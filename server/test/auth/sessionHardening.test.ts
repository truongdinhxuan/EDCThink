import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import '../../src/plugins/dbContext';
import {
  __authSessionInternals,
} from '../../src/services/auth-sessions.service';
import {
  getAllowedClientOrigins,
  getAuthConfiguration,
  isAllowedClientOrigin,
} from '../../src/config/auth';
import { getTrustProxyOption } from '../../src/config/server';

const migrationPath = 'supabase/migrations/20260908020510_auth_sessions.sql';
const reusePath = 'supabase/migrations/20260915040212_auth_session_reuse_detection.sql';
const read = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const trackedEnv = [
  'NODE_ENV',
  'ORIGIN_URL',
  'CLIENT_ORIGINS',
  'APP_REFRESH_TOKEN_TTL_DAYS',
  'APP_REFRESH_COOKIE_SECURE',
  'APP_REFRESH_COOKIE_SAME_SITE',
  'APP_REFRESH_REUSE_GRACE_SECONDS',
  'TRUST_PROXY',
] as const;
const originalEnv = Object.fromEntries(trackedEnv.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of trackedEnv) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('AUTH Phase 1 session hardening', () => {
  it('generates a 256-bit opaque refresh secret and stores only SHA-256 material', () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000';
    const token = __authSessionInternals.createRefreshToken(sessionId);
    const parsed = __authSessionInternals.parseRefreshToken(token);

    assert.ok(token.startsWith(`${sessionId}.`));
    assert.equal(token.split('.')[1].length, 43);
    assert.equal(parsed?.sessionId, sessionId);
    assert.equal(parsed?.tokenHash.length, 64);
    assert.notEqual(parsed?.tokenHash, token);
  });

  it('defines a backend-only RLS session table with expiry and revocation indexes', () => {
    const migration = read(migrationPath);
    assert.match(migration, /create table public\.auth_sessions/i);
    assert.match(migration, /refresh_token_hash text not null/i);
    assert.match(migration, /constraint auth_sessions_refresh_token_hash_key unique/i);
    assert.match(migration, /where revoked_at is null/i);
    assert.match(migration, /enable row level security/i);
    assert.match(migration, /revoke all on table public\.auth_sessions from public, anon, authenticated/i);
    assert.match(migration, /grant select, insert, update, delete on table public\.auth_sessions to service_role/i);
  });

  it('uses one conditional UPDATE as the refresh rotation compare-and-swap', () => {
    const migration = read(migrationPath);
    const functionBody = migration.match(/create or replace function public\.rotate_auth_session[\s\S]*?\$\$;/i)?.[0] ?? '';
    assert.match(functionBody, /session\.refresh_token_hash = p_old_refresh_token_hash/i);
    assert.match(functionBody, /set refresh_token_hash = p_new_refresh_token_hash/i);
    assert.match(functionBody, /session\.revoked_at is null/i);
    assert.match(functionBody, /session\.expires_at > p_used_at/i);
    assert.match(functionBody, /app_user\.is_verified = true/i);
  });

  it('pins access JWT verification to HS256, issuer, audience and short default TTL', () => {
    const plugin = read('src/plugins/jwt.ts');
    assert.match(plugin, /algorithm: 'HS256'/);
    assert.match(plugin, /algorithms: \['HS256'\]/);
    assert.match(plugin, /allowedIss: config\.issuer/);
    assert.match(plugin, /allowedAud: config\.audience/);
    assert.equal(getAuthConfiguration().accessTokenTtl, '30m');
  });

  it('uses exact ENV origins and secure HttpOnly cookie defaults', () => {
    process.env.NODE_ENV = 'production';
    process.env.ORIGIN_URL = 'https://vf.example.com';
    process.env.CLIENT_ORIGINS = 'https://admin.example.com, https://vf.example.com';
    delete process.env.APP_REFRESH_COOKIE_SECURE;
    delete process.env.APP_REFRESH_COOKIE_SAME_SITE;

    assert.deepEqual(getAllowedClientOrigins(), [
      'https://vf.example.com',
      'https://admin.example.com',
    ]);
    assert.equal(isAllowedClientOrigin('https://admin.example.com'), true);
    assert.equal(isAllowedClientOrigin('https://evil.example.com'), false);
    assert.equal(isAllowedClientOrigin(undefined), false);
    const cookie = getAuthConfiguration().refreshCookieOptions;
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.secure, true);
    assert.equal(cookie.sameSite, 'none');
    assert.equal(cookie.path, '/auth');
  });

  it('exposes login, refresh and idempotent logout with login rate limiting', () => {
    const routes = read('src/routes/auth/index.ts');
    const controller = read('src/controllers/auth/login.ts');
    assert.match(routes, /post\("\/login"[\s\S]*max: 5[\s\S]*timeWindow: '1 minute'/);
    assert.match(routes, /post\('\/refresh'/);
    assert.match(routes, /post\('\/logout'/);
    assert.match(controller, /accessToken/);
    assert.doesNotMatch(controller, /send\(\{[\s\S]*refreshToken:/);
    assert.match(controller, /clearRefreshCookie/);
  });

  it('validates every access token against its active server session', () => {
    const middleware = read('src/middleware/auth.ts');
    const authorization = read('src/services/authorization.service.ts');
    assert.match(middleware, /typeof request\.user\.sid !== 'string'/);
    assert.match(middleware, /getEffectivePermissions\([\s\S]*tokenSessionId/);
    assert.match(authorization, /from\('auth_sessions'\)/);
    assert.match(authorization, /\.is\('revoked_at', null\)/);
    assert.match(authorization, /\.gt\('expires_at'/);
  });

  it('revokes all user sessions after password or account security changes', () => {
    const users = read('src/services/users.service.ts');
    assert.match(users, /async updatePassword[\s\S]*revokeAllForUser\(id\)/);
    assert.match(users, /async setPassword[\s\S]*revokeAllForUser\(id\)/);
    assert.match(users, /async deactivate[\s\S]*revokeAllForUser\(id\)/);
  });
});

describe('AUTH Phase 2 refresh token reuse detection', () => {
  const sessionId = '550e8400-e29b-41d4-a716-446655440000';
  const graceSession = (rotatedAt: string, previousHash: string) => ({
    previous_refresh_token_hash: previousHash,
    previous_rotated_at: rotatedAt,
  });

  it('records the replaced hash so a lost rotation stays identifiable', () => {
    const migration = read(reusePath);
    assert.match(migration, /add column if not exists previous_refresh_token_hash text/i);
    assert.match(migration, /add column if not exists previous_rotated_at timestamptz/i);
    const functionBody = migration.match(/create or replace function public\.rotate_auth_session[\s\S]*?\$\$;/i)?.[0] ?? '';
    assert.match(functionBody, /previous_refresh_token_hash = p_old_refresh_token_hash/i);
    assert.match(functionBody, /previous_rotated_at = p_used_at/i);
    // The compare-and-swap guards must survive the rewrite.
    assert.match(functionBody, /session\.refresh_token_hash = p_old_refresh_token_hash/i);
    assert.match(functionBody, /session\.revoked_at is null/i);
    assert.match(migration, /grant execute on function public\.rotate_auth_session/i);
  });

  it('accepts the immediately previous token only inside the grace window', () => {
    delete process.env.APP_REFRESH_REUSE_GRACE_SECONDS;
    const token = __authSessionInternals.createRefreshToken(sessionId);
    const hash = __authSessionInternals.hashRefreshToken(token);
    const now = new Date();
    const at = (secondsAgo: number) =>
      new Date(now.getTime() - secondsAgo * 1000).toISOString();

    assert.equal(
      __authSessionInternals.isWithinRotationGrace(
        graceSession(at(5), hash), hash, now.toISOString(),
      ),
      true,
      'a concurrent tab replaying the token it just lost must be tolerated',
    );
    assert.equal(
      __authSessionInternals.isWithinRotationGrace(
        graceSession(at(31), hash), hash, now.toISOString(),
      ),
      false,
      'the same token replayed after the window is a leak',
    );
  });

  it('never treats an unrelated or unrecorded token as a concurrent client', () => {
    const currentHash = __authSessionInternals.hashRefreshToken(
      __authSessionInternals.createRefreshToken(sessionId),
    );
    const staleHash = __authSessionInternals.hashRefreshToken(
      __authSessionInternals.createRefreshToken(sessionId),
    );
    const now = new Date().toISOString();
    const justNow = new Date(Date.now() - 1000).toISOString();

    assert.equal(
      __authSessionInternals.isWithinRotationGrace(
        graceSession(justNow, currentHash), staleHash, now,
      ),
      false,
      'a token from further back in the chain is not the one rotation replaced',
    );
    assert.equal(
      __authSessionInternals.isWithinRotationGrace(
        { previous_refresh_token_hash: null, previous_rotated_at: null }, currentHash, now,
      ),
      false,
      'a session that never rotated has no previous token to forgive',
    );
  });

  it('honours a configured grace window and rejects an invalid one', () => {
    process.env.APP_REFRESH_REUSE_GRACE_SECONDS = '0';
    assert.equal(getAuthConfiguration().refreshReuseGraceSeconds, 0);
    process.env.APP_REFRESH_REUSE_GRACE_SECONDS = '301';
    assert.throws(() => getAuthConfiguration(), /0 to 300/);
  });

  it('revokes the affected session on reuse and leaves the cookie alone on grace', () => {
    const service = read('src/services/auth-sessions.service.ts');
    const controller = read('src/controllers/auth/login.ts');
    assert.match(service, /resolveFailedRotation/);
    assert.match(service, /Refresh token reuse detected[\s\S]*revokeSession\(session\.id\)/);
    // Session scoped, not account wide: the session id travels in the JWT sid
    // claim, so a wider revoke would be a lockout primitive.
    assert.doesNotMatch(
      service,
      /Refresh token reuse detected[\s\S]{0,200}revokeAllForUser/,
    );
    assert.match(service, /rotated: false/);
    assert.match(controller, /if \(session\.rotated\) \{\s*setRefreshCookie/);
  });

  it('rate limits the unauthenticated session endpoints', () => {
    const routes = read('src/routes/auth/index.ts');
    assert.match(routes, /SESSION_ENDPOINT_RATE_LIMIT/);
    assert.match(routes, /post\('\/refresh'[\s\S]*config: \{ rateLimit: SESSION_ENDPOINT_RATE_LIMIT \}/);
    assert.match(routes, /post\('\/logout'[\s\S]*config: \{ rateLimit: SESSION_ENDPOINT_RATE_LIMIT \}/);
  });

  it('sends baseline security headers without fighting the Swagger UI policy', () => {
    const plugin = read('src/plugins/helmet.ts');
    assert.match(plugin, /@fastify\/helmet/);
    assert.match(plugin, /frameguard: \{ action: 'deny' \}/);
    assert.match(plugin, /referrerPolicy: \{ policy: 'no-referrer' \}/);
    assert.match(plugin, /hsts: production/);
    assert.match(plugin, /contentSecurityPolicy: false/);
  });

  it('keeps X-Forwarded-For untrusted until proxies are named', () => {
    delete process.env.TRUST_PROXY;
    assert.equal(getTrustProxyOption(), false);
    process.env.TRUST_PROXY = 'false';
    assert.equal(getTrustProxyOption(), false);
    process.env.TRUST_PROXY = '2';
    assert.equal(getTrustProxyOption(), 2);
    process.env.TRUST_PROXY = '10.0.0.0/8, 192.168.0.0/16';
    assert.equal(getTrustProxyOption(), '10.0.0.0/8, 192.168.0.0/16');
    process.env.TRUST_PROXY = 'true';
    assert.equal(getTrustProxyOption(), true);
    process.env.TRUST_PROXY = '0';
    assert.throws(() => getTrustProxyOption(), /1 or greater/);
  });

  it('wires trustProxy into the options fastify-cli actually reads', () => {
    const app = read('src/app.ts');
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    assert.match(app, /trustProxy: getTrustProxyOption\(\)/);
    // Exported options are ignored unless the start command opts in.
    assert.match(pkg.scripts.start, /fastify start --options/);
    assert.match(pkg.scripts.dev, /fastify start --options/);
  });
});

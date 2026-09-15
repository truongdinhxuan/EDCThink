import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getAuthConfiguration, isAllowedClientOrigin } from '../config/auth';

const REFRESH_SECRET_BYTES = 32;
const SESSION_TOKEN_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43,})$/i;

const INVALID_SESSION_MESSAGE = 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn';

interface SessionRotationRow {
  session_id: string;
  user_id: string;
  expires_at: string;
  rotation_counter: number;
}

interface FailedRotationRow {
  id: string;
  user_id: string;
  expires_at: string;
  previous_refresh_token_hash: string | null;
  previous_rotated_at: string | null;
}

export interface CreatedAuthSession {
  sessionId: string;
  userId: string;
  refreshToken: string;
  expiresAt: string;
}

export interface RotatedAuthSession extends CreatedAuthSession {
  /**
   * False when the presented token was the one the previous rotation replaced
   * and it arrived inside the grace window. The session is valid and a fresh
   * access token is issued, but the refresh cookie must be left alone so the
   * browser keeps the newer token a concurrent request already stored.
   */
  rotated: boolean;
}

export class AuthSessionError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AuthSessionError';
  }
}

const sessionFailure = (statusCode: number, message: string): never => {
  throw new AuthSessionError(statusCode, message);
};

const hashRefreshToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

const createRefreshToken = (sessionId: string): string =>
  `${sessionId}.${randomBytes(REFRESH_SECRET_BYTES).toString('base64url')}`;

const parseRefreshToken = (
  token: string | undefined,
): { sessionId: string; tokenHash: string } | null => {
  if (!token) return null;
  const match = SESSION_TOKEN_PATTERN.exec(token);
  if (!match) return null;
  return { sessionId: match[1], tokenHash: hashRefreshToken(token) };
};

/**
 * True when the presented token is exactly the one the last rotation replaced
 * and that rotation happened recently enough to be the same burst of requests.
 * Anything else that fails the compare-and-swap is a token from further back in
 * the chain, which no honest client still holds.
 */
const isWithinRotationGrace = (
  session: Pick<FailedRotationRow, 'previous_refresh_token_hash' | 'previous_rotated_at'>,
  tokenHash: string,
  atIso: string,
): boolean => {
  const { previous_refresh_token_hash: previousHash, previous_rotated_at: rotatedAt } = session;
  if (!previousHash || !rotatedAt || previousHash !== tokenHash) return false;

  const elapsedMs = Date.parse(atIso) - Date.parse(rotatedAt);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return false;
  return elapsedMs <= getAuthConfiguration().refreshReuseGraceSeconds * 1000;
};

export const requireTrustedAuthOrigin = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  if (!isAllowedClientOrigin(request.headers.origin)) {
    return reply.code(403).send({ error: 'Origin không được phép thực hiện thao tác phiên' });
  }
};

export class AuthSessionsService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get db() {
    return this.fastify.supabaseAdmin;
  }

  async create(
    userId: string,
    metadata: { userAgent?: string; ipAddress?: string },
  ): Promise<CreatedAuthSession> {
    const config = getAuthConfiguration();
    const sessionId = randomUUID();
    const refreshToken = createRefreshToken(sessionId);
    const expiresAt = new Date(
      Date.now() + config.refreshTokenTtlSeconds * 1000,
    ).toISOString();

    const { error } = await this.db.from('auth_sessions').insert({
      id: sessionId,
      user_id: userId,
      refresh_token_hash: hashRefreshToken(refreshToken),
      expires_at: expiresAt,
      user_agent: metadata.userAgent?.slice(0, 1000) || null,
      ip_address: metadata.ipAddress?.slice(0, 255) || null,
    });
    if (error) {
      this.fastify.log.error({ err: error }, 'Unable to create auth session');
      return sessionFailure(500, 'Không thể tạo phiên đăng nhập');
    }

    return { sessionId, userId, refreshToken, expiresAt };
  }

  async rotate(rawToken: string | undefined): Promise<RotatedAuthSession> {
    const parsed = parseRefreshToken(rawToken);
    if (!parsed) return sessionFailure(401, INVALID_SESSION_MESSAGE);

    const refreshToken = createRefreshToken(parsed.sessionId);
    const usedAt = new Date().toISOString();
    const { data, error } = await this.db.rpc('rotate_auth_session', {
      p_session_id: parsed.sessionId,
      p_old_refresh_token_hash: parsed.tokenHash,
      p_new_refresh_token_hash: hashRefreshToken(refreshToken),
      p_used_at: usedAt,
    });

    if (error) {
      this.fastify.log.error({ err: error }, 'Unable to rotate auth session');
      return sessionFailure(500, 'Không thể làm mới phiên đăng nhập');
    }
    const row = Array.isArray(data)
      ? data[0] as SessionRotationRow | undefined
      : data as SessionRotationRow | null;

    if (!row) return this.resolveFailedRotation(parsed, rawToken!, usedAt);

    return {
      sessionId: row.session_id,
      userId: row.user_id,
      refreshToken,
      expiresAt: row.expires_at,
      rotated: true,
    };
  }

  /**
   * The compare-and-swap matched nothing. Either the session is unusable
   * (expired, revoked, user disabled) or the presented token is simply not the
   * current one. Only the second case is interesting: a token that the previous
   * rotation just replaced is a concurrent client, while an older one is a token
   * somebody kept a copy of. Treat that as a leak and revoke the session so the
   * copy and the original both stop working.
   *
   * Revocation is deliberately scoped to the affected session rather than every
   * session of the user: the session id is the readable half of the refresh
   * token and also travels in the access token's `sid` claim, so widening the
   * blast radius would hand anyone who learns a session id a way to lock an
   * account out of the system entirely.
   */
  private async resolveFailedRotation(
    parsed: { sessionId: string; tokenHash: string },
    rawToken: string,
    usedAt: string,
  ): Promise<RotatedAuthSession> {
    const { data, error } = await this.db
      .from('auth_sessions')
      .select('id, user_id, expires_at, previous_refresh_token_hash, previous_rotated_at')
      .eq('id', parsed.sessionId)
      .is('revoked_at', null)
      .gt('expires_at', usedAt)
      .maybeSingle();

    if (error) {
      this.fastify.log.error({ err: error }, 'Unable to classify a failed refresh rotation');
      return sessionFailure(500, 'Không thể làm mới phiên đăng nhập');
    }

    const session = data as FailedRotationRow | null;
    if (!session) return sessionFailure(401, INVALID_SESSION_MESSAGE);

    if (isWithinRotationGrace(session, parsed.tokenHash, usedAt)) {
      this.fastify.log.info(
        { sessionId: session.id },
        'Concurrent refresh served from the rotation grace window',
      );
      return {
        sessionId: session.id,
        userId: session.user_id,
        refreshToken: rawToken,
        expiresAt: session.expires_at,
        rotated: false,
      };
    }

    this.fastify.log.warn(
      { sessionId: session.id, userId: session.user_id },
      'Refresh token reuse detected, revoking the affected session',
    );
    await this.revokeSession(session.id);
    return sessionFailure(401, INVALID_SESSION_MESSAGE);
  }

  async revokeSession(sessionId: string): Promise<void> {
    const { error } = await this.db
      .from('auth_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', sessionId)
      .is('revoked_at', null);
    if (error) {
      this.fastify.log.error({ err: error }, 'Unable to revoke auth session');
      return sessionFailure(500, 'Không thể đóng phiên đăng nhập');
    }
  }

  async revokeCurrent(rawToken: string | undefined): Promise<void> {
    const parsed = parseRefreshToken(rawToken);
    if (!parsed) return;

    const { error } = await this.db
      .from('auth_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', parsed.sessionId)
      .eq('refresh_token_hash', parsed.tokenHash)
      .is('revoked_at', null);
    if (error) {
      this.fastify.log.error({ err: error }, 'Unable to revoke current auth session');
      return sessionFailure(500, 'Không thể đóng phiên đăng nhập');
    }
  }

  async revokeAllForUser(userId: string): Promise<void> {
    const { error } = await this.db
      .from('auth_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('revoked_at', null);
    if (error) {
      this.fastify.log.error({ err: error }, 'Unable to revoke user auth sessions');
      return sessionFailure(500, 'Không thể thu hồi phiên đăng nhập người dùng');
    }
  }
}

export const getRefreshCookie = (request: FastifyRequest): string | undefined => {
  const config = getAuthConfiguration();
  return request.cookies[config.refreshCookieName];
};

export const setRefreshCookie = (
  reply: FastifyReply,
  token: string,
  expiresAt: string,
): void => {
  const config = getAuthConfiguration();
  const remainingSeconds = Math.max(
    0,
    Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000),
  );
  reply.setCookie(config.refreshCookieName, token, {
    ...config.refreshCookieOptions,
    maxAge: remainingSeconds,
    expires: new Date(expiresAt),
  });
};

export const clearRefreshCookie = (reply: FastifyReply): void => {
  const config = getAuthConfiguration();
  const { maxAge: _maxAge, ...options } = config.refreshCookieOptions;
  reply.clearCookie(config.refreshCookieName, options);
};

export const authSessionMetadata = (
  request: FastifyRequest,
): { userAgent?: string; ipAddress?: string } => ({
  userAgent: request.headers['user-agent'],
  ipAddress: request.ip,
});

export const __authSessionInternals = {
  createRefreshToken,
  hashRefreshToken,
  parseRefreshToken,
  isWithinRotationGrace,
};

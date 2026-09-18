import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import { createClient } from '@supabase/supabase-js';
import app from '../../dist/app.js';
import { hashPassword } from '../../dist/utils/password.js';
import { UsersService } from '../../dist/services/users.service.js';

const vinfastId = '969800002';
const initialPassword = 'AuthPhase1!';
const origin = process.env.ORIGIN_URL;
const secret = process.env.APP_JWT_SECRET;
assert.ok(origin, 'ORIGIN_URL is required');
assert.ok(secret, 'APP_JWT_SECRET is required');
assert.ok(process.env.SUPABASE_URL, 'SUPABASE_URL is required');
assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY is required');

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const cookiePair = (response) => {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  assert.ok(value, 'Expected Set-Cookie');
  return value.split(';')[0];
};

const tokenPayload = (token) => JSON.parse(
  Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
);

const signAccessToken = (payload, algorithm = 'HS256') => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: algorithm, typ: 'JWT' });
  const body = encode(payload);
  const digest = algorithm === 'HS384' ? 'sha384' : 'sha256';
  const signature = createHmac(digest, secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
};

const login = (server, password = initialPassword, remoteAddress = '10.1.0.1') =>
  server.inject({
    method: 'POST',
    url: '/auth/login',
    remoteAddress,
    headers: { origin },
    payload: { vinfast_id: vinfastId, password },
  });

let userId;

const cleanup = async () => {
  if (!userId) return;
  await db.from('auth_sessions').delete().eq('user_id', userId);
  await db.from('users').update({ is_active: false, is_deleted: true }).eq('id', userId);
};

const [{ data: role }, { data: area }] = await Promise.all([
  db.from('roles').select('id').eq('code', 'DATA_PACKING').eq('is_active', true).single(),
  db.from('areas').select('id').eq('code', 'EDC_LOGISTICS').single(),
]);
assert.ok(role?.id && area?.id, 'DATA_PACKING role and EDC_LOGISTICS area are required');
const passwordHash = await hashPassword(initialPassword);
const { data: existingUser, error: existingUserError } = await db
  .from('users')
  .select('id')
  .eq('vinfast_id', vinfastId)
  .maybeSingle();
assert.equal(existingUserError, null, existingUserError?.message);
if (existingUser?.id) {
  userId = existingUser.id;
} else {
  const { data: createdId, error: createError } = await db.rpc('create_internal_user', {
    p_email: 'auth-phase1-session@example.test',
    p_first_name: 'Auth',
    p_last_name: 'Phase1',
    p_vinfast_id: vinfastId,
    p_phone_number: null,
    p_avatar_url: null,
    p_role_id: role.id,
    p_area_id: area.id,
    p_managed_by_user_id: null,
    p_password_hash: passwordHash,
  });
  assert.equal(createError, null, createError?.message);
  assert.equal(typeof createdId, 'string');
  userId = createdId;
}
const { error: userUpdateError } = await db.from('users').update({
  email: 'auth-phase1-session@example.test',
  first_name: 'Auth',
  last_name: 'Phase1',
  area_id: area.id,
  is_active: true,
  is_verified: true,
  is_deleted: false,
}).eq('id', userId);
assert.equal(userUpdateError, null, userUpdateError?.message);
const { error: roleError } = await db.from('user_roles').upsert({
  user_id: userId,
  role_id: role.id,
  is_active: true,
  is_deleted: false,
}, { onConflict: 'user_id,role_id' });
assert.equal(roleError, null, roleError?.message);
const { error: credentialError } = await db.from('user_credentials').upsert({
  user_id: userId,
  password_hash: passwordHash,
  password_changed_at: new Date().toISOString(),
}, { onConflict: 'user_id' });
assert.equal(credentialError, null, credentialError?.message);

const server = Fastify({ logger: false });
try {
  await server.register(app);
  await server.ready();

  const firstLogin = await login(server);
  assert.equal(firstLogin.statusCode, 200, firstLogin.body);
  const firstBody = firstLogin.json();
  assert.equal(typeof firstBody.accessToken, 'string');
  assert.equal('refreshToken' in firstBody, false);
  assert.equal('token' in firstBody, false);
  const firstCookie = cookiePair(firstLogin);
  const setCookie = String(firstLogin.headers['set-cookie']);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Path=\/auth/i);

  const claims = tokenPayload(firstBody.accessToken);
  assert.equal(claims.sub, userId);
  assert.equal(typeof claims.sid, 'string');
  assert.equal(claims.iss, process.env.APP_JWT_ISSUER ?? 'vf-api');
  assert.equal(claims.aud, process.env.APP_JWT_AUDIENCE ?? 'vf-client');
  assert.equal('permissions' in claims, false);
  assert.equal('roleIds' in claims, false);
  assert.equal('areaId' in claims, false);
  assert.ok(claims.exp - claims.iat <= 30 * 60 + 1);

  const { data: storedSession } = await db
    .from('auth_sessions')
    .select('refresh_token_hash,rotation_counter,revoked_at')
    .eq('id', claims.sid)
    .single();
  assert.equal(storedSession?.refresh_token_hash.length, 64);
  assert.equal(firstCookie.includes(storedSession?.refresh_token_hash ?? ''), false);

  const me = await server.inject({
    method: 'GET',
    url: '/auth/me',
    headers: { authorization: `Bearer ${firstBody.accessToken}` },
  });
  assert.equal(me.statusCode, 200, me.body);

  const [concurrentA, concurrentB] = await Promise.all([
    server.inject({ method: 'POST', url: '/auth/refresh', headers: { cookie: firstCookie, origin } }),
    server.inject({ method: 'POST', url: '/auth/refresh', headers: { cookie: firstCookie, origin } }),
  ]);
  const concurrentCodes = [concurrentA.statusCode, concurrentB.statusCode].sort();
  assert.deepEqual(concurrentCodes, [200, 401]);
  const rotatedResponse = concurrentA.statusCode === 200 ? concurrentA : concurrentB;
  const rotatedCookie = cookiePair(rotatedResponse);
  assert.notEqual(rotatedCookie, firstCookie);

  const replay = await server.inject({
    method: 'POST', url: '/auth/refresh', headers: { cookie: firstCookie, origin },
  });
  assert.equal(replay.statusCode, 401, replay.body);

  const rotateAgain = await server.inject({
    method: 'POST', url: '/auth/refresh', headers: { cookie: rotatedCookie, origin },
  });
  assert.equal(rotateAgain.statusCode, 200, rotateAgain.body);
  const latestCookie = cookiePair(rotateAgain);
  const latestToken = rotateAgain.json().accessToken;

  const wrongOrigin = await server.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: { cookie: latestCookie, origin: 'https://not-allowed.example' },
  });
  assert.equal(wrongOrigin.statusCode, 403, wrongOrigin.body);

  const secondDeviceLogin = await login(server, initialPassword, '10.1.0.2');
  assert.equal(secondDeviceLogin.statusCode, 200, secondDeviceLogin.body);
  let secondDeviceToken = secondDeviceLogin.json().accessToken;
  const secondDeviceCookie = cookiePair(secondDeviceLogin);

  const logout = await server.inject({
    method: 'POST', url: '/auth/logout', headers: { cookie: latestCookie, origin },
  });
  assert.equal(logout.statusCode, 200, logout.body);
  const logoutAgain = await server.inject({
    method: 'POST', url: '/auth/logout', headers: { cookie: latestCookie, origin },
  });
  assert.equal(logoutAgain.statusCode, 200, logoutAgain.body);

  const revokedAccess = await server.inject({
    method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${latestToken}` },
  });
  assert.equal(revokedAccess.statusCode, 401, revokedAccess.body);
  const otherDeviceStillActive = await server.inject({
    method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${secondDeviceToken}` },
  });
  assert.equal(otherDeviceStillActive.statusCode, 200, otherDeviceStillActive.body);

  const activeSessionClaims = tokenPayload(secondDeviceToken);
  const shortAccessToken = signAccessToken({
    sub: userId,
    sid: activeSessionClaims.sid,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 1,
    iss: 'vf-api',
    aud: 'vf-client',
  });
  const shortAccessWorks = await server.inject({
    method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${shortAccessToken}` },
  });
  assert.equal(shortAccessWorks.statusCode, 200, shortAccessWorks.body);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1100));
  const expiredAccess = await server.inject({
    method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${shortAccessToken}` },
  });
  assert.equal(expiredAccess.statusCode, 401, expiredAccess.body);
  const accessRecovery = await server.inject({
    method: 'POST', url: '/auth/refresh', headers: { cookie: secondDeviceCookie, origin },
  });
  assert.equal(accessRecovery.statusCode, 200, accessRecovery.body);
  secondDeviceToken = accessRecovery.json().accessToken;

  const secondClaims = tokenPayload(secondDeviceToken);
  const now = Math.floor(Date.now() / 1000);
  const invalidTokens = [
    signAccessToken({ sub: userId, exp: now + 60, iss: 'wrong', aud: 'vf-client', sid: secondClaims.sid }),
    signAccessToken({ sub: userId, exp: now + 60, iss: 'vf-api', aud: 'wrong', sid: secondClaims.sid }),
    signAccessToken({ sub: userId, exp: now - 1, iss: 'vf-api', aud: 'vf-client', sid: secondClaims.sid }),
    signAccessToken({ sub: userId, exp: now + 60, iss: 'vf-api', aud: 'vf-client' }),
    signAccessToken({ sub: userId, exp: now + 60, iss: 'vf-api', aud: 'vf-client', sid: secondClaims.sid }, 'HS384'),
    `${secondDeviceToken.slice(0, -1)}${secondDeviceToken.endsWith('a') ? 'b' : 'a'}`,
    'not-a-jwt',
  ];
  for (const token of invalidTokens) {
    const invalid = await server.inject({
      method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(invalid.statusCode, 401, invalid.body);
  }

  const noSub = signAccessToken({
    exp: now + 60,
    iss: 'vf-api',
    aud: 'vf-client',
    sid: secondClaims.sid,
  });
  const noSubResponse = await server.inject({
    method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${noSub}` },
  });
  assert.equal(noSubResponse.statusCode, 401, noSubResponse.body);

  const missingCookie = await server.inject({
    method: 'POST', url: '/auth/refresh', headers: { origin },
  });
  assert.equal(missingCookie.statusCode, 401, missingCookie.body);
  const missingOrigin = await server.inject({
    method: 'POST', url: '/auth/refresh', headers: { cookie: secondDeviceCookie },
  });
  assert.equal(missingOrigin.statusCode, 403, missingOrigin.body);
  const garbageCookie = await server.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: { origin, cookie: 'vf_refresh_token=garbage' },
  });
  assert.equal(garbageCookie.statusCode, 401, garbageCookie.body);

  const expiredLogin = await login(server, initialPassword, '10.1.0.4');
  assert.equal(expiredLogin.statusCode, 200, expiredLogin.body);
  const expiredClaims = tokenPayload(expiredLogin.json().accessToken);
  const { error: expireError } = await db.from('auth_sessions').update({
    created_at: new Date(Date.now() - 2 * 86400_000).toISOString(),
    expires_at: new Date(Date.now() - 86400_000).toISOString(),
  }).eq('id', expiredClaims.sid);
  assert.equal(expireError, null, expireError?.message);
  const expiredRefresh = await server.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: { origin, cookie: cookiePair(expiredLogin) },
  });
  assert.equal(expiredRefresh.statusCode, 401, expiredRefresh.body);

  const revokedLogin = await login(server, initialPassword, '10.1.0.5');
  assert.equal(revokedLogin.statusCode, 200, revokedLogin.body);
  const revokedClaims = tokenPayload(revokedLogin.json().accessToken);
  const { error: revokeError } = await db.from('auth_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', revokedClaims.sid);
  assert.equal(revokeError, null, revokeError?.message);
  const revokedRefresh = await server.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: { origin, cookie: cookiePair(revokedLogin) },
  });
  assert.equal(revokedRefresh.statusCode, 401, revokedRefresh.body);

  const wrongPassword = await login(server, 'WrongPassword1!', '10.1.0.6');
  assert.equal(wrongPassword.statusCode, 401, wrongPassword.body);
  assert.equal(wrongPassword.json().error, 'VinFast ID hoặc mật khẩu không đúng');
  const unknownUser = await server.inject({
    method: 'POST',
    url: '/auth/login',
    remoteAddress: '10.1.0.7',
    headers: { origin },
    payload: { vinfast_id: '123456789', password: 'WrongPassword1!' },
  });
  assert.equal(unknownUser.statusCode, 401, unknownUser.body);
  assert.equal(unknownUser.json().error, wrongPassword.json().error);

  const { data: disabledUser, error: disableError } = await db
    .from('users')
    .update({ is_active: false })
    .eq('id', userId)
    .select('is_active')
    .single();
  assert.equal(disableError, null, disableError?.message);
  assert.equal(disabledUser?.is_active, false);
  const inactiveLogin = await login(server, initialPassword, '10.1.0.8');
  assert.equal(inactiveLogin.statusCode, 403, inactiveLogin.body);
  const inactiveAccess = await server.inject({
    method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${secondDeviceToken}` },
  });
  assert.equal(inactiveAccess.statusCode, 403, inactiveAccess.body);
  const { error: reactivateError } = await db
    .from('users')
    .update({ is_active: true, is_deleted: false })
    .eq('id', userId);
  assert.equal(reactivateError, null, reactivateError?.message);

  const corsLocalhost = await server.inject({
    method: 'OPTIONS',
    url: '/auth/refresh',
    headers: {
      origin: 'http://localhost:5173',
      'access-control-request-method': 'POST',
    },
  });
  assert.equal(corsLocalhost.headers['access-control-allow-origin'], 'http://localhost:5173');
  assert.equal(corsLocalhost.headers['access-control-allow-credentials'], 'true');
  const corsLoopback = await server.inject({
    method: 'OPTIONS',
    url: '/auth/refresh',
    headers: {
      origin: 'http://127.0.0.1:5173',
      'access-control-request-method': 'POST',
    },
  });
  assert.equal(corsLoopback.headers['access-control-allow-origin'], 'http://127.0.0.1:5173');
  assert.equal(corsLoopback.headers['access-control-allow-credentials'], 'true');

  const limited = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    limited.push(await login(server, 'WrongPassword1!', '10.1.0.3'));
  }
  assert.equal(limited.at(-1)?.statusCode, 429, limited.at(-1)?.body);
  const notPermanentlyLocked = await login(server, initialPassword, '10.1.0.9');
  assert.equal(notPermanentlyLocked.statusCode, 200, notPermanentlyLocked.body);

  const changedPassword = 'AuthPhase1Changed!';
  const userService = new UsersService({ supabaseAdmin: db, log: server.log });
  await userService.setPassword(userId, changedPassword);
  const { count: activeAfterPasswordChange, error: activeSessionError } = await db
    .from('auth_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('revoked_at', null);
  assert.equal(activeSessionError, null, activeSessionError?.message);
  assert.equal(activeAfterPasswordChange, 0);
  const oldAccessAfterPasswordChange = await server.inject({
    method: 'GET',
    url: '/auth/me',
    headers: { authorization: `Bearer ${notPermanentlyLocked.json().accessToken}` },
  });
  assert.equal(oldAccessAfterPasswordChange.statusCode, 401, oldAccessAfterPasswordChange.body);
  const oldPasswordAfterChange = await login(server, initialPassword, '10.1.0.10');
  assert.equal(oldPasswordAfterChange.statusCode, 401, oldPasswordAfterChange.body);
  const newPasswordLogin = await login(server, changedPassword, '10.1.0.11');
  assert.equal(newPasswordLogin.statusCode, 200, newPasswordLogin.body);

  await userService.deactivate(userId);
  const { count: activeAfterDeactivate, error: deactivateSessionError } = await db
    .from('auth_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('revoked_at', null);
  assert.equal(deactivateSessionError, null, deactivateSessionError?.message);
  assert.equal(activeAfterDeactivate, 0);
  const accessAfterDeactivate = await server.inject({
    method: 'GET',
    url: '/auth/me',
    headers: { authorization: `Bearer ${newPasswordLogin.json().accessToken}` },
  });
  assert.equal(accessAfterDeactivate.statusCode, 401, accessAfterDeactivate.body);

  console.log('auth-session-http: PASS');
} finally {
  await server.close();
  await cleanup();
}

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const apiUrl = process.env.PHASE6_API_URL ?? 'http://localhost:3000';
const origin = process.env.ORIGIN_URL ?? 'http://localhost:5173';
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(supabaseUrl, 'SUPABASE_URL is required');
assert.ok(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY is required');
assert.match(
  supabaseUrl,
  /^http:\/\/(?:127\.0\.0\.1|localhost):54321\/?$/,
  'This integration test is local-only',
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});
const fixture = {
  roles: {
    packing: randomUUID(),
    logistics: randomUUID(),
    noScope: randomUUID(),
    roleReader: randomUUID(),
  },
  users: {
    scoped: randomUUID(),
    noScope: randomUUID(),
    roleReader: randomUUID(),
  },
};
const suffix = `${Date.now()}_${randomInt(1000, 9999)}`;
const sessionIds = [];
const createdAreaIds = [];
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const signAccessToken = (userId, sessionId) => {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    sub: userId,
    sid: sessionId,
    iat: now,
    exp: now + 300,
    iss: process.env.APP_JWT_ISSUER ?? 'vf-api',
    aud: process.env.APP_JWT_AUDIENCE ?? 'vf-client',
  });
  const signature = createHmac('sha256', process.env.APP_JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
};
const jsonRequest = async (path, token, init = {}) => {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      origin,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  return { response, body: await response.json() };
};
const createTestSession = async (userId, label) => {
  const id = randomUUID();
  const { error } = await supabase.from('auth_sessions').insert({
    id,
    user_id: userId,
    refresh_token_hash: `phase8-smoke-${randomUUID()}`,
    expires_at: new Date(Date.now() + 300_000).toISOString(),
    user_agent: `Phase 8 Area Type integration (${label})`,
    ip_address: '127.0.0.1',
  });
  assert.equal(error, null, error?.message);
  sessionIds.push(id);
  return id;
};
const assertNoError = (error) => assert.equal(error, null, error?.message);
const runLocalSql = (sql) => execFileSync('docker', [
  'exec', 'supabase_db_server', 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
  '-U', 'postgres', '-d', 'postgres', '-c', sql,
], { stdio: 'pipe' });

try {
  const { data: areaTypes, error: areaTypeError } = await supabase
    .from('area_types')
    .select('id,code')
    .in('code', ['PACKING', 'LOGISTICS', 'SHOP'])
    .eq('is_active', true)
    .eq('is_deleted', false);
  assertNoError(areaTypeError);
  const areaTypeByCode = new Map(areaTypes.map((item) => [item.code, item.id]));
  assert.deepEqual([...areaTypeByCode.keys()].sort(), ['LOGISTICS', 'PACKING', 'SHOP']);

  const areaCodes = ['DG_HATINH', 'DG_INDIA', 'DG_INDO', 'EDC_LOGISTICS', 'VTDG'];
  const { data: existingAreas, error: existingAreaError } = await supabase
    .from('areas')
    .select('id,code,area_type_id')
    .in('code', areaCodes);
  assertNoError(existingAreaError);
  const existingCodes = new Set(existingAreas.map((item) => item.code));
  const areaDefinitions = [
    ['DG_HATINH', 'Đóng gói Hà Tĩnh', 'PACKING'],
    ['DG_INDIA', 'Đóng gói Ấn Độ', 'PACKING'],
    ['DG_INDO', 'Đóng gói Indonesia', 'PACKING'],
    ['EDC_LOGISTICS', 'EDC Logistics', 'LOGISTICS'],
    ['VTDG', 'Vật tư đóng gói', null],
  ];
  const missingAreas = areaDefinitions
    .filter(([code]) => !existingCodes.has(code))
    .map(([code, name, areaTypeCode]) => {
      const id = randomUUID();
      createdAreaIds.push(id);
      return {
        id,
        code,
        name,
        area_type_id: areaTypeCode ? areaTypeByCode.get(areaTypeCode) : null,
        is_active: true,
        is_deleted: false,
      };
    });
  if (missingAreas.length > 0) {
    const values = missingAreas.map((area) => `(
      '${area.id}', '${area.code}', '${area.name.replaceAll("'", "''")}',
      ${area.area_type_id ? `'${area.area_type_id}'` : 'null'}, true, false
    )`).join(',');
    runLocalSql(`
      insert into public.areas(
        id, code, name, area_type_id, is_active, is_deleted
      ) values ${values};
    `);
  }
  const { data: areas, error: areaError } = await supabase
    .from('areas')
    .select('id,code,area_type_id')
    .in('code', areaCodes);
  assertNoError(areaError);
  const areaByCode = new Map(areas.map((item) => [item.code, item]));
  assert.equal(areaByCode.get('DG_HATINH').area_type_id, areaTypeByCode.get('PACKING'));
  assert.equal(areaByCode.get('DG_INDIA').area_type_id, areaTypeByCode.get('PACKING'));
  assert.equal(areaByCode.get('DG_INDO').area_type_id, areaTypeByCode.get('PACKING'));
  assert.equal(areaByCode.get('EDC_LOGISTICS').area_type_id, areaTypeByCode.get('LOGISTICS'));
  assert.equal(areaByCode.get('VTDG').area_type_id, null);

  const { data: permissions, error: permissionError } = await supabase
    .from('permissions')
    .select('id,code')
    .in('code', [
      'supply.shift_order_sheet.read',
      'admin.role.read',
      'admin.role.update',
    ])
    .eq('is_active', true)
    .eq('is_deleted', false);
  assertNoError(permissionError);
  const permissionByCode = new Map(permissions.map((item) => [item.code, item.id]));
  assert.equal(permissionByCode.size, 3);

  const { data: adminRole, error: adminRoleError } = await supabase
    .from('roles')
    .select('id')
    .eq('code', 'ADMIN')
    .eq('is_system', true)
    .eq('is_active', true)
    .eq('is_deleted', false)
    .single();
  assertNoError(adminRoleError);
  const { data: adminMappings, error: adminMappingsError } = await supabase
    .from('user_roles')
    .select('user_id,user:users!user_roles_user_id_fkey(id,is_active,is_verified,is_deleted)')
    .eq('role_id', adminRole.id)
    .eq('is_active', true)
    .eq('is_deleted', false);
  assertNoError(adminMappingsError);
  const adminMapping = adminMappings.find((mapping) => {
    const user = Array.isArray(mapping.user) ? mapping.user[0] : mapping.user;
    return user?.is_active && user?.is_verified && !user?.is_deleted;
  });
  assert.ok(adminMapping, 'An active verified system ADMIN user is required');

  const roleRows = [
    [fixture.roles.packing, `P8_PACKING_${suffix}`, 'Phase 8 Packing scope'],
    [fixture.roles.logistics, `P8_LOGISTICS_${suffix}`, 'Phase 8 Logistics scope'],
    [fixture.roles.noScope, `P8_NO_SCOPE_${suffix}`, 'Phase 8 no scope'],
    [fixture.roles.roleReader, `P8_ROLE_READER_${suffix}`, 'Phase 8 role reader'],
  ].map(([id, code, name]) => ({
    id,
    code,
    name,
    description: 'LOCAL TEST ONLY',
    is_system: false,
    is_active: true,
    is_deleted: false,
  }));
  assertNoError((await supabase.from('roles').insert(roleRows)).error);

  const baseVinfastId = 980_000_000 + randomInt(1_000, 999_000);
  const userRows = [
    [fixture.users.scoped, baseVinfastId, fixture.roles.packing, 'Scoped'],
    [fixture.users.noScope, baseVinfastId + 1, fixture.roles.noScope, 'No Scope'],
    [fixture.users.roleReader, baseVinfastId + 2, fixture.roles.roleReader, 'Role Reader'],
  ].map(([id, vinfast_id, role_id, last_name]) => ({
    id,
    vinfast_id,
    email: `phase8-${vinfast_id}@local.test`,
    role_id,
    area_id: areaByCode.get('DG_HATINH').id,
    first_name: 'Phase 8',
    last_name,
    is_active: true,
    is_verified: true,
    is_deleted: false,
  }));
  const userValues = userRows.map((user) => `(
    '${user.id}', ${user.vinfast_id}, '${user.email}', '${user.role_id}',
    '${user.area_id}', '${user.first_name}', '${user.last_name}', true, true, false
  )`).join(',');
  runLocalSql(`
    insert into public.users(
      id, vinfast_id, email, role_id, area_id, first_name, last_name,
      is_active, is_verified, is_deleted
    ) values ${userValues};
  `);
  assertNoError((await supabase.from('user_roles').upsert([
    { user_id: fixture.users.scoped, role_id: fixture.roles.packing, is_active: true, is_deleted: false },
    { user_id: fixture.users.noScope, role_id: fixture.roles.noScope, is_active: true, is_deleted: false },
    { user_id: fixture.users.roleReader, role_id: fixture.roles.roleReader, is_active: true, is_deleted: false },
  ], { onConflict: 'user_id,role_id' })).error);

  const sheetReadId = permissionByCode.get('supply.shift_order_sheet.read');
  assertNoError((await supabase.from('role_permissions').insert([
    { role_id: fixture.roles.packing, permission_id: sheetReadId, is_active: true, is_deleted: false },
    { role_id: fixture.roles.logistics, permission_id: sheetReadId, is_active: true, is_deleted: false },
    { role_id: fixture.roles.noScope, permission_id: sheetReadId, is_active: true, is_deleted: false },
    { role_id: fixture.roles.roleReader, permission_id: permissionByCode.get('admin.role.read'), is_active: true, is_deleted: false },
  ])).error);
  assertNoError((await supabase.from('role_area_type_scopes').insert([
    { role_id: fixture.roles.packing, area_type_id: areaTypeByCode.get('PACKING') },
    { role_id: fixture.roles.logistics, area_type_id: areaTypeByCode.get('LOGISTICS') },
  ])).error);

  const adminToken = signAccessToken(
    adminMapping.user_id,
    await createTestSession(adminMapping.user_id, 'admin'),
  );
  const scopedToken = signAccessToken(
    fixture.users.scoped,
    await createTestSession(fixture.users.scoped, 'scoped'),
  );
  const noScopeToken = signAccessToken(
    fixture.users.noScope,
    await createTestSession(fixture.users.noScope, 'no-scope'),
  );
  const roleReaderToken = signAccessToken(
    fixture.users.roleReader,
    await createTestSession(fixture.users.roleReader, 'role-reader'),
  );

  const packingOnly = await jsonRequest('/me/area-scopes', scopedToken);
  assert.equal(packingOnly.response.status, 200, packingOnly.body.error);
  assert.deepEqual(packingOnly.body.data.areaTypes.map((item) => item.code), ['PACKING']);
  assert.deepEqual(
    packingOnly.body.data.areaTypes[0].areas.map((area) => area.code),
    ['DG_HATINH', 'DG_INDIA', 'DG_INDO'],
  );
  const noScope = await jsonRequest('/me/area-scopes', noScopeToken);
  assert.equal(noScope.response.status, 200, noScope.body.error);
  assert.deepEqual(noScope.body.data.areaTypes, []);
  const noScopeList = await jsonRequest(
    '/supply/shift-order-sheets?page=1&pageSize=100',
    noScopeToken,
  );
  assert.equal(noScopeList.response.status, 200, noScopeList.body.error);
  assert.equal(noScopeList.body.pagination.total, 0);

  const roleRead = await jsonRequest(
    `/roles/${fixture.roles.packing}/area-type-scopes`,
    roleReaderToken,
  );
  assert.equal(roleRead.response.status, 200, roleRead.body.error);
  const roleUpdateForbidden = await jsonRequest(
    `/roles/${fixture.roles.packing}/area-type-scopes`,
    roleReaderToken,
    { method: 'PUT', body: JSON.stringify({ areaTypeIds: [] }) },
  );
  assert.equal(roleUpdateForbidden.response.status, 403);

  const liveExpanded = await jsonRequest(
    `/roles/${fixture.roles.packing}/area-type-scopes`,
    adminToken,
    {
      method: 'PUT',
      body: JSON.stringify({
        areaTypeIds: [areaTypeByCode.get('PACKING'), areaTypeByCode.get('LOGISTICS')],
      }),
    },
  );
  assert.equal(liveExpanded.response.status, 200, liveExpanded.body.error);
  const expandedScope = await jsonRequest('/me/area-scopes', scopedToken);
  assert.deepEqual(
    expandedScope.body.data.areaTypes.map((item) => item.code),
    ['LOGISTICS', 'PACKING'],
  );

  const liveCleared = await jsonRequest(
    `/roles/${fixture.roles.packing}/area-type-scopes`,
    adminToken,
    { method: 'PUT', body: JSON.stringify({ areaTypeIds: [] }) },
  );
  assert.equal(liveCleared.response.status, 200, liveCleared.body.error);
  const clearedScope = await jsonRequest('/me/area-scopes', scopedToken);
  assert.deepEqual(clearedScope.body.data.areaTypes, []);

  const restored = await jsonRequest(
    `/roles/${fixture.roles.packing}/area-type-scopes`,
    adminToken,
    {
      method: 'PUT',
      body: JSON.stringify({ areaTypeIds: [areaTypeByCode.get('PACKING')] }),
    },
  );
  assert.equal(restored.response.status, 200, restored.body.error);
  assertNoError((await supabase.from('user_roles').insert({
    user_id: fixture.users.scoped,
    role_id: fixture.roles.logistics,
    is_active: true,
    is_deleted: false,
  })).error);
  const multiRole = await jsonRequest('/me/area-scopes', scopedToken);
  assert.deepEqual(
    multiRole.body.data.areaTypes.map((item) => item.code),
    ['LOGISTICS', 'PACKING'],
  );

  const protectedAdmin = await jsonRequest(
    `/roles/${adminRole.id}/area-type-scopes`,
    adminToken,
    { method: 'PUT', body: JSON.stringify({ areaTypeIds: [] }) },
  );
  assert.equal(protectedAdmin.response.status, 409);

  console.log(JSON.stringify({
    packingOnly: packingOnly.response.status,
    noScopeCount: noScopeList.body.pagination.total,
    roleRead: roleRead.response.status,
    roleUpdateWithoutPermission: roleUpdateForbidden.response.status,
    liveUpdate: liveExpanded.response.status,
    multiRoleTypes: multiRole.body.data.areaTypes.map((item) => item.code),
    protectedSystemAdmin: protectedAdmin.response.status,
  }));
} finally {
  const roleIds = Object.values(fixture.roles);
  const userIds = Object.values(fixture.users);
  const quoted = (values) => (values.length > 0 ? values : ['00000000-0000-0000-0000-000000000000'])
    .map((value) => `'${value}'`)
    .join(',');
  const cleanupSql = `
    begin;
    set local session_replication_role = replica;
    delete from public.auth_sessions where id in (${quoted(sessionIds)});
    delete from public.role_area_type_scopes where role_id in (${quoted(roleIds)});
    delete from public.user_roles where user_id in (${quoted(userIds)});
    delete from public.users where id in (${quoted(userIds)});
    delete from public.role_permissions where role_id in (${quoted(roleIds)});
    delete from public.roles where id in (${quoted(roleIds)});
    delete from public.areas where id in (${quoted(createdAreaIds)});
    commit;
  `;
  runLocalSql(cleanupSql);
}

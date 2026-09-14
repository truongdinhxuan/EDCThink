import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

const migration = read('supabase/migrations/20260912081931_replace_role_area_type_scopes.sql');
const service = read('src/services/rbac.service.ts');
const roleRoutes = read('src/routes/roles/index.ts');
const areaTypeRoutes = read('src/routes/area-types/index.ts');
const schema = read('src/schemas/rbac.ts');

describe('Phase 6 Role Area Type configuration', () => {
  it('uses admin.role.read for reads and admin.role.update for replacement', () => {
    assert.match(areaTypeRoutes, /ADMIN_ROLE_READ/);
    assert.match(roleRoutes, /'\/:id\/area-type-scopes'[\s\S]*ADMIN_ROLE_READ/);
    assert.match(roleRoutes, /put\([\s\S]*'\/:id\/area-type-scopes'[\s\S]*ADMIN_ROLE_UPDATE/);
    assert.doesNotMatch(roleRoutes, /assign_area_type_scope/);
  });

  it('validates the complete desired UUID list before calling one atomic RPC', () => {
    assert.match(schema, /required: \['areaTypeIds'\]/);
    assert.match(schema, /areaTypeIds: \{ type: 'array',[\s\S]*items: uuid/);
    assert.match(service, /new Set\(body\.areaTypeIds\)/);
    assert.match(service, /\.from\('area_types'\)[\s\S]*\.eq\('is_active', true\)[\s\S]*\.eq\('is_deleted', false\)/);
    assert.match(service, /\.rpc\('replace_role_area_type_scopes'/);
  });

  it('keeps replacement atomic and authorizes again inside PostgreSQL', () => {
    assert.match(migration, /create or replace function public\.replace_role_area_type_scopes/);
    assert.match(migration, /public\.has_permission\(p_actor_id, 'admin\.role\.update'\)/);
    assert.match(migration, /delete from public\.role_area_type_scopes[\s\S]*insert into public\.role_area_type_scopes/);
    assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/);
    assert.match(migration, /grant execute on function[\s\S]*to service_role/);
  });

  it('protects only the exact system ADMIN role and does not persist bypass mappings', () => {
    assert.match(service, /role\.code === 'ADMIN' && role\.is_system === true/);
    assert.match(migration, /v_role_code = 'ADMIN' and v_role_is_system = true/);
    assert.match(
      migration,
      /insert into public\.role_area_type_scopes \(role_id, area_type_id\)\s+select p_role_id, requested_id\s+from unnest/,
    );
    assert.doesNotMatch(migration, /insert into public\.role_area_type_scopes[\s\S]*where[\s\S]*role\.code = 'ADMIN'/);
  });
});

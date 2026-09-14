import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const page = read('src/pages/management/RolesPage.tsx');
const roleApi = read('src/api/roles.service.ts');
const areaTypeApi = read('src/api/area-types.service.ts');
const queryKeys = read('src/lib/queryKeys.ts');

describe('Phase 6 Role Area Type configuration UI', () => {
  it('loads the active catalog and Role mappings through backend APIs', () => {
    assert.match(areaTypeApi, /'area-types'/);
    assert.match(roleApi, /roles\/\$\{id\}\/area-type-scopes/);
    assert.match(roleApi, /\{ areaTypeIds \}/);
    assert.match(queryKeys, /roleAreaTypeScopes/);
    assert.match(queryKeys, /areaTypes/);
  });

  it('shows Area Type Access independently from permission assignment', () => {
    assert.match(page, />Area Types<\/button>/);
    assert.match(page, /Area Type Access/);
    assert.match(page, /ADMIN_ROLE_UPDATE/);
    assert.match(page, /replaceRoleAreaTypeScopes/);
  });

  it('renders exact system ADMIN as read-only all-scope without role-name authorization', () => {
    assert.match(page, /code === 'ADMIN' && areaScopeTarget\.is_system/);
    assert.match(page, /Toàn bộ Area Type \(System Admin\)/);
    assert.match(page, /không tạo mapping PACKING, LOGISTICS hoặc SHOP/);
    assert.doesNotMatch(page, /role\s*===|role\.name\s*===|role\.includes/);
  });

  it('uses TanStack Query caching and invalidates only the Role scope family', () => {
    assert.match(page, /queryKeys\.areaTypes\.all/);
    assert.match(page, /queryKeys\.roleAreaTypeScopes\.detail/);
    assert.match(page, /queryKeys\.roleAreaTypeScopes\.all/);
    assert.match(page, /queryKeys\.meAreaScopes\.all/);
    assert.doesNotMatch(page, /queryClient\.clear|window\.location|location\.reload/);
  });
});

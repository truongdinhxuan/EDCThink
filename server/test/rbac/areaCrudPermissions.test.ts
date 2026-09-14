import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { PERMISSION_CODE } from '../../src/domain/permission-codes';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260912235836_area_crud_permissions.sql',
  ),
  'utf8',
);

describe('Area CRUD permission isolation', () => {
  it('defines four dedicated permission codes without a database enum', () => {
    assert.equal(PERMISSION_CODE.SUPPLY_AREA_READ, 'supply.area.read');
    assert.equal(PERMISSION_CODE.SUPPLY_AREA_CREATE, 'supply.area.create');
    assert.equal(PERMISSION_CODE.SUPPLY_AREA_UPDATE, 'supply.area.update');
    assert.equal(PERMISSION_CODE.SUPPLY_AREA_DEACTIVATE, 'supply.area.deactivate');
    assert.doesNotMatch(migration, /create\s+type[\s\S]+as\s+enum/i);
  });

  it('seeds active system permissions and preserves existing Role access', () => {
    for (const code of [
      'supply.area.read',
      'supply.area.create',
      'supply.area.update',
      'supply.area.deactivate',
    ]) {
      assert.match(migration, new RegExp(code.replaceAll('.', '\\.')));
    }
    assert.match(migration, /from public\.role_permissions old_mapping/);
    assert.match(migration, /old_mapping\.is_active = true/);
    assert.match(migration, /old_mapping\.is_deleted = false/);
    assert.match(migration, /role_row\.code = 'ADMIN'/);
    assert.match(migration, /role_row\.is_system = true/);
  });

  it('does not alter Area Type Scope or create a new Area table', () => {
    assert.doesNotMatch(migration, /create\s+table/i);
    assert.doesNotMatch(migration, /role_area_type_scopes/);
    assert.doesNotMatch(migration, /alter\s+table\s+public\.areas/i);
  });
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { PERMISSION_CODE } from '../../src/domain/permission-codes';
import { hasPermission } from '../../src/services/authorization.service';
import {
  groupEffectiveAreaTypeScopes,
  isAreaWithinEffectiveScope,
  resolveEffectiveAreaTypes,
  type AreaTypeAccessRow,
  type RoleScopeAccessRow,
  type ScopedAreaAccessRow,
} from '../../src/services/area-scopes.service';

const root = join(__dirname, '..', '..');
const scopeService = readFileSync(
  join(root, 'src', 'services', 'area-scopes.service.ts'),
  'utf8',
);
const scopeRoute = readFileSync(
  join(root, 'src', 'routes', 'me', 'area-scopes', 'index.ts'),
  'utf8',
);
const sheetRoute = readFileSync(
  join(root, 'src', 'routes', 'supply', 'shift-order-sheets', 'index.ts'),
  'utf8',
);
const sheetService = readFileSync(
  join(root, 'src', 'services', 'shift-order-sheets.service.ts'),
  'utf8',
);
const areaService = readFileSync(join(root, 'src', 'services', 'areas.service.ts'), 'utf8');
const masterSchemas = readFileSync(join(root, 'src', 'schemas', 'master-data.ts'), 'utf8');

const areaType = (
  id: string,
  code: string,
  overrides: Partial<AreaTypeAccessRow> = {},
): AreaTypeAccessRow => ({
  id,
  code,
  name: code,
  description: null,
  is_active: true,
  is_deleted: false,
  ...overrides,
});

const roleScope = (
  roleId: string,
  type: AreaTypeAccessRow,
  roleOverrides: Partial<{ is_active: boolean; is_deleted: boolean }> = {},
): RoleScopeAccessRow => ({
  role_id: roleId,
  role: {
    id: roleId,
    is_active: true,
    is_deleted: false,
    ...roleOverrides,
  },
  area_type: type,
});

const actor = (roleIds: string[], isSystemAdmin = false) => ({
  roleIds,
  isSystemAdmin,
});

const packing = areaType('type-packing', 'PACKING');
const logistics = areaType('type-logistics', 'LOGISTICS');

test('T01-T03 effective scopes union active roles and deduplicate Area Types', () => {
  assert.deepEqual(
    resolveEffectiveAreaTypes(actor(['role-a']), [roleScope('role-a', packing)])
      .map((item) => item.code),
    ['PACKING'],
  );
  assert.deepEqual(
    resolveEffectiveAreaTypes(actor(['role-a', 'role-b']), [
      roleScope('role-a', packing),
      roleScope('role-b', logistics),
    ]).map((item) => item.code),
    ['LOGISTICS', 'PACKING'],
  );
  assert.deepEqual(
    resolveEffectiveAreaTypes(actor(['role-a', 'role-b']), [
      roleScope('role-a', packing),
      roleScope('role-b', packing),
    ]).map((item) => item.code),
    ['PACKING'],
  );
});

test('T04-T06 inactive/deleted roles and Area Types do not contribute scope', () => {
  const inactiveType = areaType('type-inactive', 'INACTIVE', { is_active: false });
  const deletedType = areaType('type-deleted', 'DELETED', { is_deleted: true });
  const resolved = resolveEffectiveAreaTypes(actor(['a', 'b', 'c', 'd']), [
    roleScope('a', packing, { is_active: false }),
    roleScope('b', logistics, { is_deleted: true }),
    roleScope('c', inactiveType),
    roleScope('d', deletedType),
  ]);
  assert.deepEqual(resolved, []);
});

const scopedAreas: ScopedAreaAccessRow[] = [
  { id: 'dg-ht', code: 'DG_HATINH', name: 'Đóng gói Hà Tĩnh', area_type_id: packing.id, is_active: true, is_deleted: false },
  { id: 'dg-india', code: 'DG_INDIA', name: 'Đóng gói Ấn Độ', area_type_id: packing.id, is_active: true, is_deleted: false },
  { id: 'dg-indo', code: 'DG_INDO', name: 'Đóng gói Indonesia', area_type_id: packing.id, is_active: true, is_deleted: false },
  { id: 'edc', code: 'EDC_LOGISTICS', name: 'EDC Logistics', area_type_id: logistics.id, is_active: true, is_deleted: false },
  { id: 'vtdg', code: 'VTDG', name: 'Vật tư đóng gói', area_type_id: null, is_active: true, is_deleted: false },
];

test('T07-T09 PACKING returns only active typed PACKING Areas and excludes VTDG', () => {
  const scopes = groupEffectiveAreaTypeScopes([packing], scopedAreas);
  assert.deepEqual(scopes[0]?.areas.map((area) => area.code), [
    'DG_HATINH',
    'DG_INDIA',
    'DG_INDO',
  ]);
  assert.equal(scopes[0]?.areas.some((area) => area.code === 'EDC_LOGISTICS'), false);
  assert.equal(scopes[0]?.areas.some((area) => area.code === 'VTDG'), false);
});

test('T10-T12 area authorization accepts scoped Area, rejects other type, and empty scope stays empty', () => {
  const scopes = groupEffectiveAreaTypeScopes([packing], scopedAreas);
  assert.equal(isAreaWithinEffectiveScope(scopes, 'dg-ht'), true);
  assert.equal(isAreaWithinEffectiveScope(scopes, 'edc'), false);
  assert.deepEqual(groupEffectiveAreaTypeScopes([], scopedAreas), []);
});

test('T13 exact system ADMIN bypass receives every active non-deleted Area Type', () => {
  const inactive = areaType('inactive', 'INACTIVE', { is_active: false });
  assert.deepEqual(
    resolveEffectiveAreaTypes(actor([], true), [], [packing, logistics, inactive])
      .map((item) => item.code),
    ['LOGISTICS', 'PACKING'],
  );
  assert.match(scopeService, /if \(this\.actor\.isSystemAdmin\)/);
  assert.doesNotMatch(scopeService, /role\.name|DATA_MATERIAL|DATA_PACKING/);
});

test('T14-T16 Shift Sheet read is independent from Order create permission', () => {
  const readOnly = {
    permissions: [PERMISSION_CODE.SUPPLY_SHIFT_ORDER_SHEET_READ],
    isSystemAdmin: false,
  };
  const createOnly = {
    permissions: [PERMISSION_CODE.SUPPLY_ORDER_CREATE],
    isSystemAdmin: false,
  };
  assert.equal(
    hasPermission(readOnly, PERMISSION_CODE.SUPPLY_SHIFT_ORDER_SHEET_READ),
    true,
  );
  assert.equal(
    hasPermission(createOnly, PERMISSION_CODE.SUPPLY_SHIFT_ORDER_SHEET_READ),
    false,
  );
  assert.equal(
    hasPermission(readOnly, PERMISSION_CODE.SUPPLY_ORDER_CREATE),
    false,
  );
  assert.match(
    sheetRoute,
    /requirePermission\(PERMISSION_CODE\.SUPPLY_SHIFT_ORDER_SHEET_READ\)/,
  );
  assert.doesNotMatch(sheetRoute, /ORDER_READ_PERMISSIONS|SUPPLY_ORDER_CREATE/);
  assert.match(sheetService, /request = request\.in\('area_id', readableAreaIds\)/);
});

test('T17 GET areas supports server-side areaTypeId filter without changing catalog permission', () => {
  assert.match(masterSchemas, /areaListQuerySchema[\s\S]*areaTypeId: uuid/);
  assert.match(areaService, /request = request\.eq\('area_type_id', query\.areaTypeId\)/);
  assert.match(areaService, /\.range\(pagination\.from, pagination\.to\)/);
});

test('T18 new Area Scope API uses bounded reads and keeps pageSize maximum unchanged', () => {
  assert.match(scopeRoute, /SUPPLY_SHIFT_ORDER_SHEET_READ/);
  assert.match(scopeRoute, /getMyAreaScopes/);
  assert.match(scopeService, /\.from\('role_area_type_scopes'\)/);
  assert.match(scopeService, /\.from\('areas'\)/);
  assert.doesNotMatch(scopeService, /pageSize\s*[:=]\s*(?:10[1-9]|[2-9]\d\d)/);
});

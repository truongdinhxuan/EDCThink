import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { PERMISSION_CODE } from '../../src/domain/permission-codes';
import {
  canReadStockArea,
  canWriteStockArea,
  readsEveryStockArea,
  resolveReadableStockAreas,
  resolveWritableStockAreaId,
  type StockAreaAccess,
} from '../../src/domain/stock-access';

const root = join(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8');

const HATINH = 'area-hatinh';
const INDIA = 'area-india';
const VTDG = 'area-vtdg';
const PACKING = [HATINH, INDIA];

const access = (over: Partial<StockAreaAccess> = {}): StockAreaAccess => ({
  areaId: HATINH,
  permissions: [PERMISSION_CODE.SUPPLY_STOCK_READ],
  isSystemAdmin: false,
  ...over,
});

test('own Area is readable even when it belongs to no Area Type', () => {
  // The supplying warehouse is deliberately outside every Area Type, so without
  // this its own staff would read nothing at all.
  const readable = resolveReadableStockAreas(access({ areaId: VTDG }), PACKING);
  assert.deepEqual([...readable].sort(), [HATINH, INDIA, VTDG].sort());
  assert.ok(canReadStockArea(readable, VTDG));
  assert.ok(canReadStockArea(readable, HATINH));
});

test('read scope never leaks an Area outside the role Area Types', () => {
  const readable = resolveReadableStockAreas(access(), PACKING);
  assert.equal(canReadStockArea(readable, VTDG), false);
});

test('read_all_areas widens reading without touching writing', () => {
  const supervisor = access({
    permissions: [
      PERMISSION_CODE.SUPPLY_STOCK_READ,
      PERMISSION_CODE.SUPPLY_STOCK_READ_ALL_AREAS,
    ],
  });
  assert.ok(readsEveryStockArea(supervisor));
  assert.equal(resolveReadableStockAreas(supervisor, []), 'ALL');
  assert.ok(canReadStockArea('ALL', VTDG));
  // Still pinned for writing: seeing every market must not mean moving its stock.
  assert.equal(canWriteStockArea(supervisor, VTDG), false);
  assert.equal(canWriteStockArea(supervisor, HATINH), true);
});

test('writing is pinned to the actor own Area, widened only by system admin', () => {
  assert.equal(canWriteStockArea(access(), HATINH), true);
  assert.equal(canWriteStockArea(access(), INDIA), false);
  // The Area Type scope must not grant writing: it exists so a supervisor can
  // look at the packing Areas, not move their stock.
  assert.equal(canWriteStockArea(access({ areaId: INDIA }), HATINH), false);

  const admin = access({ isSystemAdmin: true, permissions: [] });
  assert.equal(resolveReadableStockAreas(admin, []), 'ALL');
  assert.equal(canWriteStockArea(admin, VTDG), true);
  assert.equal(resolveWritableStockAreaId(admin), null);
});

test('an actor with no Area can neither write nor claim one', () => {
  const unassigned = access({ areaId: null });
  assert.equal(canWriteStockArea(unassigned, HATINH), false);
  assert.equal(resolveWritableStockAreaId(unassigned), null);
  assert.deepEqual(resolveReadableStockAreas(unassigned, PACKING), PACKING);
});

test('services scope before applying the caller own areaId filter', () => {
  // PostgREST ANDs the two, so `.in()` first means a query-string areaId can
  // only narrow the result. Reversing them would not fail any type check.
  for (const file of ['stock-balances.service.ts', 'stock-transactions.service.ts']) {
    const source = read('src', 'services', file);
    const scopeAt = source.indexOf(".in('area_id', readable)");
    const filterAt = source.indexOf(".eq('area_id', areaId)");
    assert.ok(scopeAt > 0, `${file} must scope by readable Areas`);
    assert.ok(filterAt > scopeAt, `${file} must apply the scope before the query filter`);
    assert.match(source, /readable\.length === 0/, file);
  }
});

test('every stock write path checks the Area before it reaches the RPC', () => {
  const adjustments = read('src', 'services', 'stock-adjustments.service.ts');
  const assertAt = adjustments.indexOf('assertCanWrite(body.area_id)');
  const rpcAt = adjustments.indexOf("rpc('apply_stock_adjustment_v4'");
  assert.ok(assertAt > 0 && rpcAt > assertAt);

  const discrepancies = read('src', 'services', 'inventory-discrepancies.service.ts');
  assert.match(discrepancies, /assertCanWrite\(/);
  assert.match(discrepancies, /assertCanRead\(/);
});

test('the supplying Area cannot raise Orders for itself', () => {
  const orders = read('src', 'services', 'orders.service.ts');
  assert.match(orders, /actor\.areaId === sourceAreaId && !actor\.isSystemAdmin/);
  const sheets = read('src', 'services', 'shift-order-sheets.service.ts');
  assert.match(sheets, /can_create_order: await this\.canCreateOrderFromArea\(actor\)/);
  // getCurrent reads only the caller's own Area, so it must not be gated on the
  // Area Type scope the supplying Area deliberately has none of.
  assert.doesNotMatch(sheets, /getCurrent[\s\S]{0,400}assertAreaWithinEffectiveScope/);
});

test('migration seeds the permission and detaches the supplying Area', () => {
  const migration = read(
    'supabase', 'migrations', '20260921010000_stock_area_scope.sql',
  );
  assert.match(migration, /'supply\.stock\.read_all_areas'/);
  assert.match(migration, /where r\.code = 'TBP'/);
  assert.match(migration, /set area_type_id = null[\s\S]*?where code = 'VTDG'/);
  assert.doesNotMatch(migration, /delete from|truncate/i);
});

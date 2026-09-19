import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

const interfaces = read('src/interfaces/shift-order-sheets.ts');
const schemas = read('src/schemas/shift-order-sheets.ts');
const service = read('src/services/shift-order-sheets.service.ts');
const controller = read('src/controllers/shift-order-sheets/index.ts');

describe('Phase 5 Shift Order Sheet relational filters', () => {
  it('T06-T13 exposes every approved query input through the validated contract', () => {
    for (const field of ['search', 'areaId', 'workShiftId', 'workDate', 'statusId', 'categoryId']) {
      assert.match(interfaces, new RegExp(`${field}\\?:`));
    }
    assert.match(schemas, /workDate: \{ type: 'string', format: 'date' \}/);
    assert.match(schemas, /statusId: uuid/);
    assert.match(schemas, /categoryId: uuid/);
    assert.match(schemas, /search: \{ type: 'string', maxLength: 100 \}/);
  });

  it('T08-T14 filters parent Sheets through inner relations before exact pagination', () => {
    assert.match(service, /orders:orders!orders_shift_order_sheet_id_fkey\$\{filterOrders \? '!inner'/);
    assert.match(service, /order_items\$\{filterItems \? '!inner'/);
    assert.match(service, /supply:supplies!order_items_supply_id_fkey!inner/);
    assert.match(service, /orders\.status_id/);
    assert.match(service, /orders\.order_items\.supply\.category_id/);
    assert.match(service, /\.ilike\('orders\.order_items\.supply\.code'/);
    assert.match(service, /select\(createSheetListSelect\(filters\), \{ count: 'exact' \}\)/);
    assert.match(service, /\.range\(pagination\.from, pagination\.to\)/);
    assert.doesNotMatch(service, /\.slice\(/);
  });

  it('T01-T05/T15-T16 keeps Area Type Scope as the server authorization boundary', () => {
    assert.match(service, /getEffectiveAreaTypeScopes\(\)/);
    // Area Type Scope is still the ceiling; resolveReadableAreaIds intersects it
    // with the actor's own Area whenever they lack approval authority, so a
    // sibling market sharing the same Area Type never leaks into history.
    assert.match(service, /request = request\.in\('area_id', readableAreaIds\)/);
    assert.match(service, /if \(readableAreaIds\.length === 0\) return createPaginatedResult/);
    assert.match(service, /query\.areaId && !readableAreaIds\.includes\(query\.areaId\)/);
    assert.match(service, /resolveReadableAreaIds\(/);
    assert.match(service, /await this\.assertReadable\(actor, row\)/g);
  });

  it('passes search/status/category into detail while leaving export unfiltered', () => {
    assert.match(controller, /request\.query as ShiftOrderSheetDetailQuery/);
    assert.match(service, /select\(createSheetDetailSelect\(filters\)\)/);
    assert.match(service, /const createSheetDetailSelect[\s\S]*orders:orders!orders_shift_order_sheet_id_fkey\(/);
    assert.doesNotMatch(
      service,
      /const createSheetDetailSelect[\s\S]*orders:orders!orders_shift_order_sheet_id_fkey\$\{hasOrderFilters/,
    );
    assert.match(service, /select\(SHEET_EXPORT_SELECT\)/);
  });
});

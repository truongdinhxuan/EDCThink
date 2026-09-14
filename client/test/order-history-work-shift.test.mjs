import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const page = read('src/pages/orders/OrdersListPage.tsx');
const types = read('src/types/orders.ts');
const navigation = read('src/constants/workspaceNavigation.ts');

describe('Order History Work Shift UI', () => {
  it('uses the shared filter rail and keeps DataTable search hidden', () => {
    assert.match(page, /PageFilterLayout/);
    assert.match(page, /PageFilterRail/);
    assert.match(page, /FilterField label="Tìm kiếm"/);
    assert.match(page, /<DataTable[\s\S]*?hideInternalSearch/);
    assert.match(page, /useDebounce\(searchInput, 400\)/);
  });

  it('loads active Work Shifts from the existing API and sends workShiftId', () => {
    assert.match(page, /getWorkShifts\(signal\)/);
    assert.match(page, /queryKeys\.workShifts\.lookup\(\)/);
    assert.match(page, /value=\{resource\.query\.workShiftId \?\? ''\}/);
    assert.match(page, /workShiftId: event\.target\.value \|\| undefined/);
    assert.match(types, /workShiftId\?: string/);
    assert.doesNotMatch(page, /<option[^>]*>S[12367]<\/option>/);
  });

  it('renders the historical relation and a safe legacy fallback without relational sorting', () => {
    assert.match(page, /header: 'Ca làm việc'/);
    assert.match(page, /order\.shift_order_sheet\?\.work_shift\?\.code \?\? '—'/);
    const shiftColumn = page.match(/\{\s*header: 'Ca làm việc',[\s\S]*?\n\s*\},/)?.[0] ?? '';
    assert.doesNotMatch(shiftColumn, /sortKey/);
  });

  it('resets the Work Shift filter and lets the paginated hook reset page one', () => {
    assert.match(page, /resetFilters[\s\S]*?workShiftId: undefined/);
    assert.match(page, /updateResourceQuery\(\{[\s\S]*?workShiftId:/);
  });

  it('respects the backend pageSize maximum for Area lookup', () => {
    assert.match(page, /pageSize: 100/);
    assert.doesNotMatch(page, /pageSize: 200/);
  });

  it('uses the approved Order history wording in navigation and page title', () => {
    assert.match(navigation, /label: 'Order lịch sử'/);
    assert.match(page, />Order lịch sử<\/h1>/);
  });

  it('does not filter, paginate, or sort Order records in the browser', () => {
    assert.doesNotMatch(page, /resource\.items\.(?:filter|slice|sort)\(/);
    assert.match(page, /pagination=\{resource\.pagination\}/);
  });
});

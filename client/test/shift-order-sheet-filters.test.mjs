import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

// The filters belong to the archive; the current Sheet has nothing to filter.
const page = read('src/pages/orders/ShiftOrderSheetHistoryPage.tsx');
const currentPage = read('src/pages/orders/ShiftOrderSheetsPage.tsx');
const api = read('src/api/shift-order-sheets.service.ts');
const areaScopeApi = read('src/api/area-scopes.service.ts');
const areaScopeTypes = read('src/types/area-scopes.ts');
const queryKeys = read('src/lib/queryKeys.ts');
const navigation = read('src/constants/workspaceNavigation.ts');
const routes = read('src/routes/workspace.routes.tsx');
const workspace = read('src/components/orders/ShiftOrderSheetWorkspace.tsx');
const orderDetail = read('src/pages/orders/OrderDetailPage.tsx');

describe('Phase 5 Shift Order Sheet Filter Rail', () => {
  it('T17-T20 loads Area options only from the effective scope endpoint', () => {
    assert.match(areaScopeApi, /me\/area-scopes/);
    assert.match(areaScopeTypes, /interface AreaScopeArea/);
    assert.match(areaScopeTypes, /interface AreaTypeScope/);
    assert.match(areaScopeTypes, /interface EffectiveAreaScopesResponse/);
    assert.match(queryKeys, /meAreaScopes/);
    assert.match(page, /getMyAreaScopes/);
    assert.match(page, /areaTypeScopes\.length > 0/);
    assert.match(page, /<optgroup key=\{areaType\.id\}/);
    assert.doesNotMatch(page, /listAreas|queryKeys\.areas/);
    assert.doesNotMatch(page, /role\s*===|role\.includes/);
  });

  it('T21-T28 keeps all business filters inside the shared rail', () => {
    const rail = page.slice(page.indexOf('<PageFilterRail'), page.indexOf('</PageFilterRail>'));
    for (const label of [
      'Tìm mã hàng',
      'Khu vực',
      'Ca làm việc',
      'Ngày làm việc',
      'Trạng thái Order',
      'Loại mã hàng',
    ]) assert.match(rail, new RegExp(label));
    assert.match(page, /useDebounce\(searchInput, 400\)/);
    assert.match(page, /setHistoryPage\(1\)/);
    assert.match(page, /hideInternalSearch/);
    assert.match(page, /Không có phiếu phù hợp với bộ lọc\./);
  });

  it('sends the complete filter set server-side and filters selected detail rows', () => {
    for (const field of ['search', 'areaId', 'workShiftId', 'workDate', 'statusId', 'categoryId']) {
      assert.match(page, new RegExp(`${field}:`));
    }
    assert.match(api, /\{ params, signal \}/);
    assert.match(page, /getShiftOrderSheet\(selectedHistoryId!, signal, detailParams\)/);
    assert.doesNotMatch(page, /\.filter\(|\.slice\(/);
  });

  it('keeps the rail on the archive route and off the current Sheet', () => {
    // One `historyOpen` flag used to pick between two unrelated screens on one
    // URL, which mounted the rail over a Sheet it could not filter.
    assert.match(routes, /path: 'shift-order-sheets\/history'/);
    assert.match(routes, /ShiftOrderSheetHistoryPage/);
    assert.doesNotMatch(currentPage, /PageFilterRail|PageFilterLayout|FilterField/);
    assert.doesNotMatch(currentPage, /setFilters|useDebounce/);
    // The state, not the word: both files still name the old flag in prose.
    for (const source of [page, currentPage]) {
      assert.doesNotMatch(source, /setHistoryOpen\(|useState\(false\)/);
    }
  });

  it('uses the dedicated read permission for menu, routes and export UX', () => {
    assert.match(navigation, /SUPPLY_SHIFT_ORDER_SHEET_READ/);
    assert.match(routes, /shift-order-sheets'[\s\S]*SUPPLY_SHIFT_ORDER_SHEET_READ/);
    assert.match(workspace, /hasPermission\(PERMISSION_CODE\.SUPPLY_SHIFT_ORDER_SHEET_READ\)/);
  });

  it('T30-T31 invalidates matching cached histories without resetting filter state', () => {
    assert.match(queryKeys, /histories: \['shift-order-sheets', 'history'\]/);
    assert.match(workspace, /queryKeys\.shiftOrderSheets\.histories/);
    assert.match(orderDetail, /queryKeys\.shiftOrderSheets\.histories/);
    assert.doesNotMatch(workspace, /setFilters|setSearchInput|queryClient\.clear/);
  });
});

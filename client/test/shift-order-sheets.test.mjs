import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const createOrder = read('src/pages/orders/CreateOrderPage.tsx');
const createOrderForm = read('src/components/orders/CreateOrderForm.tsx');
const orderDetail = read('src/pages/orders/OrderDetailPage.tsx');
const sheetList = read('src/pages/orders/ShiftOrderSheetsPage.tsx');
const sheetHistory = read('src/pages/orders/ShiftOrderSheetHistoryPage.tsx');
const sheetDetail = read('src/pages/orders/ShiftOrderSheetDetailPage.tsx');
const sheetWorkspace = read('src/components/orders/ShiftOrderSheetWorkspace.tsx');
const sheetApi = read('src/api/shift-order-sheets.service.ts');
const routes = read('src/routes/workspace.routes.tsx');
const availabilityWarning = read('src/components/orders/StockAvailabilityWarning.tsx');
const http = read('src/api/http.ts');

describe('Supply Phase 9 shift-order-sheet UI', () => {
  it('opens the authenticated current Sheet workspace and keeps paginated history', () => {
    assert.match(sheetApi, /supply\/shift-order-sheets/);
    assert.match(sheetApi, /supply\/shift-order-sheets\/current/);
    assert.match(sheetApi, /PaginatedResponse<ShiftOrderSheetSummary>/);
    assert.match(sheetList, /queryKeys\.shiftOrderSheets\.current/);
    // The archive is its own route now, so its query lives with it.
    assert.match(sheetHistory, /queryKeys\.shiftOrderSheets\.history/);
    assert.doesNotMatch(sheetList, /queryKeys\.shiftOrderSheets\.history/);
    assert.doesNotMatch(sheetList, /\.slice\(/);
  });

  it('registers list/detail routes and preserves the sheet context for Create More', () => {
    assert.match(routes, /path: 'shift-order-sheets'/);
    assert.match(routes, /path: 'shift-order-sheets\/history'/);
    assert.match(routes, /path: 'shift-order-sheets\/:id'/);
    assert.match(createOrderForm, /sheetContext\?\.id/);
    assert.match(createOrderForm, /shift_order_sheet_id: sheetContext\.id/);
    assert.match(createOrderForm, /createOrder\(buildPayload\(values\)\)/);
    assert.doesNotMatch(createOrderForm, /submitOrder|DRAFT/);
  });

  it('shows current Order status from related backend data', () => {
    assert.match(sheetWorkspace, /status_lookup\?\.code/);
    assert.match(sheetWorkspace, /order\.code/);
    assert.doesNotMatch(sheetWorkspace, /statusHistory|snapshot_status/);
  });

  it('renders readable relations without UUID fallbacks', () => {
    assert.match(sheetWorkspace, /context\.area\?\.name/);
    assert.match(sheetWorkspace, /order\.requester\.first_name/);
    assert.match(sheetWorkspace, /item\.supply\?\.code/);
    assert.match(sheetWorkspace, /item\.provider\.name/);
    assert.doesNotMatch(sheetWorkspace, /\?\?\s*(sheet\.(leader_id|area_id|work_shift_id)|order\.requested_by)/);
  });

  it('blocks atomic create at zero stock and preserves warning-only shortage behavior', () => {
    assert.match(createOrderForm, /Không thể tạo và gửi Order/);
    assert.doesNotMatch(orderDetail, /DRAFT|submitOrder/);
    assert.match(availabilityWarning, /Order vẫn có thể được tạo\/gửi hoặc approve/);
    assert.match(availabilityWarning, /Tồn sẽ được kiểm tra lại khi issue/);
  });

  it('downloads Shift Sheet XLSX from backend with read permission and binary headers', () => {
    assert.match(sheetApi, /responseType:\s*'blob'/);
    assert.match(sheetApi, /content-disposition/);
    assert.match(sheetWorkspace, /Xuất Excel/);
    assert.match(sheetWorkspace, /Đang xuất\.\.\./);
    assert.match(sheetWorkspace, /SUPPLY_SHIFT_ORDER_SHEET_READ/);
    assert.match(sheetWorkspace, /URL\.createObjectURL/);
    assert.match(http, /response\.config\.responseType === 'blob'/);
    assert.match(http, /:\s*response\.data/);
    assert.doesNotMatch(sheetWorkspace, /window\.location\.reload/);
  });

  it('renders the fast current-area flow and a read-only history route', () => {
    assert.match(sheetList, /getCurrentShiftOrderSheet/);
    assert.match(sheetList, /Bạn chưa được gán khu vực làm việc/);
    assert.match(sheetWorkspace, /Phiếu order ca \{shiftLabel\(context\)\} ngày/);
    assert.match(sheetWorkspace, /Các mã đang Order/);
    assert.match(sheetWorkspace, /\+ Thêm Order/);
    assert.match(sheetWorkspace, /Lịch sử phiếu order ca/);
    assert.match(sheetWorkspace, /mode === 'current'/);
    assert.match(sheetWorkspace, /mode === 'history'/);
    assert.match(sheetWorkspace, /flatMap/);
    assert.doesNotMatch(sheetList, /window\.location|navigate\(/);
  });
});

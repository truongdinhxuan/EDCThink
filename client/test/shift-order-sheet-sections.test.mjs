import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const workspace = read('src/components/orders/ShiftOrderSheetWorkspace.tsx');
const incoming = read('src/components/orders/IncomingMarketOrdersSection.tsx');
const orderList = read('src/components/orders/SheetOrderListSection.tsx');
const api = read('src/api/shift-order-sheets.service.ts');
const types = read('src/types/shift-order-sheets.ts');
const queryKeys = read('src/lib/queryKeys.ts');

describe('Shift Order Sheet workspace sections', () => {
  it('R1 leaves the page header untouched and ungated', () => {
    assert.match(
      workspace,
      /\{titlePrefix\}Phiếu order ca \{shiftLabel\(context\)\} ngày \{formatDate\(context\.work_date\)\}/,
    );
    assert.match(workspace, /Khu vực: <span className="font-semibold text-slate-900">/);
    // The header block must not sit behind either section's permission flag.
    const header = workspace.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '';
    assert.doesNotMatch(header, /canCreateOrder|canApproveOrder/);
  });

  it('R2 renders "Các mã đang Order" only for order creators', () => {
    assert.match(workspace, /const canCreateOrder = hasPermission\(PERMISSION_CODE\.SUPPLY_ORDER_CREATE\)/);
    assert.match(
      workspace,
      /\{canCreateOrder && \([\s\S]*?<h2 className="font-bold text-slate-900">Các mã đang Order<\/h2>/,
    );
    // The "+ Thêm Order" action additionally needs the Sheet being worked now.
    assert.match(workspace, /const allowCreate = mode === 'current' && canCreateOrder/);
  });

  it('R3 renders the approver section only for approvers, driven by context', () => {
    assert.match(workspace, /const canApproveOrder = hasPermission\(PERMISSION_CODE\.SUPPLY_ORDER_APPROVE\)/);
    // Step one lives on the overview only. Repeating the market list inside one
    // market's own Sheet would just be noise.
    assert.match(
      workspace,
      /\{canApproveOrder && mode === 'current' && \(\s*<IncomingMarketOrdersSection context=\{context\} \/>/,
    );
    assert.match(incoming, /Phiếu order từ các thị trường/);
    assert.match(incoming, /workDate: context\.work_date/);
    assert.match(incoming, /workShiftId: context\.work_shift_id/);
  });

  it('R3 uses React Query and never sends an area filter from the client', () => {
    assert.match(incoming, /useQuery\(\{/);
    assert.match(incoming, /queryKeys\.shiftOrderSheets\.incoming\(params\)/);
    assert.match(queryKeys, /incoming: \(query: QueryParameters = \{\}\)/);
    assert.match(api, /supply\/shift-order-sheets\/incoming/);
    assert.match(types, /interface IncomingShiftOrderSheet/);
    assert.match(types, /pending_order_count: number/);
    // Area visibility is the server's decision; the client must not try to
    // widen or narrow it by passing an areaId.
    assert.doesNotMatch(incoming, /areaId/);
    assert.doesNotMatch(
      api,
      /listIncomingShiftOrderSheets[\s\S]*?areaId/,
    );
  });

  it('R3 covers loading, error and empty states', () => {
    assert.match(incoming, /incomingQuery\.isPending/);
    assert.match(incoming, /incomingQuery\.isError/);
    assert.match(incoming, /<ErrorState/);
    assert.match(incoming, /Chưa có thị trường nào order trong ca này\./);
  });

  it('gates purely on permission codes, never on role names', () => {
    for (const source of [workspace, incoming, orderList]) {
      assert.doesNotMatch(source, /role\s*===|role\.includes\(|switch\s*\(\s*role/);
      assert.doesNotMatch(source, /DATA_PACKING|DATA_MATERIAL|MATERIAL_|ADMIN'/);
    }
  });
});

describe('Approver navigation flow', () => {
  it('step 1: each market row offers "Xem phiếu" into that Sheet', () => {
    assert.match(incoming, /getWorkspacePath\(role, SHIFT_ORDER_SHEET_PATH\)/);
    assert.match(incoming, /<Link\s+to=\{`\$\{sheetsPath\}\/\$\{sheet\.id\}`\}[\s\S]*?Xem phiếu/);
  });

  it('step 2: the opened Sheet lists its own Orders for the approver', () => {
    assert.match(
      workspace,
      /\{canApproveOrder && isSingleSheetView && sheet && \(\s*<SheetOrderListSection orders=\{sheet\.orders\} \/>/,
    );
    assert.match(orderList, /Order trong phiếu/);
    // The Sheet's business key is (area_id, work_shift_id, work_date), so the
    // Orders it already carries are exactly the market/shift/day slice. It must
    // therefore fetch nothing of its own: a second round trip could only return
    // the same rows, and re-filtering them client side could get it wrong.
    assert.doesNotMatch(orderList, /useQuery|useMutation|fetch\(|\.service'/);
    assert.match(orderList, /orders \}: SheetOrderListSectionProps/);
  });

  it('step 3: every Order links to /workspace/orders/:id', () => {
    assert.match(orderList, /getWorkspacePath\(role, 'orders'\)/);
    assert.match(orderList, /<Link\s+to=\{`\$\{ordersPath\}\/\$\{order\.id\}`\}/);
    assert.match(orderList, /Xem order/);
    // Hand-built URLs would bypass the workspace path helper.
    assert.doesNotMatch(orderList, /["'`]\/workspace\//);
  });

  it('gives the Order still awaiting a decision the primary action', () => {
    assert.match(orderList, /const pending = status === 'PENDING'/);
    assert.match(orderList, /pending \? `\$\{InfoButton\}[\s\S]*?: TextButton/);
  });
});

describe('Xuất Excel is scoped to one market Sheet', () => {
  it('only renders once the user has drilled into a persisted Sheet', () => {
    assert.match(
      workspace,
      /const isSingleSheetView = mode !== 'current' && Boolean\(sheetId\)/,
    );
    assert.match(
      workspace,
      /\{isSingleSheetView && hasPermission\(PERMISSION_CODE\.SUPPLY_SHIFT_ORDER_SHEET_READ\) && \([\s\S]*?Xuất Excel/,
    );
  });

  it('is gone from the current-Sheet and aggregate views', () => {
    // The old condition rendered the button for any loaded Sheet, including the
    // operator's own current one and the approver's overview.
    assert.doesNotMatch(
      workspace,
      /\{sheet && hasPermission\(PERMISSION_CODE\.SUPPLY_SHIFT_ORDER_SHEET_READ\)/,
    );
  });
});

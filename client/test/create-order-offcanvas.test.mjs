import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Create Order direct-PENDING offcanvas contract', () => {
  it('uses one atomic create request and has no client submit-Draft orchestration', () => {
    const form = read('src/components/orders/CreateOrderForm.tsx');
    const api = read('src/api/orders.service.ts');
    assert.match(form, /const created = await createOrder\(buildPayload\(values\)\)/);
    assert.match(form, /setStage\('creating'\)/);
    assert.match(form, /setStage\('success'\)/);
    assert.match(form, /setStage\('create-failed'\)/);
    assert.doesNotMatch(form, /submitOrder|draftOrder|createAndSubmitOrder/);
    assert.doesNotMatch(api, /submitOrder|\/:id\/submit/);
  });

  it('extracts a route-independent RHF form and keeps the route wrapper', () => {
    const form = read('src/components/orders/CreateOrderForm.tsx');
    const page = read('src/pages/orders/CreateOrderPage.tsx');
    assert.match(form, /useForm<CreateOrderFormValues>/);
    assert.match(form, /useFieldArray/);
    assert.doesNotMatch(form, /useNavigate|useSearchParams|<Link/);
    assert.match(page, /<CreateOrderForm/);
    assert.match(page, /navigate\(`\$\{ordersPath\}\/\$\{order\.id\}/);
    assert.doesNotMatch(page, /draft-only|DRAFT/);
  });

  it('opens creation on the Sheet through shared offcanvas without route navigation', () => {
    const sheet = read('src/components/orders/ShiftOrderSheetWorkspace.tsx');
    assert.match(sheet, /openCrud\(/);
    assert.match(sheet, /submitLabel="Gửi Order"/);
    assert.match(sheet, /submittingLabel="Đang gửi Order\.\.\."/);
    assert.doesNotMatch(sheet, /createPath|shift-sheet-submit|draftOrder/);
  });

  it('uses effective permission and targeted query invalidation', () => {
    const sheet = read('src/components/orders/ShiftOrderSheetWorkspace.tsx');
    assert.match(sheet, /hasPermission\(PERMISSION_CODE\.SUPPLY_ORDER_CREATE\)/);
    assert.doesNotMatch(sheet, /role\s*===|role\.includes|switch\s*\(\s*role/);
    assert.match(sheet, /queryKeys\.orders\.lists/);
    assert.match(sheet, /queryKeys\.shiftOrderSheets\.detail\(sheetId\)/);
    assert.match(sheet, /queryKeys\.shiftOrderSheets\.current/);
    assert.match(sheet, /queryKeys\.shiftOrderSheets\.histories/);
    assert.doesNotMatch(sheet, /queryKeys\.stockBalances|queryClient\.clear/);
  });

  it('preserves Stack, Provider and fixed Area behavior in the shared form', () => {
    const form = read('src/components/orders/CreateOrderForm.tsx');
    assert.match(form, /ORDER_SOURCE_AREA_CODE = 'VTDG'/);
    assert.match(form, /<SupplyProviderSelect/);
    assert.match(form, /<OrderStackFields/);
    assert.match(form, /requested_stack_quantity/);
    assert.match(form, /requested_total_set_quantity/);
    assert.match(form, /sheetContext\.area_id !== receivingAreaId/);
  });

  it('keeps busy close protection, dirty state and focus integration', () => {
    const form = read('src/components/orders/CreateOrderForm.tsx');
    const sheet = read('src/components/orders/ShiftOrderSheetWorkspace.tsx');
    assert.match(form, /if \(isBusy\) return/);
    assert.match(form, /isDirty,/);
    assert.match(sheet, /preventCloseWhileBusy: true/);
    assert.match(sheet, /initialFocusRef/);
    assert.doesNotMatch(sheet, /requestPersistedDraftClose/);
  });
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const createPage = read('src/pages/orders/CreateOrderPage.tsx');
const createForm = read('src/components/orders/CreateOrderForm.tsx');
const stackFields = read('src/components/orders/OrderStackFields.tsx');
const queryKeys = read('src/lib/queryKeys.ts');
const orderDetail = read('src/pages/orders/OrderDetailPage.tsx');
const supplyService = read('src/api/supplies.service.ts');
const orderService = read('src/api/orders.service.ts');
const orderTypes = read('src/types/orders.ts');
const permissionCodes = read('src/constants/permissions.ts');
const apiErrors = read('src/api/errors.ts');

describe('Supply stack Phase 3 frontend (T-017 to T-019)', () => {
  it('resets stale stack fields after Supply or Provider changes (T-017)', () => {
    assert.match(createForm, /const resetStackFields/);
    assert.match(createForm, /changeSupply[\s\S]*resetStackFields\(index\)/);
    assert.match(createForm, /changeProvider[\s\S]*resetStackFields\(index\)/);
  });

  it('keys and resets availability by Supply, Provider and source Area (T-018)', () => {
    assert.match(queryKeys, /supplyStackOptions/);
    assert.match(queryKeys, /supplyId,[\s\S]*providerId,[\s\S]*areaId/);
    assert.match(createForm, /previousSourceAreaId/);
    assert.match(stackFields, /staleTime: 15_000/);
    assert.match(stackFields, /refetchOnWindowFocus: true/);
  });

  it('uses dynamic options, total preview and warning-only shortage UX', () => {
    assert.match(supplyService, /supplies\/\$\{id\}\/stack-options/);
    assert.match(stackFields, /options\.map/);
    assert.match(stackFields, /setPerQty \* requestedStackQuantity/);
    assert.match(stackFields, /Order vẫn có thể được gửi/);
    assert.doesNotMatch(stackFields, /\[8,\s*9,\s*10,\s*11\]/);
  });

  it('renders minimal persisted stack information in Order detail (T-019)', () => {
    assert.match(orderDetail, /SET\/chồng/);
    assert.match(orderDetail, /requested_stack_quantity/);
    assert.match(orderDetail, /requested_total_set_quantity/);
  });
});

describe('Stack confirmation frontend (no allocation step)', () => {
  it('has no allocation step: confirmation is per item, gated by its own permission', () => {
    // Stock has no locations to split an Order across any more.
    assert.doesNotMatch(orderDetail, /allocateOrder|SUPPLY_ORDER_ALLOCATE|Phân bổ vị trí/);
    assert.doesNotMatch(orderService, /\/allocate`/);
    assert.match(orderDetail, /hasPermission\(\s*PERMISSION_CODE\.SUPPLY_ORDER_CONFIRM_ALLOCATION/);
    assert.match(orderService, /items\/\$\{orderItemId\}\/confirm/);
    // The code stays: it still grants read access to Orders.
    assert.match(permissionCodes, /SUPPLY_ORDER_ALLOCATE: 'supply\.order\.allocate'/);
    assert.doesNotMatch(orderDetail, /role\s*===\s*['"]ADMIN['"]/);
  });

  it('derives approved stacks exactly and blocks partial-stack approvals', () => {
    assert.match(orderDetail, /approved % setPerQty !== 0/);
    assert.match(orderDetail, /return approved \/ setPerQty/);
    assert.match(orderDetail, /approvals\[index\]\.quantity_approved % Number\(item\.set_per_qty\) !== 0/);
    assert.doesNotMatch(orderDetail, /Math\.(round|floor|ceil)/);
  });

  it('shows where to pick before anyone confirms', () => {
    assert.match(orderTypes, /locations\?: OrderAllocationLocation\[\]/);
    assert.match(orderDetail, /locationCodes\(item\.locations\)/);
    assert.match(orderDetail, /Xác nhận số chồng — kiện tiêu chuẩn/);
  });

  it('maps structured details without parsing PostgreSQL messages', () => {
    assert.match(apiErrors, /getApiErrorDetails/);
    assert.match(orderDetail, /shortage_quantity/);
    assert.doesNotMatch(orderDetail, /JSON\.parse\(|PostgreSQL|PGRST/);
  });
});

describe('Stack issue ships the confirmed count', () => {
  it('is ready once confirmed, whatever the count', () => {
    assert.match(orderDetail, /const getStackItemState/);
    assert.match(orderDetail, /ready: rejected \|\| issued \|\| confirmation\?\.status === 'CONFIRMED'/);
    // The old "confirmed total must equal the approval" gate is gone.
    assert.doesNotMatch(orderDetail, /actualConfirmedStacks === approvedStacks/);
    assert.match(orderDetail, /normalIssueItems\.flatMap/);
  });

  it('lets a stack-only issue send an empty normal-item payload', () => {
    assert.match(orderDetail, /selected\.length === 0 && !pendingStack/);
    assert.match(orderService, /orders\/\$\{id\}\/issue/);
    assert.doesNotMatch(orderService, /stack-issue|issue-stack/);
  });

  it('sends one quantity per normal item, with no storage location', () => {
    assert.match(orderTypes, /order_item_id: string;\s*quantity: number;/);
    assert.doesNotMatch(orderDetail, /storage_location_id|storageLocationId|listStorageLocations/);
  });

  it('maps structured stock conflicts and invalidates only affected server caches', () => {
    assert.match(apiErrors, /getApiErrorCode/);
    assert.match(orderDetail, /NORMAL_ISSUE_STOCK_CONFLICT/);
    assert.match(orderDetail, /queryKeys\.stockBalances\.all/);
    assert.match(orderDetail, /queryKeys\.stockTransactions\.all/);
    assert.match(orderDetail, /queryKeys\.supplyStackOptions\.all/);
    assert.match(orderDetail, /queryKeys\.inventoryDiscrepancies\.all/);
  });

  it('maps the current Stack error codes to readable Vietnamese messages', () => {
    for (const code of [
      'STACK_ALLOCATIONS_NOT_CONFIRMED',
      'STACK_APPROVAL_NOT_COMPATIBLE',
      'CONFIRM_REASON_REQUIRED',
      'CONFIRM_REASON_DIRECTION_MISMATCH',
      'NORMAL_ISSUE_STOCK_CONFLICT',
      'ORDER_ALREADY_ISSUED',
    ]) {
      assert.match(apiErrors, new RegExp(code));
    }
    // Codes the server can no longer raise are not kept around.
    assert.doesNotMatch(apiErrors, /STACK_ISSUE_ALLOCATION_INCOMPLETE|STACK_PARTIAL_ISSUE_NOT_SUPPORTED|ACTUAL_STACK_EXCEEDS_EXPECTED/);
    assert.match(apiErrors, /technicalErrorPattern/);
  });

  it('keeps discrepancy display warning-only and disables issue until Stack is ready', () => {
    assert.match(orderDetail, /stackItemsNotReady\.length === 0/);
    // actionsLocked folds `mutating` together with the shift+3h status window,
    // so Issue stays blocked while a mutation is in flight and after the window
    // has closed, on top of the Stack readiness check.
    assert.match(orderDetail, /disabled=\{!canIssue \|\| actionsLocked\}/);
    assert.match(orderDetail, /const actionsLocked = mutating \|\| isStatusUpdateExpired/);
    assert.match(orderDetail, /cần kiểm kê/);
  });

  it('uses readable relations and explicit allocation confirmation state', () => {
    assert.doesNotMatch(orderDetail, /order\.from_area\?\.name \?\? order\.from_area_id/);
    assert.doesNotMatch(orderDetail, /item\.provider\?\.code \?\? item\.provider_id/);
    assert.match(orderDetail, /Đã xác nhận/);
    assert.match(orderDetail, /Chưa xác nhận/);
  });
});

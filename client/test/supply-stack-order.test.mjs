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

describe('Supply stack Phase 4 frontend', () => {
  it('uses effective permission and the single allocation API action', () => {
    assert.match(permissionCodes, /SUPPLY_ORDER_ALLOCATE: 'supply\.order\.allocate'/);
    assert.match(orderDetail, /hasPermission\(PERMISSION_CODE\.SUPPLY_ORDER_ALLOCATE\)/);
    assert.match(orderService, /orders\/\$\{id\}\/allocate/);
    assert.match(orderDetail, /allocateOrder\(id\)/);
    assert.doesNotMatch(orderDetail, /role\s*===\s*['"]ADMIN['"]/);
  });

  it('derives approved stacks exactly and blocks incompatible approval UX', () => {
    assert.match(orderDetail, /approved % setPerQty !== 0/);
    assert.match(orderDetail, /return approved \/ setPerQty/);
    assert.match(orderDetail, /Không tương thích quy cách/);
    assert.doesNotMatch(orderDetail, /Math\.(round|floor|ceil)/);
  });

  it('renders allocations and keeps actual quantity empty for Phase 4', () => {
    assert.match(orderTypes, /interface OrderItemAllocation/);
    assert.match(orderDetail, /Đề xuất phân bổ vị trí/);
    assert.match(orderDetail, /allocation\.location\?\.code/);
    assert.match(orderDetail, /allocation\.expected_stack_quantity/);
    assert.match(orderDetail, /allocation\.actual_stack_quantity \?\? "—"/);
  });

  it('maps structured shortage details without parsing PostgreSQL messages', () => {
    assert.match(apiErrors, /getApiErrorDetails/);
    assert.match(orderDetail, /required_stack_quantity/);
    assert.match(orderDetail, /available_stack_quantity/);
    assert.match(orderDetail, /shortage_stack_quantity/);
    assert.match(orderDetail, /SET\/chồng/);
    assert.doesNotMatch(orderDetail, /JSON\.parse\(|PostgreSQL|PGRST/);
  });
});

describe('Supply stack Phase 6 issue UX', () => {
  it('derives readiness from confirmed actual allocations, not manual Stack issue input', () => {
    assert.match(orderDetail, /const getStackIssueReadiness/);
    assert.match(orderDetail, /actualConfirmedStacks/);
    assert.match(orderDetail, /unconfirmedAllocations/);
    assert.match(orderDetail, /actualConfirmedStacks === approvedStacks/);
    assert.match(orderDetail, /normalIssueItems\.flatMap/);
  });

  it('allows the existing issue API to send an empty normal-item payload for Stack-only orders', () => {
    assert.match(orderDetail, /selected\.length === 0 && stackItems\.length === 0/);
    assert.match(orderService, /orders\/\$\{id\}\/issue/);
    assert.doesNotMatch(orderService, /stack-issue|issue-stack/);
  });

  it('maps structured stock conflicts and invalidates only affected server caches', () => {
    assert.match(apiErrors, /getApiErrorCode/);
    assert.match(orderDetail, /STACK_ISSUE_STOCK_CONFLICT/);
    assert.match(orderDetail, /StackIssueConflictDetails/);
    assert.match(orderDetail, /queryKeys\.stockBalances\.all/);
    assert.match(orderDetail, /queryKeys\.stockTransactions\.all/);
    assert.match(orderDetail, /queryKeys\.supplyStackOptions\.all/);
  });

  it('maps Stack error codes to readable Vietnamese messages', () => {
    for (const code of [
      'STACK_ALLOCATIONS_NOT_CONFIRMED',
      'STACK_ISSUE_ALLOCATION_INCOMPLETE',
      'STACK_APPROVAL_NOT_COMPATIBLE',
      'STACK_PARTIAL_ISSUE_NOT_SUPPORTED',
      'STACK_ISSUE_STOCK_CONFLICT',
      'ORDER_ALREADY_ISSUED',
    ]) {
      assert.match(apiErrors, new RegExp(code));
    }
    assert.match(apiErrors, /technicalErrorPattern/);
  });

  it('keeps discrepancy display warning-only and disables issue until Stack is ready', () => {
    assert.match(orderDetail, /stackItemsNotReady\.length === 0/);
    // actionsLocked folds `mutating` together with the shift+3h status window,
    // so Issue stays blocked while a mutation is in flight and after the window
    // has closed, on top of the Stack readiness check.
    assert.match(orderDetail, /disabled=\{!canIssue \|\| actionsLocked\}/);
    assert.match(orderDetail, /const actionsLocked = mutating \|\| isStatusUpdateExpired/);
    assert.match(orderDetail, /Cần kiểm kê/);
  });

  it('uses readable relations and explicit allocation confirmation state', () => {
    assert.doesNotMatch(orderDetail, /order\.from_area\?\.name \?\? order\.from_area_id/);
    assert.doesNotMatch(orderDetail, /item\.provider\?\.code \?\? item\.provider_id/);
    assert.match(orderDetail, /Đã xác nhận/);
    assert.match(orderDetail, /Chưa xác nhận/);
  });
});

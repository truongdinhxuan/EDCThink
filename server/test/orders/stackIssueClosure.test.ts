import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  assertApprovedQuantity,
  assertWholeStackApproval,
  findApprovalStockExcess,
  isOrderItemIssueClosed,
  OrderRuleError,
} from '../../src/domain/orderRules';

const orderService = readFileSync(
  resolve(process.cwd(), 'src/services/orders.service.ts'),
  'utf8',
);

const stack = (overrides: Partial<Parameters<typeof isOrderItemIssueClosed>[0]> = {}) => ({
  set_per_qty: 12,
  quantity_approved: 60,
  quantity_issued: 0,
  allocations: [] as Array<{ status: string | null }>,
  ...overrides,
});

describe('when an order item has nothing left to issue', () => {
  it('closes a stack item on its issued confirmation, below the approval', () => {
    // Approved 5 stacks, the area agreed to take 3: done, not partially issued.
    assert.equal(isOrderItemIssueClosed(stack({
      quantity_issued: 36,
      allocations: [{ status: 'ISSUED' }],
    })), true);
  });

  it('closes a stack item issued above the approval', () => {
    assert.equal(isOrderItemIssueClosed(stack({
      quantity_issued: 84,
      allocations: [{ status: 'ISSUED' }],
    })), true);
  });

  it('closes a stack item confirmed and issued at zero', () => {
    assert.equal(isOrderItemIssueClosed(stack({
      quantity_issued: 0,
      allocations: [{ status: 'ISSUED' }],
    })), true);
  });

  it('keeps a confirmed but unissued stack item open', () => {
    assert.equal(isOrderItemIssueClosed(stack({
      allocations: [{ status: 'CONFIRMED' }],
    })), false);
    assert.equal(isOrderItemIssueClosed(stack()), false);
  });

  it('treats an item approved at zero as closed and an unreviewed one as open', () => {
    assert.equal(isOrderItemIssueClosed(stack({ quantity_approved: 0 })), true);
    assert.equal(isOrderItemIssueClosed(stack({ quantity_approved: null })), false);
  });

  it('closes a normal item only on reaching its approval', () => {
    const normal = { set_per_qty: null, quantity_approved: 10 };
    assert.equal(isOrderItemIssueClosed({ ...normal, quantity_issued: 9 }), false);
    assert.equal(isOrderItemIssueClosed({ ...normal, quantity_issued: 10 }), true);
  });

  it('is the rule complete() uses, so a short-issued stack Order can finish', () => {
    const complete = orderService.slice(orderService.indexOf('async complete('));
    assert.match(complete, /!isOrderItemIssueClosed\(item\)/);
  });
});

describe('an approval is bounded by stock, not by the request', () => {
  const line = (quantity_approved: number, available_quantity: number, overrides = {}) => ({
    supply_id: 's1', provider_id: 'p1', set_per_qty: null,
    quantity_approved, available_quantity, ...overrides,
  });

  it('accepts zero and anything above the request, but never a negative', () => {
    assert.equal(assertApprovedQuantity(0, 10), 0);
    assert.equal(assertApprovedQuantity(25, 10), 25);
    assert.throws(() => assertApprovedQuantity(-1, 10), OrderRuleError);
  });

  it('refuses more than the source Area holds', () => {
    assert.equal(findApprovalStockExcess([line(100, 100)]), null);
    assert.deepEqual(findApprovalStockExcess([line(101, 100)]), {
      supply_id: 's1', provider_id: 'p1', set_per_qty: null,
      approved_quantity: 101, available_quantity: 100,
    });
  });

  it('sums lines of one code, since they draw from the same pooled row', () => {
    assert.ok(findApprovalStockExcess([line(60, 100), line(60, 100)]));
    // Another provider or set size is another row.
    assert.equal(findApprovalStockExcess([
      line(60, 100),
      line(60, 100, { provider_id: 'p2' }),
      line(60, 100, { set_per_qty: 12 }),
    ]), null);
  });

  it('never blocks a rejection at zero, even with no stock left', () => {
    assert.equal(findApprovalStockExcess([line(0, 0)]), null);
  });

  it('runs in approve() before the RPC, as a stable error code', () => {
    const approve = orderService.slice(
      orderService.indexOf('async approve('),
      orderService.indexOf("rpc('review_order'"),
    );
    assert.match(approve, /findApprovalStockExcess\(/);
    assert.match(approve, /'ORDER_APPROVAL_EXCEEDS_STOCK'/);
  });
});

describe('a stack approval is a whole number of stacks', () => {
  it('refuses a partial stack, which could never be confirmed', () => {
    // The mock data held exactly this: 11 SET approved on a 12-SET stack.
    assert.throws(() => assertWholeStackApproval(11, 12), OrderRuleError);
    assert.throws(() => assertWholeStackApproval(30, '12'), OrderRuleError);
  });

  it('accepts whole stacks, a rejection at zero and any normal quantity', () => {
    assert.doesNotThrow(() => assertWholeStackApproval(24, 12));
    assert.doesNotThrow(() => assertWholeStackApproval(0, 12));
    assert.doesNotThrow(() => assertWholeStackApproval(11, null));
  });

  it('runs on every item during approval, before the RPC', () => {
    const approve = orderService.slice(
      orderService.indexOf('async approve('),
      orderService.indexOf("rpc('review_order'"),
    );
    assert.match(approve, /assertWholeStackApproval\(quantityApproved, item\.set_per_qty\)/);
  });
});

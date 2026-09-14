import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OrderStatus } from '../../src/domain/enums';
import { PERMISSION_CODE } from '../../src/domain/permission-codes';
import {
  assertApprovedQuantity,
  assertCancelReason,
  assertIssueWithinApproved,
  assertOrderActionAllowed,
  assertRejectedReason,
  assertStockAvailable,
  calculateStockAvailability,
  orderActionAffectsStock,
} from '../../src/domain/orderRules';

describe('order state flow', () => {
  it('supports PENDING -> APPROVED -> PARTIAL_ISSUED -> ISSUED -> RECEIVED -> COMPLETED', () => {
    let status: OrderStatus = 'PENDING';
    assert.doesNotThrow(() => assertOrderActionAllowed(status, 'approve'));
    status = 'APPROVED';
    assert.doesNotThrow(() => assertOrderActionAllowed(status, 'issue'));
    status = 'PARTIAL_ISSUED';
    assert.doesNotThrow(() => assertOrderActionAllowed(status, 'issue'));
    status = 'ISSUED';
    assert.doesNotThrow(() => assertOrderActionAllowed(status, 'receive'));
    status = 'RECEIVED';
    assert.doesNotThrow(() => assertOrderActionAllowed(status, 'complete'));
    status = 'COMPLETED';
    assert.throws(() => assertOrderActionAllowed(status, 'edit'));
  });

  it('does not allow editing OrderItems after issue/receive/complete', () => {
    for (const status of ['ISSUED', 'RECEIVED', 'COMPLETED'] as const) {
      assert.throws(() => assertOrderActionAllowed(status, 'edit'));
    }
  });

  it('marks only issue as an order action with stock impact', () => {
    assert.equal(orderActionAffectsStock('edit'), false);
    assert.equal(orderActionAffectsStock('approve'), false);
    assert.equal(orderActionAffectsStock('reject'), false);
    assert.equal(orderActionAffectsStock('receive'), false);
    assert.equal(orderActionAffectsStock('complete'), false);
    assert.equal(orderActionAffectsStock('cancel'), false);
    assert.equal(orderActionAffectsStock('issue'), true);
  });
});

describe('order quantity rules', () => {
  it('allows zero and quantity_approved above quantity_requested', () => {
    assert.equal(assertApprovedQuantity(0, 10), 0);
    assert.equal(assertApprovedQuantity(11, 10), 11);
    assert.equal(assertApprovedQuantity(10, 10), 10);
    assert.throws(() => assertApprovedQuantity(-1, 10), /greater than or equal to 0/);
  });

  it('reports current stock shortages without changing order quantities', () => {
    assert.deepEqual(calculateStockAvailability(100, 50), {
      available_quantity: 50,
      shortage_quantity: 50,
      has_stock_shortage: true,
    });
    assert.deepEqual(calculateStockAvailability(100, 120), {
      available_quantity: 120,
      shortage_quantity: 0,
      has_stock_shortage: false,
    });
  });

  it('rejects issue above quantity_approved including previous issues', () => {
    assert.doesNotThrow(() => assertIssueWithinApproved(4, 10, 6));
    assert.throws(() => assertIssueWithinApproved(4, 10, 7), /quantity_approved/);
  });

  it('rejects issue above the selected StockBalances quantity', () => {
    assert.doesNotThrow(() => assertStockAvailable(10, 10));
    assert.throws(() => assertStockAvailable(9, 10), /StockBalances/);
  });
});

describe('order reason and permission rules', () => {
  it('requires rejected_reason', () => {
    assert.throws(() => assertRejectedReason('  '), /rejected_reason/);
    assert.equal(assertRejectedReason('not available'), 'not available');
  });

  it('requires cancel_reason for every cancellable Order', () => {
    assert.throws(() => assertCancelReason(''), /cancel_reason/);
    assert.equal(assertCancelReason(' changed plan '), 'changed plan');
  });

  it('uses permission codes for each operational capability', () => {
    assert.equal(PERMISSION_CODE.SUPPLY_ORDER_CREATE, 'supply.order.create');
    assert.equal(PERMISSION_CODE.SUPPLY_ORDER_APPROVE, 'supply.order.approve');
    assert.equal(PERMISSION_CODE.SUPPLY_STOCK_READ, 'supply.stock.read');
    assert.equal(PERMISSION_CODE.SUPPLY_STOCK_ADJUST, 'supply.stock.adjust');
  });
});

import type { OrderStatus } from './enums';

export type OrderAction =
  | 'edit'
  | 'approve'
  | 'reject'
  | 'issue'
  | 'receive'
  | 'complete'
  | 'cancel';

const ACTION_STATUSES: Record<OrderAction, readonly OrderStatus[]> = {
  edit: ['PENDING'],
  approve: ['PENDING'],
  reject: ['PENDING'],
  issue: ['APPROVED', 'PARTIAL_ISSUED'],
  receive: ['ISSUED'],
  complete: ['RECEIVED', 'ISSUED'],
  cancel: ['PENDING'],
};

export class OrderRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderRuleError';
  }
}

export const assertOrderActionAllowed = (
  status: OrderStatus,
  action: OrderAction,
): void => {
  if (!ACTION_STATUSES[action].includes(status)) {
    throw new OrderRuleError(`Cannot ${action} order with status ${status}`);
  }
};

export const orderActionAffectsStock = (action: OrderAction): boolean =>
  action === 'issue';

export const assertRejectedReason = (reason: unknown): string => {
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new OrderRuleError('rejected_reason is required');
  }
  return reason.trim();
};

export const assertCancelReason = (
  reason: unknown,
): string => {
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new OrderRuleError('cancel_reason is required');
  }
  return reason.trim();
};

export const assertPositiveQuantity = (quantity: unknown, field: string): number => {
  const value = Number(quantity);
  if (!Number.isFinite(value) || value <= 0) {
    throw new OrderRuleError(`${field} must be greater than 0`);
  }
  return value;
};

export const assertApprovedQuantity = (
  quantityApproved: unknown,
  _quantityRequested: number,
): number => {
  const value = Number(quantityApproved);
  if (!Number.isFinite(value) || value < 0) {
    throw new OrderRuleError(
      'quantity_approved must be greater than or equal to 0',
    );
  }
  return value;
};

export const calculateStockAvailability = (
  quantityRequested: number,
  availableQuantity: number,
) => {
  const requested = Math.max(0, Number(quantityRequested) || 0);
  const available = Math.max(0, Number(availableQuantity) || 0);
  const shortage = Math.max(0, requested - available);

  return {
    available_quantity: available,
    shortage_quantity: shortage,
    has_stock_shortage: shortage > 0,
  };
};

export const assertIssueWithinApproved = (
  alreadyIssued: number,
  approved: number,
  requestedIssue: number,
): void => {
  if (alreadyIssued + requestedIssue > approved) {
    throw new OrderRuleError('Cannot issue more than quantity_approved');
  }
};

export const assertStockAvailable = (available: number, requestedIssue: number): void => {
  if (requestedIssue > available) {
    throw new OrderRuleError('Cannot issue more than StockBalances.quantity');
  }
};

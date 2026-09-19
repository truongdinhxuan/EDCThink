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

export const ORDER_STATUS_UPDATE_EXPIRED_MESSAGE =
  'Không thể cập nhật trạng thái Order do đã quá thời hạn cho phép (kết thúc ca + 3 giờ).';

/** How long after its shift ends an Order may still change status. */
export const ORDER_STATUS_UPDATE_GRACE_MS = 3 * 60 * 60 * 1000;

/**
 * The absolute instant a shift instance ends.
 *
 * Asia/Ho_Chi_Minh is a fixed UTC+7 with no DST, so pinning the offset is exact
 * all year and makes the result independent of the server's own timezone. A
 * shift flagged as crossing midnight ends on the following calendar day.
 *
 * Returns null when the pieces do not form a real instant, so callers can tell
 * "no deadline" apart from "deadline passed".
 */
/**
 * The absolute instant a shift instance starts. Same fixed-offset reasoning as
 * resolveShiftEndAt, kept beside it so shift arithmetic lives in one place.
 */
export const resolveShiftStartAt = (
  workDate: string,
  shift: { start_time: string },
): Date | null => {
  const startAt = new Date(`${workDate}T${shift.start_time}+07:00`);
  return Number.isNaN(startAt.getTime()) ? null : startAt;
};

export const resolveShiftEndAt = (
  workDate: string,
  shift: { end_time: string; crosses_midnight?: boolean },
): Date | null => {
  const endAt = new Date(`${workDate}T${shift.end_time}+07:00`);
  if (Number.isNaN(endAt.getTime())) return null;
  if (shift.crosses_midnight) endAt.setUTCDate(endAt.getUTCDate() + 1);
  return endAt;
};

/**
 * Whether the window for changing an Order's status has closed.
 *
 * Unreadable shift data yields false on purpose: bad master data must not strand
 * an Order that nobody can then approve, reject or cancel. The status machine
 * and the permission checks still apply.
 */
export const isOrderStatusUpdateExpired = (
  workDate: string,
  shift: { end_time: string; crosses_midnight?: boolean },
  now: Date = new Date(),
): boolean => {
  const endAt = resolveShiftEndAt(workDate, shift);
  if (!endAt) return false;
  return now.getTime() > endAt.getTime() + ORDER_STATUS_UPDATE_GRACE_MS;
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
  // Supply is counted in whole units; a fraction here means the caller bypassed
  // the request schema, so the rule layer refuses it too.
  if (!Number.isInteger(value)) {
    throw new OrderRuleError(`${field} phải là số nguyên dương`);
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
  if (!Number.isInteger(value)) {
    throw new OrderRuleError('quantity_approved phải là số nguyên');
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

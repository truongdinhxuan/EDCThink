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

/**
 * A stack item ships in whole stacks, so its approval must be a whole number of
 * them. An approval of 11 SET on a 12-SET stack can never be confirmed or
 * issued; refusing it here stops the Order from getting stuck after review.
 */
export const assertWholeStackApproval = (
  quantityApproved: number,
  setPerQty: number | string | null,
): void => {
  if (setPerQty === null || quantityApproved === 0) return;
  const perStack = Number(setPerQty);
  if (quantityApproved % perStack !== 0) {
    throw new OrderRuleError(
      `Kiện tiêu chuẩn phải duyệt theo bội số của ${perStack} SET/chồng.`,
    );
  }
};

export interface ApprovalStockLine {
  supply_id: string;
  provider_id: string;
  set_per_qty: number | string | null;
  quantity_approved: number;
  /** Pooled stock of this code in the source Area, in the item's own unit (SET for stacks). */
  available_quantity: number;
}

export interface ApprovalStockExcess {
  supply_id: string;
  provider_id: string;
  set_per_qty: number | null;
  approved_quantity: number;
  available_quantity: number;
}

/**
 * The approval may not promise more than the source Area holds. Lines of the
 * same code draw from one pooled row, so they are summed before comparing:
 * two lines of 60 against a stock of 100 is an over-promise even though each
 * line alone fits. Returns the first code that exceeds, or null.
 */
export const findApprovalStockExcess = (
  lines: readonly ApprovalStockLine[],
): ApprovalStockExcess | null => {
  const totals = new Map<string, ApprovalStockExcess>();
  for (const line of lines) {
    if (line.quantity_approved <= 0) continue;
    const setPerQty = line.set_per_qty === null ? null : Number(line.set_per_qty);
    const key = `${line.supply_id}:${line.provider_id}:${setPerQty ?? 'normal'}`;
    const current = totals.get(key) ?? {
      supply_id: line.supply_id,
      provider_id: line.provider_id,
      set_per_qty: setPerQty,
      approved_quantity: 0,
      available_quantity: Math.max(0, Number(line.available_quantity) || 0),
    };
    current.approved_quantity += line.quantity_approved;
    totals.set(key, current);
  }
  return [...totals.values()].find(
    (total) => total.approved_quantity > total.available_quantity,
  ) ?? null;
};

interface IssueClosureItem {
  set_per_qty: number | string | null;
  quantity_approved: number | string | null;
  quantity_issued: number | string | null;
  allocations?: ReadonlyArray<{ status: string | null }>;
}

/**
 * Whether an item has nothing left to issue. Mirrors the status rule at the end
 * of issue_order: a stack item closes when its confirmed count has been issued,
 * whatever that count was — it may sit below or above the approval by design —
 * while a normal item closes when it reaches its approval.
 */
export const isOrderItemIssueClosed = (item: IssueClosureItem): boolean => {
  if (item.quantity_approved === null) return false;
  const approved = Number(item.quantity_approved);
  if (item.set_per_qty !== null) {
    return approved === 0
      || (item.allocations ?? []).some((allocation) => allocation.status === 'ISSUED');
  }
  return Number(item.quantity_issued ?? 0) >= approved;
};

export const assertStockAvailable = (available: number, requestedIssue: number): void => {
  if (requestedIssue > available) {
    throw new OrderRuleError('Cannot issue more than StockBalances.quantity');
  }
};

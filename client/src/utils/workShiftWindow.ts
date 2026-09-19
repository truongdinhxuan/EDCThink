/**
 * Whether `at` falls outside a work shift window.
 *
 * Both bounds are absolute instants resolved server side in Asia/Ho_Chi_Minh
 * from the Sheet's work_date plus the shift's start_time/end_time, with end_time
 * already carried onto the following day when the shift crosses midnight. So the
 * whole calculation here is an instant comparison: there is no offset to apply
 * and no next-day arithmetic to repeat in the browser, where the device's own
 * timezone would otherwise leak into the verdict.
 *
 * The upper bound is exclusive, matching resolve_user_work_shift_instance in
 * Postgres (`p_at >= end`), so the two can never disagree on the closing minute.
 *
 * Missing or unparseable bounds return false: the UI must not lock a Sheet it
 * cannot reason about. The database guard inside create_pending_order_with_items
 * remains the authority either way.
 */
/** How long after its shift ends an Order may still change status. */
export const ORDER_STATUS_UPDATE_GRACE_MS = 3 * 60 * 60 * 1000;

interface ShiftEndSource {
  end_time?: string | null;
  crosses_midnight?: boolean | null;
}

/**
 * The absolute instant a shift instance ends, mirroring `resolveShiftEndAt` in
 * `server/src/domain/orderRules.ts`.
 *
 * Asia/Ho_Chi_Minh is a fixed UTC+7 with no DST, so pinning the offset is exact
 * all year and keeps the result independent of the device's own timezone. A
 * shift flagged as crossing midnight ends on the following calendar day.
 */
export const resolveShiftEndAt = (
  workDate: string | null | undefined,
  shift: ShiftEndSource | null | undefined,
): Date | null => {
  if (!workDate || !shift?.end_time) return null;
  const endAt = new Date(`${workDate}T${shift.end_time}+07:00`);
  if (Number.isNaN(endAt.getTime())) return null;
  if (shift.crosses_midnight) endAt.setUTCDate(endAt.getUTCDate() + 1);
  return endAt;
};

/**
 * The moment an Order's status may no longer be changed: its shift end plus the
 * grace period. Null when the shift is unknown or unreadable, which the UI must
 * treat as "no deadline" rather than locking the Order out. The backend repeats
 * this check and remains the authority.
 */
export const resolveStatusUpdateCutoff = (
  workDate: string | null | undefined,
  shift: ShiftEndSource | null | undefined,
): Date | null => {
  const endAt = resolveShiftEndAt(workDate, shift);
  return endAt ? new Date(endAt.getTime() + ORDER_STATUS_UPDATE_GRACE_MS) : null;
};

export const isOutsideShiftWindow = (
  startAt: string | null | undefined,
  endAt: string | null | undefined,
  at: number,
): boolean => {
  if (!startAt || !endAt) return false;
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return at < start || at >= end;
};

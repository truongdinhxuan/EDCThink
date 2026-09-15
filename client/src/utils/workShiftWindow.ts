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

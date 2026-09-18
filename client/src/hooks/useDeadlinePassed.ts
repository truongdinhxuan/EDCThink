import { useEffect, useState } from 'react';

/** Small cushion so the timer fires just after the deadline, never a tick early. */
const SETTLE_MS = 250;

/**
 * Whether a deadline has already gone by, re-evaluated exactly once when it
 * arrives.
 *
 * A single timer aimed at the deadline, rather than polling: the moment is known
 * in advance, so there is nothing to discover by waking up repeatedly. `null`
 * means there is no deadline and the answer is always false.
 */
export const useDeadlinePassed = (deadline: Date | null): boolean => {
  const deadlineMs = deadline?.getTime() ?? null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadlineMs === null) return undefined;
    // A deadline already in the past still schedules a refresh: `now` was read
    // when this component mounted and may be older than the deadline itself.
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(0, deadlineMs - Date.now()) + SETTLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [deadlineMs]);

  return deadlineMs !== null && now > deadlineMs;
};

/** Waits before attempts 2, 3, 4 and 5; the fifth failure is final. */
export const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000] as const;
export const MAX_ATTEMPTS = 5;
export const SEND_TIMEOUT_MS = 10_000;

export type SendResult =
  | { kind: 'response'; status: number; retryAfter?: string | null }
  | { kind: 'error'; message: string };

export interface DeliveryOutcome {
  status: 'SENT' | 'PENDING' | 'FAILED';
  nextAttemptAt: Date | null;
  httpStatus: number | null;
  error: string | null;
}

/** Retry-After as delta-seconds or an HTTP date; null when absent or unreadable. */
export const parseRetryAfterMs = (value: string | null | undefined, now: Date): number | null => {
  if (!value) return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now.getTime());
};

/**
 * Decides what one attempt means. `attempts` counts this attempt too.
 * 2xx sent; 408/429/5xx and network errors retry on the schedule (429 honours
 * Retry-After); any other status fails for good, since resending cannot help.
 */
export const decideOutcome = (
  result: SendResult,
  attempts: number,
  now: Date = new Date(),
): DeliveryOutcome => {
  const httpStatus = result.kind === 'response' ? result.status : null;
  if (httpStatus !== null && httpStatus >= 200 && httpStatus < 300) {
    return { status: 'SENT', nextAttemptAt: null, httpStatus, error: null };
  }

  const error = result.kind === 'error'
    ? result.message
    : `HTTP ${httpStatus}`;
  const retryable = result.kind === 'error'
    || httpStatus === 408
    || httpStatus === 429
    || (httpStatus !== null && httpStatus >= 500);

  if (!retryable || attempts >= MAX_ATTEMPTS) {
    return { status: 'FAILED', nextAttemptAt: null, httpStatus, error };
  }

  const scheduled = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
  const retryAfter = result.kind === 'response' && httpStatus === 429
    ? parseRetryAfterMs(result.retryAfter, now)
    : null;
  const delay = retryAfter ?? scheduled;
  return {
    status: 'PENDING',
    nextAttemptAt: new Date(now.getTime() + delay),
    httpStatus,
    error,
  };
};

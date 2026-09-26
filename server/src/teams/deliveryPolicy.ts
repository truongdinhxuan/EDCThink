/** Teams accepts about 28 KB per message; stay clear of it. */
export const MAX_PAYLOAD_BYTES = 25 * 1024;
/** Waits before retries 1, 2 and 3; the fourth attempt is the last. */
export const RETRY_DELAYS_MS = [5_000, 30_000, 120_000] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
export const SEND_TIMEOUT_MS = 10_000;

export type SendResult =
  | { kind: 'response'; status: number; retryAfter?: string | null }
  | { kind: 'error'; message: string };

export type AttemptOutcome =
  | { final: true; success: boolean; httpStatus: number | null; error: string | null }
  | { final: false; retryInMs: number; httpStatus: number | null; error: string };

/** Retry-After as delta-seconds or an HTTP date; null when absent or unreadable. */
export const parseRetryAfterMs = (value: string | null | undefined, now: Date): number | null => {
  if (!value) return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now.getTime());
};

/**
 * What one attempt means. `attempt` is 1-based. 2xx succeeds; 408/429/5xx and
 * network errors retry on the schedule (429 honours Retry-After); any other
 * status fails at once, since resending cannot help.
 */
export const decideOutcome = (
  result: SendResult,
  attempt: number,
  now: Date = new Date(),
): AttemptOutcome => {
  const httpStatus = result.kind === 'response' ? result.status : null;
  if (httpStatus !== null && httpStatus >= 200 && httpStatus < 300) {
    return { final: true, success: true, httpStatus, error: null };
  }

  const error = result.kind === 'error' ? result.message : `HTTP ${httpStatus}`;
  const retryable = result.kind === 'error'
    || httpStatus === 408
    || httpStatus === 429
    || (httpStatus !== null && httpStatus >= 500);
  if (!retryable || attempt >= MAX_ATTEMPTS) {
    return { final: true, success: false, httpStatus, error };
  }

  const retryAfter = httpStatus === 429 && result.kind === 'response'
    ? parseRetryAfterMs(result.retryAfter, now)
    : null;
  return { final: false, retryInMs: retryAfter ?? RETRY_DELAYS_MS[attempt - 1], httpStatus, error };
};

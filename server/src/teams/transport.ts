import { SEND_TIMEOUT_MS, type SendResult } from './deliveryPolicy';

export type TeamsTransport = (url: string, body: { html: string }) => Promise<SendResult>;

/**
 * POSTs `{ html }` to a Workflow URL. Redirects are not followed (a 3xx comes
 * back as a response and fails), and no error message ever contains the URL.
 */
export const postToWorkflow: TeamsTransport = async (url, body) => {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    // Drain so the socket is released; the body is not used.
    await response.arrayBuffer().catch(() => undefined);
    return {
      kind: 'response',
      status: response.status,
      retryAfter: response.headers.get('retry-after'),
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return {
      kind: 'error',
      message: name === 'TimeoutError' || name === 'AbortError'
        ? `Hết thời gian chờ ${SEND_TIMEOUT_MS / 1000}s`
        : 'Không kết nối được tới Workflow',
    };
  }
};

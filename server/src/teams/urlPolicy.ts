/**
 * Anti-SSRF policy for Workflow URLs read from Vault. The server POSTs to
 * whatever the secret holds, so only https to a Microsoft Power Automate /
 * Logic Apps host passes. Hardcoded on purpose: widening it is a code change.
 */
export const ALLOWED_WEBHOOK_HOSTS = [
  '*.logic.azure.com',
  '*.powerplatform.com',
  '*.api.powerplatform.com',
] as const;

export class WebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookUrlError';
  }
}

/** `*.example.com` matches any subdomain but not the bare `example.com`. */
export const hostMatches = (host: string, pattern: string): boolean => {
  const normalizedHost = host.toLowerCase().replace(/\.$/, '');
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1);
    return normalizedHost.endsWith(suffix) && normalizedHost.length > suffix.length;
  }
  return normalizedHost === pattern;
};

/** Messages never contain the URL: they end up in last_error and API responses. */
export const assertAllowedWebhookUrl = (
  value: string,
  allowedHosts: readonly string[] = ALLOWED_WEBHOOK_HOSTS,
): URL => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new WebhookUrlError('URL Workflow trong Vault không hợp lệ.');
  }
  if (url.protocol !== 'https:') {
    throw new WebhookUrlError('URL Workflow phải dùng https.');
  }
  if (url.username || url.password) {
    throw new WebhookUrlError('URL Workflow không được chứa thông tin đăng nhập.');
  }
  if (url.port && url.port !== '443') {
    throw new WebhookUrlError('URL Workflow không được dùng cổng khác 443.');
  }
  if (!allowedHosts.some((pattern) => hostMatches(url.hostname, pattern))) {
    throw new WebhookUrlError('Host của URL Workflow không nằm trong danh sách cho phép.');
  }
  return url;
};

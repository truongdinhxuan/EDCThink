/**
 * Anti-SSRF policy for Workflow URLs. The server will POST to whatever is saved
 * here, so only https to a Microsoft Power Automate / Logic Apps host passes.
 */
export const DEFAULT_ALLOWED_HOSTS = [
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

export const parseAllowedHosts = (raw: string | undefined): string[] => {
  const hosts = (raw ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return hosts.length > 0 ? hosts : [...DEFAULT_ALLOWED_HOSTS];
};

/** `*.example.com` matches any subdomain but not the bare `example.com`. */
export const hostMatches = (host: string, pattern: string): boolean => {
  const normalizedHost = host.toLowerCase().replace(/\.$/, '');
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1);
    return normalizedHost.endsWith(suffix) && normalizedHost.length > suffix.length;
  }
  return normalizedHost === pattern;
};

export const assertAllowedWebhookUrl = (value: string, allowedHosts: readonly string[]): URL => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new WebhookUrlError('URL Workflow không hợp lệ.');
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

/** host + "…" + last 6 characters. Enough to recognise a URL, useless to reuse it. */
export const maskWebhookUrl = (value: string | null): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.host}…${value.slice(-6)}`;
  } catch {
    return `…${value.slice(-6)}`;
  }
};

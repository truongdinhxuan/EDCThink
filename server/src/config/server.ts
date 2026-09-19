/**
 * `request.ip` is not cosmetic here: it keys every rate-limit bucket and it is
 * persisted as `auth_sessions.ip_address` for the session audit trail. Behind a
 * reverse proxy or load balancer it resolves to the proxy's own address unless
 * Fastify is told how many hops to trust, which would put every operator in a
 * single shared login bucket and make the audit column useless.
 *
 * Trusting `X-Forwarded-For` unconditionally is the opposite failure: the header
 * is client-supplied, so a spoofed value walks straight past the rate limiter.
 * Hence this is opt-in and explicit. Leave TRUST_PROXY unset for a directly
 * exposed server; set it to the proxy addresses (or the hop count) otherwise.
 *
 * Accepted values:
 *   unset | "false"        -> do not trust X-Forwarded-For
 *   "1", "2", ...          -> trust that many hops closest to the server
 *   "10.0.0.0/8, 1.2.3.4"  -> trust only these addresses / CIDR ranges
 *   "true"                 -> trust every hop (only safe when the server is
 *                             unreachable except through a proxy that always
 *                             overwrites X-Forwarded-For)
 */
export const getTrustProxyOption = (): boolean | number | string => {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw || raw.toLowerCase() === 'false') return false;
  if (raw.toLowerCase() === 'true') return true;

  const hops = Number(raw);
  if (Number.isInteger(hops)) {
    if (hops < 1) throw new Error('TRUST_PROXY hop count must be 1 or greater');
    return hops;
  }

  // Comma separated addresses / CIDR ranges, validated by Fastify's proxy-addr.
  return raw;
};

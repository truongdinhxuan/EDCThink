import helmet from '@fastify/helmet';
import fp from 'fastify-plugin';

/**
 * Baseline security response headers.
 *
 * Scope note: this is a JSON API, so the Content-Security-Policy that actually
 * mitigates XSS in the React app has to be sent by whatever serves the SPA's
 * HTML, not from here. CSP is therefore left off on this side for two reasons:
 * it would do nothing for the SPA, and @fastify/swagger-ui already ships its own
 * policy for /docs which a global one would fight with.
 *
 * What the API genuinely gains: HSTS so a stray plaintext request cannot
 * downgrade the Secure refresh cookie, nosniff, a referrer policy that keeps
 * tokens out of Referer headers, and framing denial.
 */
export default fp(async (fastify) => {
  const production = process.env.NODE_ENV === 'production';

  await fastify.register(helmet, {
    contentSecurityPolicy: false,
    // CORS already decides who may read a response; CORP on top of it would
    // break a frontend deployed on a different site.
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: production
      ? { maxAge: 15_552_000, includeSubDomains: true, preload: false }
      : false,
  });

  fastify.log.info(
    { hsts: production },
    'Security headers are active (CSP is owned by the frontend host)',
  );
});

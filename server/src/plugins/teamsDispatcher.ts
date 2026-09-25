import fp from 'fastify-plugin';
import { readTeamsConfig, teamsWebhookUrlEnvKey } from '../config/teams';
import { assertAllowedWebhookUrl } from '../teams/urlPolicy';
import { TeamsDispatcher } from '../teams/dispatcher';
import { postToWorkflow } from '../teams/transport';

/**
 * Starts the Teams outbox sweep with the server and stops it on close.
 * Requires a long-running Node process: a per-request runtime (e.g. Cloudflare
 * Workers) would never run the sweep, and queued messages would only leave when
 * a later status change kicks the dispatcher.
 */
export default fp(async (fastify) => {
  const config = readTeamsConfig();
  const dispatcher = new TeamsDispatcher(fastify.supabaseAdmin, {
    transport: postToWorkflow,
    appBaseUrl: config.appBaseUrl,
    allowedHosts: config.allowedHosts,
    webhookUrls: config.webhookUrls,
    log: fastify.log,
  });

  // Surface a misconfigured env at boot rather than as FAILED rows later.
  // Only the variable name is logged, never the URL.
  for (const [code, url] of Object.entries(config.webhookUrls)) {
    if (!url) continue;
    try {
      assertAllowedWebhookUrl(url, config.allowedHosts);
    } catch {
      fastify.log.warn(`${teamsWebhookUrlEnvKey(code)} is not an https URL on TEAMS_WEBHOOK_ALLOWED_HOSTS; messages for ${code} will fail`);
    }
  }
  fastify.decorate('teamsDispatcher', dispatcher);

  if (config.dispatcherEnabled) {
    fastify.addHook('onReady', async () => dispatcher.start(config.sweepIntervalMs));
  }
  fastify.addHook('onClose', async () => dispatcher.stop());
}, { name: 'teams-dispatcher' });

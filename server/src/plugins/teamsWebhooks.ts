import fp from 'fastify-plugin';
import { readTeamsConfig } from '../config/teams';
import { TeamsListener } from '../teams/listener';
import { TeamsSender } from '../teams/sender';

declare module 'fastify' {
  interface FastifyInstance {
    teamsSender: TeamsSender;
  }
}

/**
 * Teams webhooks: a sender (in-memory queues and retries) fed by a Postgres
 * LISTEN session. Requires a long-running Node process; a per-request runtime
 * (e.g. Cloudflare Workers) cannot hold the LISTEN connection.
 */
export default fp(async (fastify) => {
  const config = readTeamsConfig();
  const sender = new TeamsSender(fastify.supabaseAdmin, {
    appBaseUrl: config.appBaseUrl,
    log: fastify.log,
  });
  fastify.decorate('teamsSender', sender);

  if (!config.appBaseUrl) {
    fastify.log.warn('ORIGIN_URL is not set; "Xem chi tiết" links in Teams messages will be relative');
  }

  let listener: TeamsListener | null = null;
  if (!config.listenerEnabled) {
    fastify.log.info('Teams webhook: listener disabled (TEAMS_LISTENER_ENABLED=false)');
  } else if (!config.databaseUrl) {
    fastify.log.warn('Teams webhook: SUPABASE_DB_URL is not set; order status messages will not be sent');
  } else {
    listener = new TeamsListener({
      connectionString: config.databaseUrl,
      onNotification: (payload) => sender.handleNotification(payload),
      log: fastify.log,
    });
    const started = listener;
    fastify.addHook('onReady', async () => started.start());
  }

  fastify.addHook('onClose', async () => {
    await listener?.stop();
    sender.stop();
  });
}, { name: 'teams-webhooks' });

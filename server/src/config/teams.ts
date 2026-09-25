import { TEAMS_FUNCTION_CODES } from '../teams/registry';
import { parseAllowedHosts } from '../teams/urlPolicy';

/** The env variable holding a function's Workflow URL. */
export const teamsWebhookUrlEnvKey = (functionCode: string): string =>
  `TEAMS_WEBHOOK_URL_${functionCode}`;

export interface TeamsConfig {
  /** Client origin for links in messages: ORIGIN_URL, shared with CORS. */
  appBaseUrl: string;
  allowedHosts: string[];
  /**
   * Workflow HTTP POST URL per registry function, from
   * TEAMS_WEBHOOK_URL_<FUNCTION_CODE>. Secret: never logged, never returned
   * to the client except masked. Changing one needs a server restart.
   */
  webhookUrls: Readonly<Record<string, string | undefined>>;
  /** Off in tests and one-off scripts; on by default for the server. */
  dispatcherEnabled: boolean;
  sweepIntervalMs: number;
}

export const readTeamsConfig = (env: NodeJS.ProcessEnv = process.env): TeamsConfig => ({
  appBaseUrl: (env.ORIGIN_URL?.trim() ?? '').replace(/\/+$/, ''),
  allowedHosts: parseAllowedHosts(env.TEAMS_WEBHOOK_ALLOWED_HOSTS),
  webhookUrls: Object.fromEntries(TEAMS_FUNCTION_CODES.map((code) => [
    code,
    env[teamsWebhookUrlEnvKey(code)]?.trim().replace(/^["']|["']$/g, '') || undefined,
  ])),
  dispatcherEnabled: env.TEAMS_DISPATCHER_ENABLED?.trim().toLowerCase() !== 'false',
  sweepIntervalMs: 15_000,
});

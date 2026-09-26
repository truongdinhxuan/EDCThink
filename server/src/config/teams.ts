export interface TeamsConfig {
  /** Client origin for links in messages: ORIGIN_URL, shared with CORS. */
  appBaseUrl: string;
  /**
   * Direct or session-pooler Postgres URL for LISTEN (a transaction pooler
   * drops LISTEN between statements). Unset: no events are received.
   */
  databaseUrl: string | null;
  /** Off in tests and one-off scripts; on by default for the server. */
  listenerEnabled: boolean;
}

export const readTeamsConfig = (env: NodeJS.ProcessEnv = process.env): TeamsConfig => ({
  appBaseUrl: (env.ORIGIN_URL?.trim() ?? '').replace(/\/+$/, ''),
  databaseUrl: env.SUPABASE_DB_URL?.trim() || null,
  listenerEnabled: env.TEAMS_LISTENER_ENABLED?.trim().toLowerCase() !== 'false',
});

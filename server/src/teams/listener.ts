import { Client } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { TEAMS_EVENTS_CHANNEL } from './registry';

/** Only the instance holding this session lock listens, so each event is sent once. */
export const TEAMS_LISTENER_LOCK_KEY = 815_203_417;
const MAX_RECONNECT_MS = 30_000;
const LOCK_RETRY_MS = 30_000;

export interface TeamsListenerOptions {
  connectionString: string;
  onNotification: (payload: string | undefined) => void;
  log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
}

/**
 * Keeps one dedicated Postgres session on LISTEN teams_webhook_events and
 * reconnects when it drops. Needs a session connection (direct, or the session
 * pooler on port 5432); a transaction pooler loses LISTEN between queries.
 * Notifications sent while it is disconnected are not replayed.
 */
export class TeamsListener {
  private client: Client | null = null;
  private timer: NodeJS.Timeout | null = null;
  private delayMs = 1_000;
  private stopped = true;

  constructor(private readonly options: TeamsListenerOptions) {}

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const client = this.client;
    this.client = null;
    await client?.end().catch(() => undefined);
  }

  get listening(): boolean {
    return this.client !== null;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const client = new Client({
      connectionString: this.options.connectionString,
      application_name: 'edcthink-teams-listener',
      keepAlive: true,
    });
    let closed = false;
    const close = () => {
      if (closed) return false;
      closed = true;
      if (this.client === client) this.client = null;
      void client.end().catch(() => undefined);
      return true;
    };
    const onDrop = () => {
      if (close()) this.schedule(this.nextDelay(), 'connection lost');
    };
    client.on('error', onDrop);
    client.on('end', onDrop);

    try {
      await client.connect();
      const { rows } = await client.query<{ locked: boolean }>(
        'select pg_try_advisory_lock($1) as locked',
        [TEAMS_LISTENER_LOCK_KEY],
      );
      if (!rows[0]?.locked) {
        close();
        this.schedule(LOCK_RETRY_MS, 'another instance is listening');
        return;
      }
      client.on('notification', (message) => {
        if (message.channel === TEAMS_EVENTS_CHANNEL) this.options.onNotification(message.payload);
      });
      await client.query(`listen ${TEAMS_EVENTS_CHANNEL}`);
      if (this.stopped) {
        close();
        return;
      }
      this.client = client;
      this.delayMs = 1_000;
      this.options.log.info(`Teams webhook: listening on ${TEAMS_EVENTS_CHANNEL}`);
    } catch (error) {
      // pg errors can quote connection details; log the code only.
      const code = (error as { code?: string }).code ?? 'unknown';
      this.options.log.warn(`Teams webhook: listener could not connect (${code})`);
      onDrop();
    }
  }

  private nextDelay(): number {
    const delay = this.delayMs;
    this.delayMs = Math.min(this.delayMs * 2, MAX_RECONNECT_MS);
    return delay;
  }

  private schedule(ms: number, reason: string): void {
    if (this.stopped || this.timer) return;
    this.options.log.info(`Teams webhook: listener retries in ${Math.round(ms / 1000)}s (${reason})`);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connect();
    }, ms);
  }
}

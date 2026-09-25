import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';
import { decideOutcome, type DeliveryOutcome } from './deliveryPolicy';
import { getTeamsFunction, MAX_PAYLOAD_BYTES } from './registry';
import type { TeamsTransport } from './transport';
import { assertAllowedWebhookUrl } from './urlPolicy';

export interface DeliveryPayload {
  snapshot?: unknown;
  body?: { html: string };
  test?: boolean;
}

export interface DeliveryRow {
  id: string;
  seq: number;
  workflow_id: string;
  function_code: string;
  entity_type: string;
  entity_id: string;
  event_key: string;
  payload: DeliveryPayload;
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
}

interface WorkflowTarget {
  isActive: boolean;
  url: string | null;
}

export interface TeamsDispatcherOptions {
  transport: TeamsTransport;
  appBaseUrl: string;
  allowedHosts: readonly string[];
  /** Workflow URL per function code, from the server env. */
  webhookUrls: Readonly<Record<string, string | undefined>>;
  batchSize?: number;
  leaseSeconds?: number;
  now?: () => Date;
  log?: { error: (details: object, message: string) => void };
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Set by plugins/teamsDispatcher.ts. */
    teamsDispatcher?: TeamsDispatcher;
  }
}

/**
 * Called after a committed Order status change so its queued Teams message
 * leaves now rather than at the next sweep. Safe without the plugin (scripts,
 * tests): it then does nothing.
 */
export const kickTeamsDispatcher = (fastify: FastifyInstance): void => {
  fastify.teamsDispatcher?.kick();
};

const byteLength = (value: string): number => Buffer.byteLength(value, 'utf8');

/**
 * Drains the teams_webhook_deliveries outbox.
 *
 * `kick()` is called right after an Order status change commits, so a message
 * normally leaves within a second; `start()` adds a 15s sweep that catches
 * retries and anything a kick missed (another instance, a restart). Several
 * instances can run this at once: claiming uses FOR UPDATE SKIP LOCKED plus a
 * lease, and rows of one Order are claimed strictly in order.
 *
 * The URL comes from the server env (TEAMS_WEBHOOK_URL_<FUNCTION_CODE>) and is
 * never logged or stored in an error message.
 */
export class TeamsDispatcher {
  private running: Promise<void> | null = null;
  private rerun = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly batchSize: number;
  private readonly leaseSeconds: number;
  private readonly now: () => Date;

  constructor(
    private readonly db: SupabaseClient,
    private readonly options: TeamsDispatcherOptions,
  ) {
    this.batchSize = options.batchSize ?? 20;
    this.leaseSeconds = options.leaseSeconds ?? 60;
    this.now = options.now ?? (() => new Date());
  }

  /** Fire-and-forget: never throws and never delays the caller. */
  kick(): void {
    void this.drain().catch((error: unknown) => {
      this.options.log?.error({ err: error }, 'Teams dispatcher pass failed');
    });
  }

  /** Runs passes until nothing is due. Concurrent calls share one run. */
  drain(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.rerun = false;
        // A sent message can unblock the next one of the same Order, so keep
        // claiming until a pass comes back empty.
        while ((await this.runOnce()) > 0) { /* keep draining */ }
      } while (this.rerun);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  start(intervalMs = 15_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.kick(), intervalMs);
    this.timer.unref();
    this.kick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined);
  }

  async runOnce(): Promise<number> {
    const { data, error } = await this.db.rpc('claim_teams_webhook_deliveries', {
      p_limit: this.batchSize,
      p_lease_seconds: this.leaseSeconds,
    });
    if (error) throw new Error(`claim_teams_webhook_deliveries: ${error.message}`);
    const rows = (data ?? []) as DeliveryRow[];
    const targets = new Map<string, WorkflowTarget>();
    // One at a time: a batch holds at most one row per Order anyway, and
    // sequential sends keep the Workflow from being flooded.
    for (const row of rows) await this.deliver(row, targets);
    return rows.length;
  }

  private async target(row: DeliveryRow, cache: Map<string, WorkflowTarget>): Promise<WorkflowTarget> {
    const cached = cache.get(row.workflow_id);
    if (cached) return cached;
    const { data: workflow } = await this.db
      .from('teams_workflows')
      .select('is_active')
      .eq('id', row.workflow_id)
      .maybeSingle();
    const resolved: WorkflowTarget = {
      isActive: Boolean((workflow as { is_active?: boolean } | null)?.is_active),
      url: this.options.webhookUrls[row.function_code] ?? null,
    };
    cache.set(row.workflow_id, resolved);
    return resolved;
  }

  private async deliver(row: DeliveryRow, cache: Map<string, WorkflowTarget>): Promise<void> {
    const now = this.now();
    let payload = row.payload ?? {};

    // Render once; every later attempt resends exactly this body.
    if (!payload.body) {
      const definition = getTeamsFunction(row.function_code);
      if (!definition) {
        await this.finish(row, payload, this.giveUp(`Chức năng ${row.function_code} không có trong registry`), now);
        return;
      }
      let html: string;
      try {
        html = definition.buildHtml(payload.snapshot, { appBaseUrl: this.options.appBaseUrl });
      } catch {
        await this.finish(row, payload, this.giveUp('Không dựng được nội dung tin nhắn'), now);
        return;
      }
      payload = { ...payload, body: { html } };
    }
    if (byteLength(JSON.stringify(payload.body)) > MAX_PAYLOAD_BYTES) {
      await this.finish(row, payload, this.giveUp('Nội dung vượt giới hạn 25KB'), now);
      return;
    }

    const target = await this.target(row, cache);
    // A test send goes out even while the Workflow is switched off, so an admin
    // can check a URL before enabling it.
    if (!target.isActive && !payload.test) {
      await this.finish(row, payload, this.giveUp('Workflow đang tắt'), now);
      return;
    }
    if (!target.url) {
      await this.finish(row, payload, this.giveUp(`Chưa khai báo TEAMS_WEBHOOK_URL_${row.function_code} trong .env`), now);
      return;
    }
    try {
      assertAllowedWebhookUrl(target.url, this.options.allowedHosts);
    } catch {
      await this.finish(row, payload, this.giveUp('URL Workflow không nằm trong danh sách cho phép'), now);
      return;
    }

    const result = await this.options.transport(target.url, payload.body!);
    await this.finish(row, payload, decideOutcome(result, row.attempts + 1, now), now, true);
  }

  private giveUp(error: string): DeliveryOutcome {
    return { status: 'FAILED', nextAttemptAt: null, httpStatus: null, error };
  }

  private async finish(
    row: DeliveryRow,
    payload: DeliveryPayload,
    outcome: DeliveryOutcome,
    now: Date,
    attempted = false,
  ): Promise<void> {
    const { error } = await this.db
      .from('teams_webhook_deliveries')
      .update({
        payload,
        status: outcome.status,
        attempts: attempted ? row.attempts + 1 : row.attempts,
        last_http_status: outcome.httpStatus,
        last_error: outcome.error,
        next_attempt_at: outcome.nextAttemptAt?.toISOString() ?? null,
        sent_at: outcome.status === 'SENT' ? now.toISOString() : null,
        locked_until: null,
      })
      .eq('id', row.id);
    if (error) throw new Error(`update teams_webhook_deliveries: ${error.message}`);
  }
}

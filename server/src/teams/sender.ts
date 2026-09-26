import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyBaseLogger } from 'fastify';
import {
  decideOutcome,
  MAX_PAYLOAD_BYTES,
  type SendResult,
} from './deliveryPolicy';
import { getTeamsHook, type TeamsHookDefinition } from './registry';
import { postToWorkflow, type TeamsTransport } from './transport';
import { ALLOWED_WEBHOOK_HOSTS, assertAllowedWebhookUrl, WebhookUrlError } from './urlPolicy';

export const URL_CACHE_MS = 5 * 60_000;

export interface TeamsSendResult {
  success: boolean;
  http_status: number | null;
  error: string | null;
}

export interface TeamsSenderOptions {
  appBaseUrl: string;
  transport?: TeamsTransport;
  /** Tests point this at a local mock; production uses the hardcoded list. */
  allowedHosts?: readonly string[];
  log?: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
  urlCacheMs?: number;
  /** Tests shorten the retry waits. */
  sleep?: (ms: number) => Promise<void>;
}

type Logger = NonNullable<TeamsSenderOptions['log']>;
const silent: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

/**
 * Sends Teams messages in-process. Messages with the same queue key (one Order)
 * go out strictly one after another, retries included. Nothing is persisted but
 * the latest outcome per function: a message still waiting for a retry is lost
 * if the process stops.
 *
 * The Workflow URL is read from Vault through get_teams_webhook_url, cached for
 * a few minutes, and never logged or returned: errors carry a short message.
 */
export class TeamsSender {
  private readonly transport: TeamsTransport;
  private readonly allowedHosts: readonly string[];
  private readonly log: Logger;
  private readonly urlCacheMs: number;
  private readonly urlCache = new Map<string, { url: string | null; expiresAt: number }>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly timers = new Set<{ timer: NodeJS.Timeout; resolve: () => void }>();
  private stopped = false;

  constructor(private readonly db: SupabaseClient, private readonly options: TeamsSenderOptions) {
    this.transport = options.transport ?? postToWorkflow;
    this.allowedHosts = options.allowedHosts ?? ALLOWED_WEBHOOK_HOSTS;
    this.log = options.log ?? silent;
    this.urlCacheMs = options.urlCacheMs ?? URL_CACHE_MS;
  }

  /** Entry point for a raw NOTIFY payload. Never throws. */
  handleNotification(rawPayload: string | undefined): void {
    let payload: Record<string, unknown> | null = null;
    try {
      payload = JSON.parse(rawPayload ?? '') as Record<string, unknown>;
    } catch {
      // handled below
    }
    const hook = getTeamsHook(payload?.code);
    const parsed = payload && hook ? hook.parseEvent(payload) : null;
    if (!hook || !parsed) {
      this.log.warn('Teams webhook: ignored a notification it cannot read');
      return;
    }
    this.enqueue(parsed.queueKey, () => this.deliver(hook, parsed.event));
  }

  /** Resolves once every queued message has been sent or given up on. */
  async idle(): Promise<void> {
    while (this.queues.size > 0) {
      await Promise.all([...this.queues.values()]);
    }
  }

  /** Cancels pending retries; queued work finishes without sending. */
  stop(): void {
    this.stopped = true;
    for (const entry of this.timers) {
      clearTimeout(entry.timer);
      entry.resolve();
    }
    this.timers.clear();
  }

  /** One immediate attempt with buildTestHtml(); records the outcome. */
  async sendTest(code: string, title: string): Promise<TeamsSendResult> {
    const hook = getTeamsHook(code);
    if (!hook) return { success: false, http_status: null, error: 'Chức năng không có trong registry.' };
    // Fresh read: the admin may have just changed the secret.
    const url = await this.resolveUrl(code, true);
    if (!url) return { success: false, http_status: null, error: 'Chưa cấu hình URL trong Supabase.' };
    const outcome = decideOutcome(await this.attempt(url, hook.buildTestHtml(title)), Number.MAX_SAFE_INTEGER);
    const result: TeamsSendResult = {
      success: outcome.final && outcome.success,
      http_status: outcome.httpStatus,
      error: outcome.error,
    };
    await this.record(code, result);
    return result;
  }

  /** Drops the cached URL, e.g. right after an admin saved a new one. */
  forgetUrl(code: string): void {
    this.urlCache.delete(code);
  }

  private enqueue(key: string, task: () => Promise<void>): void {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next: Promise<void> = previous
      .then(task)
      .catch((error: unknown) => {
        this.log.error(`Teams webhook: send failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      })
      .finally(() => {
        if (this.queues.get(key) === next) this.queues.delete(key);
      });
    this.queues.set(key, next);
  }

  private async deliver(hook: TeamsHookDefinition, event: unknown): Promise<void> {
    if (this.stopped) return;
    const { data: row, error } = await this.db
      .from('teams_webhooks')
      .select('is_active')
      .eq('code', hook.code)
      .maybeSingle();
    if (error) throw new Error(`teams_webhooks: ${error.message}`);
    if (!row?.is_active) return;

    const url = await this.resolveUrl(hook.code);
    if (!url) return; // no secret in Vault yet

    const snapshot = await hook.loadEvent(this.db, event);
    if (!snapshot) return;
    const html = hook.buildHtml(snapshot, { appBaseUrl: this.options.appBaseUrl });

    const result = await this.sendWithRetry(url, html);
    if (result) await this.record(hook.code, result);
  }

  /** Null when stopped while waiting to retry: nothing to record. */
  private async sendWithRetry(url: string, html: string): Promise<TeamsSendResult | null> {
    for (let attempt = 1; ; attempt += 1) {
      const outcome = decideOutcome(await this.attempt(url, html), attempt);
      if (outcome.final) {
        return { success: outcome.success, http_status: outcome.httpStatus, error: outcome.error };
      }
      await this.wait(outcome.retryInMs);
      if (this.stopped) return null;
    }
  }

  private async attempt(url: string, html: string): Promise<SendResult> {
    try {
      assertAllowedWebhookUrl(url, this.allowedHosts);
    } catch (error) {
      return {
        kind: 'error',
        message: error instanceof WebhookUrlError ? error.message : 'URL Workflow không hợp lệ.',
      };
    }
    if (Buffer.byteLength(JSON.stringify({ html }), 'utf8') > MAX_PAYLOAD_BYTES) {
      return { kind: 'error', message: 'Nội dung tin vượt quá 25KB.' };
    }
    return this.transport(url, { html });
  }

  private wait(ms: number): Promise<void> {
    if (this.options.sleep) return this.options.sleep(ms);
    return new Promise((resolve) => {
      const entry = {
        timer: setTimeout(() => {
          this.timers.delete(entry);
          resolve();
        }, ms),
        resolve,
      };
      this.timers.add(entry);
    });
  }

  private async resolveUrl(code: string, fresh = false): Promise<string | null> {
    const cached = this.urlCache.get(code);
    if (!fresh && cached && cached.expiresAt > Date.now()) return cached.url;
    const { data, error } = await this.db.rpc('get_teams_webhook_url', { p_code: code });
    if (error) throw new Error(`get_teams_webhook_url: ${error.message}`);
    const url = typeof data === 'string' && data.trim() ? data.trim() : null;
    this.urlCache.set(code, { url, expiresAt: Date.now() + this.urlCacheMs });
    return url;
  }

  private async record(code: string, result: TeamsSendResult): Promise<void> {
    const { error } = await this.db
      .from('teams_webhooks')
      .update({
        last_sent_at: new Date().toISOString(),
        last_success: result.success,
        last_http_status: result.http_status,
        last_error: result.error?.slice(0, 500) ?? null,
      })
      .eq('code', code);
    if (error) this.log.error(`Teams webhook: could not record the result for ${code}: ${error.message}`);
  }
}

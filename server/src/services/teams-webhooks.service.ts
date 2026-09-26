import type { FastifyInstance } from 'fastify';
import { getTeamsHook } from '../teams/registry';
import type { TeamsSendResult } from '../teams/sender';
import { assertAllowedWebhookUrl, WebhookUrlError } from '../teams/urlPolicy';

export class TeamsWebhookServiceError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'TeamsWebhookServiceError';
  }
}

const fail = (statusCode: number, message: string): never => {
  throw new TeamsWebhookServiceError(statusCode, message);
};

/** What GET /teams-webhooks returns per function. Never the URL. */
export interface TeamsWebhookView {
  code: string;
  title: string;
  description: string | null;
  is_active: boolean;
  /** A secret named teams_webhook:{code} exists in Vault. */
  configured: boolean;
  last_sent_at: string | null;
  last_success: boolean | null;
  last_http_status: number | null;
  last_error: string | null;
}

export class TeamsWebhooksService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get db() {
    return this.fastify.supabaseAdmin;
  }

  /** Rows whose code has no registry entry are hidden: they could never send. */
  async list(): Promise<TeamsWebhookView[]> {
    const { data, error } = await this.db.rpc('list_teams_webhooks');
    if (error) throw new Error(`list_teams_webhooks: ${error.message}`);
    return ((data ?? []) as TeamsWebhookView[]).filter((row) => getTeamsHook(row.code));
  }

  private async get(code: string): Promise<TeamsWebhookView> {
    const row = (await this.list()).find((item) => item.code === code);
    return row ?? fail(404, 'Không tìm thấy chức năng Teams Webhook.');
  }

  async setActive(code: string, isActive: boolean): Promise<TeamsWebhookView> {
    const current = await this.get(code);
    if (isActive && !current.configured) {
      fail(409, 'Chưa cấu hình URL trong Supabase.');
    }
    const { error } = await this.db
      .from('teams_webhooks')
      .update({ is_active: isActive })
      .eq('code', code);
    if (error) throw new Error(`teams_webhooks: ${error.message}`);
    return this.get(code);
  }

  /**
   * Stores a new Workflow URL in Vault (write-only: nothing ever reads it back
   * to the client). Checked against the allowlist first; error messages never
   * quote the URL.
   */
  async setUrl(code: string, webhookUrl: string): Promise<TeamsWebhookView> {
    await this.get(code);
    try {
      assertAllowedWebhookUrl(webhookUrl);
    } catch (error) {
      if (error instanceof WebhookUrlError) fail(400, error.message);
      throw error;
    }
    const { error } = await this.db.rpc('set_teams_webhook_url', {
      p_code: code,
      p_url: webhookUrl.trim(),
    });
    // The Postgres message is generic (e.g. TEAMS_WEBHOOK_NOT_FOUND), never the URL.
    if (error) throw new Error(`set_teams_webhook_url: ${error.message}`);
    this.fastify.teamsSender.forgetUrl(code);
    return this.get(code);
  }

  async sendTest(code: string): Promise<{ success: boolean; http_status: number | null }> {
    const current = await this.get(code);
    if (!current.configured) fail(409, 'Chưa cấu hình URL trong Supabase.');
    const result: TeamsSendResult = await this.fastify.teamsSender.sendTest(code, current.title);
    return { success: result.success, http_status: result.http_status };
  }
}

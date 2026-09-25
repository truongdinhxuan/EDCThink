import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { readTeamsConfig, teamsWebhookUrlEnvKey, type TeamsConfig } from '../config/teams';
import { decideOutcome } from '../teams/deliveryPolicy';
import { kickTeamsDispatcher } from '../teams/dispatcher';
import {
  getTeamsFunction,
  TEAMS_FUNCTIONS,
  type TeamsFunctionCode,
} from '../teams/registry';
import { postToWorkflow, type TeamsTransport } from '../teams/transport';
import {
  assertAllowedWebhookUrl,
  maskWebhookUrl,
  WebhookUrlError,
} from '../teams/urlPolicy';
import { TEAMS_DELIVERY_SORT_FIELDS } from '../schemas/teams-workflows';
import type { PaginationQuery } from '../interfaces/pagination';
import {
  createPaginatedResult,
  parsePagination,
  resolvePaginatedQueryResult,
} from '../utils/pagination';

export class TeamsWorkflowServiceError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'TeamsWorkflowServiceError';
  }
}

const fail = (statusCode: number, message: string): never => {
  throw new TeamsWorkflowServiceError(statusCode, message);
};

interface WorkflowRow {
  id: string;
  function_code: string;
  name: string;
  is_active: boolean;
  updated_at: string;
}

interface DeliveryListRow {
  id: string;
  workflow_id: string;
  function_code: string;
  entity_type: string;
  entity_id: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
  last_http_status: number | null;
  last_error: string | null;
  next_attempt_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
  payload: {
    test?: boolean;
    snapshot?: { new_status?: { code?: string; name?: string } };
  } | null;
}

export interface SaveTeamsWorkflowBody {
  is_active: boolean;
  name?: string;
}

export interface TeamsDeliveryListQuery extends PaginationQuery {
  functionCode?: string;
  status?: 'PENDING' | 'SENT' | 'FAILED';
  orderCode?: string;
}

const WORKFLOW_SELECT = 'id, function_code, name, is_active, updated_at';
const DELIVERY_SELECT = `
  id, workflow_id, function_code, entity_type, entity_id, status, attempts,
  last_http_status, last_error, next_attempt_at, sent_at, created_at, updated_at,
  payload
`;

/** What the log and the card show; never the rendered body, never the URL. */
const toDeliveryItem = (row: DeliveryListRow, orderCodes: Map<string, string>) => ({
  id: row.id,
  function_code: row.function_code,
  entity_type: row.entity_type,
  entity_id: row.entity_id,
  order_code: row.entity_type === 'order' ? orderCodes.get(row.entity_id) ?? null : null,
  is_test: Boolean(row.payload?.test),
  order_status: row.payload?.snapshot?.new_status?.name ?? null,
  status: row.status,
  attempts: row.attempts,
  last_http_status: row.last_http_status,
  last_error: row.last_error,
  next_attempt_at: row.next_attempt_at,
  sent_at: row.sent_at,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

export class TeamsWorkflowsService {
  private readonly config: TeamsConfig;

  constructor(
    private readonly fastify: FastifyInstance,
    private readonly transport: TeamsTransport = postToWorkflow,
    config?: TeamsConfig,
  ) {
    this.config = config ?? readTeamsConfig();
  }

  private get db() {
    return this.fastify.supabaseAdmin;
  }

  private async orderCodes(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const { data, error } = await this.db.from('orders').select('id, code').in('id', ids);
    if (error) fail(500, 'Không tải được mã đơn.');
    return new Map(((data ?? []) as Array<{ id: string; code: string }>).map((order) => [order.id, order.code]));
  }

  private async findWorkflow(code: TeamsFunctionCode): Promise<WorkflowRow | null> {
    const { data, error } = await this.db
      .from('teams_workflows')
      .select(WORKFLOW_SELECT)
      .eq('function_code', code)
      .maybeSingle();
    if (error) fail(500, 'Không tải được cấu hình Workflow.');
    return data as WorkflowRow | null;
  }

  private webhookUrl(code: TeamsFunctionCode): string | null {
    return this.config.webhookUrls[code] ?? null;
  }

  /** Every registry function, configured or not, with a masked URL and the latest attempt. */
  async list() {
    const { data, error } = await this.db.from('teams_workflows').select(WORKFLOW_SELECT);
    if (error) fail(500, 'Không tải được cấu hình Workflow.');
    const byCode = new Map(((data ?? []) as WorkflowRow[]).map((row) => [row.function_code, row]));

    return Promise.all(Object.values(TEAMS_FUNCTIONS).map(async (definition) => {
      const code = definition.code as TeamsFunctionCode;
      const workflow = byCode.get(code) ?? null;
      const url = this.webhookUrl(code);
      let urlAllowed = false;
      if (url) {
        try {
          assertAllowedWebhookUrl(url, this.config.allowedHosts);
          urlAllowed = true;
        } catch { /* reported as url_allowed: false */ }
      }
      let lastDelivery = null;
      if (workflow) {
        const { data: latest } = await this.db
          .from('teams_webhook_deliveries')
          .select(DELIVERY_SELECT)
          .eq('workflow_id', workflow.id)
          .order('created_at', { ascending: false })
          .order('seq', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latest) {
          const row = latest as unknown as DeliveryListRow;
          lastDelivery = toDeliveryItem(row, await this.orderCodes(row.entity_type === 'order' ? [row.entity_id] : []));
        }
      }
      return {
        function_code: code,
        function_name: definition.name,
        description: definition.description,
        workflow_id: workflow?.id ?? null,
        name: workflow?.name ?? definition.name,
        is_active: workflow?.is_active ?? false,
        /** The env variable the admin must set; the value itself is never sent. */
        url_env_key: teamsWebhookUrlEnvKey(code),
        has_url: Boolean(url),
        url_allowed: urlAllowed,
        masked_url: maskWebhookUrl(url),
        updated_at: workflow?.updated_at ?? null,
        last_delivery: lastDelivery,
      };
    }));
  }

  /** Name and on/off only: the URL is read from the server env. */
  async save(code: TeamsFunctionCode, body: SaveTeamsWorkflowBody, actorId: string) {
    const definition = getTeamsFunction(code) ?? fail(404, 'Chức năng không tồn tại.');
    if (body.is_active) this.assertUsableUrl(code);

    const { error } = await this.db.rpc('save_teams_workflow', {
      p_function_code: code,
      p_name: body.name?.trim() || definition.name,
      p_is_active: body.is_active,
      p_actor_id: actorId,
    });
    if (error) fail(500, 'Không lưu được cấu hình Workflow.');
    const items = await this.list();
    return items.find((item) => item.function_code === code);
  }

  private assertUsableUrl(code: TeamsFunctionCode): string {
    const url = this.webhookUrl(code)
      ?? fail(400, `Chưa khai báo ${teamsWebhookUrlEnvKey(code)} trong .env của server.`);
    try {
      assertAllowedWebhookUrl(url, this.config.allowedHosts);
    } catch (error) {
      if (error instanceof WebhookUrlError) {
        fail(400, `${teamsWebhookUrlEnvKey(code)} không hợp lệ: ${error.message}`);
      }
      throw error;
    }
    return url;
  }

  /**
   * Posts a test message now and returns the HTTP status Teams gave back. The
   * attempt is logged, so the card's "last delivery" reflects it; it is not
   * retried automatically. Works while the function is switched off, so a URL
   * can be checked before enabling it.
   */
  async sendTest(code: TeamsFunctionCode, actorId: string) {
    const definition = getTeamsFunction(code) ?? fail(404, 'Chức năng không tồn tại.');
    const url = this.assertUsableUrl(code);
    let workflow = await this.findWorkflow(code);
    if (!workflow) {
      // The log needs a workflow row; create it switched off.
      const { error } = await this.db.rpc('save_teams_workflow', {
        p_function_code: code, p_name: definition.name, p_is_active: false, p_actor_id: actorId,
      });
      if (error) fail(500, 'Không tạo được cấu hình Workflow.');
      workflow = await this.findWorkflow(code) ?? fail(500, 'Không tạo được cấu hình Workflow.');
    }

    const body = { html: definition.buildTestHtml({ appBaseUrl: this.config.appBaseUrl }) };
    const result = await this.transport(url, body);
    const outcome = decideOutcome(result, 1);
    const sent = outcome.status === 'SENT';
    const now = new Date().toISOString();
    const { error } = await this.db.from('teams_webhook_deliveries').insert({
      workflow_id: workflow.id,
      function_code: code,
      entity_type: 'teams_workflow',
      entity_id: workflow.id,
      event_key: `TEST:${code}:${randomUUID()}`,
      payload: { test: true, body },
      status: sent ? 'SENT' : 'FAILED',
      attempts: 1,
      last_http_status: outcome.httpStatus,
      last_error: outcome.error,
      next_attempt_at: null,
      sent_at: sent ? now : null,
    });
    if (error) this.fastify.log.error({ err: error, functionCode: code }, 'Could not log Teams test send');

    return { ok: sent, http_status: outcome.httpStatus, error: outcome.error };
  }

  async listDeliveries(query: TeamsDeliveryListQuery = {}) {
    const pagination = parsePagination(query, {
      allowedSortBy: TEAMS_DELIVERY_SORT_FIELDS,
      defaultSortBy: 'created_at',
      defaultSortOrder: 'desc',
    });
    let request = this.db
      .from('teams_webhook_deliveries')
      .select(DELIVERY_SELECT, { count: 'exact' });
    if (query.functionCode) request = request.eq('function_code', query.functionCode);
    if (query.status) request = request.eq('status', query.status);
    if (query.orderCode?.trim()) {
      const { data: orders, error } = await this.db
        .from('orders')
        .select('id')
        .ilike('code', `%${query.orderCode.trim()}%`)
        .limit(200);
      if (error) fail(500, 'Không tìm được đơn.');
      const ids = ((orders ?? []) as Array<{ id: string }>).map((order) => order.id);
      if (ids.length === 0) return createPaginatedResult([], pagination, 0);
      request = request.eq('entity_type', 'order').in('entity_id', ids);
    }
    request = request
      .order(pagination.sortBy, { ascending: pagination.sortOrder === 'asc' })
      .order('seq', { ascending: pagination.sortOrder === 'asc' });

    const { data, error, count } = await request.range(pagination.from, pagination.to);
    const rows = (data ?? []) as unknown as DeliveryListRow[];
    const codes = await this.orderCodes([...new Set(rows
      .filter((row) => row.entity_type === 'order')
      .map((row) => row.entity_id))]);
    const result = resolvePaginatedQueryResult(
      { data: rows.map((row) => toDeliveryItem(row, codes)), error, count },
      pagination,
    );
    if (result) return result;
    return fail(500, 'Không tải được nhật ký gửi.');
  }

  /** Puts a FAILED row back in the queue and sends it now. */
  async retry(id: string) {
    const { data, error } = await this.db
      .from('teams_webhook_deliveries')
      .update({
        status: 'PENDING',
        attempts: 0,
        next_attempt_at: new Date().toISOString(),
        locked_until: null,
      })
      .eq('id', id)
      .eq('status', 'FAILED')
      .select('id')
      .maybeSingle();
    if (error) fail(500, 'Không đưa được tin vào hàng đợi.');
    if (!data) fail(409, 'Chỉ gửi lại được dòng đang ở trạng thái FAILED.');
    kickTeamsDispatcher(this.fastify);
    return { id, status: 'PENDING' as const };
  }
}

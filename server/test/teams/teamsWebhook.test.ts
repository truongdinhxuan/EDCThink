import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { escapeHtml, formatTeamsDateTime } from '../../src/teams/html';
import {
  buildOrderStatusHtml,
  buildTestHtml,
  MAX_ITEM_ROWS,
  ORDER_STATUS_COLORS,
  type OrderStatusSnapshot,
} from '../../src/teams/orderStatusTemplate';
import {
  assertAllowedWebhookUrl,
  DEFAULT_ALLOWED_HOSTS,
  hostMatches,
  maskWebhookUrl,
  parseAllowedHosts,
  WebhookUrlError,
} from '../../src/teams/urlPolicy';
import {
  decideOutcome,
  MAX_ATTEMPTS,
  parseRetryAfterMs,
  RETRY_DELAYS_MS,
} from '../../src/teams/deliveryPolicy';
import { MAX_PAYLOAD_BYTES, TEAMS_FUNCTIONS, isTeamsFunctionCode } from '../../src/teams/registry';
import { readTeamsConfig, teamsWebhookUrlEnvKey } from '../../src/config/teams';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const APP = { appBaseUrl: 'https://edcthink.pro' };
const STATUS_NAMES: Record<string, string> = {
  PENDING: 'Chờ xác nhận', APPROVED: 'Đã xác nhận', REJECTED: 'Đã từ chối',
  PARTIAL_ISSUED: 'Đã xuất một phần', ISSUED: 'Đã xuất', RECEIVED: 'Đã nhận',
  COMPLETED: 'Đã hoàn thành', CANCELLED: 'Đã hủy',
};

const snapshot = (overrides: Partial<OrderStatusSnapshot> = {}): OrderStatusSnapshot => ({
  order: {
    id: '11111111-1111-1111-1111-111111111111',
    code: 'ORD-20260925-ABCD',
    from_area: { code: 'VTDG', name: 'Vật tư đóng gói' },
    to_area: { code: 'DG_HATINH', name: 'Đóng gói Hà Tĩnh' },
    requester: 'Nguyễn Văn A',
    rejected_reason: null,
    cancel_reason: null,
  },
  revision_id: '22222222-2222-2222-2222-222222222222',
  occurred_at: '2026-09-24T07:30:00Z',
  actor: 'Trần Thị B',
  old_status: null,
  new_status: { code: 'PENDING', name: 'Chờ xác nhận' },
  items: [
    { name: 'Ống PVC D21', unit: 'cây', quantity_requested: 50, quantity_approved: 40, quantity_issued: 30 },
    { name: 'Co 90 D21', unit: 'cái', quantity_requested: 120, quantity_approved: 100, quantity_issued: 90 },
  ],
  ...overrides,
});
const transition = (from: string, to: string, extra: Partial<OrderStatusSnapshot['order']> = {}) => snapshot({
  old_status: { code: from, name: STATUS_NAMES[from] },
  new_status: { code: to, name: STATUS_NAMES[to] },
  order: { ...snapshot().order, ...extra },
});

describe('Teams HTML: order status message', () => {
  it('keeps the sample structure for a new order', () => {
    const html = buildOrderStatusHtml(snapshot(), APP);
    assert.match(html, /^<p><b>🔔 Thông báo đơn hàng mới<\/b><\/p>/);
    assert.match(html, /Mã đơn: <b>ORD-20260925-ABCD<\/b>/);
    assert.match(html, /Người tạo: Nguyễn Văn A/);
    assert.match(html, /Thời gian: 24\/09\/2026 14:30/); // 07:30Z in Asia/Bangkok
    assert.match(html, /Khu gửi → khu nhận: Vật tư đóng gói → Đóng gói Hà Tĩnh/);
    assert.match(html, /<table><tr><th>Vật tư<\/th><th>SL<\/th><th>ĐVT<\/th><\/tr><tr><td>Ống PVC D21<\/td><td>50<\/td><td>cây<\/td><\/tr>/);
    assert.match(html, /Trạng thái: <span style='color:#d13438'><b>Chờ xác nhận<\/b><\/span>/);
    assert.match(html, /<a href='https:\/\/edcthink\.pro\/workspace\/orders\/11111111-1111-1111-1111-111111111111'>👉 Xem chi tiết<\/a>/);
    assert.doesNotMatch(html, /Từ:/);
  });

  it('titles every later status as an update, with from → to and the actor', () => {
    const html = buildOrderStatusHtml(transition('PENDING', 'APPROVED'), APP);
    assert.match(html, /🔄 Đơn hàng cập nhật trạng thái/);
    assert.match(html, /Từ: Chờ xác nhận → Đã xác nhận/);
    assert.match(html, /Người thao tác: Trần Thị B/);
  });

  it('colours and quantities every real status code', () => {
    const cases: Array<[string, string, string]> = [
      ['PENDING', 'APPROVED', '40'],
      ['PENDING', 'REJECTED', '50'],
      ['PENDING', 'CANCELLED', '50'],
      ['APPROVED', 'PARTIAL_ISSUED', '30'],
      ['APPROVED', 'ISSUED', '30'],
      ['ISSUED', 'RECEIVED', '30'],
      ['RECEIVED', 'COMPLETED', '30'],
    ];
    for (const [from, to, firstQuantity] of cases) {
      const html = buildOrderStatusHtml(transition(from, to), APP);
      assert.match(html, new RegExp(`color:${ORDER_STATUS_COLORS[to]}'><b>${STATUS_NAMES[to]}</b>`), to);
      assert.match(html, new RegExp(`<td>Ống PVC D21</td><td>${firstQuantity}</td>`), to);
    }
    assert.equal(Object.keys(ORDER_STATUS_COLORS).length, Object.keys(STATUS_NAMES).length);
  });

  it('adds the reason for rejected and cancelled orders only', () => {
    assert.match(buildOrderStatusHtml(transition('PENDING', 'REJECTED', { rejected_reason: 'Hết ca' }), APP), /Lý do: Hết ca/);
    assert.match(buildOrderStatusHtml(transition('PENDING', 'CANCELLED', { cancel_reason: 'Tạo nhầm' }), APP), /Lý do: Tạo nhầm/);
    assert.doesNotMatch(buildOrderStatusHtml(transition('PENDING', 'APPROVED', { rejected_reason: 'x' }), APP), /Lý do/);
  });

  it('escapes every dynamic value', () => {
    const evil = `<script>alert('x')</script>&"`;
    const html = buildOrderStatusHtml(snapshot({
      order: { ...snapshot().order, code: evil, requester: evil, from_area: { code: null, name: evil } },
      items: [{ name: evil, unit: evil, quantity_requested: 1, quantity_approved: null, quantity_issued: null }],
    }), APP);
    assert.doesNotMatch(html, /<script>/);
    assert.doesNotMatch(html, /alert\('x'\)/);
    assert.match(html, /&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;&amp;&quot;/);
    assert.equal(escapeHtml(`'`), '&#39;');
  });

  it('shows at most 20 items and counts the rest', () => {
    const items = Array.from({ length: 27 }, (_, index) => ({
      name: `Vật tư ${index + 1}`, unit: 'cái', quantity_requested: index + 1, quantity_approved: null, quantity_issued: null,
    }));
    const html = buildOrderStatusHtml(snapshot({ items }), APP);
    assert.equal((html.match(/<tr><td>/g) ?? []).length, MAX_ITEM_ROWS);
    assert.match(html, /<p>\+7 vật tư khác<\/p>/);
    assert.doesNotMatch(buildOrderStatusHtml(snapshot(), APP), /vật tư khác/);
  });

  it('stays under the payload limit even with very long texts', () => {
    const long = 'x'.repeat(5000);
    const items = Array.from({ length: 60 }, () => ({
      name: long, unit: long, quantity_requested: 1, quantity_approved: null, quantity_issued: null,
    }));
    const html = buildOrderStatusHtml(transition('PENDING', 'CANCELLED', { cancel_reason: long, requester: long }), APP);
    const huge = buildOrderStatusHtml(snapshot({ items, actor: long }), APP);
    for (const body of [html, huge]) {
      assert.ok(Buffer.byteLength(JSON.stringify({ html: body })) < MAX_PAYLOAD_BYTES);
    }
  });

  it('formats time in Asia/Bangkok as dd/MM/yyyy HH:mm', () => {
    assert.equal(formatTeamsDateTime('2026-09-24T17:05:00Z'), '25/09/2026 00:05');
    assert.equal(formatTeamsDateTime('not a date'), '');
  });

  it('builds the test message', () => {
    const html = buildTestHtml('Đơn hàng <x>', new Date('2026-09-24T07:30:00Z'));
    assert.match(html, /🧪 Tin nhắn thử từ EDCThink/);
    assert.match(html, /Đơn hàng &lt;x&gt;/);
    assert.match(html, /24\/09\/2026 14:30/);
  });
});

describe('Teams webhook URL policy', () => {
  const hosts = [...DEFAULT_ALLOWED_HOSTS];

  it('accepts https Workflow URLs on the default hosts', () => {
    for (const url of [
      'https://prod-12.southeastasia.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=x',
      'https://default123.08.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/abc',
      'https://x.powerplatform.com/a',
    ]) assert.doesNotThrow(() => assertAllowedWebhookUrl(url, hosts), url);
  });

  it('refuses anything else', () => {
    for (const url of [
      'http://prod.logic.azure.com/x',
      'https://logic.azure.com/x',
      'https://evil.com/?x=.logic.azure.com',
      'https://logic.azure.com.evil.com/x',
      'https://user:pass@prod.logic.azure.com/x',
      'https://prod.logic.azure.com:8443/x',
      'https://169.254.169.254/latest',
      'not a url',
    ]) assert.throws(() => assertAllowedWebhookUrl(url, hosts), WebhookUrlError, url);
  });

  it('reads the allowlist from the env, falling back to the defaults', () => {
    assert.deepEqual(parseAllowedHosts(undefined), hosts);
    assert.deepEqual(parseAllowedHosts(' *.Example.com , api.test.io '), ['*.example.com', 'api.test.io']);
    assert.ok(hostMatches('a.example.com', '*.example.com'));
    assert.ok(!hostMatches('example.com', '*.example.com'));
    assert.ok(hostMatches('api.test.io', 'api.test.io'));
  });

  it('masks a URL to host + … + last 6 characters', () => {
    assert.equal(maskWebhookUrl('https://prod-1.logic.azure.com/workflows/x?sig=SECRETabc123'), 'prod-1.logic.azure.com…abc123');
    assert.equal(maskWebhookUrl(null), null);
  });
});

describe('Teams delivery retry policy', () => {
  const now = new Date('2026-09-25T00:00:00Z');
  const response = (status: number, retryAfter?: string) => ({ kind: 'response' as const, status, retryAfter });

  it('marks 2xx as sent', () => {
    assert.equal(decideOutcome(response(202), 1, now).status, 'SENT');
    assert.equal(decideOutcome(response(200), 3, now).status, 'SENT');
  });

  it('backs off 30s, 2m, 10m, 30m for 408 and 5xx, then gives up after 5 attempts', () => {
    const waits = [1, 2, 3, 4].map((attempt) => {
      const outcome = decideOutcome(response(503), attempt, now);
      assert.equal(outcome.status, 'PENDING');
      return outcome.nextAttemptAt!.getTime() - now.getTime();
    });
    assert.deepEqual(waits, [...RETRY_DELAYS_MS]);
    assert.equal(decideOutcome(response(408), 1, now).status, 'PENDING');
    assert.equal(decideOutcome(response(500), MAX_ATTEMPTS, now).status, 'FAILED');
  });

  it('honours Retry-After on 429', () => {
    const seconds = decideOutcome(response(429, '120'), 1, now);
    assert.equal(seconds.nextAttemptAt!.getTime() - now.getTime(), 120_000);
    const date = decideOutcome(response(429, 'Fri, 25 Sep 2026 00:05:00 GMT'), 1, now);
    assert.equal(date.nextAttemptAt!.getTime() - now.getTime(), 300_000);
    const missing = decideOutcome(response(429), 1, now);
    assert.equal(missing.nextAttemptAt!.getTime() - now.getTime(), RETRY_DELAYS_MS[0]);
    assert.equal(parseRetryAfterMs('garbage', now), null);
  });

  it('fails other 4xx and redirects without retrying; retries network errors', () => {
    for (const status of [400, 401, 403, 404, 302]) {
      const outcome = decideOutcome(response(status), 1, now);
      assert.equal(outcome.status, 'FAILED', String(status));
      assert.equal(outcome.nextAttemptAt, null);
    }
    assert.equal(decideOutcome({ kind: 'error', message: 'timeout' }, 1, now).status, 'PENDING');
  });
});

describe('Teams registry and wiring', () => {
  const migration = read('supabase/migrations/20260925020000_teams_webhook.sql');
  const orderService = read('src/services/orders.service.ts');
  const transport = read('src/teams/transport.ts');

  it('registers ORDER_STATUS_CHANGED and validates codes against the registry', () => {
    assert.ok(isTeamsFunctionCode('ORDER_STATUS_CHANGED'));
    assert.ok(!isTeamsFunctionCode('NOPE'));
    assert.ok(!isTeamsFunctionCode('toString'));
    assert.equal(TEAMS_FUNCTIONS.ORDER_STATUS_CHANGED.code, 'ORDER_STATUS_CHANGED');
  });

  it('hooks one place, order_revisions, and makes every status change write one', () => {
    assert.match(migration, /after insert on public\.order_revisions[\s\S]*enqueue_order_status_teams_delivery/);
    assert.match(migration, /create constraint trigger orders_write_create_revision\s+after insert on public\.orders\s+deferrable initially deferred/);
    assert.match(migration, /create constraint trigger orders_status_change_requires_revision\s+after update of status_id on public\.orders/);
    assert.match(migration, /'ORDER_STATUS_CHANGED:' \|\| new\.order_id \|\| ':' \|\| new\.id/);
    // Receive, complete and cancel no longer write orders.status_id directly.
    assert.doesNotMatch(orderService, /\.from\('orders'\)\s*\.update\(\{[^}]*status_id/);
    assert.equal((orderService.match(/rpc\('transition_order_status'/g) ?? []).length, 1);
    assert.equal((orderService.match(/kickTeamsDispatcher\(this\.fastify\)/g) ?? []).length, 2);
  });

  it('reads the URL from the server env, never from the database, and never logs it', () => {
    const envMigration = read('supabase/migrations/20260925030000_teams_webhook_url_in_env.sql');
    assert.match(envMigration, /alter table public\.teams_workflows drop column webhook_secret_id/);
    assert.match(envMigration, /drop function if exists public\.get_teams_workflow_url/);
    assert.match(envMigration, /delete from vault\.secrets/);
    // The trigger now queues on the switch alone.
    const trigger = envMigration.slice(envMigration.indexOf('enqueue_order_status_teams_delivery'));
    assert.doesNotMatch(trigger, /webhook_secret_id/);
    assert.match(trigger, /is_active/);

    const config = readTeamsConfig({
      TEAMS_WEBHOOK_URL_ORDER_STATUS_CHANGED: ' "https://x.logic.azure.com/a?sig=1" ',
    } as NodeJS.ProcessEnv);
    assert.equal(config.webhookUrls.ORDER_STATUS_CHANGED, 'https://x.logic.azure.com/a?sig=1');
    assert.equal(readTeamsConfig({} as NodeJS.ProcessEnv).webhookUrls.ORDER_STATUS_CHANGED, undefined);
    assert.equal(teamsWebhookUrlEnvKey('ORDER_STATUS_CHANGED'), 'TEAMS_WEBHOOK_URL_ORDER_STATUS_CHANGED');
    // Links use the shared client origin; APP_BASE_URL is no longer read.
    assert.equal(readTeamsConfig({ ORIGIN_URL: 'https://edcthink.pro/' } as NodeJS.ProcessEnv).appBaseUrl, 'https://edcthink.pro');
    assert.equal(readTeamsConfig({ APP_BASE_URL: 'https://other.example' } as NodeJS.ProcessEnv).appBaseUrl, '');
    assert.doesNotMatch(read('src/config/teams.ts'), /APP_BASE_URL/);

    const plugin = read('src/plugins/teamsDispatcher.ts');
    assert.match(plugin, /webhookUrls: config\.webhookUrls/);
    // Only the variable name is ever logged.
    assert.doesNotMatch(plugin, /log\.\w+\([^)]*\burl\b(?!s)/);
    assert.match(transport, /redirect: 'manual'/);
    assert.doesNotMatch(transport, /message: .*url/i);
  });

  it('claims with SKIP LOCKED, in order per entity', () => {
    assert.match(migration, /for update of delivery skip locked/);
    assert.match(migration, /earlier\.seq < delivery\.seq\s+and earlier\.status = 'PENDING'/);
  });
});

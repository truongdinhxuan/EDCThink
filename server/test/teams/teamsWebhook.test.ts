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
  ALLOWED_WEBHOOK_HOSTS,
  assertAllowedWebhookUrl,
  hostMatches,
  WebhookUrlError,
} from '../../src/teams/urlPolicy';
import {
  decideOutcome,
  MAX_ATTEMPTS,
  MAX_PAYLOAD_BYTES,
  parseRetryAfterMs,
  RETRY_DELAYS_MS,
  type SendResult,
} from '../../src/teams/deliveryPolicy';
import { getTeamsHook, TEAMS_EVENTS_CHANNEL, TEAMS_HOOK_CODES } from '../../src/teams/registry';
import { TeamsSender } from '../../src/teams/sender';
import { readTeamsConfig } from '../../src/config/teams';

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
      ['PENDING', 'CANCELLED', '40'], // approved count once it got that far
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
    const unapproved = snapshot({
      old_status: { code: 'PENDING', name: STATUS_NAMES.PENDING },
      new_status: { code: 'CANCELLED', name: STATUS_NAMES.CANCELLED },
      items: [{ name: 'Ống PVC D21', unit: 'cây', quantity_requested: 50, quantity_approved: null, quantity_issued: 0 }],
    });
    assert.match(buildOrderStatusHtml(unapproved, APP), /<td>Ống PVC D21<\/td><td>50<\/td>/);
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
  it('accepts https Workflow URLs on the hardcoded hosts only', () => {
    assert.deepEqual([...ALLOWED_WEBHOOK_HOSTS], ['*.logic.azure.com', '*.powerplatform.com', '*.api.powerplatform.com']);
    for (const url of [
      'https://prod-12.southeastasia.logic.azure.com/workflows/x/triggers/manual/paths/invoke?sig=abc',
      'https://default123.f8.environment.api.powerplatform.com:443/powerautomate/automations/direct/x?sig=abc',
    ]) {
      assert.doesNotThrow(() => assertAllowedWebhookUrl(url));
    }
    assert.equal(hostMatches('logic.azure.com', '*.logic.azure.com'), false);
    assert.equal(hostMatches('evil-logic.azure.com.attacker.io', '*.logic.azure.com'), false);
  });

  it('refuses anything else, with messages that never quote the URL', () => {
    const secret = 'sig=SUPERSECRET';
    for (const url of [
      `http://prod.logic.azure.com/x?${secret}`,
      `https://attacker.example.com/x?${secret}`,
      `https://user:pw@prod.logic.azure.com/x?${secret}`,
      `https://prod.logic.azure.com:8443/x?${secret}`,
      `https://127.0.0.1/x?${secret}`,
      `not a url ${secret}`,
    ]) {
      assert.throws(() => assertAllowedWebhookUrl(url), (error: unknown) =>
        error instanceof WebhookUrlError && !error.message.includes('SUPERSECRET') && !error.message.includes('attacker'));
    }
  });

  it('takes no allowlist or URL from the environment', () => {
    assert.doesNotMatch(read('src/teams/urlPolicy.ts'), /process\.env/);
    assert.doesNotMatch(read('src/config/teams.ts'), /TEAMS_WEBHOOK_ALLOWED_HOSTS|TEAMS_WEBHOOK_URL_|APP_BASE_URL/);
    assert.equal(readTeamsConfig({ ORIGIN_URL: 'https://edcthink.pro/' } as NodeJS.ProcessEnv).appBaseUrl, 'https://edcthink.pro');
  });
});

describe('Teams send retry policy', () => {
  const at = new Date('2026-09-24T00:00:00Z');

  it('succeeds on 2xx', () => {
    assert.deepEqual(decideOutcome({ kind: 'response', status: 202 }, 1, at), {
      final: true, success: true, httpStatus: 202, error: null,
    });
  });

  it('retries 408, 5xx and network errors after 5s, 30s, 2m, then gives up', () => {
    assert.deepEqual([...RETRY_DELAYS_MS], [5_000, 30_000, 120_000]);
    assert.equal(MAX_ATTEMPTS, 4);
    const retryable: SendResult[] = [
      { kind: 'response', status: 500 },
      { kind: 'response', status: 408 },
      { kind: 'error', message: 'x' },
    ];
    for (const result of retryable) {
      assert.deepEqual(
        [1, 2, 3].map((attempt) => {
          const outcome = decideOutcome(result, attempt, at);
          return outcome.final ? null : outcome.retryInMs;
        }),
        [5_000, 30_000, 120_000],
      );
      assert.equal(decideOutcome(result, 4, at).final, true);
    }
    assert.deepEqual(decideOutcome({ kind: 'response', status: 503 }, 4, at), {
      final: true, success: false, httpStatus: 503, error: 'HTTP 503',
    });
  });

  it('honours Retry-After on 429', () => {
    const outcome = decideOutcome({ kind: 'response', status: 429, retryAfter: '12' }, 1, at);
    assert.equal(!outcome.final && outcome.retryInMs, 12_000);
    assert.equal(parseRetryAfterMs(new Date(at.getTime() + 90_000).toUTCString(), at), 90_000);
    const fallback = decideOutcome({ kind: 'response', status: 429 }, 2, at);
    assert.equal(!fallback.final && fallback.retryInMs, 30_000);
  });

  it('fails other 4xx and redirects at once', () => {
    for (const status of [400, 401, 404, 302]) {
      const outcome = decideOutcome({ kind: 'response', status }, 1, at);
      assert.equal(outcome.final && !outcome.success, true, String(status));
    }
  });
});

/** Minimal stand-in for the Supabase client calls the sender makes. */
const fakeDb = (state: { isActive: boolean; url: string | null }) => {
  const updates: Array<Record<string, unknown>> = [];
  const rpcCalls: string[] = [];
  const db = {
    from: (table: string) => {
      assert.equal(table, 'teams_webhooks');
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { is_active: state.isActive }, error: null }) }),
        }),
        update: (values: Record<string, unknown>) => ({
          eq: async () => {
            updates.push(values);
            return { error: null };
          },
        }),
      };
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push(name);
      if (name === 'get_teams_webhook_url') return { data: state.url, error: null };
      if (name === 'get_order_status_teams_event') {
        return { data: { ...snapshot(), revision_id: args.p_revision_id }, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  return { db: db as never, updates, rpcCalls };
};

const ORDER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const notice = (orderId: string, revision: number) => JSON.stringify({
  code: 'ORDER_STATUS_CHANGED',
  order_id: orderId,
  revision_id: `00000000-0000-4000-8000-${String(revision).padStart(12, '0')}`,
  old_status_id: null,
  new_status_id: '33333333-3333-4333-8333-333333333333',
  actor_id: null,
});
const REAL_LOOKING_URL = 'https://prod-01.southeastasia.logic.azure.com/workflows/w/triggers/manual/paths/invoke?sig=TOPSECRET123';

describe('Teams sender', () => {
  it('sends one { html } per event, in order per Order, retrying through a 500', async () => {
    const { db, updates } = fakeDb({ isActive: true, url: REAL_LOOKING_URL });
    const statuses = [500, 202, 202];
    const sent: Array<{ revision: string; body: { html: string } }> = [];
    const waits: number[] = [];
    const sender = new TeamsSender(db, {
      appBaseUrl: 'https://edcthink.pro',
      transport: async (_url, body) => {
        sent.push({ revision: String(sent.length), body });
        return { kind: 'response', status: statuses.shift() ?? 202 };
      },
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    sender.handleNotification(notice(ORDER_A, 1));
    sender.handleNotification(notice(ORDER_A, 2));
    await sender.idle();

    assert.equal(sent.length, 3);
    assert.deepEqual(Object.keys(sent[0].body), ['html']);
    assert.equal(sent[0].body.html, sent[1].body.html, 'the retry resends the same message');
    assert.deepEqual(waits, [5_000]);
    assert.equal(updates.length, 2);
    assert.deepEqual(
      { success: updates[1].last_success, status: updates[1].last_http_status, error: updates[1].last_error },
      { success: true, status: 202, error: null },
    );
  });

  it('skips when the function is off or has no secret', async () => {
    for (const state of [{ isActive: false, url: REAL_LOOKING_URL }, { isActive: true, url: null }]) {
      const { db, updates } = fakeDb(state);
      let calls = 0;
      const sender = new TeamsSender(db, {
        appBaseUrl: '',
        transport: async () => {
          calls += 1;
          return { kind: 'response', status: 202 };
        },
      });
      sender.handleNotification(notice(ORDER_A, 1));
      await sender.idle();
      assert.equal(calls, 0);
      assert.equal(updates.length, 0);
    }
  });

  it('refuses a URL off the allowlist without sending, and never logs or records the URL', async () => {
    const logged: string[] = [];
    const push = (message: unknown) => {
      logged.push(String(message));
    };
    const { db, updates } = fakeDb({ isActive: true, url: 'https://attacker.example.com/hook?sig=TOPSECRET123' });
    let calls = 0;
    const sender = new TeamsSender(db, {
      appBaseUrl: '',
      log: { info: push, warn: push, error: push } as never,
      transport: async () => {
        calls += 1;
        return { kind: 'response', status: 202 };
      },
      sleep: async () => undefined,
    });
    sender.handleNotification(notice(ORDER_A, 1));
    sender.handleNotification('not json');
    await sender.idle();
    const test = await sender.sendTest('ORDER_STATUS_CHANGED', 'Thông báo');

    assert.equal(calls, 0);
    assert.equal(test.success, false);
    assert.doesNotMatch(JSON.stringify({ logged, updates, test }), /TOPSECRET|attacker/);
    assert.match(String(updates[0].last_error), /Host/);
  });

  it('caches the URL for about 5 minutes, but a test send reads it fresh', async () => {
    const { db, rpcCalls } = fakeDb({ isActive: true, url: REAL_LOOKING_URL });
    const sender = new TeamsSender(db, {
      appBaseUrl: '',
      transport: async () => ({ kind: 'response', status: 202 }),
    });
    sender.handleNotification(notice(ORDER_A, 1));
    sender.handleNotification(notice(ORDER_A, 2));
    await sender.idle();
    const urlReads = () => rpcCalls.filter((name) => name === 'get_teams_webhook_url').length;
    assert.equal(urlReads(), 1);
    assert.deepEqual(await sender.sendTest('ORDER_STATUS_CHANGED', 'Thông báo'), {
      success: true, http_status: 202, error: null,
    });
    assert.equal(urlReads(), 2);
  });
});

describe('Teams registry, database and wiring', () => {
  const migration = read('supabase/migrations/20260926010000_teams_webhooks_vault_notify.sql');

  it('registers ORDER_STATUS_CHANGED with its event and templates', () => {
    assert.deepEqual(TEAMS_HOOK_CODES, ['ORDER_STATUS_CHANGED']);
    const hook = getTeamsHook('ORDER_STATUS_CHANGED');
    assert.ok(hook);
    assert.equal(getTeamsHook('NOPE'), null);
    assert.equal(hook.parseEvent({ order_id: 'x', revision_id: 'y' }), null);
    assert.equal(hook.parseEvent(JSON.parse(notice(ORDER_A, 1)))?.queueKey, `order:${ORDER_A}`);
    assert.match(hook.buildTestHtml('Thông báo trạng thái đơn hàng'), /🧪 Tin nhắn thử từ EDCThink/);
  });

  it('keeps the URL in Vault only, readable by service_role only', () => {
    assert.match(migration, /create table public\.teams_webhooks/);
    assert.match(migration, /vault_secret_name text not null/);
    assert.doesNotMatch(migration, /webhook_url text|secret_id uuid/);
    assert.match(migration, /join vault\.decrypted_secrets secret on secret\.name = webhook\.vault_secret_name/);
    assert.match(migration, /revoke all on function public\.get_teams_webhook_url\(text\) from public, anon, authenticated;/);
    assert.match(migration, /grant execute on function public\.get_teams_webhook_url\(text\) to service_role;/);
    assert.match(migration, /'teams_webhook:ORDER_STATUS_CHANGED'/);
    assert.match(migration, /drop table if exists public\.teams_webhook_deliveries;/);
  });

  it('notifies on every status revision, after commit, with ids only', () => {
    assert.match(migration, /after insert on public\.order_revisions/);
    assert.match(migration, new RegExp(`pg_notify\\('${TEAMS_EVENTS_CHANNEL}'`));
    for (const key of ['code', 'order_id', 'old_status_id', 'new_status_id', 'actor_id']) {
      assert.match(migration, new RegExp(`'${key}'`));
    }
  });

  it('listens on one instance, and exposes only the documented routes', () => {
    const listener = read('src/teams/listener.ts');
    assert.match(listener, /pg_try_advisory_lock/);
    assert.match(listener, /listen \$\{TEAMS_EVENTS_CHANNEL\}/);
    assert.doesNotMatch(listener, /log\.\w+\([^)]*connectionString/);
    const routes = read('src/routes/teams-webhooks/index.ts');
    assert.match(routes, /fastify\.get\('\/', \{ preHandler: canView \}/);
    assert.match(routes, /fastify\.patch\('\/:code', \{ preHandler: canManage/);
    assert.match(routes, /fastify\.post\('\/:code\/test', \{ preHandler: canManage/);
    assert.match(routes, /PERMISSION_CODE\.TEAMS_WEBHOOK_VIEW/);
    assert.match(read('src/schemas/teams-webhooks.ts'), /properties: \{ is_active: \{ type: 'boolean' \} \}/);
  });

  it('lets an admin save the URL write-only: checked, stored in Vault, never returned', () => {
    const urlMigration = read('supabase/migrations/20260926020000_teams_webhook_url_form.sql');
    assert.match(urlMigration, /perform vault\.create_secret\(v_url, v_secret_name/);
    assert.match(urlMigration, /perform vault\.update_secret\(v_secret_id, v_url\)/);
    assert.match(urlMigration, /revoke all on function public\.set_teams_webhook_url\(text, text\) from public, anon, authenticated;/);
    assert.match(urlMigration, /grant execute on function public\.set_teams_webhook_url\(text, text\) to service_role;/);

    const routes = read('src/routes/teams-webhooks/index.ts');
    assert.match(routes, /fastify\.put\('\/:code\/url', \{ preHandler: canManage, schema: teamsWebhookUrlSchema \}/);
    assert.match(read('src/schemas/teams-webhooks.ts'), /properties: \{ webhook_url: \{ type: 'string', minLength: 1, maxLength: 2048 \} \}/);

    const service = read('src/services/teams-webhooks.service.ts');
    const setUrl = service.slice(service.indexOf('async setUrl('), service.indexOf('async sendTest('));
    // Allowlist before storing; the sender re-reads the new URL; the reply is the view (no URL field).
    assert.ok(setUrl.indexOf('assertAllowedWebhookUrl(webhookUrl)') < setUrl.indexOf("rpc('set_teams_webhook_url'"));
    assert.match(setUrl, /teamsSender\.forgetUrl\(code\)/);
    assert.match(setUrl, /return this\.get\(code\);/);
    assert.doesNotMatch(service.slice(service.indexOf('export interface TeamsWebhookView'), service.indexOf('export class')), /url\??:/i);
  });

  it('leaves the order flow free of Teams calls: events come from the database', () => {
    assert.doesNotMatch(read('src/services/orders.service.ts'), /kickTeams|teamsSender/);
  });
});

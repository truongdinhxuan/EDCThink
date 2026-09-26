// Integration: Teams webhooks end to end against the configured Supabase project:
// NOTIFY trigger → LISTEN session → sender → a local mock HTTP server standing in
// for the Teams Workflow.
//
//   npm run build:ts && SUPABASE_DB_URL=... node test/integration/teams-webhook-flow.mjs
//
// SUPABASE_DB_URL: session pooler or direct connection of a role that may write
// vault.secrets (postgres). The test puts a fake Workflow URL into Vault and
// toggles ORDER_STATUS_CHANGED, then restores both. It creates TEAMS-TEST-*
// orders (left APPROVED / PENDING). Stop the API server first: while it holds the
// listener lock this test cannot listen. Run against mock data only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');
const { TeamsSender } = require('../../dist/teams/sender.js');
const { TeamsListener } = require('../../dist/teams/listener.js');

assert.ok(process.env.SUPABASE_DB_URL, 'SUPABASE_DB_URL is required');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const pg = new Client({ connectionString: process.env.SUPABASE_DB_URL });
await pg.connect();
// A Supabase CLI login role (cli_login_postgres) may act as postgres for Vault.
if ((await pg.query('select current_user')).rows[0].current_user !== 'postgres') {
  await pg.query('set role postgres');
}

const CODE = 'ORDER_STATUS_CHANGED';
const SECRET_NAME = `teams_webhook:${CODE}`;
const FAKE_URL = 'https://prod-00.southeastasia.logic.azure.com/workflows/teams-test/triggers/manual/paths/invoke?sig=TESTSIG123456';
const one = async (promise, label) => {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
};
const until = async (condition, label, timeoutMs = 15_000) => {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 2_000));

// --- Vault helpers (the admin does this in the SQL Editor) -------------------
const readSecret = async () => (await pg.query(
  'select decrypted_secret from vault.decrypted_secrets where name = $1', [SECRET_NAME],
)).rows[0]?.decrypted_secret ?? null;
const writeSecret = async (value) => {
  if (value === null) {
    await pg.query('delete from vault.secrets where name = $1', [SECRET_NAME]);
  } else if (await readSecret() === null) {
    await pg.query('select vault.create_secret($1, $2, $3)', [value, SECRET_NAME, 'Teams workflow: trạng thái đơn hàng']);
  } else {
    await pg.query('select vault.update_secret((select id from vault.secrets where name = $1), $2)', [SECRET_NAME, value]);
  }
};
const setActive = (isActive) => one(db.from('teams_webhooks').update({ is_active: isActive }).eq('code', CODE), 'switch');
const webhookRow = async () => (await one(db.rpc('list_teams_webhooks'), 'list')).find((row) => row.code === CODE);

// --- mock Teams Workflow -----------------------------------------------------
const received = [];
const plannedStatuses = [];
const server = createServer((request, response) => {
  let raw = '';
  request.on('data', (chunk) => { raw += chunk; });
  request.on('end', () => {
    received.push({ contentType: request.headers['content-type'], body: JSON.parse(raw) });
    response.writeHead(plannedStatuses.shift() ?? 202).end();
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const mockUrl = `http://127.0.0.1:${server.address().port}/`;
// The sender checks the Vault URL against the real allowlist; the transport then
// confirms it got that URL and posts to the local mock instead.
const targets = [];
const waits = [];
const sender = new TeamsSender(db, {
  appBaseUrl: 'https://edcthink.pro',
  urlCacheMs: 0,
  sleep: async (ms) => { waits.push(ms); },
  transport: async (url, body) => {
    targets.push(url);
    const response = await fetch(mockUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
    return { kind: 'response', status: response.status, retryAfter: response.headers.get('retry-after') };
  },
});
const logs = [];
const listener = new TeamsListener({
  connectionString: process.env.SUPABASE_DB_URL,
  onNotification: (payload) => sender.handleNotification(payload),
  log: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
});

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(`PASS ${name}`); } catch (error) { results.push(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
};

const backup = { secret: await readSecret(), active: (await webhookRow())?.is_active ?? false };
try {
  listener.start();
  await until(() => listener.listening, 'LISTEN');

  // --- fixtures ---------------------------------------------------------------
  const admin = (await one(db.from('user_roles').select('user_id, role:roles!inner(code)').eq('role.code', 'ADMIN').limit(1), 'admin'))[0].user_id;
  const statuses = Object.fromEntries((await one(db.from('order_statuses').select('id, code'), 'statuses')).map((s) => [s.code, s.id]));
  const areas = await one(db.from('areas').select('id, code').in('code', ['VTDG', 'DG_HATINH']), 'areas');
  const vtdg = areas.find((a) => a.code === 'VTDG').id;
  const target = areas.find((a) => a.code === 'DG_HATINH').id;
  const supply = await one(db.from('supplies').select('id, code, unit_id').eq('code', '71000002').single(), 'supply');
  const balance = await one(db.from('stock_balances').select('provider_id').eq('supply_id', supply.id).eq('area_id', vtdg).is('set_per_qty', null).eq('is_deleted', false).single(), 'balance');
  const createOrder = async (suffix) => {
    const order = await one(db.from('orders').insert({
      code: `TEAMS-TEST-${Date.now()}-${suffix}`, from_area_id: vtdg, to_area_id: target,
      requested_by: admin, status_id: statuses.PENDING, submitted_at: new Date().toISOString(),
      is_active: true, is_deleted: false,
    }).select('id, code').single(), 'insert order');
    await one(db.from('order_items').insert({
      order_id: order.id, supply_id: supply.id, provider_id: balance.provider_id, unit_id: supply.unit_id,
      quantity_requested: 2, quantity_approved: null, quantity_issued: 0, is_active: true, is_deleted: false,
    }), 'insert item');
    return order;
  };

  // --- 1. no secret → configured = false, nothing sent -----------------------
  await check('without a Vault secret the API reports configured = false and nothing is sent', async () => {
    await writeSecret(null);
    await setActive(true);
    assert.equal((await webhookRow()).configured, false);
    await createOrder('NOSECRET');
    await settle();
    await sender.idle();
    assert.equal(received.length, 0);
  });

  // --- 2. create → 1 request ----------------------------------------------------
  await writeSecret(FAKE_URL);
  const order = await createOrder('A');
  await check('creating an order sends one request whose body is only { html }', async () => {
    assert.equal((await webhookRow()).configured, true);
    await until(() => received.length >= 1, 'create message');
    await sender.idle();
    assert.equal(received.length, 1);
    assert.deepEqual(Object.keys(received[0].body), ['html']);
    assert.match(received[0].contentType, /application\/json; charset=utf-8/i);
    assert.match(received[0].body.html, /🔔 Thông báo đơn hàng mới/);
    assert.match(received[0].body.html, new RegExp(order.code));
    assert.match(received[0].body.html, new RegExp(`/workspace/orders/${order.id}`));
    assert.equal(targets[0], FAKE_URL);
  });

  // --- 3. approve with a 500 → retried, then sent -------------------------------
  await check('approving sends one more message; a 500 is retried and last_* records the success', async () => {
    plannedStatuses.push(500);
    const item = await one(db.from('order_items').select('id').eq('order_id', order.id).single(), 'item');
    await one(db.rpc('review_order', {
      p_order_id: order.id, p_actor_id: admin, p_action_code: 'APPROVE',
      p_items: [{ order_item_id: item.id, quantity_approved: 2 }], p_reason: null, p_note: null,
    }), 'approve');
    await until(() => received.length >= 3, 'approve message and its retry');
    await sender.idle();
    assert.equal(received.length, 3);
    assert.deepEqual(waits, [5_000]);
    assert.equal(received[2].body.html, received[1].body.html);
    assert.match(received[2].body.html, /🔄 Đơn hàng cập nhật trạng thái/);
    assert.match(received[2].body.html, /Từ: Chờ xác nhận → Đã xác nhận/);
    const row = await webhookRow();
    assert.equal(row.last_success, true);
    assert.equal(row.last_http_status, 202);
    assert.equal(row.last_error, null);
    assert.ok(Date.now() - Date.parse(row.last_sent_at) < 60_000);
  });

  // --- 4. switch off → nothing ----------------------------------------------
  await check('with the switch off nothing is sent', async () => {
    await setActive(false);
    await createOrder('OFF');
    await settle();
    await sender.idle();
    assert.equal(received.length, 3);
  });

  // --- 5. clients cannot read the secret -----------------------------------------
  await check('anon and authenticated cannot call get_teams_webhook_url', async () => {
    const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data, error } = await anon.rpc('get_teams_webhook_url', { p_code: CODE });
    assert.ok(error, 'anon must be refused');
    assert.equal(data, null);
    for (const role of ['anon', 'authenticated']) {
      await pg.query('begin');
      try {
        await pg.query(`set local role ${role}`);
        await assert.rejects(pg.query('select public.get_teams_webhook_url($1)', [CODE]), /permission denied/);
      } finally {
        await pg.query('rollback');
      }
    }
  });

  await check('logs never contain the URL', async () => {
    assert.doesNotMatch(JSON.stringify(logs), /TESTSIG|logic\.azure/);
  });
} finally {
  await listener.stop();
  sender.stop();
  server.close();
  await writeSecret(backup.secret);
  await setActive(backup.active);
  results.push(`(Vault secret ${backup.secret ? 'restored' : 'removed again'}; switch restored to ${backup.active ? 'ON' : 'OFF'})`);
  await pg.end();
}

console.log(results.join('\n'));

// Integration: Teams outbox end to end against the configured Supabase project
// and a local mock HTTP server standing in for the Teams Workflow.
//
//   npm run build:ts && node test/integration/teams-webhook-flow.mjs
//
// Writes to the database: creates two orders coded TEAMS-TEST-* (one left APPROVED,
// one CANCELLED) and toggles ORDER_STATUS_CHANGED, restoring its switch at the end.
// Stop the API server first, or its dispatcher will send the test messages to the
// real Workflow URL in .env. Run against mock data only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');
const { TeamsDispatcher } = require('../../dist/teams/dispatcher.js');
const { DEFAULT_ALLOWED_HOSTS } = require('../../dist/teams/urlPolicy.js');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const FAKE_URL = 'https://prod-00.southeastasia.logic.azure.com/workflows/teams-test/triggers/manual/paths/invoke?sig=TESTSIG123456';
const one = async (promise, label) => {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
};

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
// The dispatcher takes the (https, allowlisted) URL from its env-derived map; the
// transport checks it is that URL and then posts to the local mock instead.
let lastTargetUrl = null;
const transport = async (url, body) => {
  lastTargetUrl = url;
  const response = await fetch(mockUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  return { kind: 'response', status: response.status, retryAfter: response.headers.get('retry-after') };
};
const dispatcher = new TeamsDispatcher(db, {
  transport,
  appBaseUrl: 'https://edcthink.pro',
  allowedHosts: [...DEFAULT_ALLOWED_HOSTS],
  webhookUrls: { ORDER_STATUS_CHANGED: FAKE_URL },
});

const results = [];
let restoreActive = null;
const check = async (name, fn) => {
  try { await fn(); results.push(`PASS ${name}`); } catch (error) { results.push(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
};

try {
  // --- fixtures ---------------------------------------------------------------
  const admin = (await one(db.from('user_roles').select('user_id, role:roles!inner(code)').eq('role.code', 'ADMIN').limit(1), 'admin'))[0].user_id;
  const statuses = Object.fromEntries((await one(db.from('order_statuses').select('id, code'), 'statuses')).map((s) => [s.code, s.id]));
  const areas = await one(db.from('areas').select('id, code').in('code', ['VTDG', 'DG_HATINH']), 'areas');
  const vtdg = areas.find((a) => a.code === 'VTDG').id;
  const target = areas.find((a) => a.code === 'DG_HATINH').id;
  const supply = await one(db.from('supplies').select('id, code, unit_id').eq('code', '71000002').single(), 'supply');
  const balance = await one(db.from('stock_balances').select('provider_id, quantity').eq('supply_id', supply.id).eq('area_id', vtdg).is('set_per_qty', null).eq('is_deleted', false).single(), 'balance');

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
  const deliveriesFor = (orderId) => one(db.from('teams_webhook_deliveries')
    .select('id, event_key, status, attempts, last_http_status, next_attempt_at, payload')
    .eq('entity_id', orderId).order('seq'), 'deliveries');

  // --- 1. switch only; no URL in the database -------------------------------
  const before = await one(db.from('teams_workflows').select('is_active').eq('function_code', 'ORDER_STATUS_CHANGED').maybeSingle(), 'before');
  restoreActive = before?.is_active ?? false;
  let workflowId;
  await check('the database stores only the switch, never a URL', async () => {
    workflowId = await one(db.rpc('save_teams_workflow', {
      p_function_code: 'ORDER_STATUS_CHANGED', p_name: null, p_is_active: true, p_actor_id: admin,
    }), 'save');
    const row = await one(db.from('teams_workflows').select('*').eq('id', workflowId).single(), 'workflow');
    assert.equal(row.is_active, true);
    assert.equal(row.name.length > 0, true, 'a null name keeps the stored one');
    assert.equal(Object.keys(row).some((column) => /url|secret/i.test(column)), false);
    const { error } = await db.rpc('get_teams_workflow_url', { p_workflow_id: workflowId });
    assert.ok(error, 'the Vault reader is gone');
  });

  await dispatcher.drain(); // clear anything already due
  received.length = 0;

  // --- 2. create → 1 request ----------------------------------------------------
  const order = await createOrder('A');
  await check('creating an order sends one request whose body is only { html }', async () => {
    await dispatcher.drain();
    assert.equal(received.length, 1);
    assert.deepEqual(Object.keys(received[0].body), ['html']);
    assert.match(received[0].contentType, /application\/json; charset=utf-8/i);
    assert.match(received[0].body.html, /🔔 Thông báo đơn hàng mới/);
    assert.match(received[0].body.html, new RegExp(order.code));
    assert.match(received[0].body.html, /\/workspace\/orders\//);
    assert.equal(lastTargetUrl, FAKE_URL);
    const rows = await deliveriesFor(order.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'SENT');
    assert.match(rows[0].event_key, new RegExp(`^ORDER_STATUS_CHANGED:${order.id}:`));
  });

  // --- 3. approve → +1 request, 500 then retried -------------------------------
  await check('approving sends one more request; a 500 is retried, then sent', async () => {
    plannedStatuses.push(500);
    await one(db.rpc('review_order', {
      p_order_id: order.id, p_actor_id: admin, p_action_code: 'APPROVE',
      p_items: [{ order_item_id: (await one(db.from('order_items').select('id').eq('order_id', order.id).single(), 'item')).id, quantity_approved: 2 }],
      p_reason: null, p_note: null,
    }), 'approve');
    await dispatcher.drain();
    assert.equal(received.length, 2);
    let rows = await deliveriesFor(order.id);
    assert.equal(rows[1].status, 'PENDING');
    assert.equal(rows[1].attempts, 1);
    assert.equal(rows[1].last_http_status, 500);
    const waitMs = Date.parse(rows[1].next_attempt_at) - Date.now();
    assert.ok(waitMs > 20_000 && waitMs <= 30_000, `backoff ~30s, got ${waitMs}ms`);
    // Fast-forward the backoff instead of waiting 30 seconds.
    await one(db.from('teams_webhook_deliveries').update({ next_attempt_at: new Date().toISOString() }).eq('id', rows[1].id), 'ff');
    await dispatcher.drain();
    assert.equal(received.length, 3);
    assert.equal(received[2].body.html, received[1].body.html, 'retry resends the identical body');
    assert.match(received[2].body.html, /🔄 Đơn hàng cập nhật trạng thái/);
    assert.match(received[2].body.html, /Từ: Chờ xác nhận → Đã xác nhận/);
    rows = await deliveriesFor(order.id);
    assert.equal(rows[1].status, 'SENT');
    assert.equal(rows[1].attempts, 2);
  });

  // --- 4. no duplicates ---------------------------------------------------------
  await check('the same event cannot be queued or sent twice', async () => {
    const [first] = await deliveriesFor(order.id);
    const { error } = await db.from('teams_webhook_deliveries').insert({
      workflow_id: workflowId, function_code: 'ORDER_STATUS_CHANGED', entity_type: 'order',
      entity_id: order.id, event_key: first.event_key, payload: {},
    });
    assert.equal(error?.code, '23505');
    await dispatcher.drain();
    assert.equal(received.length, 3);
  });

  // --- 5. guard ---------------------------------------------------------------
  await check('a status change without a revision is refused', async () => {
    const { error } = await db.from('orders').update({ status_id: statuses.COMPLETED }).eq('id', order.id);
    assert.equal(error?.message, 'ORDER_STATUS_CHANGE_WITHOUT_REVISION');
  });

  // --- 6. workflow off → nothing ----------------------------------------------
  await check('with the workflow off nothing is queued or sent', async () => {
    await one(db.rpc('save_teams_workflow', {
      p_function_code: 'ORDER_STATUS_CHANGED', p_name: null, p_is_active: false, p_actor_id: admin,
    }), 'off');
    const second = await createOrder('B');
    // Cancel through the new RPC: it writes a revision, which must also be skipped.
    const changed = await one(db.rpc('transition_order_status', {
      p_order_id: second.id, p_actor_id: admin, p_expected_status_id: statuses.PENDING,
      p_target_status_code: 'CANCELLED', p_cancel_reason: 'Teams integration test', p_taken_away_by: null,
    }), 'cancel');
    assert.equal(changed, true);
    await dispatcher.drain();
    assert.equal(received.length, 3);
    assert.equal((await deliveriesFor(second.id)).length, 0);
    const revisions = await one(db.from('order_revisions')
      .select('action:order_revision_actions!order_revisions_action_id_fkey(code)').eq('order_id', second.id), 'revs');
    assert.deepEqual(revisions.map((r) => r.action.code).sort(), ['CANCEL', 'CREATE']);
  });
} finally {
  server.close();
  if (restoreActive !== null) {
    const admin = (await db.from('user_roles').select('user_id, role:roles!inner(code)').eq('role.code', 'ADMIN').limit(1)).data[0].user_id;
    await db.rpc('save_teams_workflow', { p_function_code: 'ORDER_STATUS_CHANGED', p_name: null, p_is_active: restoreActive, p_actor_id: admin });
    results.push(`(switch restored to ${restoreActive ? 'ON' : 'OFF'})`);
  }
}

console.log(results.join('\n'));

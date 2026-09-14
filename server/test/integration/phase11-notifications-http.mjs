import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import Fastify from 'fastify';
import app from '../../dist/app.js';
import { createSessionAuth } from './session-auth-helper.mjs';

const ids = {
  actor: '69400000-0000-4000-8000-000000000001',
  peer: '69400000-0000-4000-8000-000000000002',
  manager: '69400000-0000-4000-8000-000000000003',
  outsider: '69400000-0000-4000-8000-000000000004',
  none: '69400000-0000-4000-8000-000000000005',
  inactive: '69400000-0000-4000-8000-000000000006',
  supply: '69400000-0000-4000-8000-000000000020',
};

let sessionAuth;
const signToken = (subject, expiresInSeconds = 300) =>
  sessionAuth.tokenFor(subject, expiresInSeconds);

const startServer = async () => {
  const server = Fastify({ logger: false });
  await server.register(app);
  await server.listen({ host: '127.0.0.1', port: 0 });
  const address = server.server.address();
  assert.ok(address && typeof address === 'object');
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
};

const requestJson = async (baseUrl, userId, path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${signToken(userId)}`,
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json();
  return { response, body };
};

const readSseEvent = async (reader, expectedEvent, timeoutMs = 8000) => {
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const result = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting for ${expectedEvent}`)), remaining)),
    ]);
    if (result.done) throw new Error(`SSE closed before ${expectedEvent}`);
    buffer += decoder.decode(result.value, { stream: true }).replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
      const eventLine = block.split('\n').find((line) => line.startsWith('event:'));
      const event = eventLine?.slice(6).trim() ?? 'message';
      const data = block.split('\n').filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart()).join('\n');
      if (event === expectedEvent) return data ? JSON.parse(data) : null;
    }
  }
  throw new Error(`Timed out waiting for ${expectedEvent}`);
};

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORIGIN_URL = process.env.ORIGIN_URL;
assert.ok(supabaseUrl);
assert.ok(supabaseServiceRoleKey);
assert.ok(ORIGIN_URL, 'ORIGIN_URL must be provided by the test environment');
const database = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

sessionAuth = await createSessionAuth([
  ids.actor,
  ids.peer,
  ids.manager,
  ids.outsider,
  ids.none,
  ids.inactive,
]);
let runtime = await startServer();
let streamController;
let noneStreamController;
try {
  const { data: lookups, error: lookupError } = await database
    .from('supplies')
    .select('id,unit_id')
    .eq('id', ids.supply)
    .single();
  assert.equal(lookupError, null);
  const { data: provider, error: providerError } = await database
    .from('providers').select('id').eq('code', 'P11_PROVIDER').single();
  assert.equal(providerError, null);
  const { data: areas, error: areaError } = await database
    .from('areas').select('id,code').in('code', ['VTDG', 'EDC_LOGISTICS']);
  assert.equal(areaError, null);
  const areaByCode = new Map(areas.map((area) => [area.code, area.id]));
  const providerId = provider.id;
  assert.ok(providerId);

  const missingAuth = await fetch(`${runtime.baseUrl}/notifications/stream`);
  assert.equal(missingAuth.status, 401);
  const invalidAuth = await fetch(`${runtime.baseUrl}/notifications/stream`, {
    headers: { authorization: 'Bearer invalid.jwt.value' },
  });
  assert.equal(invalidAuth.status, 401);
  const expiredAuth = await fetch(`${runtime.baseUrl}/notifications/stream`, {
    headers: { authorization: `Bearer ${signToken(ids.peer, -10)}` },
  });
  assert.equal(expiredAuth.status, 401);
  console.log('phase12-sse-auth: PASS');
  const createOrder = (overrides = {}) => requestJson(runtime.baseUrl, ids.actor, '/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      from_area_id: areaByCode.get('VTDG'),
      to_area_id: areaByCode.get('EDC_LOGISTICS'),
      note: 'Phase 11 HTTP workflow',
      order_list: [{
        supply_id: ids.supply,
        provider_id: providerId,
        unit_id: lookups.unit_id,
        quantity_requested: 1,
        note: null,
      }],
      ...overrides,
    }),
  });

  streamController = new AbortController();
  const streamResponse = await fetch(`${runtime.baseUrl}/notifications/stream`, {
    headers: {
      authorization: `Bearer ${signToken(ids.peer)}`,
      origin: ORIGIN_URL,
    },
    signal: streamController.signal,
  });
  assert.equal(streamResponse.status, 200);
  assert.equal(streamResponse.headers.get('access-control-allow-origin'), ORIGIN_URL);
  assert.equal(streamResponse.headers.get('access-control-allow-credentials'), 'true');
  assert.match(streamResponse.headers.get('content-type') ?? '', /text\/event-stream/);
  const reader = streamResponse.body.getReader();
  await readSseEvent(reader, 'connected');
  console.log('phase12-sse-peer-connected: PASS');

  noneStreamController = new AbortController();
  const noneStreamResponse = await fetch(`${runtime.baseUrl}/notifications/stream`, {
    headers: { authorization: `Bearer ${signToken(ids.none)}` },
    signal: noneStreamController.signal,
  });
  assert.equal(noneStreamResponse.status, 200);
  const noneReader = noneStreamResponse.body.getReader();
  await readSseEvent(noneReader, 'connected');
  console.log('phase12-sse-no-permission-connected: PASS');

  const stockAdjustment = await requestJson(runtime.baseUrl, ids.manager, '/stock-adjustments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      supply_id: ids.supply,
      provider_id: providerId,
      area_id: areaByCode.get('VTDG'),
      storage_location_id: '69400000-0000-4000-8000-000000000021',
      transaction_type_code: 'ADJUSTMENT_IN',
      quantity: 1,
      reason: 'Phase 12 transient stock SSE verification',
    }),
  });
  assert.equal(stockAdjustment.response.status, 201, JSON.stringify(stockAdjustment.body));
  console.log('phase12-stock-adjustment: PASS');
  const stockSignal = await readSseEvent(reader, 'stock_changed');
  assert.deepEqual(Object.keys(stockSignal).sort(), ['domain', 'occurred_at', 'type']);
  assert.equal(stockSignal.domain, 'supply');
  assert.equal(stockSignal.type, 'STOCK_CHANGED');
  await assert.rejects(
    readSseEvent(noneReader, 'stock_changed', 2200),
    /Timed out waiting for stock_changed/,
  );
  noneStreamController.abort();
  noneStreamController = undefined;
  console.log('phase12-stock-signal-scope: PASS');

  const createResponse = await createOrder();
  assert.equal(createResponse.response.status, 201, JSON.stringify(createResponse.body));
  const createdOrder = createResponse.body.data;
  assert.equal(createdOrder.status_lookup.code, 'PENDING');
  const liveCreated = await readSseEvent(reader, 'notification');
  const createdId = liveCreated.notification_id;
  assert.ok(createdId);
  assert.equal(liveCreated.type, 'ORDER_CREATED');
  assert.equal(liveCreated.entity_id, createdOrder.id);

  // Replaying the persistence RPC with the same event key remains idempotent.
  const { data: notificationMaster, error: masterError } = await database.from('notifications')
    .select('*').eq('id', createdId).single();
  assert.equal(masterError, null);
  const { data: recipients, count: recipientCount } = await database.from('notification_recipients')
    .select('user_id', { count: 'exact' }).eq('notification_id', createdId);
  const recipientIds = new Set(recipients.map((row) => row.user_id));
  assert.equal(recipientIds.has(ids.peer), true);
  assert.equal(recipientIds.has(ids.manager), true);
  assert.equal(recipientIds.has(ids.actor), false);
  assert.equal(recipientIds.has(ids.outsider), false);
  assert.equal(recipientIds.has(ids.none), false);
  assert.equal(recipientIds.has(ids.inactive), false);
  const duplicate = await database.rpc('persist_notification_with_recipients', {
    p_domain: notificationMaster.domain,
    p_type: notificationMaster.type,
    p_title: notificationMaster.title,
    p_message: notificationMaster.message,
    p_entity_type: notificationMaster.entity_type,
    p_entity_id: notificationMaster.entity_id,
    p_area_id: notificationMaster.area_id,
    p_created_by: notificationMaster.created_by,
    p_event_key: notificationMaster.event_key,
    p_recipient_ids: [...recipientIds],
  });
  assert.equal(duplicate.error, null);
  assert.equal(duplicate.data, createdId);
  const { count: recipientCountAfterDuplicate } = await database.from('notification_recipients')
    .select('id', { count: 'exact', head: true }).eq('notification_id', createdId);
  assert.equal(recipientCountAfterDuplicate, recipientCount);

  const peerList = await requestJson(runtime.baseUrl, ids.peer, '/notifications?page=1&pageSize=20&domain=supply');
  assert.equal(peerList.response.status, 200);
  assert.equal(peerList.body.pagination.total, 1);
  assert.equal(peerList.body.unread_count, 1);
  assert.equal(peerList.body.data[0].entity.code, createdOrder.code);
  assert.equal('entity_id' in peerList.body.data[0], false);

  for (const excludedUser of [ids.actor, ids.outsider, ids.none, ids.inactive]) {
    const list = await requestJson(runtime.baseUrl, excludedUser, '/notifications?page=1&pageSize=20');
    const expectedStatus = excludedUser === ids.inactive ? 403 : 200;
    assert.equal(list.response.status, expectedStatus);
    if (expectedStatus === 200) assert.equal(list.body.pagination.total, 0);
  }

  const firstRead = await requestJson(runtime.baseUrl, ids.peer, `/notifications/${createdId}/read`, { method: 'PATCH' });
  assert.equal(firstRead.response.status, 200);
  assert.equal(firstRead.body.data.is_read, true);
  const originalReadAt = firstRead.body.data.read_at;
  const secondRead = await requestJson(runtime.baseUrl, ids.peer, `/notifications/${createdId}/read`, { method: 'PATCH' });
  assert.equal(secondRead.response.status, 200);
  assert.equal(secondRead.body.data.read_at, originalReadAt);
  const foreignRead = await requestJson(runtime.baseUrl, ids.outsider, `/notifications/${createdId}/read`, { method: 'PATCH' });
  assert.equal(foreignRead.response.status, 404);
  const managerList = await requestJson(runtime.baseUrl, ids.manager, '/notifications?page=1&pageSize=20&unreadOnly=true');
  assert.equal(managerList.body.pagination.total, 1);
  assert.equal(managerList.body.unread_count, 1);

  const approvalItems = createdOrder.order_items.map((item) => ({
    order_item_id: item.id,
    quantity_approved: Number(item.quantity_requested),
  }));
  const approveRequest = () => requestJson(
    runtime.baseUrl,
    ids.manager,
    `/orders/${createdOrder.id}/approve`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: approvalItems }),
    },
  );
  const concurrentApprovals = await Promise.all([approveRequest(), approveRequest()]);
  assert.deepEqual(
    concurrentApprovals.map(({ response }) => response.status).sort((a, b) => a - b),
    [200, 409],
  );
  const approveResponse = concurrentApprovals.find(({ response }) => response.status === 200);
  const rejectedConcurrentApproval = concurrentApprovals.find(
    ({ response }) => response.status === 409,
  );
  assert.ok(approveResponse, JSON.stringify(concurrentApprovals.map(({ body }) => body)));
  assert.ok(rejectedConcurrentApproval);
  assert.equal(approveResponse.response.status, 200, JSON.stringify(approveResponse.body));
  assert.equal(approveResponse.body.data.status_lookup.code, 'APPROVED');
  const liveStatus = await readSseEvent(reader, 'notification');
  assert.equal(liveStatus.type, 'ORDER_STATUS_CHANGED');
  assert.equal(liveStatus.entity_id, createdOrder.id);

  const afterFailedStatus = await database.from('notifications')
    .select('id', { count: 'exact', head: true }).eq('entity_id', createdOrder.id);
  assert.equal(afterFailedStatus.count, 2);

  // A zero-stock create rolls back the entire Order and emits no ORDER_CREATED.
  const zeroStockUpdate = await database.from('stock_balances')
    .update({ quantity: 0 }).eq('id', '69400000-0000-4000-8000-000000000022');
  assert.equal(zeroStockUpdate.error, null);
  const ordersBeforeZeroCreate = await database.from('orders')
    .select('id', { count: 'exact', head: true });
  const notificationsBeforeZeroCreate = await database.from('notifications')
    .select('id', { count: 'exact', head: true });
  const zeroCreate = await createOrder();
  assert.equal(zeroCreate.response.status, 409);
  assert.equal(zeroCreate.body.code, 'ORDER_ITEM_ZERO_STOCK');
  const ordersAfterZeroCreate = await database.from('orders')
    .select('id', { count: 'exact', head: true });
  const notificationsAfterZeroCreate = await database.from('notifications')
    .select('id', { count: 'exact', head: true });
  assert.equal(ordersAfterZeroCreate.count, ordersBeforeZeroCreate.count);
  assert.equal(notificationsAfterZeroCreate.count, notificationsBeforeZeroCreate.count);
  const restoreStock = await database.from('stock_balances')
    .update({ quantity: 10 }).eq('id', '69400000-0000-4000-8000-000000000022');
  assert.equal(restoreStock.error, null);

  // A caller-supplied invalid Sheet context also cannot emit a notification.
  const ordersBeforeInvalidSheet = await database.from('orders')
    .select('id', { count: 'exact', head: true });
  const invalidSheetCreate = await createOrder({
    shift_order_sheet_id: '69499999-0000-4000-8000-000000000099',
  });
  assert.ok([403, 409].includes(invalidSheetCreate.response.status));
  const ordersAfterInvalidSheet = await database.from('orders')
    .select('id', { count: 'exact', head: true });
  assert.equal(ordersAfterInvalidSheet.count, ordersBeforeInvalidSheet.count);

  streamController.abort();
  await runtime.server.close();

  // Persisted rows survive server restart and recover events missed while offline.
  runtime = await startServer();
  const afterRestart = await requestJson(runtime.baseUrl, ids.peer, '/notifications?page=1&pageSize=20');
  assert.equal(afterRestart.response.status, 200);
  assert.equal(afterRestart.body.pagination.total, 2);
  assert.equal(afterRestart.body.data[0].type, 'ORDER_STATUS_CHANGED');

  // Server-side pagination/unread count with more rows than one page.
  for (let index = 0; index < 25; index += 1) {
    const persisted = await database.rpc('persist_notification_with_recipients', {
      p_domain: 'supply',
      p_type: 'ORDER_STATUS_CHANGED',
      p_title: `Pagination ${index}`,
      p_message: `Phase 11 pagination row ${index}`,
      p_entity_type: 'order',
      p_entity_id: createdOrder.id,
      p_area_id: areaByCode.get('EDC_LOGISTICS'),
      p_created_by: ids.manager,
      p_event_key: `phase11:pagination:${createdOrder.id}:${index}`,
      p_recipient_ids: [ids.peer],
    });
    assert.equal(persisted.error, null);
  }
  const page1 = await requestJson(runtime.baseUrl, ids.peer, '/notifications?page=1&pageSize=10');
  const page2 = await requestJson(runtime.baseUrl, ids.peer, '/notifications?page=2&pageSize=10');
  const page3 = await requestJson(runtime.baseUrl, ids.peer, '/notifications?page=3&pageSize=10');
  assert.equal(page1.body.pagination.total, 27);
  assert.equal(page1.body.unread_count, 26);
  assert.equal(page1.body.data.length, 10);
  assert.equal(page2.body.data.length, 10);
  assert.equal(page3.body.data.length, 7);
  const page1Ids = new Set(page1.body.data.map((notification) => notification.id));
  assert.equal(page2.body.data.some((notification) => page1Ids.has(notification.id)), false);
  for (let index = 1; index < page1.body.data.length; index += 1) {
    assert.ok(page1.body.data[index - 1].created_at >= page1.body.data[index].created_at);
  }
  const beyondLastPage = await requestJson(runtime.baseUrl, ids.peer, '/notifications?page=100&pageSize=10');
  assert.equal(beyondLastPage.response.status, 200);
  assert.equal(beyondLastPage.body.data.length, 0);

  const invalidPage = await requestJson(runtime.baseUrl, ids.peer, '/notifications?page=0');
  assert.equal(invalidPage.response.status, 400);
  const invalidPageSize = await requestJson(runtime.baseUrl, ids.peer, '/notifications?pageSize=101');
  assert.equal(invalidPageSize.response.status, 400);

  console.log(JSON.stringify({ notificationCount: 27, initialRecipients: recipientCount }));
  console.log('phase11-notifications-http: PASS');
} finally {
  streamController?.abort();
  noneStreamController?.abort();
  await runtime.server.close();
  await sessionAuth.cleanup();
}

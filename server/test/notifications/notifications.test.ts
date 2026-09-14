import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('Phase 11 persistent Supply notifications', () => {
  it('defines persistent notification tables, recipient ownership and no browser-open RLS policy', () => {
    const migration = read('supabase/migrations/20260827012116_shared_notifications_sse.sql');
    assert.match(migration, /create table if not exists public\.notifications/i);
    assert.match(migration, /create table if not exists public\.notification_recipients/i);
    assert.match(migration, /unique \(notification_id, user_id\)/i);
    assert.match(migration, /unique[\s\S]*event_key/i);
    assert.match(migration, /enable row level security/i);
    assert.doesNotMatch(migration, /using\s*\(\s*true\s*\)/i);
    assert.doesNotMatch(migration, /with check\s*\(\s*true\s*\)/i);
  });

  it('uses current-user APIs and has no notification update/delete collection routes', () => {
    const routes = read('src/routes/notifications/index.ts');
    assert.match(routes, /fastify\.get\(\s*'\/'/);
    assert.match(routes, /fastify\.patch\(\s*'\/:id\/read'/);
    assert.match(routes, /fastify\.get\(\s*'\/stream'/);
    assert.doesNotMatch(routes, /fastify\.delete/);
    assert.doesNotMatch(routes, /verifyTokenAndRole|role\s*===|role\.includes/);
  });

  it('persists ORDER_CREATED after direct PENDING creation and transition notifications afterward', () => {
    const service = read('src/services/orders.service.ts');
    const createStart = service.indexOf('async create(');
    const patchStart = service.indexOf('\n  async patch(', createStart);
    const createBody = service.slice(createStart, patchStart);
    assert.match(createBody, /create_pending_order_with_items/);
    assert.match(createBody, /persistOrderCreated\(actor, order\)/);
    assert.doesNotMatch(createBody, /finishStatusTransition/);
    for (const action of ['approve', 'reject', 'issue', 'receive', 'complete', 'cancel']) {
      const methodStart = service.indexOf(`async ${action}(`);
      assert.notEqual(methodStart, -1, `${action} method missing`);
      const nextMethod = service.indexOf('\n  async ', methodStart + 8);
      const body = service.slice(methodStart, nextMethod === -1 ? undefined : nextMethod);
      assert.match(body, /finishStatusTransition\(actor, order/);
    }
    assert.doesNotMatch(service, /async submit\(|submit_order_to_pending/);
  });

  it('invalidates Supply views and targeted availability queries on live events', () => {
    const hook = read('../client/src/hooks/useSupplyRealtime.ts');
    assert.match(hook, /queryKeys\.notifications\.all/);
    assert.match(hook, /queryKeys\.orders\.lists/);
    assert.match(hook, /queryKeys\.shiftOrderSheets\.all/);
    assert.match(hook, /queryKeys\.supplyStackOptions\.all/);
    assert.match(hook, /queryKeys\.orders\.details/);
    assert.doesNotMatch(hook, /queryKeys\.(stockBalances|stockTransactions)|milkrun/i);
  });

  it('emits a payload-free stock signal only for users allowed to create Supply orders', () => {
    const controller = read('src/controllers/notifications/index.ts');
    assert.match(controller, /PERMISSION_CODE\.SUPPLY_ORDER_CREATE/);
    assert.match(controller, /event: \$\{event\}/);
    assert.match(controller, /'stock_changed'/);
    assert.doesNotMatch(controller, /stock_changed[\s\S]{0,180}(quantity|stock_balance_id|supply_id)/);
  });

  it('writes configured CORS headers before hijacking the SSE response', () => {
    const controller = read('src/controllers/notifications/index.ts');
    const corsHeaderIndex = controller.indexOf("setHeader('Access-Control-Allow-Origin'");
    const hijackIndex = controller.indexOf('reply.hijack();');
    assert.notEqual(corsHeaderIndex, -1);
    assert.notEqual(hijackIndex, -1);
    assert.ok(corsHeaderIndex < hijackIndex);
    assert.match(
      controller,
      /setHeader\('Access-Control-Allow-Origin', requestOrigin\)/,
    );
    assert.match(controller, /allowedOrigins\.includes\(requestOrigin\)/);
    assert.match(controller, /Access-Control-Allow-Credentials/);
    assert.match(controller, /setHeader\('Vary', 'Origin'\)/);
  });
});

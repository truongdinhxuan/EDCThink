import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const migration = read(
  'supabase/migrations/20260909173958_create_order_direct_pending.sql',
);
const removalMigration = read(
  'supabase/migrations/20260911031203_remove_order_draft_status.sql',
);
const orderService = read('src/services/orders.service.ts');
const orderRoutes = read('src/routes/orders/index.ts');

const createFunction = migration.slice(
  migration.indexOf('create or replace function public.create_pending_order_with_items'),
  migration.indexOf('revoke all on function public.create_pending_order_with_items'),
);
const createService = orderService.slice(
  orderService.indexOf('async create('),
  orderService.indexOf('async patch('),
);
const patchService = orderService.slice(
  orderService.indexOf('async patch('),
  orderService.indexOf('async list('),
);

describe('Order direct-PENDING Phase 2 contract', () => {
  it('forces PENDING by lookup code and never accepts a client status id', () => {
    assert.match(createFunction, /status_row\.code = 'PENDING'/);
    assert.match(
      createFunction,
      /v_pending_status_id, nullif\(btrim\(p_note\), ''\), p_submitted_at/,
    );
    assert.doesNotMatch(createFunction, /p_status_id/);
    assert.match(createService, /rpc\(\s*'create_pending_order_with_items'/);
    assert.doesNotMatch(createService, /ORDER_STATUS\.DRAFT|getStatusId/);
  });

  it('validates positive stock before inserting an Order and does not reserve stock', () => {
    const zeroGuardIndex = createFunction.indexOf("message = 'ORDER_ITEM_ZERO_STOCK'");
    const orderInsertIndex = createFunction.indexOf('insert into public.orders');
    assert.ok(zeroGuardIndex > 0);
    assert.ok(orderInsertIndex > zeroGuardIndex);
    assert.match(createFunction, /sum\(balance\.quantity\)/);
    assert.match(createFunction, /sum\(balance\.stack_quantity\)/);
    assert.match(createFunction, /balance\.provider_id/);
    assert.match(createFunction, /balance\.area_id = p_from_area_id/);
    assert.doesNotMatch(
      createFunction,
      /update public\.stock_balances|insert into public\.stock_transactions/i,
    );
    assert.doesNotMatch(
      createFunction,
      /reserved_quantity|(?:insert into|update|delete from)\s+[^;]*reserv/i,
    );
  });

  it('creates or validates the authoritative Area + Shift + WorkDate sheet atomically', () => {
    assert.match(createFunction, /resolve_user_work_shift_instance/);
    assert.match(
      createFunction,
      /on conflict \(area_id, work_shift_id, work_date\)/,
    );
    assert.match(createFunction, /p_shift_order_sheet_id/);
    assert.match(createFunction, /shift_order_sheet_id/);
    assert.match(createFunction, /submitted_at/);
  });

  it('stores unreviewed quantities as NULL and inserts every item in the same RPC', () => {
    assert.match(createFunction, /quantity_approved, quantity_issued/);
    assert.match(createFunction, /null,\s*0,/);
    assert.match(createFunction, /jsonb_array_elements\(v_normalized_items\)/);
  });

  it('keeps PENDING items immutable while allowing a status-guarded note update', () => {
    assert.match(patchService, /assertOrderActionAllowed\(currentStatus, 'edit'\)/);
    assert.doesNotMatch(patchService, /order_list/);
    assert.match(patchService, /\.update\(\{ note: body\.note \}\)/);
    assert.match(patchService, /\.eq\('status_id', order\.status_id\)/);
    assert.match(removalMigration, /drop function if exists public\.replace_order_items_with_providers/);
  });

  it('removes the legacy submit endpoint and restricts the atomic create RPC to service_role', () => {
    assert.doesNotMatch(orderService, /submit_order_to_pending|async submit\(/);
    assert.doesNotMatch(orderRoutes, /\/:id\/submit|submitOrder/);
    assert.match(removalMigration, /drop function if exists public\.submit_order_to_pending/);
    assert.match(
      migration,
      /revoke all on function public\.create_pending_order_with_items[\s\S]*from public, anon, authenticated/,
    );
    assert.match(
      migration,
      /grant execute on function public\.create_pending_order_with_items[\s\S]*to service_role/,
    );
  });

  it('persists the create notification only after the atomic Order commit', () => {
    assert.match(createService, /const order = await this\.findOrder/);
    assert.match(createService, /persistOrderCreated\(actor, order\)/);
    assert.ok(
      createService.indexOf("'create_pending_order_with_items'")
        < createService.indexOf('persistOrderCreated(actor, order)'),
    );
  });
});

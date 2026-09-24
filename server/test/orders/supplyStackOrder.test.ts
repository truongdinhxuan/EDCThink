import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const migration = read('supabase/migrations/20260822141943_supply_stack_create_order.sql');
const orderService = read('src/services/orders.service.ts');
const supplyService = read('src/services/supplies.service.ts');
const supplyRoutes = read('src/routes/supplies/index.ts');
const orderSchema = read('src/schemas/orders.ts');
const confirmMigration = read('supabase/migrations/20260924010200_stack_confirm_issue_flow.sql');
const labelsMigration = read('supabase/migrations/20260924010000_stock_location_labels.sql');
const locationFreeMigration = read('supabase/migrations/20260924010100_stock_location_free_rpcs.sql');
const orderRoutes = read('src/routes/orders/index.ts');
const orderController = read('src/controllers/orders/index.ts');
const permissionCodes = read('src/domain/permission-codes.ts');

describe('Supply stack Phase 3 options (T-001 to T-006)', () => {
  // Current definition: one pooled row per set_per_qty, so nothing to sum.
  const options = locationFreeMigration.slice(
    locationFreeMigration.indexOf('create or replace function public.get_supply_stack_options'),
    locationFreeMigration.indexOf('create or replace function public.normalize_order_item_request'),
  );

  it('lists positive stack options, one per set size (T-001/T-002/T-003)', () => {
    assert.match(options, /sb\.stack_quantity as available_stack_quantity/);
    assert.match(options, /sb\.stack_quantity \* sb\.set_per_qty as available_total_set_quantity/);
    assert.match(options, /sb\.stack_quantity > 0/);
  });

  it('scopes options by Supply, Provider, Area and excludes legacy rows (T-004/T-005/T-006)', () => {
    assert.match(options, /sb\.supply_id = p_supply_id/);
    assert.match(options, /sb\.provider_id = p_provider_id/);
    assert.match(options, /sb\.area_id = p_area_id/);
    assert.match(options, /sb\.set_per_qty is not null/);
    assert.doesNotMatch(options, /storage_locations/);
  });

  it('exposes one authenticated, permission-protected endpoint', () => {
    assert.match(supplyRoutes, /'\/:id\/stack-options'/);
    assert.match(supplyRoutes, /requirePermission\(PERMISSION_CODE\.SUPPLY_ORDER_CREATE\)/);
    assert.match(supplyService, /rpc\('get_supply_stack_options'/);
  });
});

describe('Supply stack Phase 3 create and replace (T-007 to T-015)', () => {
  it('persists one stack request per OrderItem with authoritative total (T-007/T-008)', () => {
    assert.match(migration, /v_calculated_total := v_set_per_qty \* v_requested_stack_quantity/);
    assert.match(migration, /requested_total_set_quantity, quantity_approved, quantity_issued/);
    assert.match(migration, /nullif\(v_item ->> 'requested_stack_quantity'/);
    assert.doesNotMatch(migration, /stack_options\s+jsonb/i);
  });

  it('rejects client total tampering and unavailable set sizes (T-009/T-010)', () => {
    assert.match(migration, /quantity_requested mismatch: expected/);
    assert.match(migration, /requested_total_set_quantity mismatch: expected/);
    assert.match(migration, /Selected set_per_qty is not available/);
    assert.match(orderService, /eligibleStackOptions\.has/);
  });

  it('keeps normal and KIEN_SAT_SPECIAL on normal quantity mode (T-011/T-012)', () => {
    assert.match(migration, /if v_category_code = 'KIEN_SAT_TC' then/);
    assert.match(migration, /Stack fields are only allowed for KIEN_SAT_TC/);
    assert.match(orderSchema, /quantity_requested: \{ type: 'integer', minimum: 1 \}/);
    assert.doesNotMatch(migration, /KIEN_SAT_SPECIAL[\s\S]*set_per_qty/);
  });

  it('does not mutate stock or create ledger rows at create time (T-013/T-020)', () => {
    const createFunction = migration.slice(
      migration.indexOf('create or replace function public.create_order_with_items'),
      migration.indexOf('revoke all on function public.create_order_with_items'),
    );
    assert.doesNotMatch(createFunction, /update public\.stock_balances|insert into public\.stock_transactions/i);
  });

  it('keeps Order plus all items atomic and ignores client category spoofing (T-014/T-015)', () => {
    assert.match(migration, /create or replace function public\.create_order_with_items/);
    assert.match(migration, /public\.normalize_order_item_request\(v_item, p_from_area_id\)/);
    assert.match(migration, /join public\.supply_categories sc on sc\.id = s\.category_id/);
    assert.doesNotMatch(migration, /p_item ->> 'category'/);
  });
});

describe('Supply stack Phase 3 read/edit (T-016/T-019)', () => {
  it('scopes detail availability by set_per_qty (T-016)', () => {
    assert.match(orderService, /const stackDimension = item\.set_per_qty === null/);
    assert.match(orderService, /availableStacksByDimension/);
  });

  it('preserves stack fields in create, replace and detail response (T-019)', () => {
    for (const field of [
      'set_per_qty',
      'requested_stack_quantity',
      'requested_total_set_quantity',
    ]) {
      assert.ok(orderService.includes(field), `missing ${field}`);
    }
    assert.match(orderService, /order_items\(\s*\*,/);
    assert.match(migration, /create or replace function public\.replace_order_items_with_providers/);
  });
});

describe('Stack item confirmation contract', () => {
  const confirmFunction = confirmMigration.slice(
    confirmMigration.indexOf('create or replace function public.confirm_stack_order_item'),
    confirmMigration.indexOf('revoke all on function public.confirm_stack_order_item'),
  );

  it('has no allocation step left: one route confirms one item', () => {
    // Stock no longer has locations to split an Order across.
    assert.match(confirmMigration, /drop function if exists public\.allocate_stack_order/);
    assert.doesNotMatch(orderRoutes, /'\/:id\/allocate'/);
    assert.doesNotMatch(orderService, /allocate_stack_order/);
    assert.match(orderRoutes, /'\/:id\/items\/:itemId\/confirm'/);
    assert.match(orderRoutes, /requirePermission\(PERMISSION_CODE\.SUPPLY_ORDER_CONFIRM_ALLOCATION\)/);
    assert.match(orderController, /new OrderService\(request\.server\)\.confirmStackItem/);
    assert.match(orderService, /'confirm_stack_order_item'/);
    // The code stays: it still grants read access to Orders.
    assert.match(permissionCodes, /SUPPLY_ORDER_ALLOCATE: "supply\.order\.allocate"/);
  });

  it('derives approved stacks exactly without rounding', () => {
    assert.match(
      confirmFunction,
      /v_approved_stack := v_item\.quantity_approved \/ v_item\.set_per_qty/,
    );
    assert.match(confirmFunction, /mod\(v_item\.quantity_approved, v_item\.set_per_qty\) <> 0/);
    assert.doesNotMatch(confirmFunction, /round\(|floor\(|ceil\(/i);
  });

  it('lets the count go above or below the approval, but never without a reason', () => {
    assert.doesNotMatch(confirmFunction, /ACTUAL_STACK_EXCEEDS_EXPECTED/);
    assert.match(confirmFunction, /if p_actual_stack_quantity <> v_approved_stack then/);
    assert.match(confirmFunction, /message = 'CONFIRM_REASON_REQUIRED'/);
    // The reason's own direction column decides which side it may be used on.
    assert.match(confirmFunction, /\(p_actual_stack_quantity < v_approved_stack\)\s*<> \(v_reason\.direction = 'LOWER'\)/);
    assert.match(confirmFunction, /message = 'CONFIRM_REASON_DIRECTION_MISMATCH'/);
  });

  it('never branches on a reason code; corrects_stock decides', () => {
    assert.match(confirmFunction, /if v_reason\.corrects_stock then/);
    assert.doesNotMatch(confirmFunction, /'NOT_AVAILABLE'|'NEGOTIATED_(LOWER|HIGHER)'/);
  });

  it('corrects only the phantom part of a shortfall and opens a recount', () => {
    assert.match(
      confirmFunction,
      /v_correction_stack := least\(\s*v_approved_stack - p_actual_stack_quantity,\s*greatest\(v_balance\.stack_quantity - p_actual_stack_quantity, 0\)\s*\)/,
    );
    assert.match(confirmFunction, /'OPEN',\s*'CONFIRMATION'/);
    assert.match(confirmFunction, /code = 'DISCREPANCY_CORRECTION'/);
  });

  it('no longer re-allocates a shortfall into new unconfirmed rows', () => {
    assert.doesNotMatch(confirmFunction, /REALLOCATED|INSUFFICIENT|v_new_allocations/);
    assert.match(confirmMigration, /drop function if exists public\.confirm_stack_allocation_actual/);
  });

  it('refuses a second confirmation of the same item', () => {
    assert.match(confirmFunction, /message = 'ALLOCATION_ALREADY_CONFIRMED'/);
    assert.match(labelsMigration, /create unique index order_item_allocations_order_item_key/);
  });

  it('returns confirmations through the Order detail select without N+1 queries', () => {
    assert.match(orderService, /allocations:order_item_allocations!order_item_allocations_order_item_fkey/);
    assert.match(orderService, /reason:allocation_confirm_reasons!order_item_allocations_reason_fkey/);
    assert.match(orderService, /location_labels:stock_balance_locations!stock_balance_locations_balance_fkey/);
    assert.doesNotMatch(orderService, /stock_balances_storage_location_id_fkey/);
  });
});

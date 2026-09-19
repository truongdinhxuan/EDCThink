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
const allocationMigration = read('supabase/migrations/20260823142244_supply_stack_allocation.sql');
const orderRoutes = read('src/routes/orders/index.ts');
const orderController = read('src/controllers/orders/index.ts');
const permissionCodes = read('src/domain/permission-codes.ts');

describe('Supply stack Phase 3 options (T-001 to T-006)', () => {
  it('aggregates positive stack options across eligible locations (T-001/T-002/T-003)', () => {
    assert.match(migration, /create or replace function public\.get_supply_stack_options/);
    assert.match(migration, /sum\(sb\.stack_quantity\) as available_stack_quantity/);
    assert.match(migration, /sum\(sb\.stack_quantity\) \* sb\.set_per_qty as available_total_set_quantity/);
    assert.match(migration, /sb\.stack_quantity > 0/);
    assert.match(migration, /group by sb\.set_per_qty/);
  });

  it('scopes options by Supply, Provider, Area and excludes legacy rows (T-004/T-005/T-006)', () => {
    assert.match(migration, /sb\.supply_id = p_supply_id/);
    assert.match(migration, /sb\.provider_id = p_provider_id/);
    assert.match(migration, /sb\.area_id = p_area_id/);
    assert.match(migration, /sb\.set_per_qty is not null/);
    assert.match(migration, /sl\.is_active = true/);
    assert.match(migration, /sl\.is_deleted = false/);
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
    assert.match(orderService, /storage_location\.is_deleted/);
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

describe('Supply stack Phase 4 allocation contract', () => {
  const allocationFunction = allocationMigration.slice(
    allocationMigration.indexOf('create or replace function public.allocate_stack_order'),
    allocationMigration.indexOf('revoke execute on function public.allocate_stack_order'),
  );

  it('uses one permission-protected route, service orchestration and authoritative RPC', () => {
    assert.match(permissionCodes, /SUPPLY_ORDER_ALLOCATE: "supply\.order\.allocate"/);
    assert.match(orderRoutes, /'\/:id\/allocate'/);
    assert.match(orderRoutes, /requirePermission\(PERMISSION_CODE\.SUPPLY_ORDER_ALLOCATE\)/);
    assert.match(orderController, /new OrderService\(request\.server\)\.allocate/);
    assert.match(orderService, /rpc\('allocate_stack_order'/);
    assert.doesNotMatch(orderService, /available_stack_quantity desc/);
  });

  it('derives approved stacks exactly without rounding', () => {
    assert.match(
      allocationFunction,
      /v_required_stack_quantity\s*:=\s*v_item\.quantity_approved \/ v_item\.set_per_qty/,
    );
    assert.match(
      allocationFunction,
      /mod\(v_item\.quantity_approved, v_item\.set_per_qty\) <> 0/,
    );
    assert.doesNotMatch(allocationFunction, /round\(|floor\(|ceil\(/i);
  });

  it('uses largest-first deterministic ordering and supports split rows', () => {
    assert.match(allocationFunction, /working\.available_stack_quantity desc/);
    assert.match(allocationFunction, /working\.storage_location_code asc/);
    assert.match(allocationFunction, /working\.stock_balance_id asc/);
    assert.match(allocationFunction, /least\(\s*v_balance\.available_stack_quantity,\s*v_remaining_stack_quantity/);
    assert.match(allocationFunction, /insert into public\.order_item_allocations/);
    assert.match(allocationFunction, /v_remaining_stack_quantity\s*:=\s*v_remaining_stack_quantity - v_take_stack_quantity/);
  });

  it('tracks whole-order working availability and rolls the function back on shortage', () => {
    assert.match(allocationFunction, /pg_temp\.stack_allocation_working/);
    assert.match(allocationFunction, /update pg_temp\.stack_allocation_working/);
    assert.match(allocationFunction, /message = 'INSUFFICIENT_STACK_STOCK'/);
    assert.match(allocationFunction, /shortage_stack_quantity/);
  });

  it('scopes eligible stock by every required dimension and active location', () => {
    for (const expression of [
      /working\.supply_id = v_item\.supply_id/,
      /working\.provider_id = v_item\.provider_id/,
      /working\.area_id = v_order\.from_area_id/,
      /working\.set_per_qty = v_item\.set_per_qty/,
      /balance\.stack_quantity > 0/,
      /location\.is_active = true/,
      /location\.is_deleted = false/,
      /location\.area_id = balance\.area_id/,
    ]) assert.match(allocationFunction, expression);
    assert.match(allocationFunction, /balance\.set_per_qty is not null/);
  });

  it('persists an initial proposal only and rejects repeat/non-approved allocation', () => {
    assert.match(allocationFunction, /v_status_code <> 'APPROVED'/);
    assert.match(allocationFunction, /message = 'ALLOCATION_ALREADY_EXISTS'/);
    assert.match(allocationFunction, /category\.code = 'KIEN_SAT_TC'/);
    assert.match(allocationFunction, /v_take_stack_quantity,\s*null,\s*null,\s*null,\s*now\(\),\s*null/);
    assert.doesNotMatch(allocationFunction, /update public\.stock_balances/i);
    assert.doesNotMatch(allocationFunction, /insert into public\.stock_transactions/i);
    assert.doesNotMatch(allocationFunction, /reserved_(stack_)?quantity|reservation|stock hold/i);
  });

  it('returns allocation relations through the Order detail select without N+1 queries', () => {
    assert.match(orderService, /allocations:order_item_allocations!order_item_allocations_order_item_fkey/);
    assert.match(orderService, /stock_balance:stock_balances!order_item_allocations_stock_balance_fkey/);
    assert.match(orderService, /location:storage_locations!stock_balances_storage_location_id_fkey/);
    assert.match(orderService, /actual_stack_quantity/);
  });
});

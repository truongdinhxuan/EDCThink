import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const migration = read(
  'supabase/migrations/20260823165527_supply_stack_discrepancy_confirmation.sql',
);
const confirmMigration = read(
  'supabase/migrations/20260924010200_stack_confirm_issue_flow.sql',
);
const confirmFunction = confirmMigration.slice(
  confirmMigration.indexOf('create or replace function public.confirm_stack_order_item'),
  confirmMigration.indexOf('revoke all on function public.confirm_stack_order_item'),
);
const labelsMigration = read(
  'supabase/migrations/20260924010000_stock_location_labels.sql',
);
const serviceRoleGrantMigration = read(
  'supabase/migrations/20260823165524_service_role_authorization_read_grants.sql',
);
const ordersRoutes = read('src/routes/orders/index.ts');
const ordersService = read('src/services/orders.service.ts');
const balanceRoutes = read('src/routes/stock-balances/index.ts');
const balanceService = read('src/services/stock-balances.service.ts');
const discrepancyRoutes = read('src/routes/inventory-discrepancies/index.ts');
const discrepancyService = read('src/services/inventory-discrepancies.service.ts');

describe('Supply stack Phase 5 discrepancy confirmation', () => {
  it('seeds semantic permissions and the master transaction type without a database enum', () => {
    assert.match(migration, /supply\.order\.confirm_allocation/);
    assert.match(migration, /supply\.discrepancy\.resolve/);
    assert.match(migration, /DISCREPANCY_CORRECTION/);
    assert.match(migration, /DATA_MATERIAL/);
    assert.doesNotMatch(migration, /create\s+type[\s\S]*enum/i);
  });

  it('keeps correction and recount in one locked RPC, with no re-allocation', () => {
    assert.match(confirmFunction, /for update of orders/i);
    assert.match(confirmFunction, /for update of item/i);
    assert.match(confirmFunction, /for update of balance/i);
    assert.match(confirmFunction, /insert into public\.inventory_discrepancies/i);
    assert.match(confirmFunction, /insert into public\.stock_transactions/i);
    assert.doesNotMatch(confirmFunction, /v_available_alternative|v_reallocation_status/i);
    assert.doesNotMatch(confirmFunction, /update public\.stock_transactions|delete from public\.stock_transactions/i);
  });

  it('exposes confirmation through permission-protected Order API without issuing stock', () => {
    assert.match(ordersRoutes, /items\/:itemId\/confirm/);
    assert.match(ordersRoutes, /SUPPLY_ORDER_CONFIRM_ALLOCATION/);
    assert.match(ordersService, /confirm_stack_order_item/);
    assert.doesNotMatch(
      ordersService.match(/async confirmStackItem[\s\S]*?\n  }/i)?.[0] ?? '',
      /issue_order|SUPPLY_ORDER_ISSUE/,
    );
    assert.doesNotMatch(confirmFunction, /set status = 'ISSUED'|quantity_issued/);
  });

  it('derives warning state and supports server-side warning filtering plus history', () => {
    assert.match(migration, /function public\.has_open_discrepancy/i);
    assert.match(balanceService, /has_open_discrepancy/);
    assert.match(balanceService, /request\.eq\('has_open_discrepancy', true\)/);
    assert.match(balanceService, /request\.eq\('has_open_discrepancy', false\)/);
    assert.match(balanceRoutes, /:id\/discrepancies/);
  });

  it('resolves an OPEN discrepancy without stock or ledger mutation', () => {
    assert.match(discrepancyRoutes, /:id\/resolve/);
    assert.match(discrepancyRoutes, /SUPPLY_DISCREPANCY_RESOLVE/);
    assert.match(discrepancyService, /resolve_inventory_discrepancy/);
    const resolveRpc = migration.match(
      /create or replace function public\.resolve_inventory_discrepancy[\s\S]*?\nend;\n\$\$;/i,
    )?.[0] ?? '';
    assert.match(resolveRpc, /RESOLUTION_NOTE_REQUIRED/);
    assert.match(resolveRpc, /DISCREPANCY_ALREADY_RESOLVED/);
    assert.doesNotMatch(resolveRpc, /stock_balances|stock_transactions/);
  });

  it('keeps mutation RPC execution backend-only', () => {
    for (const [source, signature] of [
      [confirmMigration, 'confirm_stack_order_item'],
      [migration, 'resolve_inventory_discrepancy'],
    ] as const) {
      assert.match(source, new RegExp(`revoke all on function public\\.${signature}[\\s\\S]*?from public, anon, authenticated`, 'i'));
      assert.match(source, new RegExp(`grant execute on function public\\.${signature}[\\s\\S]*?to service_role`, 'i'));
    }
  });

  it('records where a recount came from and allows one of each per confirmation', () => {
    assert.match(labelsMigration, /drop index public\.inventory_discrepancies_allocation_key/);
    assert.match(labelsMigration, /check \(source in \('CONFIRMATION', 'ISSUE'\)\)/);
    assert.match(
      labelsMigration,
      /inventory_discrepancies_allocation_source_key\s+on public\.inventory_discrepancies \(allocation_id, source\)/,
    );
    assert.match(discrepancyService, /^\s+source,\s*$/m);
  });

  it('grants backend-only reads required by current PostgREST authorization and embeds', () => {
    for (const table of [
      'users',
      'roles',
      'user_roles',
      'permissions',
      'role_permissions',
      'orders',
      'order_items',
      'order_item_allocations',
      'inventory_discrepancies',
      'stock_balances',
      'stock_transactions',
    ]) {
      assert.match(
        serviceRoleGrantMigration,
        new RegExp(`grant select on table public\\.${table} to service_role`, 'i'),
      );
    }
    assert.doesNotMatch(serviceRoleGrantMigration, /to anon|to authenticated/i);
  });
});

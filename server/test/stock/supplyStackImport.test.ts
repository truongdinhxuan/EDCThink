import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const migration = read('supabase/migrations/20260822135035_supply_stack_import.sql');
const phaseOneMigration = read('supabase/migrations/20260822131844_supply_stack_foundation.sql');
const locationFree = read('supabase/migrations/20260924010100_stock_location_free_rpcs.sql');
const currentAdjustment = locationFree.slice(
  locationFree.indexOf('create or replace function public.apply_stock_adjustment_v5'),
  locationFree.indexOf('revoke all on function public.apply_stock_adjustment_v5'),
);
const adjustmentService = read('src/services/stock-adjustments.service.ts');
const adjustmentSchema = read('src/schemas/stock.ts');
const balanceService = read('src/services/stock-balances.service.ts');
const transactionService = read('src/services/stock-transactions.service.ts');

describe('Supply stack Phase 2 IMPORT contract', () => {
  it('adds nullable immutable-ledger metadata and keeps v3 historical', () => {
    for (const field of [
      'set_per_qty',
      'stack_quantity',
      'before_stack_quantity',
      'after_stack_quantity',
    ]) {
      assert.match(migration, new RegExp(`add column ${field} numeric`, 'i'));
    }
    assert.match(migration, /create or replace function public\.apply_stock_adjustment_v4/i);
    assert.doesNotMatch(migration, /create or replace function public\.apply_stock_adjustment_v3/i);
    assert.doesNotMatch(migration, /disable trigger|update public\.stock_transactions|delete from public\.stock_transactions/i);
  });

  it('resolves the category from Supply and enables stack mode only for KIEN_SAT_TC IMPORT', () => {
    assert.match(migration, /join public\.supply_categories sc on sc\.id = s\.category_id/);
    assert.match(migration, /v_is_stack_supply := v_category_code = 'KIEN_SAT_TC'/);
    assert.match(migration, /if v_type\.code <> 'IMPORT'/);
    assert.match(migration, /Stack operation not supported for this transaction type/);
    assert.doesNotMatch(adjustmentService, /category_code|is_stack/);
  });

  it('calculates the authoritative total and rejects client mismatches', () => {
    assert.match(migration, /v_delta_quantity := p_stack_quantity \* p_set_per_qty/);
    assert.match(migration, /p_quantity <> v_delta_quantity/);
    assert.match(migration, /Quantity mismatch/);
    assert.match(migration, /total_set_quantity = v_after_quantity/);
    assert.match(migration, /quantity = v_after_quantity/);
  });

  it('uses the full stack dimension, upsert plus row lock for concurrency safety', () => {
    assert.match(
      phaseOneMigration,
      /create unique index stock_balances_stack_identity_key[\s\S]*provider_id[\s\S]*set_per_qty/i,
    );
    assert.match(migration, /on conflict \([\s\S]*provider_id,[\s\S]*set_per_qty[\s\S]*\)[\s\S]*do nothing/i);
    assert.match(migration, /sb\.set_per_qty = p_set_per_qty[\s\S]*for update/i);
    assert.match(migration, /v_after_stack_quantity := v_before_stack_quantity \+ p_stack_quantity/);
  });

  it('does not merge a stack row into legacy or normal NULL stack balances', () => {
    assert.match(migration, /and sb\.set_per_qty = p_set_per_qty/);
    assert.match(migration, /and sb\.set_per_qty is null[\s\S]*for update/i);
    assert.match(migration, /where set_per_qty is null and is_deleted = false/);
  });

  it('validates Provider, Area, location labels and reason inside the same RPC (v5)', () => {
    assert.match(currentAdjustment, /from public\.supply_providers sp/);
    assert.match(currentAdjustment, /Provider not valid for Supply/);
    assert.match(currentAdjustment, /adjustment_reason_id or reason_note is required/);
    assert.match(currentAdjustment, /public\.has_permission\(p_created_by, 'supply\.stock\.adjust'\)/);
    // Labels are checked against the Area in the helper v5 calls.
    assert.match(currentAdjustment, /perform public\.attach_stock_balance_locations\(/);
    assert.match(locationFree, /location\.area_id = p_area_id/);
    assert.match(locationFree, /StorageLocation not in Area/);
  });

  it('routes the API through v5 and exposes stack fields in response selects', () => {
    assert.match(adjustmentService, /rpc\('apply_stock_adjustment_v5'/);
    assert.match(adjustmentService, /p_stack_quantity: body\.stack_quantity \?\? null/);
    assert.match(adjustmentService, /p_set_per_qty: body\.set_per_qty \?\? null/);
    assert.match(adjustmentSchema, /stack_quantity: \{ type: 'integer', minimum: 1 \}/);
    assert.match(adjustmentSchema, /set_per_qty: \{ type: 'integer', minimum: 1 \}/);
    assert.match(balanceService, /set_per_qty, stack_quantity, total_set_quantity/);
    assert.match(transactionService, /set_per_qty, stack_quantity, before_stack_quantity, after_stack_quantity/);
  });

  it('restricts direct RPC execution to the backend service role', () => {
    assert.match(migration, /security definer[\s\S]*set search_path = ''/i);
    assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/i);
    assert.match(migration, /grant execute[\s\S]*to service_role/i);
  });
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const balanceRoutes = read('src/routes/stock-balances/index.ts');
const transactionRoutes = read('src/routes/stock-transactions/index.ts');
const adjustmentRoutes = read('src/routes/stock-adjustments/index.ts');
const adjustmentService = read('src/services/stock-adjustments.service.ts');
const migration = read('supabase/migrations/202608050001_provider_foundation.sql');
const stackImportMigration = read('supabase/migrations/20260822135035_supply_stack_import.sql');

describe('Phase 3 stock API contracts', () => {
  it('keeps StockBalance quantities read-only and routes mutations through adjustments', () => {
    assert.equal((balanceRoutes.match(/fastify\.get\(/g) ?? []).length, 3);
    assert.doesNotMatch(balanceRoutes, /fastify\.(?:post|patch|delete)\(/);
    // The one write is relabelling where a code sits; it carries no quantity.
    assert.equal((balanceRoutes.match(/fastify\.put\(/g) ?? []).length, 1);
    assert.match(balanceRoutes, /fastify\.put\(\s*'\/:id\/locations'/);
    assert.equal((adjustmentRoutes.match(/fastify\.post\(/g) ?? []).length, 1);
  });

  it('keeps StockTransactions immutable at the HTTP layer', () => {
    assert.equal((transactionRoutes.match(/fastify\.get\(/g) ?? []).length, 2);
    assert.doesNotMatch(transactionRoutes, /fastify\.(?:post|patch|delete)\(/);
  });

  it('guards stock endpoints by permission code', () => {
    assert.match(balanceRoutes, /PERMISSION_CODE\.SUPPLY_STOCK_READ/);
    assert.match(transactionRoutes, /PERMISSION_CODE\.SUPPLY_STOCK_READ/);
    assert.match(adjustmentRoutes, /PERMISSION_CODE\.SUPPLY_STOCK_ADJUST/);
    assert.doesNotMatch(
      [balanceRoutes, transactionRoutes, adjustmentRoutes].join('\n'),
      /verifyTokenAndRole|role\s*===/,
    );
  });

  it('calls one atomic RPC instead of writing balance and transaction separately', () => {
    assert.equal(
      (adjustmentService.match(/\.rpc\(['"]apply_stock_adjustment_v5['"]/g) ?? []).length,
      1,
    );
    assert.doesNotMatch(adjustmentService, /\.from\(['"]stock_balances['"]\)/);
    assert.doesNotMatch(adjustmentService, /\.from\(['"]stock_transactions['"]\)/);
  });

  it('uses the stack-capable v4 RPC without rewriting the historical v3 migration', () => {
    assert.match(stackImportMigration, /create or replace function public\.apply_stock_adjustment_v4/i);
    assert.match(stackImportMigration, /for update/i);
    assert.match(stackImportMigration, /insert into public\.stock_transactions/i);
    assert.match(stackImportMigration, /before_stack_quantity/i);
    assert.match(stackImportMigration, /after_stack_quantity/i);
  });

  it('locks the balance and records exact before/after values atomically', () => {
    assert.match(migration, /create or replace function public\.apply_stock_adjustment_v3/i);
    assert.match(migration, /for update/i);
    assert.match(migration, /update public\.stock_balances[\s\S]*set quantity = v_after/i);
    assert.match(migration, /insert into public\.stock_transactions/i);
    assert.match(migration, /v_before/);
    assert.match(migration, /v_after/);
    assert.match(migration, /Insufficient stock/i);
    assert.match(migration, /adjustment_reason_id or reason_note is required/i);
  });

  it('restricts the RPC to the service role', () => {
    assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/i);
    assert.match(migration, /grant execute[\s\S]*to service_role/i);
  });
});

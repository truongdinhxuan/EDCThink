import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const providerFoundation = read(
  'supabase/migrations/202608050001_provider_foundation.sql',
);
const orderRuntime = read(
  'supabase/migrations/202608050003_provider_stock_order_runtime.sql',
);
const stackImport = read(
  'supabase/migrations/20260822135035_supply_stack_import.sql',
);
const directPendingOrder = read(
  'supabase/migrations/20260909173958_create_order_direct_pending.sql',
);
const balanceService = read('src/services/stock-balances.service.ts');
const transactionService = read('src/services/stock-transactions.service.ts');
const adjustmentService = read('src/services/stock-adjustments.service.ts');
const orderService = read('src/services/orders.service.ts');
const stockSchema = read('src/schemas/stock.ts');
const orderSchema = read('src/schemas/orders.ts');

describe('Provider-scoped StockBalance contract', () => {
  it('uses Provider in the composite balance identity', () => {
    assert.match(
      providerFoundation,
      /unique \(supply_id, provider_id, area_id, storage_location_id\)/i,
    );
    assert.match(
      providerFoundation,
      /on conflict \(supply_id, provider_id, area_id, storage_location_id\)/i,
    );
  });

  it('returns and filters Provider on StockBalances', () => {
    assert.match(balanceService, /id, supply_id, provider_id, area_id/);
    assert.match(
      balanceService,
      /provider:providers!stock_balances_provider_id_fkey/,
    );
    assert.match(balanceService, /query\.providerId \?\? query\.provider_id/);
    assert.match(balanceService, /\.eq\('provider_id', providerId\)/);
    assert.match(stockSchema, /providerId: uuid/);
  });
});

describe('Provider-aware atomic stock adjustment contract', () => {
  it('requires and passes provider_id to the provider-aware RPC', () => {
    assert.match(
      stockSchema,
      /required:[\s\S]*'supply_id',[\s\S]*'provider_id',[\s\S]*'area_id'/,
    );
    assert.match(adjustmentService, /rpc\('apply_stock_adjustment_v4'/);
    assert.match(adjustmentService, /p_provider_id: body\.provider_id/);
  });

  it('keeps Provider in the complete stack balance identity', () => {
    assert.match(
      stackImport,
      /on conflict \([\s\S]*supply_id,[\s\S]*provider_id,[\s\S]*area_id,[\s\S]*storage_location_id,[\s\S]*set_per_qty[\s\S]*\)/i,
    );
    assert.match(stackImport, /sp\.provider_id = p_provider_id/);
  });

  it('validates active Supply-Provider relation inside the transaction', () => {
    assert.match(
      providerFoundation,
      /from public\.supply_providers sp[\s\S]*sp\.supply_id = p_supply_id[\s\S]*sp\.provider_id = p_provider_id/,
    );
    assert.match(providerFoundation, /p\.is_active = true/);
    assert.match(providerFoundation, /p\.is_deleted = false/);
    assert.match(providerFoundation, /for update/);
    assert.match(
      providerFoundation,
      /insert into public\.stock_transactions \([\s\S]*provider_id/,
    );
  });

  it('keeps UNKNOW valid only through a normal active relation', () => {
    assert.match(providerFoundation, /where p\.code = 'UNKNOW'/);
    assert.doesNotMatch(adjustmentService, /unknown_provider_id/);
    assert.match(
      orderRuntime,
      /drop trigger if exists stock_balances_assign_unknown_provider/,
    );
    assert.match(
      orderRuntime,
      /drop trigger if exists order_items_assign_unknown_provider/,
    );
    assert.match(
      orderRuntime,
      /drop trigger if exists stock_transactions_assign_unknown_provider/,
    );
  });
});

describe('Provider-aware immutable StockTransaction contract', () => {
  it('returns and filters Provider on transactions', () => {
    assert.match(transactionService, /id, supply_id, provider_id, area_id/);
    assert.match(
      transactionService,
      /provider:providers!stock_transactions_provider_id_fkey/,
    );
    assert.match(transactionService, /query\.providerId \?\? query\.provider_id/);
    assert.match(transactionService, /\.eq\('provider_id', providerId\)/);
  });

  it('does not add update or delete transaction code', () => {
    const routes = read('src/routes/stock-transactions/index.ts');
    assert.equal((routes.match(/fastify\.get\(/g) ?? []).length, 2);
    assert.doesNotMatch(routes, /fastify\.(?:patch|delete)\(/);
  });
});

describe('Provider-aware atomic OrderItem contract', () => {
  it('requires provider_id for every create or replacement item', () => {
    assert.match(
      orderSchema,
      /required: \['supply_id', 'provider_id', 'quantity_requested'\]/,
    );
    assert.match(orderService, /provider_id is required/);
    assert.match(orderService, /from\('supply_providers'\)/);
    assert.match(orderService, /provider\.is_active/);
    assert.match(orderService, /provider\.is_deleted/);
  });

  it('creates Order and all OrderItems in one RPC without compensation delete', () => {
    assert.match(orderService, /rpc\(\s*'create_pending_order_with_items'/);
    assert.doesNotMatch(
      orderService,
      /async create[\s\S]*from\('orders'\)[\s\S]*\.insert\(/,
    );
    assert.doesNotMatch(orderService, /await this\.db\.from\('orders'\)\.delete/);
    assert.match(
      directPendingOrder,
      /insert into public\.orders[\s\S]*returning id into v_order_id/,
    );
    assert.match(
      directPendingOrder,
      /insert into public\.order_items[\s\S]*v_order_id,[\s\S]*provider_id/,
    );
  });

  it('validates every Provider before inserting the OrderItem', () => {
    assert.match(
      orderRuntime,
      /from public\.supply_providers sp[\s\S]*sp\.provider_id = v_provider_id/,
    );
    assert.match(orderRuntime, /p\.is_active = true/);
    assert.match(orderRuntime, /p\.is_deleted = false/);
    assert.match(orderRuntime, /sp\.is_active = true/);
    assert.match(orderRuntime, /sp\.is_deleted = false/);
  });

  it('returns Provider on every Order detail item', () => {
    assert.match(
      orderService,
      /provider:providers!order_items_provider_id_fkey\([\s\S]*id, code, name, description/,
    );
  });

  it('keeps stock availability separated by Supply and Provider', () => {
    assert.match(orderService, /availableByDimension/);
    assert.match(
      orderService,
      /`\$\{balance\.supply_id\}:\$\{balance\.provider_id\}:\$\{stackDimension\}`/,
    );
    assert.match(
      orderService,
      /`\$\{item\.supply_id\}:\$\{item\.provider_id\}:\$\{stackDimension\}`/,
    );
  });
});

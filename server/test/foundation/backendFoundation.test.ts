import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  ORDER_STATUSES,
  STOCK_TRANSACTION_TYPES,
} from '../../src/domain/enums';
import { PERMISSION_CODE } from '../../src/domain/permission-codes';

const migration = [
  '202607200003_backend_foundation.sql',
  '202607290001_lookup_master_data_foundation.sql',
  '202608050001_provider_foundation.sql',
  '202608050002_supply_provider_rpc.sql',
  '202608050003_provider_stock_order_runtime.sql',
].map((file) => readFileSync(
  resolve(process.cwd(), 'supabase/migrations', file),
  'utf8',
)).join('\n');
const databaseInterfaces = readFileSync(
  resolve(process.cwd(), 'src/interfaces/database.ts'),
  'utf8',
);
const corsPlugin = readFileSync(
  resolve(process.cwd(), 'src/plugins/cors.ts'),
  'utf8',
);

const interfaceProperties = (name: string): string[] => {
  const block = databaseInterfaces.match(
    new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`),
  )?.[1];
  assert.ok(block, `${name} must exist`);
  return [...block.matchAll(/^\s+(\w+):/gm)].map((match) => match[1]);
};

describe('Phase 1 backend foundation', () => {
  it('uses lookup codes for workflow values without a hard-coded role list', () => {
    assert.deepEqual(ORDER_STATUSES, [
      'PENDING',
      'APPROVED',
      'REJECTED',
      'PARTIAL_ISSUED',
      'ISSUED',
      'RECEIVED',
      'COMPLETED',
      'CANCELLED',
    ]);
    assert.deepEqual(STOCK_TRANSACTION_TYPES, [
      'ISSUE',
      'RECEIVE',
      'ADJUSTMENT_IN',
      'ADJUSTMENT_OUT',
      'TRANSFER_IN',
      'TRANSFER_OUT',
      'IMPORT',
      'EXPORT',
      'REVERSAL_IN',
      'REVERSAL_OUT',
      'DISCREPANCY_CORRECTION',
    ]);
  });

  it('defines stable permission codes for backend authorization', () => {
    assert.equal(PERMISSION_CODE.ADMIN_USER_READ, 'admin.user.read');
    assert.equal(PERMISSION_CODE.ADMIN_ROLE_UPDATE, 'admin.role.update');
    assert.equal(PERMISSION_CODE.SUPPLY_STOCK_READ, 'supply.stock.read');
    assert.equal(PERMISSION_CODE.SUPPLY_STOCK_ADJUST, 'supply.stock.adjust');
    assert.equal(PERMISSION_CODE.SUPPLY_ORDER_CREATE, 'supply.order.create');
    assert.equal(PERMISSION_CODE.SUPPLY_ORDER_APPROVE, 'supply.order.approve');
  });

  it('defines exact record fields for all requested foundation models', () => {
    assert.deepEqual(interfaceProperties('RoleRecord'), [
      'id', 'code', 'name', 'description', 'is_system', 'is_active',
      'is_deleted', 'created_at', 'updated_at',
    ]);
    assert.deepEqual(interfaceProperties('AreaRecord'), [
      'id', 'code', 'name', 'description', 'area_type_id', 'is_active', 'is_deleted',
      'created_at', 'updated_at',
    ]);
    assert.deepEqual(interfaceProperties('UserRecord'), [
      'id', 'vinfast_id', 'email', 'phone_number', 'avatar_url', 'role_id',
      'area_id', 'managed_by_user_id', 'is_active', 'is_verified', 'is_deleted',
      'created_at', 'updated_at', 'first_name', 'last_name',
    ]);
    assert.deepEqual(interfaceProperties('SupplyCategoryRecord'), [
      'id', 'code', 'name', 'description', 'is_active', 'created_at', 'updated_at',
      'is_deleted',
    ]);
    assert.deepEqual(interfaceProperties('UnitRecord'), [
      'id', 'code', 'symbol', 'name', 'description', 'is_active',
      'updated_at', 'created_at',
      'is_deleted',
    ]);
    assert.deepEqual(interfaceProperties('SupplyRecord'), [
      'id', 'code', 'short_text', 'translation_text', 'description',
      'category_id', 'unit_id', 'min_stock',
      'max_stock', 'safety_stock', 'image_url', 'is_active', 'is_deleted',
      'created_at', 'updated_at',
    ]);
    assert.deepEqual(interfaceProperties('ProviderRecord'), [
      'id', 'code', 'name', 'description', 'is_active', 'is_deleted',
      'created_at', 'updated_at',
    ]);
    assert.deepEqual(interfaceProperties('SupplyProviderRecord'), [
      'id', 'supply_id', 'provider_id', 'is_active', 'is_deleted',
      'created_at', 'updated_at',
    ]);
    assert.deepEqual(interfaceProperties('StorageLocationRecord'), [
      'id', 'code', 'area_id', 'name', 'description', 'is_active',
      'is_deleted', 'created_at', 'updated_at',
    ]);
    // No storage_location_id: since 20260924010000 a location is a label in
    // stock_balance_locations, not part of the row that holds the quantity.
    assert.deepEqual(interfaceProperties('StockBalanceRecord'), [
      'id', 'supply_id', 'provider_id', 'area_id', 'quantity',
      'set_per_qty', 'stack_quantity', 'total_set_quantity',
      'is_active', 'is_deleted', 'created_at', 'updated_at',
    ]);
    assert.deepEqual(interfaceProperties('StockBalanceLocationRecord'), [
      'stock_balance_id', 'storage_location_id', 'area_id', 'created_by', 'created_at',
    ]);
    assert.deepEqual(interfaceProperties('OrderItemRecord'), [
      'id', 'order_id', 'supply_id', 'provider_id', 'unit_id',
      'quantity_requested', 'set_per_qty', 'requested_stack_quantity',
      'requested_total_set_quantity', 'quantity_approved', 'quantity_issued', 'note',
      'is_active', 'is_deleted', 'created_at', 'updated_at',
    ]);
    assert.deepEqual(interfaceProperties('StockTransactionRecord'), [
      'id', 'supply_id', 'provider_id', 'area_id', 'storage_location_id', 'order_id',
      'order_item_id', 'inventory_discrepancy_id', 'transaction_type_id', 'quantity', 'before_quantity',
      'after_quantity', 'set_per_qty', 'stack_quantity', 'before_stack_quantity',
      'after_stack_quantity', 'reason_id', 'reason_note', 'note', 'created_by',
      'is_active', 'is_deleted', 'created_at', 'updated_at',
    ]);
  });

  it('enforces all requested unique keys without deleting data', () => {
    for (const indexName of [
      'roles_code_key',
      'areas_code_key',
      'supply_categories_code_key',
      'units_code_key',
      'supplies_code_key',
      'storage_locations_area_code_key',
    ]) {
      assert.match(migration, new RegExp(`unique index if not exists ${indexName}`, 'i'));
    }
    assert.match(
      migration,
      /constraint stock_balances_supply_provider_area_location_key[\s\S]*unique \(supply_id, provider_id, area_id, storage_location_id\)/i,
    );
    assert.match(
      migration,
      /drop constraint if exists stock_balances_supply_area_location_key/i,
    );
    assert.doesNotMatch(migration, /\btruncate\s+/i);
  });

  it('enforces location and area consistency for stock records', () => {
    assert.match(migration, /stock_balances_location_area_fkey/i);
    assert.match(migration, /stock_transactions_location_area_fkey/i);
    assert.match(migration, /validate constraint stock_balances_location_area_fkey/i);
    assert.match(migration, /validate constraint stock_transactions_location_area_fkey/i);
  });

  it('cuts over legacy database enums to lookup foreign keys', () => {
    assert.match(
      migration,
      /alter table public\.roles drop column if exists role_name/i,
    );
    assert.match(
      migration,
      /alter table public\.orders drop column if exists status/i,
    );
    assert.match(
      migration,
      /alter table public\.stock_transactions drop column if exists type/i,
    );
    for (const typeName of [
      'role_name',
      'order_status',
      'stock_transaction_type',
    ]) {
      assert.match(
        migration,
        new RegExp(`drop type if exists public\\.${typeName}`, 'i'),
      );
    }
  });

  it('allows PATCH through CORS for existing and future API routes', () => {
    assert.match(corsPlugin, /methods:\s*\[[^\]]*'PATCH'/s);
  });
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(__dirname, '..', '..');
const migration = readFileSync(join(
  root,
  'supabase',
  'migrations',
  '20260826170000_supply_shift_order_sheets.sql',
), 'utf8');
const directPendingMigration = readFileSync(join(
  root,
  'supabase',
  'migrations',
  '20260909173958_create_order_direct_pending.sql',
), 'utf8');
const draftRemovalMigration = readFileSync(join(
  root,
  'supabase',
  'migrations',
  '20260911031203_remove_order_draft_status.sql',
), 'utf8');
const orderService = readFileSync(join(root, 'src', 'services', 'orders.service.ts'), 'utf8');
const sheetService = readFileSync(join(root, 'src', 'services', 'shift-order-sheets.service.ts'), 'utf8');
const sheetExporter = readFileSync(join(root, 'src', 'services', 'shift-order-sheet-exporter.ts'), 'utf8');
const sheetRoutes = readFileSync(join(root, 'src', 'routes', 'supply', 'shift-order-sheets', 'index.ts'), 'utf8');

test('Phase 9 migration uses workbook sheet identity and canonical timezone', () => {
  assert.match(migration, /create table public\.supply_shift_order_sheets/);
  assert.match(migration, /\(area_id, work_shift_id, work_date\)/);
  assert.match(migration, /where is_deleted = false/);
  assert.match(migration, /Asia\/Ho_Chi_Minh/g);
  assert.match(migration, /orders_shift_order_sheet_id_fkey/);
  assert.doesNotMatch(migration, /date\s*\(\s*created_at\s*\)/i);
});

test('Atomic PENDING create guards zero stock without reservation or stock mutation', () => {
  assert.match(directPendingMigration, /create or replace function public\.create_pending_order_with_items/);
  assert.match(directPendingMigration, /ORDER_ITEM_ZERO_STOCK/);
  assert.match(directPendingMigration, /sum\(balance\.stack_quantity\)/);
  assert.match(directPendingMigration, /balance\.set_per_qty = \(v_item ->> 'set_per_qty'\)::numeric/);
  assert.match(directPendingMigration, /sum\(balance\.quantity\)/);
  assert.doesNotMatch(directPendingMigration, /update public\.stock_balances/i);
  assert.doesNotMatch(directPendingMigration, /insert into public\.stock_transactions/i);
  assert.doesNotMatch(
    directPendingMigration,
    /reserved_quantity|(?:insert into|update|delete from)\s+[^;]*reserv/i,
  );
});

test('Order service creates PENDING atomically and legacy submit is removed', () => {
  assert.match(orderService, /rpc\(\s*'create_pending_order_with_items'/);
  assert.doesNotMatch(orderService, /submit_order_to_pending|async submit\(/);
  assert.match(draftRemovalMigration, /drop function if exists public\.submit_order_to_pending/);
});

test('Shift sheet queries are paginated, scoped and relation-based', () => {
  assert.match(sheetService, /parsePagination/);
  assert.match(sheetService, /\.range\(pagination\.from, pagination\.to\)/);
  assert.match(sheetService, /orders!orders_shift_order_sheet_id_fkey/);
  assert.match(sheetService, /getEffectiveAreaTypeScopes\(\)/);
  assert.match(sheetService, /request = request\.in\('area_id', scopedAreaIds\)/);
  assert.match(sheetService, /order_items\([\s\S]*supply:supplies!/);
  assert.match(sheetService, /provider:providers!order_items_provider_id_fkey/);
  assert.match(sheetService, /unit:units!order_items_unit_id_fkey/);
});

test('Current Shift Sheet resolves authenticated Area and canonical work shift instance', () => {
  assert.match(sheetRoutes, /fastify\.get\('\/current'/);
  assert.match(sheetService, /resolve_user_work_shift_instance/);
  assert.match(sheetService, /p_user_id: actor\.id/);
  assert.match(sheetService, /\.eq\('area_id', actor\.areaId\)/);
  assert.match(sheetService, /\.eq\('work_shift_id', shift\.work_shift_id\)/);
  assert.match(sheetService, /\.eq\('work_date', shift\.work_date\)/);
  assert.match(sheetService, /return \{ context, sheet: null \}/);
  assert.doesNotMatch(sheetService, /new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/);
});

test('Phase 10 export reuses Sheet read guard and relational historical data', () => {
  assert.match(sheetRoutes, /\/:id\/export/);
  assert.match(sheetRoutes, /preHandler:\s*readPermission/);
  assert.match(sheetService, /await this\.assertReadable\(actor, row\)/g);
  assert.match(
    sheetRoutes,
    /requirePermission\(PERMISSION_CODE\.SUPPLY_SHIFT_ORDER_SHEET_READ\)/,
  );
  assert.match(sheetService, /orders!orders_shift_order_sheet_id_fkey/);
  assert.match(sheetService, /category:supply_categories!supplies_category_id_fkey/);
  assert.match(sheetService, /provider:providers!order_items_provider_id_fkey/);
  assert.doesNotMatch(sheetService, /stock_balances/);
  assert.doesNotMatch(sheetService, /stock_transactions/);
  assert.doesNotMatch(sheetService, /\.insert\(|\.update\(|\.delete\(/);
});

test('Phase 10 exporter follows exact workbook fields and does not mutate business data', () => {
  for (const header of [
    'Mã hàng', 'Tên mã', 'Số lượng', 'Số chồng',
    'Nhà cung cấp', 'Giờ order', 'Giờ nhận hàng', 'Note',
  ]) assert.match(sheetExporter, new RegExp(header));
  assert.match(sheetExporter, /quantity_issued/);
  assert.match(sheetExporter, /quantity_requested/);
  assert.match(sheetExporter, /requested_stack_quantity/);
  assert.match(sheetExporter, /Asia\/Ho_Chi_Minh/);
  assert.match(sheetExporter, /order\.submitted_at/);
  assert.match(sheetExporter, /order\.issued_at/);
  assert.doesNotMatch(sheetExporter, /received_at|StockBalance|StockTransaction/);
});

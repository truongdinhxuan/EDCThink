import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

const guardMigration = read(
  'supabase/migrations/20260915094500_order_shift_window_guard.sql',
);
const resolverMigration = read(
  'supabase/migrations/20260826170000_supply_shift_order_sheets.sql',
);
const orderService = read('src/services/orders.service.ts');
const sheetService = read('src/services/shift-order-sheets.service.ts');

describe('Order creation is refused outside the work shift window', () => {
  it('raises inside the create function, before anything is written', () => {
    assert.match(guardMigration, /if v_shift\.is_overtime then/);
    assert.match(guardMigration, /ORDER_OUTSIDE_WORK_SHIFT_WINDOW/);

    // Structural, not merely textual: the refusal must precede every write in
    // the same transaction, otherwise a partial Order could survive it.
    const guardAt = guardMigration.indexOf('ORDER_OUTSIDE_WORK_SHIFT_WINDOW');
    const resolveAt = guardMigration.indexOf('resolve_user_work_shift_instance');
    assert.ok(resolveAt > -1 && guardAt > resolveAt, 'guard must follow shift resolution');

    for (const write of [
      'insert into public.orders',
      'insert into public.order_items',
      'insert into public.supply_shift_order_sheets',
    ]) {
      const writeAt = guardMigration.indexOf(write);
      assert.ok(writeAt > -1, `expected the function to still perform: ${write}`);
      assert.ok(guardAt < writeAt, `guard must precede: ${write}`);
    }
  });

  it('reuses the one shift-window implementation rather than recomputing it', () => {
    // resolve_user_work_shift_instance owns the arithmetic: work_date plus the
    // shift times, evaluated in Asia/Ho_Chi_Minh, with end_time carried to the
    // next day when the shift crosses midnight.
    assert.match(resolverMigration, /v_local_at := p_at at time zone 'Asia\/Ho_Chi_Minh'/);
    assert.match(
      resolverMigration,
      /case when v_shift\.crosses_midnight then 1 else 0 end/,
    );
    assert.match(
      resolverMigration,
      /p_at < \(v_start_local at time zone 'Asia\/Ho_Chi_Minh'\)[\s\S]*?or p_at >= \(v_end_local at time zone 'Asia\/Ho_Chi_Minh'\)/,
    );
    // The guard must not re-derive the window with its own date maths.
    assert.doesNotMatch(guardMigration, /is_overtime\s*:=|v_shift_window|now\(\)\s*at time zone/);
  });

  it('maps the refusal to 403 with the operator-facing wording', () => {
    assert.match(
      orderService,
      /export const ORDER_OUTSIDE_WORK_SHIFT_MESSAGE =\s*\n?\s*'Không thể tạo Order do đã ngoài thời gian quy định của ca làm việc\.'/,
    );
    assert.match(
      orderService,
      /ORDER_OUTSIDE_WORK_SHIFT_WINDOW: \{\s*status: 403,\s*message: ORDER_OUTSIDE_WORK_SHIFT_MESSAGE,/,
    );
  });

  it('fails fast in the service against the same instant the write uses', () => {
    assert.match(orderService, /private async assertWithinWorkShiftWindow\(/);
    // One timestamp is produced, then handed to both the pre-check and the RPC,
    // so the two can never land on opposite sides of the shift boundary.
    assert.match(
      orderService,
      /const submittedAt = new Date\(\)\.toISOString\(\);\s*\n\s*await this\.assertWithinWorkShiftWindow\(actor\.id, submittedAt\);/,
    );
    assert.match(orderService, /p_submitted_at: submittedAt/);
    // The pre-check runs before the per-item stock reads are spent.
    const checkAt = orderService.indexOf('await this.assertWithinWorkShiftWindow');
    const itemsAt = orderService.indexOf('await this.prepareOrderItems(body.order_list');
    assert.ok(checkAt > -1 && itemsAt > checkAt, 'pre-check must precede item preparation');
  });

  it('surfaces the verdict to the current Sheet so the UI can lock itself', () => {
    assert.match(sheetService, /is_outside_working_hours: shift\.is_overtime/);
  });
});

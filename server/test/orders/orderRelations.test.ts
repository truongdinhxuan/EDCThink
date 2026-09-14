import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const orderService = readFileSync(
  resolve(process.cwd(), 'src/services/orders.service.ts'),
  'utf8',
);

describe('order relation response contract', () => {
  it('loads order areas and users in the same Supabase query', () => {
    assert.match(orderService, /from_area:areas!orders_from_area_id_fkey/);
    assert.match(orderService, /to_area:areas!orders_to_area_id_fkey/);
    assert.match(orderService, /requester:users!orders_requested_by_fkey/);
    assert.match(orderService, /approver:users!orders_approved_by_fkey/);
    assert.match(orderService, /forklift:users!orders_forklift_by_fkey/);
    assert.match(orderService, /taken_away:users!orders_taken_away_by_fkey/);
  });

  it('loads order item supply, Provider and unit relations for detail responses', () => {
    assert.match(
      orderService,
      /order_items\([\s\S]*supply:supplies!order_items_supply_id_fkey/,
    );
    assert.match(
      orderService,
      /order_items\([\s\S]*provider:providers!order_items_provider_id_fkey/,
    );
    assert.match(
      orderService,
      /order_items\([\s\S]*unit:units!order_items_unit_id_fkey/,
    );
  });

  it('uses the relation projections for both list and detail queries', () => {
    assert.match(orderService, /\.select\(ORDER_DETAIL_SELECT\)/);
    assert.match(
      orderService,
      /\.select\(\s*query\.workShiftId[\s\S]*?ORDER_LIST_SELECT,[\s\S]*?\{\s*count:\s*'exact'\s*\}/,
    );
    const findOrderBlock =
      orderService.match(
        /private async findOrder[\s\S]*?private assertPackingOwner/,
      )?.[0] ?? '';
    assert.doesNotMatch(findOrderBlock, /\.from\('areas'\)/);
  });
});

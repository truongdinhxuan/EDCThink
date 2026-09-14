import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { OrderService, type OrderActor } from '../../src/services/orders.service';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

interface QueryTrace {
  select: string;
  exactCount: boolean;
  filters: Array<[string, unknown]>;
  range: [number, number] | null;
}

const createService = () => {
  const trace: QueryTrace = {
    select: '',
    exactCount: false,
    filters: [],
    range: null,
  };
  const builder = {
    select(columns: string, options?: { count?: string }) {
      trace.select = columns;
      trace.exactCount = options?.count === 'exact';
      return this;
    },
    eq(column: string, value: unknown) {
      trace.filters.push([column, value]);
      return this;
    },
    or() { return this; },
    gte() { return this; },
    lte() { return this; },
    lt() { return this; },
    order() { return this; },
    async range(from: number, to: number) {
      trace.range = [from, to];
      return { data: [], error: null, count: 0 };
    },
  };
  const fastify = {
    supabaseAdmin: {
      from(table: string) {
        assert.equal(table, 'orders');
        return builder;
      },
    },
  } as unknown as FastifyInstance;
  return { service: new OrderService(fastify), trace };
};

const actor: OrderActor = {
  id: '10000000-0000-4000-8000-000000000001',
  areaId: '20000000-0000-4000-8000-000000000001',
  permissions: [],
  isSystemAdmin: true,
};

describe('Order History Work Shift filter', () => {
  it('keeps the left embedded Shift Sheet relation when no filter is supplied', async () => {
    const { service, trace } = createService();

    const response = await service.list(actor, { page: 1, pageSize: 20 });

    assert.equal(response.pagination.total, 0);
    assert.match(
      trace.select,
      /supply_shift_order_sheets!orders_shift_order_sheet_id_fkey/,
    );
    assert.doesNotMatch(trace.select, /supply_shift_order_sheets!inner/);
    assert.equal(
      trace.filters.some(([column]) => column === 'shift_order_sheet.work_shift_id'),
      false,
    );
  });

  it('uses an inner embedded relation so filtering happens before exact count and range', async () => {
    const workShiftId = '30000000-0000-4000-8000-000000000001';
    const { service, trace } = createService();

    await service.list(actor, {
      page: 2,
      pageSize: 20,
      workShiftId,
      search: 'ORD',
      areaId: actor.areaId,
    });

    assert.match(trace.select, /supply_shift_order_sheets!inner/);
    assert.deepEqual(
      trace.filters.find(([column]) => column === 'shift_order_sheet.work_shift_id'),
      ['shift_order_sheet.work_shift_id', workShiftId],
    );
    assert.equal(trace.exactCount, true);
    assert.deepEqual(trace.range, [20, 39]);
  });

  it('documents and validates workShiftId as UUID in the GET /orders query schema', () => {
    const schema = read('src/schemas/orders.ts');
    const interfaces = read('src/interfaces/orders.ts');

    assert.match(interfaces, /workShiftId\?: string/);
    assert.match(schema, /workShiftId:\s*\{[\s\S]*?\.\.\.uuid/);
    assert.match(schema, /historical Work Shift linked through Shift Order Sheet/);
  });

  it('lets existing Order readers load the active Work Shift lookup without role checks', () => {
    const route = read('src/routes/shared/work-shifts/index.ts');

    assert.match(route, /ORDER_READ_PERMISSIONS/);
    assert.match(route, /requirePermission\(\{[\s\S]*?anyOf/);
    assert.doesNotMatch(route, /role\s*===|role\.name\s*===/);
  });
});

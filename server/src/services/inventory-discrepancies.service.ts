import type { FastifyInstance } from 'fastify';
import type {
  InventoryDiscrepancyListQuery,
  ResolveInventoryDiscrepancyBody,
} from '../interfaces/stock';
import {
  parsePagination,
  resolvePaginatedQueryResult,
} from '../utils/pagination';
import { stockFail, stockFailWithDetails } from './stock.helpers';
import type { StockActor } from '../interfaces/stock';
import { StockAreaAccessService } from './stock-area-access.service';

interface SupabaseErrorLike {
  code?: string;
  message?: string;
  details?: string;
}

const DISCREPANCY_SORT_FIELDS = [
  'reported_at',
  'created_at',
  'status',
] as const;

const SELECT = `
  id,
  stock_balance_id,
  order_id,
  order_item_id,
  allocation_id,
  expected_stack_quantity,
  actual_stack_quantity,
  difference_stack_quantity,
  reason,
  status,
  reported_by,
  reported_at,
  resolved_by,
  resolved_at,
  resolution_note,
  is_active,
  is_deleted,
  created_at,
  updated_at,
  reporter:users!inventory_discrepancies_reported_by_fkey(
    id, vinfast_id, first_name, last_name
  ),
  resolver:users!inventory_discrepancies_resolved_by_fkey(
    id, vinfast_id, first_name, last_name
  ),
  order:orders!inventory_discrepancies_order_fkey(id, code),
  order_item:order_items!inventory_discrepancies_order_item_fkey(
    id,
    set_per_qty,
    supply:supplies!order_items_supply_id_fkey(id, code, description),
    provider:providers!order_items_provider_id_fkey(id, code, name)
  ),
  allocation:order_item_allocations!inventory_discrepancies_allocation_fkey(
    id,
    expected_stack_quantity,
    actual_stack_quantity,
    stock_balance:stock_balances!order_item_allocations_stock_balance_fkey(
      id,
      storage_location:storage_locations!stock_balances_storage_location_id_fkey(
        id, code, name
      )
    )
  )
`;

const parseDetails = (details?: string): Record<string, unknown> | undefined => {
  if (!details) return undefined;
  try {
    const value: unknown = JSON.parse(details);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
};

const discrepancyRpcError = (error: SupabaseErrorLike): never => {
  const code = error.message ?? 'DISCREPANCY_RESOLVE_FAILED';
  const statusByCode: Record<string, number> = {
    DISCREPANCY_RESOLVE_FORBIDDEN: 403,
    DISCREPANCY_NOT_FOUND: 404,
    RESOLUTION_NOTE_REQUIRED: 400,
    DISCREPANCY_ALREADY_RESOLVED: 409,
  };
  const translated: Record<string, string> = {
    DISCREPANCY_RESOLVE_FORBIDDEN:
      'Missing supply.discrepancy.resolve permission',
    DISCREPANCY_NOT_FOUND: 'Inventory discrepancy not found',
    RESOLUTION_NOTE_REQUIRED: 'resolution_note là bắt buộc.',
    DISCREPANCY_ALREADY_RESOLVED: 'Discrepancy đã được xử lý trước đó.',
  };
  const details = parseDetails(error.details);
  const message = translated[code] ?? code;
  return stockFailWithDetails(
    statusByCode[code] ?? 400,
    message,
    details,
  );
};

export class InventoryDiscrepanciesService {
  private readonly areaAccess: StockAreaAccessService;

  constructor(
    private readonly fastify: FastifyInstance,
    actor: StockActor,
  ) {
    this.areaAccess = new StockAreaAccessService(fastify, actor);
  }

  private get db() {
    return this.fastify.supabaseAdmin;
  }

  /**
   * A discrepancy is an attribute of one stock balance, so it inherits that
   * balance's Area. Resolving the Area from the balance keeps the rule in one
   * place instead of re-deriving it from the discrepancy row.
   */
  private async areaOfBalance(stockBalanceId: string): Promise<string> {
    const { data, error } = await this.db
      .from('stock_balances')
      .select('area_id')
      .eq('id', stockBalanceId)
      .single();
    if (error || !data) return stockFail(404, 'Stock balance not found');
    return (data as { area_id: string }).area_id;
  }

  async listForBalance(
    stockBalanceId: string,
    query: InventoryDiscrepancyListQuery = {},
  ) {
    await this.areaAccess.assertCanRead(await this.areaOfBalance(stockBalanceId));
    const pagination = parsePagination(query, {
      allowedSortBy: DISCREPANCY_SORT_FIELDS,
      defaultSortBy: 'reported_at',
      defaultSortOrder: 'desc',
    });
    let request = this.db
      .from('inventory_discrepancies')
      .select(SELECT, { count: 'exact' })
      .eq('stock_balance_id', stockBalanceId)
      .eq('is_deleted', false);
    if (query.status) request = request.eq('status', query.status);
    request = request.order(pagination.sortBy, {
      ascending: pagination.sortOrder === 'asc',
    });
    request = request.order('id', { ascending: true });

    const { data, error, count } = await request.range(
      pagination.from,
      pagination.to,
    );
    const result = resolvePaginatedQueryResult(
      { data, error, count },
      pagination,
    );
    if (result) return result;
    return stockFail(400, error?.message ?? 'Cannot list inventory discrepancies');
  }

  async resolve(
    discrepancyId: string,
    actorId: string,
    body: ResolveInventoryDiscrepancyBody,
  ) {
    // Resolving writes to the balance's history, so it needs write access to
    // that Area, not merely the right to look at it.
    const { data: target, error: targetError } = await this.db
      .from('inventory_discrepancies')
      .select('stock_balance_id')
      .eq('id', discrepancyId)
      .single();
    if (targetError || !target) return stockFail(404, 'Inventory discrepancy not found');
    this.areaAccess.assertCanWrite(
      await this.areaOfBalance((target as { stock_balance_id: string }).stock_balance_id),
    );

    const { error } = await this.db.rpc('resolve_inventory_discrepancy', {
      p_discrepancy_id: discrepancyId,
      p_actor_id: actorId,
      p_resolution_note: body.resolution_note,
    });
    if (error) discrepancyRpcError(error);

    const { data, error: detailError } = await this.db
      .from('inventory_discrepancies')
      .select(SELECT)
      .eq('id', discrepancyId)
      .single();
    if (detailError || !data) {
      return stockFail(404, 'Inventory discrepancy not found');
    }
    return data;
  }
}

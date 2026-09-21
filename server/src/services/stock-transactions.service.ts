import type { FastifyInstance } from 'fastify';
import type { StockActor, StockTransactionListQuery } from '../interfaces/stock';
import { STOCK_TRANSACTION_SORT_FIELDS } from '../schemas/stock';
import { createPaginatedResult, parsePagination, resolvePaginatedQueryResult } from '../utils/pagination';
import {
  normalizeDateBoundary,
  stockDatabaseError,
  stockFail,
} from './stock.helpers';
import { StockAreaAccessService } from './stock-area-access.service';
import {
  inCondition,
  resolveStockSearchReferences,
} from './stock-search';

const SELECT = `
  id, supply_id, provider_id, area_id, storage_location_id, order_id, order_item_id,
  inventory_discrepancy_id,
  transaction_type_id, reason_id, reason_note,
  quantity, before_quantity, after_quantity, reason, note, created_by,
  set_per_qty, stack_quantity, before_stack_quantity, after_stack_quantity,
  is_active, is_deleted, created_at, updated_at,
  transaction_type:stock_transaction_types!stock_transactions_transaction_type_id_fkey(
    id, code, name, effect, requires_reason
  ),
  adjustment_reason:adjustment_reasons!stock_transactions_reason_id_fkey(
    id, code, name, requires_note
  ),
  supply:supplies!stock_transactions_supply_id_fkey(id, code, short_text, description),
  order:orders!stock_transactions_order_id_fkey(id, code),
  provider:providers!stock_transactions_provider_id_fkey(
    id, code, name, description
  ),
  area:areas!stock_transactions_area_id_fkey(id, code, name),
  storage_location:storage_locations!stock_transactions_storage_location_id_fkey(id, code, name),
  creator:users!stock_transactions_created_by_fkey(id, first_name, last_name, vinfast_id)
  ,discrepancy:inventory_discrepancies!stock_transactions_inventory_discrepancy_id_fkey(
    id, allocation_id, status
  )
`;

export class StockTransactionsService {
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

  private async resolveTransactionTypeId(code: string): Promise<string> {
    const { data, error } = await this.db
      .from('stock_transaction_types')
      .select('id')
      .eq('code', code.trim().toUpperCase())
      .eq('is_active', true)
      .eq('is_deleted', false)
      .single();
    if (error || !data) stockFail(400, 'Invalid stock transaction type code');
    return (data as { id: string }).id;
  }

  async list(query: StockTransactionListQuery = {}) {
    const pagination = parsePagination(query, {
      allowedSortBy: STOCK_TRANSACTION_SORT_FIELDS,
      defaultSortBy: 'created_at',
      defaultSortOrder: 'desc',
    });
    const dateFrom = normalizeDateBoundary(
      query.dateFrom ?? query.date_from,
      'dateFrom',
    );
    const dateTo = normalizeDateBoundary(
      query.dateTo ?? query.date_to,
      'dateTo',
      true,
    );
    if (dateFrom && dateTo && dateFrom > dateTo) {
      stockFail(400, 'date_from must be before or equal to date_to');
    }

    const transactionTypeId = query.transactionTypeId
      ?? (query.type ? await this.resolveTransactionTypeId(query.type) : undefined);
    let request = this.db
      .from('stock_transactions')
      .select(SELECT, { count: 'exact' })
      .eq('is_deleted', false);

    const supplyId = query.supplyId ?? query.supply_id;
    const providerId = query.providerId ?? query.provider_id;
    // Scope first, then the caller's own filter. PostgREST ANDs the two, so an
    // areaId from the query string can only narrow this further — never widen it
    // past what the actor may read.
    const readable = await this.areaAccess.readableAreaIds();
    if (readable !== 'ALL') {
      if (readable.length === 0) return createPaginatedResult([], pagination, 0);
      request = request.in('area_id', readable);
    }

    const areaId = query.areaId ?? query.area_id;
    if (supplyId) request = request.eq('supply_id', supplyId);
    if (providerId) request = request.eq('provider_id', providerId);
    if (areaId) request = request.eq('area_id', areaId);
    if (query.storageLocationId) {
      request = request.eq('storage_location_id', query.storageLocationId);
    }
    if (query.createdBy) request = request.eq('created_by', query.createdBy);
    if (transactionTypeId) {
      request = request.eq('transaction_type_id', transactionTypeId);
    }
    if (query.order_id) request = request.eq('order_id', query.order_id);
    if (dateFrom) request = request.gte('created_at', dateFrom);
    if (dateTo) request = request.lte('created_at', dateTo);
    if (pagination.search) {
      const references = await resolveStockSearchReferences(
        this.db,
        pagination.search,
        true,
      );
      const conditions = [
        `reason.ilike.*${pagination.search}*`,
        `note.ilike.*${pagination.search}*`,
        inCondition('supply_id', references.supplyIds),
        inCondition('area_id', references.areaIds),
        inCondition('storage_location_id', references.storageLocationIds),
        inCondition('created_by', references.creatorIds),
      ].filter((condition): condition is string => Boolean(condition));
      request = request.or(conditions.join(','));
    }
    const sortBy = pagination.sortBy === 'type'
      ? 'transaction_type_id'
      : pagination.sortBy;
    request = request.order(sortBy, {
      ascending: pagination.sortOrder === 'asc',
    });
    if (sortBy !== 'id') request = request.order('id', { ascending: true });

    const { data, error, count } = await request.range(pagination.from, pagination.to);
    const result = resolvePaginatedQueryResult({ data, error, count }, pagination);
    if (result) return result;
    if (error) stockDatabaseError(error, 'Cannot list stock transactions');
    throw new Error('Unreachable pagination state');
  }

  async get(id: string) {
    const { data, error } = await this.db
      .from('stock_transactions')
      .select(SELECT)
      .eq('id', id)
      .single();
    if (error || !data) stockDatabaseError(error, 'Stock transaction not found');
    await this.areaAccess.assertCanRead((data as { area_id: string }).area_id);
    return data;
  }
}

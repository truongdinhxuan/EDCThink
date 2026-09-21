import type { FastifyInstance } from 'fastify';
import type { StockActor, StockBalanceListQuery } from '../interfaces/stock';
import { STOCK_BALANCE_SORT_FIELDS } from '../schemas/stock';
import { createPaginatedResult, parsePagination, resolvePaginatedQueryResult } from '../utils/pagination';
import { stockDatabaseError } from './stock.helpers';
import { StockAreaAccessService } from './stock-area-access.service';
import {
  inCondition,
  resolveStockSearchReferences,
} from './stock-search';

const SELECT = `
  id, supply_id, provider_id, area_id, storage_location_id, quantity,
  set_per_qty, stack_quantity, total_set_quantity,
  has_open_discrepancy,
  is_active, is_deleted, created_at, updated_at,
  supply:supplies!stock_balances_supply_id_fkey(
    id, code, short_text, description, min_stock,
    unit:units!supplies_unit_id_fkey(id, code, symbol, name),
    category:supply_categories!supplies_category_id_fkey(id, code, name)
  ),
  provider:providers!stock_balances_provider_id_fkey(
    id, code, name, description
  ),
  area:areas!stock_balances_area_id_fkey(id, code, name),
  storage_location:storage_locations!stock_balances_storage_location_id_fkey(id, code, name)
`;

export class StockBalancesService {
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

  async list(query: StockBalanceListQuery = {}) {
    const pagination = parsePagination(query, {
      allowedSortBy: STOCK_BALANCE_SORT_FIELDS,
      defaultSortBy: 'updated_at',
      defaultSortOrder: 'desc',
    });
    let request = this.db
      .from('stock_balances')
      .select(SELECT, { count: 'exact' })
      .eq('is_deleted', false);

    // Scope first, then the caller's own filter. PostgREST ANDs the two, so an
    // areaId from the query string can only narrow this further — never widen it
    // past what the actor may read.
    const readable = await this.areaAccess.readableAreaIds();
    if (readable !== 'ALL') {
      if (readable.length === 0) return createPaginatedResult([], pagination, 0);
      request = request.in('area_id', readable);
    }

    const supplyId = query.supplyId ?? query.supply_id;
    const providerId = query.providerId ?? query.provider_id;
    const areaId = query.areaId ?? query.area_id;
    const storageLocationId = query.storageLocationId ?? query.storage_location_id;
    if (supplyId) request = request.eq('supply_id', supplyId);
    if (providerId) request = request.eq('provider_id', providerId);
    if (areaId) request = request.eq('area_id', areaId);
    if (storageLocationId) {
      request = request.eq('storage_location_id', storageLocationId);
    }
    if (query.warning === 'warning') {
      request = request.eq('has_open_discrepancy', true);
    } else if (query.warning === 'no_warning') {
      request = request.eq('has_open_discrepancy', false);
    }
    if (pagination.search) {
      const references = await resolveStockSearchReferences(
        this.db,
        pagination.search,
      );
      const conditions = [
        inCondition('supply_id', references.supplyIds),
        inCondition('area_id', references.areaIds),
        inCondition('storage_location_id', references.storageLocationIds),
      ].filter((condition): condition is string => Boolean(condition));
      if (conditions.length === 0) {
        return createPaginatedResult([], pagination, 0);
      }
      request = request.or(conditions.join(','));
    }
    request = request.order(pagination.sortBy, {
      ascending: pagination.sortOrder === 'asc',
    });
    if (pagination.sortBy !== 'id') request = request.order('id', { ascending: true });
    const { data, error, count } = await request.range(pagination.from, pagination.to);
    const result = resolvePaginatedQueryResult({ data, error, count }, pagination);
    if (result) return result;
    if (error) stockDatabaseError(error, 'Cannot list stock balances');
    throw new Error('Unreachable pagination state');
  }

  async get(id: string) {
    const { data, error } = await this.db
      .from('stock_balances')
      .select(SELECT)
      .eq('id', id)
      .single();
    if (error || !data) stockDatabaseError(error, 'Stock balance not found');
    // 403 rather than an empty result: the id came from the caller, so there is
    // nothing left to conceal by pretending the row does not exist.
    await this.areaAccess.assertCanRead((data as { area_id: string }).area_id);
    return data;
  }
}

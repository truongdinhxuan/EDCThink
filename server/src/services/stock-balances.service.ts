import type { FastifyInstance } from 'fastify';
import type {
  ReplaceStockBalanceLocationsBody,
  StockActor,
  StockBalanceListQuery,
} from '../interfaces/stock';
import { STOCK_BALANCE_SORT_FIELDS } from '../schemas/stock';
import { createPaginatedResult, parsePagination, resolvePaginatedQueryResult } from '../utils/pagination';
import { stockDatabaseError, stockFail } from './stock.helpers';
import { StockAreaAccessService } from './stock-area-access.service';
import {
  inCondition,
  resolveStockSearchReferences,
} from './stock-search';

// One row per (supply, provider, area[, set_per_qty]). `locations` is where the
// code sits and carries no quantity; see 20260924010000_stock_location_labels.
const SELECT = `
  id, supply_id, provider_id, area_id, quantity,
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
  location_labels:stock_balance_locations!stock_balance_locations_balance_fkey(
    storage_location:storage_locations!stock_balance_locations_location_fkey(id, code, name)
  )
`;

interface LocationRow { id: string; code: string; name: string | null }
interface LabelRow {
  storage_location: LocationRow | LocationRow[] | null;
}
type BalanceRow = Record<string, unknown> & { location_labels?: LabelRow[] | null };

/** Flattens the junction rows into the list of locations the client renders. */
const withLocations = (row: BalanceRow) => {
  const { location_labels: labels, ...balance } = row;
  const locations = (labels ?? [])
    .map((label) => (Array.isArray(label.storage_location)
      ? label.storage_location[0]
      : label.storage_location))
    .filter((location): location is LocationRow => Boolean(location))
    .sort((left, right) => left.code.localeCompare(right.code));
  return { ...balance, locations };
};

export class StockBalancesService {
  private readonly areaAccess: StockAreaAccessService;

  constructor(
    private readonly fastify: FastifyInstance,
    private readonly actor: StockActor,
  ) {
    this.areaAccess = new StockAreaAccessService(fastify, actor);
  }

  private get db() {
    return this.fastify.supabaseAdmin;
  }

  /** Balance ids labelled with any of these locations. */
  private async balanceIdsAt(locationIds: string[]): Promise<string[]> {
    if (locationIds.length === 0) return [];
    const { data, error } = await this.db
      .from('stock_balance_locations')
      .select('stock_balance_id')
      .in('storage_location_id', locationIds);
    if (error) stockDatabaseError(error, 'Cannot resolve stock locations');
    return [...new Set(
      ((data ?? []) as Array<{ stock_balance_id: string }>)
        .map((row) => row.stock_balance_id),
    )];
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
      const labelled = await this.balanceIdsAt([storageLocationId]);
      if (labelled.length === 0) return createPaginatedResult([], pagination, 0);
      request = request.in('id', labelled);
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
      const labelled = await this.balanceIdsAt(references.storageLocationIds);
      const conditions = [
        inCondition('supply_id', references.supplyIds),
        inCondition('area_id', references.areaIds),
        inCondition('id', labelled),
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
    const result = resolvePaginatedQueryResult(
      { data: (data as unknown as BalanceRow[] | null)?.map(withLocations) ?? null, error, count },
      pagination,
    );
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
    return withLocations(data as unknown as BalanceRow);
  }

  /** Relabels where the code sits. Quantities are not touched. */
  async replaceLocations(id: string, body: ReplaceStockBalanceLocationsBody) {
    const { data: target, error: targetError } = await this.db
      .from('stock_balances')
      .select('area_id')
      .eq('id', id)
      .eq('is_deleted', false)
      .maybeSingle();
    if (targetError) stockDatabaseError(targetError, 'Stock balance not found');
    if (!target) return stockFail(404, 'Stock balance not found');
    this.areaAccess.assertCanWrite((target as { area_id: string }).area_id);

    const { error } = await this.db.rpc('replace_stock_balance_locations', {
      p_stock_balance_id: id,
      p_location_ids: body.location_ids,
      p_actor_id: this.actor.id,
    });
    if (error) {
      if (error.message === 'STOCK_LOCATIONS_FORBIDDEN') {
        return stockFail(403, 'Missing supply.stock.adjust permission');
      }
      if (error.message === 'STOCK_BALANCE_NOT_FOUND') {
        return stockFail(404, 'Stock balance not found');
      }
      if (/not in area/i.test(error.message ?? '')) {
        return stockFail(400, 'Vị trí kho không thuộc khu vực của dòng tồn.');
      }
      stockDatabaseError(error, 'Cannot update stock locations');
    }
    return this.get(id);
  }
}

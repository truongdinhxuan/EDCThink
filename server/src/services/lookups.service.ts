import type { FastifyInstance } from 'fastify';
import type { LookupListQuery, LookupTableName } from '../interfaces/lookups';
import { LOOKUP_SORT_FIELDS } from '../schemas/lookups';
import { parsePagination, resolvePaginatedQueryResult } from '../utils/pagination';
import { databaseError, parseActiveFilter } from './master-data.helpers';

const TABLE_SELECT: Record<LookupTableName, string> = {
  order_statuses:
    'id, code, name, description, sort_order, is_system, is_active, is_deleted, created_at, updated_at',
  stock_transaction_types:
    'id, code, name, effect, requires_reason, is_system, is_active, is_deleted, created_at, updated_at',
  adjustment_reasons:
    'id, code, name, description, requires_note, is_active, is_deleted, created_at, updated_at',
  order_revision_actions:
    'id, code, name, description, is_system, is_active, is_deleted, created_at, updated_at',
  allocation_confirm_reasons:
    'id, code, name, description, direction, corrects_stock, sort_order, is_system, is_active, is_deleted, created_at, updated_at',
};

const SORT_FIELDS: Record<LookupTableName, readonly string[]> = {
  order_statuses: LOOKUP_SORT_FIELDS,
  stock_transaction_types: LOOKUP_SORT_FIELDS.filter(
    (field) => field !== 'sort_order',
  ),
  adjustment_reasons: LOOKUP_SORT_FIELDS.filter(
    (field) => field !== 'is_system' && field !== 'sort_order',
  ),
  order_revision_actions: LOOKUP_SORT_FIELDS.filter(
    (field) => field !== 'sort_order',
  ),
  allocation_confirm_reasons: LOOKUP_SORT_FIELDS,
};

const SEARCH_FIELDS: Record<LookupTableName, readonly string[]> = {
  order_statuses: ['code', 'name', 'description'],
  stock_transaction_types: ['code', 'name'],
  adjustment_reasons: ['code', 'name', 'description'],
  order_revision_actions: ['code', 'name', 'description'],
  allocation_confirm_reasons: ['code', 'name', 'description'],
};

const SORTED_BY_SORT_ORDER: ReadonlySet<LookupTableName> = new Set([
  'order_statuses',
  'allocation_confirm_reasons',
]);

export class LookupsService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get db() {
    return this.fastify.supabaseAdmin;
  }

  async list(table: LookupTableName, query: LookupListQuery = {}) {
    const pagination = parsePagination(query, {
      allowedSortBy: SORT_FIELDS[table],
      defaultSortBy: SORTED_BY_SORT_ORDER.has(table) ? 'sort_order' : 'code',
      defaultSortOrder: 'asc',
    });
    const isActive = parseActiveFilter(query.isActive);
    let request = this.db
      .from(table)
      .select(TABLE_SELECT[table], { count: 'exact' })
      .eq('is_active', isActive)
      .eq('is_deleted', false);

    if (pagination.search) {
      request = request.or(
        SEARCH_FIELDS[table]
          .map((field) => `${field}.ilike.*${pagination.search}*`)
          .join(','),
      );
    }
    if (table === 'stock_transaction_types') {
      if (query.effect) request = request.eq('effect', query.effect);
      if (query.requiresReason !== undefined) {
        request = request.eq(
          'requires_reason',
          parseActiveFilter(query.requiresReason),
        );
      }
    }
    request = request.order(pagination.sortBy, {
      ascending: pagination.sortOrder === 'asc',
    });
    if (pagination.sortBy !== 'id') {
      request = request.order('id', { ascending: true });
    }

    const { data, error, count } = await request.range(
      pagination.from,
      pagination.to,
    );
    const result = resolvePaginatedQueryResult(
      { data, error, count },
      pagination,
    );
    if (result) return result;
    if (error) databaseError(error, `Không thể tải lookup ${table}`);
    throw new Error('Unreachable pagination state');
  }
}

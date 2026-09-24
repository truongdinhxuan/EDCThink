import type { FastifyInstance } from 'fastify';
import type {} from '../plugins/dbContext';
import type {
  CreateStorageLocationBody,
  StorageLocationListQuery,
  UpdateStorageLocationBody,
} from '../interfaces/storage-locations';
import {
  assertFilterId,
  databaseError,
  fail,
  normalizeOptionalText,
  normalizeRequiredText,
  parseActiveFilter,
} from './master-data.helpers';
import { STORAGE_LOCATION_SORT_FIELDS } from '../schemas/master-data';
import { parsePagination, resolvePaginatedQueryResult } from '../utils/pagination';

const SELECT = `
  id, code, area_id, name, description, is_active, is_deleted, created_at, updated_at,
  area:areas!storage_locations_area_id_fkey(id, code, name, is_active, is_deleted)
`;

export class StorageLocationsService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get db() {
    return this.fastify.supabaseAdmin;
  }

  private async assertActiveArea(areaId: string): Promise<void> {
    const { data, error } = await this.db
      .from('areas')
      .select('id')
      .eq('id', areaId)
      .eq('is_active', true)
      .eq('is_deleted', false)
      .single();
    if (error || !data) fail(400, 'area_id không tồn tại hoặc không active');
  }

  private async assertAreaCanChange(id: string, nextAreaId: string): Promise<void> {
    const { data: current, error } = await this.db
      .from('storage_locations')
      .select('area_id')
      .eq('id', id)
      .single();
    if (error) databaseError(error, 'Không tìm thấy vị trí lưu kho');
    const currentAreaId = current?.area_id as string | undefined;
    if (!currentAreaId) fail(404, 'Không tìm thấy vị trí lưu kho');
    if (currentAreaId === nextAreaId) return;

    // Labels pin a location to its Area through a composite key, so moving a
    // labelled location would be refused by the database anyway.
    const references = await Promise.all([
      this.db.from('stock_balance_locations').select('stock_balance_id', { count: 'exact', head: true }).eq('storage_location_id', id),
      this.db.from('stock_transactions').select('id', { count: 'exact', head: true }).eq('storage_location_id', id),
    ]);
    const referenceError = references.find((result) => result.error)?.error;
    if (referenceError) databaseError(referenceError, 'Không thể kiểm tra vị trí đang được sử dụng');
    if (references.some((result) => (result.count ?? 0) > 0)) {
      fail(409, 'Không thể đổi area của vị trí đã có tồn kho hoặc giao dịch');
    }
  }

  async list(query: StorageLocationListQuery = {}) {
    const areaId = assertFilterId(query.areaId ?? query.area_id, 'areaId');
    const active = parseActiveFilter(query.isActive ?? query.is_active);
    const pagination = parsePagination(query, {
      allowedSortBy: STORAGE_LOCATION_SORT_FIELDS,
      defaultSortBy: 'code',
      defaultSortOrder: 'asc',
      legacySearch: query.q,
    });
    let request = this.db
      .from('storage_locations')
      .select(SELECT, { count: 'exact' })
      .eq('is_active', active)
      .eq('is_deleted', false);

    if (areaId) request = request.eq('area_id', areaId);
    if (pagination.search) {
      request = request.or(
        `code.ilike.*${pagination.search}*,name.ilike.*${pagination.search}*,description.ilike.*${pagination.search}*`,
      );
    }
    request = request.order(pagination.sortBy, {
      ascending: pagination.sortOrder === 'asc',
    });
    if (pagination.sortBy !== 'id') request = request.order('id', { ascending: true });
    const { data, error, count } = await request.range(pagination.from, pagination.to);
    const result = resolvePaginatedQueryResult({ data, error, count }, pagination);
    if (result) return result;
    if (error) databaseError(error, 'Cannot list storage locations');
    throw new Error('Unreachable pagination state');
  }

  async get(id: string) {
    const { data, error } = await this.db
      .from('storage_locations')
      .select(SELECT)
      .eq('id', id)
      .single();
    if (error || !data) databaseError(error, 'Không tìm thấy vị trí lưu kho');
    return data;
  }

  async create(body: CreateStorageLocationBody) {
    await this.assertActiveArea(body.area_id);
    const payload = {
      code: normalizeRequiredText(body.code, 'code', 100),
      area_id: body.area_id,
      name: normalizeOptionalText(body.name, 'name', 255) ?? null,
      description: normalizeOptionalText(body.description, 'description') ?? null,
      is_active: body.is_active ?? true,
      is_deleted: false,
    };
    const { data, error } = await this.db
      .from('storage_locations')
      .insert(payload)
      .select(SELECT)
      .single();
    if (error || !data) databaseError(error, 'Code vị trí đã tồn tại trong area');
    return data;
  }

  async update(id: string, body: UpdateStorageLocationBody) {
    if (body.area_id !== undefined) {
      await this.assertActiveArea(body.area_id);
      await this.assertAreaCanChange(id, body.area_id);
    }
    const payload: Record<string, unknown> = {};
    if (body.code !== undefined) payload.code = normalizeRequiredText(body.code, 'code', 100);
    if (body.area_id !== undefined) payload.area_id = body.area_id;
    if (body.name !== undefined) payload.name = normalizeOptionalText(body.name, 'name', 255);
    if (body.description !== undefined) {
      payload.description = normalizeOptionalText(body.description, 'description');
    }
    if (body.is_active !== undefined) {
      payload.is_active = body.is_active;
      if (body.is_active) payload.is_deleted = false;
    }

    const { data, error } = await this.db
      .from('storage_locations')
      .update(payload)
      .eq('id', id)
      .select(SELECT)
      .single();
    if (error || !data) databaseError(error, 'Không thể cập nhật vị trí hoặc code đã tồn tại trong area');
    return data;
  }

  async remove(id: string) {
    const { data, error } = await this.db
      .from('storage_locations')
      .update({ is_active: false, is_deleted: true })
      .eq('id', id)
      .select(SELECT)
      .single();
    if (error || !data) databaseError(error, 'Không tìm thấy vị trí lưu kho');
    return data;
  }
}

import type { FastifyInstance } from 'fastify';
import type {} from '../plugins/dbContext';
import type {
  AreaListQuery,
  CreateAreaBody,
  UpdateAreaBody,
} from '../interfaces/master-data';
import {
  databaseError,
  fail,
  normalizeOptionalText,
  normalizeRequiredText,
  parseActiveFilter,
} from './master-data.helpers';
import { AREA_SORT_FIELDS } from '../schemas/master-data';
import { parsePagination, resolvePaginatedQueryResult } from '../utils/pagination';

const SELECT = `
  id, code, name, description, area_type_id,
  is_active, is_deleted, created_at, updated_at,
  area_type:area_types!areas_area_type_id_fkey(
    id, code, name, description, is_active, is_deleted
  )
`;

export class AreasService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get db() {
    return this.fastify.supabaseAdmin;
  }

  private async assertActiveAreaType(areaTypeId: string): Promise<void> {
    const { data, error } = await this.db
      .from('area_types')
      .select('id')
      .eq('id', areaTypeId)
      .eq('is_active', true)
      .eq('is_deleted', false)
      .maybeSingle();
    if (error) databaseError(error, 'Không thể kiểm tra Area Type');
    if (!data) fail(400, 'area_type_id không tồn tại hoặc không active');
  }

  async list(query: AreaListQuery = {}) {
    const active = parseActiveFilter(query.isActive ?? query.is_active);
    const pagination = parsePagination(query, {
      allowedSortBy: AREA_SORT_FIELDS,
      defaultSortBy: 'code',
      defaultSortOrder: 'asc',
      legacySearch: query.q,
    });
    let request = this.db
      .from('areas')
      .select(SELECT, { count: 'exact' })
      .eq('is_active', active)
      .eq('is_deleted', false);

    if (query.areaTypeId) request = request.eq('area_type_id', query.areaTypeId);

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
    if (error) databaseError(error, 'Cannot list areas');
    throw new Error('Unreachable pagination state');
  }

  async get(id: string) {
    const { data, error } = await this.db.from('areas').select(SELECT).eq('id', id).single();
    if (error || !data) databaseError(error, 'Không tìm thấy khu vực');
    return data;
  }

  async create(body: CreateAreaBody) {
    if (body.area_type_id) await this.assertActiveAreaType(body.area_type_id);
    const payload = {
      code: normalizeRequiredText(body.code, 'code', 100),
      name: normalizeRequiredText(body.name, 'name'),
      description: normalizeOptionalText(body.description, 'description') ?? null,
      area_type_id: body.area_type_id ?? null,
      is_active: body.is_active ?? true,
      is_deleted: false,
    };
    const { data, error } = await this.db
      .from('areas')
      .insert(payload)
      .select(SELECT)
      .single();
    if (error || !data) databaseError(error, 'Mã khu vực đã tồn tại');
    return data;
  }

  async update(id: string, body: UpdateAreaBody) {
    if (body.area_type_id) await this.assertActiveAreaType(body.area_type_id);
    const payload: Record<string, unknown> = {};
    if (body.code !== undefined) payload.code = normalizeRequiredText(body.code, 'code', 100);
    if (body.name !== undefined) payload.name = normalizeRequiredText(body.name, 'name');
    if (body.description !== undefined) {
      payload.description = normalizeOptionalText(body.description, 'description');
    }
    if (body.area_type_id !== undefined) payload.area_type_id = body.area_type_id;
    if (body.is_active !== undefined) {
      payload.is_active = body.is_active;
      if (body.is_active) payload.is_deleted = false;
    }
    const { data, error } = await this.db
      .from('areas')
      .update(payload)
      .eq('id', id)
      .select(SELECT)
      .single();
    if (error || !data) databaseError(error, 'Không thể cập nhật khu vực hoặc code đã tồn tại');
    return data;
  }

  async remove(id: string) {
    const { data, error } = await this.db
      .from('areas')
      .update({ is_active: false, is_deleted: true })
      .eq('id', id)
      .select(SELECT)
      .single();
    if (error || !data) databaseError(error, 'Không tìm thấy khu vực');
    return data;
  }
}

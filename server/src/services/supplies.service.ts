import type { FastifyInstance } from 'fastify';
import type {} from '../plugins/dbContext';
import type { ProviderRecord } from '../interfaces/database';
import type {
  CreateSupplyBody,
  SupplyListQuery,
  SupplyProviderListQuery,
  SupplyStackOptionsQuery,
  UpdateSupplyBody,
} from '../interfaces/supplies';
import {
  assertFilterId,
  databaseError,
  fail,
  normalizeOptionalText,
  normalizeRequiredText,
  parseActiveFilter,
} from './master-data.helpers';
import { SUPPLY_SORT_FIELDS } from '../schemas/master-data';
import { parsePagination, resolvePaginatedQueryResult } from '../utils/pagination';

export { normalizeSearchQuery, parseActiveFilter } from './master-data.helpers';

const RELATIONS = `
  category:supply_categories!supplies_category_id_fkey(id, code, name, description),
  unit:units!supplies_unit_id_fkey(id, code, symbol, name),
  provider_links:supply_providers!supply_providers_supply_id_fkey(
    id, supply_id, provider_id, is_active, is_deleted,
    provider:providers!supply_providers_provider_id_fkey(
      id, code, name, description, is_active, is_deleted,
      created_at, updated_at
    )
  )
`;

const PACKING_SELECT = `
  id, code, short_text, translation_text, description,
  category_id, unit_id, is_active, is_deleted,
  ${RELATIONS}
`;

const FULL_SELECT = `
  id, code, short_text, translation_text, description, category_id, unit_id,
  min_stock, max_stock, safety_stock, image_url, is_active, is_deleted,
  created_at, updated_at,
  ${RELATIONS}
`;

const PROVIDER_SELECT = `
  id, code, name, description, is_active, is_deleted, created_at, updated_at
`;

interface ProviderLinkRow {
  is_active: boolean;
  is_deleted: boolean;
  provider: ProviderRecord | ProviderRecord[] | null;
}

const firstRelation = <T>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : value;

export const normalizeProviderIds = (providerIds: string[]): string[] => {
  if (!Array.isArray(providerIds) || providerIds.length === 0) {
    fail(400, 'provider_ids phải có ít nhất một Provider');
  }

  const normalized = providerIds.map((providerId) => {
    if (typeof providerId !== 'string') {
      fail(400, 'provider_ids chỉ được chứa UUID');
    }
    const id = assertFilterId(providerId, 'provider_ids');
    return id ?? fail(400, 'provider_ids chỉ được chứa UUID');
  });
  return [...new Set(normalized)];
};

export const normalizeSupplyProviders = (row: unknown) => {
  const supply = row as Record<string, unknown> & {
    provider_links?: ProviderLinkRow[] | null;
  };
  const { provider_links: providerLinks, ...rest } = supply;
  const providers = (providerLinks ?? [])
    .filter((link) => link.is_active && !link.is_deleted)
    .map((link) => firstRelation(link.provider))
    .filter((provider): provider is ProviderRecord => provider !== null);
  return { ...rest, providers };
};

export class SuppliesService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get db() {
    return this.fastify.supabaseAdmin;
  }

  private selectFor(canReadStock: boolean): string {
    return canReadStock ? FULL_SELECT : PACKING_SELECT;
  }

  private async assertActiveReference(
    table: 'supply_categories' | 'units',
    id: string,
    label: string,
  ): Promise<void> {
    const { data, error } = await this.db
      .from(table)
      .select('id, is_active')
      .eq('id', id)
      .eq('is_active', true)
      .or('is_deleted.eq.false,is_deleted.is.null')
      .single();
    if (error || !data) fail(400, `${label} không tồn tại hoặc không active`);
  }

  private async assertActiveProviders(providerIds: string[]): Promise<void> {
    const { data, error } = await this.db
      .from('providers')
      .select('id')
      .in('id', providerIds)
      .eq('is_active', true)
      .eq('is_deleted', false);
    if (error) databaseError(error, 'Không thể kiểm tra Provider');

    const activeIds = new Set(
      ((data ?? []) as Array<{ id: string }>).map((provider) => provider.id),
    );
    if (activeIds.size !== providerIds.length
      || providerIds.some((providerId) => !activeIds.has(providerId))) {
      fail(400, 'provider_ids chứa Provider không tồn tại, inactive hoặc đã bị xóa');
    }
  }

  private async assertCodeCanChange(id: string, nextCode: string): Promise<void> {
    const { data: current, error } = await this.db
      .from('supplies')
      .select('code')
      .eq('id', id)
      .single();
    if (error) databaseError(error, 'Không tìm thấy vật tư');
    const currentCode = current?.code as string | undefined;
    if (!currentCode) fail(404, 'Không tìm thấy vật tư');
    if (currentCode === nextCode) return;

    const references = await Promise.all([
      this.db.from('stock_balances').select('id', { count: 'exact', head: true }).eq('supply_id', id),
      this.db.from('stock_transactions').select('id', { count: 'exact', head: true }).eq('supply_id', id),
      this.db.from('order_items').select('id', { count: 'exact', head: true }).eq('supply_id', id),
    ]);
    const referenceError = references.find((result) => result.error)?.error;
    if (referenceError) databaseError(referenceError, 'Không thể kiểm tra lịch sử sử dụng vật tư');
    if (references.some((result) => (result.count ?? 0) > 0)) {
      fail(409, 'Không thể đổi code của vật tư đã có tồn kho, giao dịch hoặc order');
    }
  }

  private async getFull(id: string) {
    const { data, error } = await this.db
      .from('supplies')
      .select(FULL_SELECT)
      .eq('id', id)
      .single();
    if (error || !data) databaseError(error, 'Không tìm thấy vật tư');
    return normalizeSupplyProviders(data);
  }

  async list(canReadStock: boolean, query: SupplyListQuery) {
    const isActive = parseActiveFilter(query.isActive ?? query.is_active);
    const isDeleted = parseActiveFilter(query.isDeleted, false);
    const categoryId = assertFilterId(query.categoryId ?? query.category_id, 'categoryId');
    const unitId = assertFilterId(query.unitId, 'unitId');
    const pagination = parsePagination(query, {
      allowedSortBy: SUPPLY_SORT_FIELDS,
      defaultSortBy: 'code',
      defaultSortOrder: 'asc',
      legacySearch: query.q,
    });

    let request = this.db
      .from('supplies')
      .select(this.selectFor(canReadStock), { count: 'exact' })
      .eq('is_active', isActive)
      .eq('is_deleted', isDeleted);

    if (categoryId) request = request.eq('category_id', categoryId);
    if (unitId) request = request.eq('unit_id', unitId);
    if (pagination.search) {
      request = request.or(
        `code.ilike.*${pagination.search}*,short_text.ilike.*${pagination.search}*,translation_text.ilike.*${pagination.search}*,description.ilike.*${pagination.search}*`,
      );
    }
    request = request.order(pagination.sortBy, {
      ascending: pagination.sortOrder === 'asc',
    });
    if (pagination.sortBy !== 'id') request = request.order('id', { ascending: true });

    const { data, error, count } = await request.range(pagination.from, pagination.to);
    const result = resolvePaginatedQueryResult({ data, error, count }, pagination);
    if (result) {
      return {
        ...result,
        items: result.items.map(normalizeSupplyProviders),
      };
    }
    if (error) databaseError(error, 'Không thể lấy danh sách vật tư');
    throw new Error('Unreachable pagination state');
  }

  async get(canReadStock: boolean, id: string) {
    const { data, error } = await this.db
      .from('supplies')
      .select(this.selectFor(canReadStock))
      .eq('id', id)
      .single();
    if (error || !data) databaseError(error, 'Không tìm thấy vật tư');
    return normalizeSupplyProviders(data);
  }

  async create(body: CreateSupplyBody) {
    const providerIds = normalizeProviderIds(body.provider_ids);
    await Promise.all([
      this.assertActiveReference('supply_categories', body.category_id, 'category_id'),
      this.assertActiveReference('units', body.unit_id, 'unit_id'),
      this.assertActiveProviders(providerIds),
    ]);

    const payload = {
      code: normalizeRequiredText(body.code, 'code', 100),
      short_text: normalizeRequiredText(body.short_text, 'short_text', 255),
      translation_text:
        normalizeOptionalText(body.translation_text, 'translation_text') ?? null,
      description: normalizeOptionalText(body.description, 'description') ?? null,
      category_id: body.category_id,
      unit_id: body.unit_id,
      min_stock: body.min_stock ?? 0,
      max_stock: body.max_stock ?? null,
      safety_stock: body.safety_stock ?? null,
      image_url: normalizeOptionalText(body.image_url, 'image_url') ?? null,
      is_active: body.is_active ?? true,
    };

    const { data: supplyId, error } = await this.db.rpc(
      'create_supply_with_providers',
      {
        p_code: payload.code,
        p_short_text: payload.short_text,
        p_translation_text: payload.translation_text,
        p_description: payload.description,
        p_category_id: payload.category_id,
        p_unit_id: payload.unit_id,
        p_min_stock: payload.min_stock,
        p_max_stock: payload.max_stock,
        p_safety_stock: payload.safety_stock,
        p_image_url: payload.image_url,
        p_is_active: payload.is_active,
        p_provider_ids: providerIds,
      },
    );
    if (error || !supplyId) {
      databaseError(error, 'Mã vật tư đã tồn tại hoặc Provider không hợp lệ');
    }
    return this.getFull(supplyId as string);
  }

  async update(id: string, body: UpdateSupplyBody) {
    const providerIds = normalizeProviderIds(body.provider_ids);
    if (body.category_id !== undefined) {
      await this.assertActiveReference('supply_categories', body.category_id, 'category_id');
    }
    if (body.unit_id !== undefined) {
      await this.assertActiveReference('units', body.unit_id, 'unit_id');
    }
    await this.assertActiveProviders(providerIds);

    const payload: Record<string, unknown> = {};
    if (body.code !== undefined) {
      const code = normalizeRequiredText(body.code, 'code', 100);
      await this.assertCodeCanChange(id, code);
      payload.code = code;
    }
    if (body.short_text !== undefined) {
      payload.short_text = normalizeRequiredText(body.short_text, 'short_text', 255);
    }
    for (const field of ['translation_text', 'description', 'image_url'] as const) {
      if (body[field] !== undefined) {
        payload[field] = normalizeOptionalText(body[field], field);
      }
    }
    for (const field of [
      'category_id', 'unit_id', 'min_stock', 'max_stock', 'safety_stock',
    ] as const) {
      if (body[field] !== undefined) payload[field] = body[field];
    }
    if (body.is_active !== undefined) payload.is_active = body.is_active;

    const { data: supplyId, error } = await this.db.rpc(
      'update_supply_with_providers',
      {
        p_supply_id: id,
        p_patch: payload,
        p_provider_ids: providerIds,
      },
    );
    if (error || !supplyId) {
      databaseError(error, 'Không thể cập nhật vật tư, Provider hoặc code không hợp lệ');
    }
    return this.getFull(supplyId as string);
  }

  async listProviders(id: string, query: SupplyProviderListQuery = {}) {
    const isActive = parseActiveFilter(query.isActive, true);
    const isDeleted = parseActiveFilter(query.isDeleted, false);

    const { data: supply, error: supplyError } = await this.db
      .from('supplies')
      .select('id')
      .eq('id', id)
      .eq('is_deleted', false)
      .single();
    if (supplyError || !supply) databaseError(supplyError, 'Không tìm thấy vật tư');

    const { data, error } = await this.db
      .from('supply_providers')
      .select(`
        provider:providers!supply_providers_provider_id_fkey!inner(${PROVIDER_SELECT})
      `)
      .eq('supply_id', id)
      .eq('is_active', isActive)
      .eq('is_deleted', isDeleted)
      .eq('provider.is_active', isActive)
      .eq('provider.is_deleted', isDeleted)
      .order('created_at', { ascending: true });
    if (error) databaseError(error, 'Không thể lấy Provider của vật tư');

    return (data ?? [])
      .map((link) => firstRelation(
        (link as { provider: ProviderRecord | ProviderRecord[] | null }).provider,
      ))
      .filter((provider): provider is ProviderRecord => provider !== null);
  }

  async listStackOptions(id: string, query: SupplyStackOptionsQuery) {
    const providerId = assertFilterId(query.provider_id, 'provider_id');
    const areaId = assertFilterId(query.area_id, 'area_id');
    if (!providerId || !areaId) fail(400, 'provider_id và area_id là bắt buộc');

    const { data, error } = await this.db.rpc('get_supply_stack_options', {
      p_supply_id: id,
      p_provider_id: providerId,
      p_area_id: areaId,
    });
    if (error) databaseError(error, 'Không thể lấy quy cách chồng đang tồn kho');

    return ((data ?? []) as Array<{
      set_per_qty: number | string;
      available_stack_quantity: number | string;
      available_total_set_quantity: number | string;
    }>).map((option) => ({
      set_per_qty: Number(option.set_per_qty),
      available_stack_quantity: Number(option.available_stack_quantity),
      available_total_set_quantity: Number(option.available_total_set_quantity),
    }));
  }

  /**
   * Non-authoritative pre-submit hint for the normal (non-stack) inventory
   * dimension. Mirrors the grouping used by attachStockAvailability so the
   * number matches what the Order detail will show after creation. The
   * authoritative zero-stock gate stays in create_pending_order_with_items.
   */
  async getAvailability(id: string, query: SupplyStackOptionsQuery) {
    const providerId = assertFilterId(query.provider_id, 'provider_id');
    const areaId = assertFilterId(query.area_id, 'area_id');
    if (!providerId || !areaId) fail(400, 'provider_id và area_id là bắt buộc');

    const { data: supply, error: supplyError } = await this.db
      .from('supplies')
      .select(`
        id, is_active, is_deleted,
        category:supply_categories!supplies_category_id_fkey(code, is_active, is_deleted)
      `)
      .eq('id', id)
      .eq('is_active', true)
      .eq('is_deleted', false)
      .maybeSingle();
    if (supplyError) databaseError(supplyError, 'Không thể tải vật tư');
    if (!supply) fail(404, 'Vật tư không tồn tại hoặc đã ngừng hoạt động');

    const category = firstRelation(
      (supply as { category: { code: string; is_active: boolean; is_deleted: boolean }
        | Array<{ code: string; is_active: boolean; is_deleted: boolean }> | null }).category,
    );
    const categoryCode = category && category.is_active && !category.is_deleted
      ? category.code
      : null;
    if (!categoryCode) fail(400, 'Danh mục vật tư không hợp lệ');

    const { count: providerLinkCount, error: providerLinkError } = await this.db
      .from('supply_providers')
      .select('provider:providers!supply_providers_provider_id_fkey!inner(id)', {
        count: 'exact',
        head: true,
      })
      .eq('supply_id', id)
      .eq('provider_id', providerId)
      .eq('is_active', true)
      .eq('is_deleted', false)
      .eq('provider.is_active', true)
      .eq('provider.is_deleted', false);
    if (providerLinkError) databaseError(providerLinkError, 'Không thể kiểm tra Provider');
    if ((providerLinkCount ?? 0) === 0) {
      fail(400, 'Provider không liên kết với vật tư hoặc đã ngừng hoạt động');
    }

    const { data: area, error: areaError } = await this.db
      .from('areas')
      .select('id')
      .eq('id', areaId)
      .eq('is_active', true)
      .eq('is_deleted', false)
      .maybeSingle();
    if (areaError) databaseError(areaError, 'Không thể kiểm tra Area');
    if (!area) fail(400, 'Area không tồn tại hoặc đã ngừng hoạt động');

    const { data: balances, error: balanceError } = await this.db
      .from('stock_balances')
      .select('quantity')
      .eq('supply_id', id)
      .eq('provider_id', providerId)
      .eq('area_id', areaId)
      .is('set_per_qty', null)
      .eq('is_active', true)
      .eq('is_deleted', false);
    if (balanceError) databaseError(balanceError, 'Không thể tính tồn khả dụng');

    const availableQuantity = ((balances ?? []) as Array<{ quantity: number | string }>)
      .reduce((total, row) => {
        const quantity = Number(row.quantity);
        return Number.isFinite(quantity) && quantity > 0 ? total + quantity : total;
      }, 0);

    return {
      supply_id: id,
      provider_id: providerId,
      area_id: areaId,
      category_code: categoryCode,
      available_quantity: availableQuantity,
    };
  }

  async remove(id: string) {
    const { data, error } = await this.db
      .from('supplies')
      .update({ is_active: false, is_deleted: true })
      .eq('id', id)
      .select(FULL_SELECT)
      .single();
    if (error || !data) databaseError(error, 'Không tìm thấy vật tư');
    return normalizeSupplyProviders(data);
  }
}

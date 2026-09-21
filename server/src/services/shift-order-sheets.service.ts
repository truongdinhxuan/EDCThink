import type { FastifyInstance } from 'fastify';
import type {
  ShiftOrderSheetDetailQuery,
  ShiftOrderSheetIncomingQuery,
  ShiftOrderSheetListQuery,
} from '../interfaces/shift-order-sheets';
import { SHIFT_ORDER_SHEET_SORT_FIELDS } from '../schemas/shift-order-sheets';
import type { OrderActor } from './orders.service';
import {
  canReadSheetArea,
  resolveIncomingAreaIds,
  resolveReadableAreaIds,
} from '../domain/sheet-access';
import { resolveShiftEndAt, resolveShiftStartAt } from '../domain/orderRules';
import { ORDER_SOURCE_AREA_CODE } from '../domain/order-access';
import { AreaScopesService } from './area-scopes.service';
import {
  createShiftOrderSheetExportFilename,
  createShiftOrderSheetWorkbook,
  ShiftOrderSheetExportError,
  type ShiftOrderSheetExportItem,
  type ShiftOrderSheetExportOrder,
  type ShiftOrderSheetExportSource,
} from './shift-order-sheet-exporter';
import {
  createPaginatedResult,
  parsePagination,
  resolvePaginatedQueryResult,
} from '../utils/pagination';

interface SupabaseErrorLike {
  code?: string;
  message?: string;
}

interface EmbeddedShift {
  id: string;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  crosses_midnight: boolean;
}

interface SheetRow {
  id: string;
  area_id: string;
  work_shift_id: string;
  work_date: string;
  leader_id: string;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  area: unknown;
  work_shift: EmbeddedShift | EmbeddedShift[] | null;
  leader: unknown;
  orders?: Array<{
    id: string;
    created_at?: string;
    is_deleted?: boolean;
    order_items?: Array<{ id: string; is_deleted?: boolean; [key: string]: unknown }>;
    [key: string]: unknown;
  }>;
}

interface ResolvedShiftRow {
  assignment_id: string;
  work_shift_id: string;
  work_shift_code: string;
  work_shift_name: string;
  work_date: string;
  shift_start_at: string;
  shift_end_at: string;
  is_overtime: boolean;
}

interface ExportRelation {
  code: string;
  name?: string;
  description?: string | null;
}

interface ExportItemRow {
  id: string;
  created_at: string;
  quantity_requested: number | string;
  quantity_approved: number | string | null;
  quantity_issued: number | string | null;
  set_per_qty: number | string | null;
  requested_stack_quantity: number | string | null;
  note: string | null;
  is_deleted: boolean;
  supply: unknown;
  provider: unknown;
  unit: unknown;
}

interface ExportOrderRow {
  id: string;
  code: string;
  submitted_at: string | null;
  issued_at: string | null;
  note: string | null;
  is_deleted: boolean;
  status_lookup: ExportStatusRow | ExportStatusRow[] | null;
  order_items?: ExportItemRow[];
}

interface ExportStatusRow {
  code: string;
  name: string | null;
}

interface ExportSheetRow extends Omit<SheetRow, 'orders'> {
  orders: ExportOrderRow[];
}

interface IncomingStatusRow {
  id: string;
  code: string;
  name: string;
}

interface IncomingOrderRow {
  id: string;
  is_deleted: boolean;
  status_lookup: IncomingStatusRow | IncomingStatusRow[] | null;
  order_items?: Array<{ id: string; is_deleted?: boolean }>;
}

interface IncomingSheetRow extends Omit<SheetRow, 'orders'> {
  orders: IncomingOrderRow[];
}

export interface ShiftOrderSheetActor extends OrderActor {
  roleIds: string[];
}

export class ShiftOrderSheetServiceError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'ShiftOrderSheetServiceError';
  }
}

const fail = (statusCode: number, message: string): never => {
  throw new ShiftOrderSheetServiceError(statusCode, message);
};

const databaseError = (error: SupabaseErrorLike | null, fallback: string): never => {
  if (error?.code === 'PGRST116') fail(404, 'Không tìm thấy Phiếu Order Ca');
  return fail(400, error?.message ?? fallback);
};

const firstRelation = <T>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : value;

const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';

// Shift arithmetic (fixed +07:00, crosses_midnight) belongs to the domain layer
// and is shared with the Order status-update deadline, so it is not redone here.
const shiftBounds = (workDate: string, shift: EmbeddedShift | null) => {
  if (!shift) return { shift_start_at: '', shift_end_at: '' };
  const startAt = resolveShiftStartAt(workDate, shift);
  const endAt = resolveShiftEndAt(workDate, shift);
  return {
    shift_start_at: startAt?.toISOString() ?? '',
    shift_end_at: endAt?.toISOString() ?? '',
  };
};

const SHEET_BASE_SELECT = `
  id, area_id, work_shift_id, work_date, leader_id,
  is_active, is_deleted, created_at, updated_at,
  area:areas!supply_shift_order_sheets_area_id_fkey(id, code, name),
  work_shift:work_shifts!supply_shift_order_sheets_work_shift_id_fkey(
    id, code, name, start_time, end_time, crosses_midnight
  ),
  leader:users!supply_shift_order_sheets_leader_id_fkey(
    id, vinfast_id, email, first_name, last_name
  )
`;

interface SheetContentFilters {
  search?: string;
  statusId?: string;
  categoryId?: string;
}

const normalizeContentFilters = (
  query: ShiftOrderSheetDetailQuery,
): SheetContentFilters => ({
  search: query.search?.trim() || undefined,
  statusId: query.statusId,
  categoryId: query.categoryId,
});

const hasItemFilters = (filters: SheetContentFilters): boolean =>
  Boolean(filters.search || filters.categoryId);

const hasOrderFilters = (filters: SheetContentFilters): boolean =>
  Boolean(filters.statusId || hasItemFilters(filters));

const createSheetListSelect = (filters: SheetContentFilters): string => {
  const filterItems = hasItemFilters(filters);
  const filterOrders = hasOrderFilters(filters);
  const itemContent = filterItems
    ? `
      id, is_deleted,
      supply:supplies!order_items_supply_id_fkey!inner(id, code, category_id)
    `
    : 'id, is_deleted';

  return `
    ${SHEET_BASE_SELECT},
    orders:orders!orders_shift_order_sheet_id_fkey${filterOrders ? '!inner' : ''}(
      id, status_id, is_deleted,
      order_items${filterItems ? '!inner' : ''}(${itemContent})
    )
  `;
};

const createSheetDetailSelect = (filters: SheetContentFilters): string => `
  ${SHEET_BASE_SELECT},
  orders:orders!orders_shift_order_sheet_id_fkey(
    id, code, from_area_id, to_area_id, requested_by, status_id, note,
    submitted_at, approved_at, issued_at, received_at, completed_at,
    created_at, updated_at, is_active, is_deleted,
    status_lookup:order_statuses!orders_status_id_fkey(id, code, name),
    requester:users!orders_requested_by_fkey(
      id, vinfast_id, email, first_name, last_name
    ),
    from_area:areas!orders_from_area_id_fkey(id, code, name),
    to_area:areas!orders_to_area_id_fkey(id, code, name),
    order_items${hasItemFilters(filters) ? '!inner' : ''}(
      id, order_id, supply_id, provider_id, unit_id,
      quantity_requested, set_per_qty, requested_stack_quantity,
      requested_total_set_quantity, quantity_approved, quantity_issued,
      note, is_active, is_deleted, created_at, updated_at,
      supply:supplies!order_items_supply_id_fkey${hasItemFilters(filters) ? '!inner' : ''}(
        id, code, description, category_id,
        category:supply_categories!supplies_category_id_fkey(id, code, name)
      ),
      provider:providers!order_items_provider_id_fkey(id, code, name, description),
      unit:units!order_items_unit_id_fkey(id, code, symbol)
    )
  )
`;

const SHEET_INCOMING_SELECT = `
  ${SHEET_BASE_SELECT},
  orders:orders!orders_shift_order_sheet_id_fkey(
    id, is_deleted,
    status_lookup:order_statuses!orders_status_id_fkey(id, code, name),
    order_items(id, is_deleted)
  )
`;

const SHEET_EXPORT_SELECT = `
  ${SHEET_BASE_SELECT},
  orders:orders!orders_shift_order_sheet_id_fkey(
    id, code, submitted_at, issued_at, note, is_deleted,
    status_lookup:order_statuses!orders_status_id_fkey(id, code, name),
    order_items(
      id, created_at, quantity_requested, quantity_approved, quantity_issued,
      set_per_qty, requested_stack_quantity, note, is_deleted,
      supply:supplies!order_items_supply_id_fkey(
        id, code, description,
        category:supply_categories!supplies_category_id_fkey(id, code)
      ),
      provider:providers!order_items_provider_id_fkey(id, code, name),
      unit:units!order_items_unit_id_fkey(id, code, symbol)
    )
  )
`;

export class ShiftOrderSheetsService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get db() {
    return this.fastify.supabaseAdmin;
  }

  private areaScopes(actor: ShiftOrderSheetActor): AreaScopesService {
    return new AreaScopesService(this.fastify, actor);
  }

  private normalize(row: SheetRow) {
    const shift = firstRelation(row.work_shift);
    return {
      ...row,
      area: firstRelation(row.area as object | object[] | null),
      work_shift: shift,
      leader: firstRelation(row.leader as object | object[] | null),
      ...shiftBounds(row.work_date, shift),
      order_count: (row.orders ?? []).length,
      item_count: (row.orders ?? []).reduce(
        (total, order) => total + (order.order_items ?? []).filter((item) => !item.is_deleted).length,
        0,
      ),
      business_time_zone: BUSINESS_TIME_ZONE,
    };
  }

  private normalizeDetail(row: SheetRow & { orders: Array<Record<string, unknown>> }) {
    const normalized = this.normalize(row);
    return {
      ...normalized,
      orders: (row.orders ?? [])
        .filter((order) => !order.is_deleted)
        .map((order): Record<string, unknown> => ({
          ...order,
          status_lookup: firstRelation(
            (order.status_lookup ?? null) as object | object[] | null,
          ),
          requester: firstRelation(
            (order.requester ?? null) as object | object[] | null,
          ),
          from_area: firstRelation(
            (order.from_area ?? null) as object | object[] | null,
          ),
          to_area: firstRelation(
            (order.to_area ?? null) as object | object[] | null,
          ),
          order_items: ((order.order_items ?? []) as Array<Record<string, unknown>>)
            .filter((item) => !item.is_deleted)
            .map((item): Record<string, unknown> => ({
              ...item,
              supply: firstRelation((item.supply ?? null) as object | object[] | null),
              provider: firstRelation((item.provider ?? null) as object | object[] | null),
              unit: firstRelation((item.unit ?? null) as object | object[] | null),
            }))
            .sort((left, right) => {
              const time = String(right['created_at']).localeCompare(String(left['created_at']));
              return time || String(right['id']).localeCompare(String(left['id']));
            }),
        }))
        .sort((left, right) => {
          const leftTime = String(left['submitted_at'] ?? left['created_at']);
          const rightTime = String(right['submitted_at'] ?? right['created_at']);
          const time = rightTime.localeCompare(leftTime);
          return time || String(right['id']).localeCompare(String(left['id']));
        }),
    };
  }

  /**
   * The supplying Area fulfils Orders rather than raising them, so its staff get
   * the Sheet screen for approving the markets but not the "+ Thêm Order" action.
   */
  private async canCreateOrderFromArea(actor: ShiftOrderSheetActor): Promise<boolean> {
    if (actor.isSystemAdmin) return true;
    const { data } = await this.db
      .from('areas')
      .select('code')
      .eq('id', actor.areaId)
      .maybeSingle();
    return (data as { code: string } | null)?.code !== ORDER_SOURCE_AREA_CODE;
  }

  private async readableAreaIds(actor: ShiftOrderSheetActor): Promise<string[]> {
    const scopes = await this.areaScopes(actor).getEffectiveAreaTypeScopes();
    return resolveReadableAreaIds(
      actor,
      scopes.flatMap((scope) => scope.areas.map((area) => area.id)),
    );
  }

  private async assertReadable(
    actor: ShiftOrderSheetActor,
    row: Pick<SheetRow, 'area_id'>,
  ): Promise<void> {
    const scopes = await this.areaScopes(actor).getEffectiveAreaTypeScopes();
    const scopedAreaIds = scopes.flatMap((scope) => scope.areas.map((area) => area.id));
    if (!canReadSheetArea(actor, scopedAreaIds, row.area_id)) {
      fail(403, 'Phiếu Order Ca nằm ngoài phạm vi Area được cấp cho bạn');
    }
  }

  async list(actor: ShiftOrderSheetActor, query: ShiftOrderSheetListQuery = {}) {
    const pagination = parsePagination(query, {
      allowedSortBy: SHIFT_ORDER_SHEET_SORT_FIELDS,
      defaultSortBy: 'work_date',
      defaultSortOrder: 'desc',
    });

    // Area Type Scope is the ceiling; an actor without approval authority is
    // pinned to their own Area on top of it, so history cannot leak a sibling
    // market that merely shares the same Area Type.
    const readableAreaIds = await this.readableAreaIds(actor);
    if (query.areaId && !readableAreaIds.includes(query.areaId)) {
      fail(403, 'Phiếu Order Ca nằm ngoài phạm vi Area được cấp cho bạn');
    }
    if (readableAreaIds.length === 0) return createPaginatedResult([], pagination, 0);

    const filters = normalizeContentFilters({
      search: pagination.search ?? undefined,
      statusId: query.statusId,
      categoryId: query.categoryId,
    });

    let request = this.db
      .from('supply_shift_order_sheets')
      .select(createSheetListSelect(filters), { count: 'exact' })
      .eq('is_deleted', false)
      .eq('orders.is_deleted', false);

    if (hasItemFilters(filters)) {
      request = request.eq('orders.order_items.is_deleted', false);
    }
    if (filters.statusId) request = request.eq('orders.status_id', filters.statusId);
    if (filters.categoryId) {
      request = request.eq('orders.order_items.supply.category_id', filters.categoryId);
    }
    if (filters.search) {
      request = request.ilike('orders.order_items.supply.code', `%${filters.search}%`);
    }

    request = request.in('area_id', readableAreaIds);
    if (query.workDate) request = request.eq('work_date', query.workDate);
    if (query.workShiftId) request = request.eq('work_shift_id', query.workShiftId);
    if (query.leaderId) request = request.eq('leader_id', query.leaderId);
    if (query.areaId) {
      request = request.eq('area_id', query.areaId);
    }

    request = request.order(pagination.sortBy, {
      ascending: pagination.sortOrder === 'asc',
    });
    request = request.order('id', { ascending: true });

    const { data, error, count } = await request.range(pagination.from, pagination.to);
    const result = resolvePaginatedQueryResult({ data, error, count }, pagination);
    if (!result) {
      if (error) databaseError(error, 'Không thể tải Phiếu Order Ca');
      throw new Error('Unreachable pagination state');
    }
    return {
      ...result,
      items: result.items.map((row) => this.normalize(row as unknown as SheetRow)),
    };
  }

  async get(
    actor: ShiftOrderSheetActor,
    sheetId: string,
    query: ShiftOrderSheetDetailQuery = {},
  ) {
    const filters = normalizeContentFilters(query);
    let request = this.db
      .from('supply_shift_order_sheets')
      .select(createSheetDetailSelect(filters))
      .eq('id', sheetId)
      .eq('is_deleted', false)
      .eq('orders.is_deleted', false);

    if (hasItemFilters(filters)) {
      request = request.eq('orders.order_items.is_deleted', false);
    }
    if (filters.statusId) request = request.eq('orders.status_id', filters.statusId);
    if (filters.categoryId) {
      request = request.eq('orders.order_items.supply.category_id', filters.categoryId);
    }
    if (filters.search) {
      request = request.ilike('orders.order_items.supply.code', `%${filters.search}%`);
    }

    const { data, error } = await request.single();

    if (error || !data) databaseError(error, 'Không thể tải Phiếu Order Ca');
    const row = data as unknown as SheetRow & { orders: Array<Record<string, unknown>> };
    await this.assertReadable(actor, row);
    return this.normalizeDetail(row);
  }

  async getCurrent(actor: ShiftOrderSheetActor) {
    if (!actor.areaId) fail(409, 'Bạn chưa được gán khu vực làm việc.');
    // Deliberately not asserted against the Area Type scope. This reads the
    // caller's OWN Area and nothing else, so there is nothing here to leak, and
    // the supplying Area belongs to no Area Type on purpose — asserting would
    // lock its own staff out of the screen where they approve the markets.

    const now = new Date().toISOString();
    const [areaResult, shiftResult] = await Promise.all([
      this.db
        .from('areas')
        .select('id, code, name')
        .eq('id', actor.areaId)
        .eq('is_active', true)
        .eq('is_deleted', false)
        .maybeSingle(),
      this.db.rpc('resolve_user_work_shift_instance', {
        p_user_id: actor.id,
        p_at: now,
      }),
    ]);

    if (areaResult.error || !areaResult.data) {
      fail(409, 'Bạn chưa được gán khu vực làm việc.');
    }
    if (shiftResult.error) {
      if (/WORK_SHIFT_ASSIGNMENT_NOT_FOUND|WORK_SHIFT_NOT_AVAILABLE/.test(shiftResult.error.message)) {
        fail(409, 'Bạn chưa được gán ca làm việc hiện tại.');
      }
      databaseError(shiftResult.error, 'Không thể xác định ca làm việc hiện tại');
    }

    const shift = (shiftResult.data as ResolvedShiftRow[] | null)?.[0];
    if (!shift) return fail(409, 'Bạn chưa được gán ca làm việc hiện tại.');

    const context = {
      area_id: actor.areaId,
      work_shift_id: shift.work_shift_id,
      work_date: shift.work_date,
      area: areaResult.data,
      work_shift: {
        id: shift.work_shift_id,
        code: shift.work_shift_code,
        name: shift.work_shift_name,
      },
      shift_start_at: shift.shift_start_at,
      shift_end_at: shift.shift_end_at,
      // Resolved in Postgres against Asia/Ho_Chi_Minh with crosses_midnight
      // already applied, so the client never has to redo shift arithmetic.
      is_outside_working_hours: shift.is_overtime,
      business_time_zone: BUSINESS_TIME_ZONE,
      // Resolved server-side so the button and the endpoint can never disagree
      // about whether this Area is allowed to raise Orders.
      can_create_order: await this.canCreateOrderFromArea(actor),
    } as const;

    const { data, error } = await this.db
      .from('supply_shift_order_sheets')
      .select(createSheetDetailSelect({}))
      .eq('area_id', actor.areaId)
      .eq('work_shift_id', shift.work_shift_id)
      .eq('work_date', shift.work_date)
      .eq('is_deleted', false)
      .eq('orders.is_deleted', false)
      .maybeSingle();

    if (error) databaseError(error, 'Không thể tải Phiếu Order Ca hiện tại');
    if (!data) return { context, sheet: null };

    const row = data as unknown as SheetRow & { orders: Array<Record<string, unknown>> };
    return { context, sheet: this.normalizeDetail(row) };
  }

  /**
   * Phiếu order từ các thị trường: the Sheets of the Areas that order out of the
   * actor's own supplying Area, narrowed to a single shift instance.
   *
   * The shift instance (work_date + work_shift_id) comes from the caller's
   * current Sheet context, so anything raised on another date or another shift
   * is by definition an older Sheet and belongs in history rather than in the
   * shift being worked right now.
   */
  async listIncoming(
    actor: ShiftOrderSheetActor,
    query: ShiftOrderSheetIncomingQuery,
  ) {
    const scopes = await this.areaScopes(actor).getEffectiveAreaTypeScopes();
    const incomingAreaIds = resolveIncomingAreaIds(
      actor,
      scopes.flatMap((scope) => scope.areas.map((area) => area.id)),
    );
    if (incomingAreaIds.length === 0) return [];

    const { data, error } = await this.db
      .from('supply_shift_order_sheets')
      .select(SHEET_INCOMING_SELECT)
      .in('area_id', incomingAreaIds)
      .eq('work_date', query.workDate)
      .eq('work_shift_id', query.workShiftId)
      .eq('is_deleted', false)
      .eq('orders.is_deleted', false)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    if (error) databaseError(error, 'Không thể tải phiếu order từ các thị trường');
    return ((data ?? []) as unknown as IncomingSheetRow[])
      .map((row) => this.normalizeIncoming(row));
  }

  private normalizeIncoming(row: IncomingSheetRow) {
    const pendingOrderCount = (row.orders ?? [])
      .filter((order) => !order.is_deleted)
      .filter((order) => firstRelation(order.status_lookup)?.code === 'PENDING')
      .length;
    const { orders: _orders, ...summary } = this.normalize(row as unknown as SheetRow);
    return { ...summary, pending_order_count: pendingOrderCount };
  }

  async export(actor: ShiftOrderSheetActor, sheetId: string) {
    const { data, error } = await this.db
      .from('supply_shift_order_sheets')
      .select(SHEET_EXPORT_SELECT)
      .eq('id', sheetId)
      .eq('is_deleted', false)
      .single();

    if (error || !data) databaseError(error, 'Không thể tải Phiếu Order Ca để xuất Excel');
    const row = data as unknown as ExportSheetRow;
    await this.assertReadable(actor, row);

    const source: ShiftOrderSheetExportSource = {
      id: row.id,
      work_date: row.work_date,
      area: firstRelation(row.area as ExportRelation | ExportRelation[] | null) as {
        code: string;
        name: string;
      } | null,
      work_shift: firstRelation(row.work_shift) as {
        code: string;
        name: string;
      } | null,
      orders: (row.orders ?? [])
        .filter((order) => !order.is_deleted)
        .map((order): ShiftOrderSheetExportOrder => ({
          id: order.id,
          code: order.code,
          submitted_at: order.submitted_at,
          issued_at: order.issued_at,
          note: order.note,
          is_deleted: order.is_deleted,
          status: firstRelation(order.status_lookup),
          order_items: (order.order_items ?? [])
            .filter((item) => !item.is_deleted)
            .map((item): ShiftOrderSheetExportItem => {
              const supply = firstRelation(item.supply as (ExportRelation & {
                category: unknown;
              }) | Array<ExportRelation & { category: unknown }> | null);
              const provider = firstRelation(
                item.provider as ExportRelation | ExportRelation[] | null,
              );
              const unit = firstRelation(
                item.unit as { code: string; symbol: string | null }
                  | Array<{ code: string; symbol: string | null }> | null,
              );
              const category = supply
                ? firstRelation(supply.category as ExportRelation | ExportRelation[] | null)
                : null;
              return {
                id: item.id,
                created_at: item.created_at,
                quantity_requested: item.quantity_requested,
                quantity_approved: item.quantity_approved,
                quantity_issued: item.quantity_issued,
                set_per_qty: item.set_per_qty,
                requested_stack_quantity: item.requested_stack_quantity,
                note: item.note,
                supply: supply ? {
                  code: supply.code,
                  description: supply.description ?? null,
                  category: category ? { code: category.code } : null,
                } : null,
                provider: provider ? {
                  code: provider.code,
                  name: provider.name ?? '',
                } : null,
                unit: unit ? { code: unit.code, symbol: unit.symbol ?? null } : null,
              };
            }),
        })),
    };

    try {
      return {
        buffer: await createShiftOrderSheetWorkbook(source),
        fileName: createShiftOrderSheetExportFilename(source),
      };
    } catch (error) {
      if (error instanceof ShiftOrderSheetExportError) {
        fail(422, error.message);
      }
      throw error;
    }
  }
}

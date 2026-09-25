import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  ORDER_STATUS,
  type OrderStatus,
} from '../domain/enums';
import {
  PERMISSION_CODE,
  type PermissionCode,
} from '../domain/permission-codes';
import {
  canReadOrder,
  isOrderAreaScoped,
  type OrderReadAccess,
  ORDER_SOURCE_AREA_CODE,
} from '../domain/order-access';
import {
  assertApprovedQuantity,
  assertCancelReason,
  assertOrderActionAllowed,
  assertPositiveQuantity,
  assertRejectedReason,
  calculateStockAvailability,
  assertWholeStackApproval,
  findApprovalStockExcess,
  isOrderItemIssueClosed,
  isOrderStatusUpdateExpired,
  ORDER_STATUS_UPDATE_EXPIRED_MESSAGE,
  OrderRuleError,
} from '../domain/orderRules';
import { hasPermission } from './authorization.service';
import type {
  ApproveOrderBody,
  CancelOrderBody,
  ConfirmStackItemBody,
  CreateOrderBody,
  IssueOrderBody,
  OrderListItemInput,
  OrderListQuery,
  PatchOrderBody,
  ReceiveOrderBody,
  RejectOrderBody,
} from '../interfaces/orders';
import { ORDER_SORT_FIELDS } from '../schemas/orders';
import { parsePagination, resolvePaginatedQueryResult } from '../utils/pagination';
import { NOTIFICATION_TYPE, type NotificationType } from '../interfaces/notifications';
import { NotificationsService } from './notifications.service';
import { kickTeamsDispatcher } from '../teams/dispatcher';

export interface OrderActor extends OrderReadAccess {
  id: string;
  permissions: PermissionCode[];
}

interface SupplyLookup {
  id: string;
  unit_id: string;
  is_active: boolean;
  is_deleted: boolean;
  category: {
    code: string;
    is_active: boolean;
    is_deleted: boolean;
  } | Array<{
    code: string;
    is_active: boolean;
    is_deleted: boolean;
  }> | null;
}

interface OrderItemData {
  id: string;
  order_id: string;
  supply_id: string;
  provider_id: string;
  unit_id: string;
  quantity_requested: number | string;
  set_per_qty: number | string | null;
  requested_stack_quantity: number | string | null;
  requested_total_set_quantity: number | string | null;
  quantity_approved: number | string | null;
  quantity_issued: number | string | null;
  note: string | null;
  available_quantity?: number;
  shortage_quantity?: number;
  has_stock_shortage?: boolean;
  available_stack_quantity?: number;
  /** Labels of the pooled row this item draws from: where to pick. */
  locations?: AllocationLocationData[];
  allocations?: OrderItemAllocationData[];
  supply?: { id: string; code: string } | Array<{ id: string; code: string }> | null;
}

interface AllocationLocationData {
  id: string;
  code: string;
  name: string;
}

interface AllocationStockBalanceData {
  id: string;
  location_labels?: Array<{
    storage_location: AllocationLocationData | AllocationLocationData[] | null;
  }> | null;
}

interface AllocationReasonData {
  id: string;
  code: string;
  name: string;
  direction: 'LOWER' | 'HIGHER';
  corrects_stock: boolean;
}

/**
 * The stack-count confirmation of one order item. expected = approved stacks,
 * actual = confirmed stacks; status goes CONFIRMED -> ISSUED.
 */
interface OrderItemAllocationData {
  id: string;
  order_item_id: string;
  stock_balance_id: string;
  expected_stack_quantity: number | string;
  actual_stack_quantity: number | string | null;
  status: 'CONFIRMED' | 'ISSUED' | null;
  reason_note: string | null;
  allocated_at: string;
  confirmed_at: string | null;
  issued_at: string | null;
  is_active: boolean;
  is_deleted: boolean;
  reason?: AllocationReasonData | AllocationReasonData[] | null;
  stock_balance?: AllocationStockBalanceData | AllocationStockBalanceData[] | null;
  locations?: AllocationLocationData[];
  discrepancies?: InventoryDiscrepancyData[];
}

interface InventoryDiscrepancyUserData {
  id: string;
  vinfast_id: string;
  first_name: string;
  last_name: string;
}

interface InventoryDiscrepancyData {
  id: string;
  stock_balance_id: string;
  order_id: string;
  order_item_id: string;
  allocation_id: string;
  expected_stack_quantity: number | string;
  actual_stack_quantity: number | string;
  difference_stack_quantity: number | string;
  reason: string | null;
  status: 'OPEN' | 'RESOLVED';
  source: 'CONFIRMATION' | 'ISSUE';
  reported_by: string;
  reported_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  reporter?: InventoryDiscrepancyUserData | InventoryDiscrepancyUserData[] | null;
  resolver?: InventoryDiscrepancyUserData | InventoryDiscrepancyUserData[] | null;
}

interface StockBalanceAvailabilityRow {
  supply_id: string;
  provider_id: string;
  quantity: number | string;
  set_per_qty: number | string | null;
  stack_quantity: number | string | null;
  location_labels?: Array<{
    storage_location: AllocationLocationData | AllocationLocationData[] | null;
  }> | null;
}

interface SupplyProviderLookup {
  supply_id: string;
  provider_id: string;
}

interface OrderData {
  id: string;
  code: string;
  requested_by: string;
  from_area_id: string;
  to_area_id: string;
  status_id: string;
  shift_order_sheet_id: string | null;
  updated_at: string;
  status_lookup: {
    id: string;
    code: OrderStatus;
    name: string;
    is_active: boolean;
    is_deleted: boolean;
  };
  order_items: OrderItemData[];
  [key: string]: unknown;
}

/** The slice of the Order's Sheet that decides the status-update deadline. */
interface ShiftSheetWindow {
  work_date?: string;
  work_shift?: {
    end_time?: string;
    crosses_midnight?: boolean;
  } | Array<{
    end_time?: string;
    crosses_midnight?: boolean;
  }> | null;
}

interface SupabaseErrorLike {
  code?: string;
  message?: string;
  details?: string;
}

export class OrderServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'OrderServiceError';
  }
}

function serviceError(
  statusCode: number,
  message: string,
  details?: Record<string, unknown>,
  code?: string,
): never {
  throw new OrderServiceError(statusCode, message, details, code);
}

function translateRuleError(error: unknown): never {
  if (error instanceof OrderRuleError) {
    serviceError(409, error.message);
  }
  throw error;
}

function databaseError(error: SupabaseErrorLike | null, fallback: string): never {
  if (error?.code === 'PGRST116') serviceError(404, 'Order not found');
  serviceError(400, error?.message ?? fallback);
}

function normalizeListDate(
  value: string | undefined,
  field: string,
  endOfDay = false,
): string | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
    : value;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) serviceError(400, `${field} không hợp lệ`);
  return parsed.toISOString();
}

function rpcError(error: SupabaseErrorLike): never {
  const message = error.message ?? 'Cannot issue order';
  if (/does not belong to the order source area|inactive, deleted/i.test(message)) {
    serviceError(400, message);
  }
  if (/stock balance not found/i.test(message)) serviceError(409, message);
  if (/not found/i.test(message)) serviceError(404, message);
  if (/stock|approved|status|issue|location|must be PENDING/i.test(message)) {
    serviceError(409, message);
  }
  serviceError(400, message);
}

function parseRpcDetails(details?: string): Record<string, unknown> | undefined {
  if (!details) return undefined;
  try {
    const parsed: unknown = JSON.parse(details);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

export const ORDER_OUTSIDE_WORK_SHIFT_MESSAGE =
  'Không thể tạo Order do đã ngoài thời gian quy định của ca làm việc.';

function createOrderRpcError(error: SupabaseErrorLike): never {
  const code = error.message ?? 'ORDER_CREATE_FAILED';
  const details = parseRpcDetails(error.details);
  const failures: Record<string, { status: number; message: string }> = {
    ORDER_CREATE_FORBIDDEN: {
      status: 403,
      message: 'Bạn không có quyền tạo Order.',
    },
    ORDER_REQUESTER_CONTEXT_INVALID: {
      status: 403,
      message: 'Tài khoản hoặc Area nhận không hợp lệ.',
    },
    ORDER_SOURCE_AREA_INVALID: {
      status: 409,
      message: `Không tìm thấy Area nguồn ${ORDER_SOURCE_AREA_CODE} đang hoạt động.`,
    },
    ORDER_ITEMS_REQUIRED: {
      status: 400,
      message: 'Order phải có ít nhất một dòng vật tư.',
    },
    ORDER_ITEM_REFERENCE_INVALID: {
      status: 400,
      message: 'Vật tư hoặc Provider của Order không hợp lệ.',
    },
    ORDER_ITEM_ZERO_STOCK: {
      status: 409,
      message: 'Vật tư hiện không còn tồn tại khu vực cấp. Không thể tạo Order.',
    },
    ORDER_SHIFT_LEADER_NOT_FOUND: {
      status: 409,
      message: 'Không xác định được Tổ trưởng từ hierarchy managed_by.',
    },
    ORDER_OUTSIDE_WORK_SHIFT_WINDOW: {
      status: 403,
      message: ORDER_OUTSIDE_WORK_SHIFT_MESSAGE,
    },
    WORK_SHIFT_ASSIGNMENT_NOT_FOUND: {
      status: 409,
      message: 'Tài khoản chưa có ca làm việc hiệu lực tại thời điểm tạo Order.',
    },
    WORK_SHIFT_NOT_AVAILABLE: {
      status: 409,
      message: 'Ca làm việc không tồn tại hoặc không hoạt động.',
    },
    ORDER_SHIFT_SHEET_CONTEXT_INVALID: {
      status: 403,
      message: 'Phiếu Order Ca không thuộc đúng Area, ca hoặc ngày làm việc.',
    },
    SHIFT_ORDER_SHEET_NOT_AVAILABLE: {
      status: 409,
      message: 'Phiếu Order Ca không còn hoạt động.',
    },
    ORDER_STATUS_NOT_FOUND: {
      status: 409,
      message: 'Trạng thái PENDING không tồn tại hoặc đã ngừng hoạt động.',
    },
    ORDER_SUBMITTED_AT_INVALID: {
      status: 400,
      message: 'Thời điểm tạo Order không hợp lệ.',
    },
  };
  const failure = failures[code];
  if (failure) serviceError(failure.status, failure.message, details, code);

  // Validation errors from the shared item normalizer are already written for
  // operators and are safe to preserve as a 400 response.
  serviceError(400, code === 'ORDER_CREATE_FAILED' ? 'Không thể tạo Order.' : code, details, code);
}

/**
 * review_order repeats the service's approval checks under the Order lock, so
 * stock can have moved in between; its codes are mapped rather than regex-matched.
 */
function approvalRpcError(error: SupabaseErrorLike): never {
  const code = error.message ?? '';
  const details = parseRpcDetails(error.details);
  if (code === 'ORDER_APPROVAL_EXCEEDS_STOCK') {
    serviceError(
      409,
      `Số duyệt vượt tồn khu vực cấp: ${details?.supply_code ?? 'vật tư'} duyệt ${details?.approved_quantity ?? '?'}, tồn ${details?.available_quantity ?? '?'}.`,
      details,
      code,
    );
  }
  if (code === 'STACK_APPROVAL_NOT_COMPATIBLE') {
    serviceError(409, 'Kiện tiêu chuẩn phải duyệt theo bội số SET/chồng.', details, code);
  }
  if (code === 'Invalid approved quantity or order item') {
    serviceError(400, 'Số duyệt phải là số nguyên không âm và thuộc đúng Order.', details, 'ORDER_APPROVAL_INVALID');
  }
  rpcError(error);
}

function confirmationRpcError(error: SupabaseErrorLike): never {
  const code = error.message ?? 'CONFIRM_ALLOCATION_FAILED';
  const details = parseRpcDetails(error.details);
  const failures: Record<string, { status: number; message: string }> = {
    CONFIRM_ALLOCATION_FORBIDDEN: {
      status: 403,
      message: 'Missing supply.order.confirm_allocation permission',
    },
    ORDER_ITEM_NOT_FOUND: { status: 404, message: 'Order item not found' },
    ACTUAL_STACK_INVALID: {
      status: 400,
      message: 'Số chồng xác nhận phải là số nguyên lớn hơn hoặc bằng 0.',
    },
    ALLOCATION_ALREADY_CONFIRMED: {
      status: 409,
      message: 'Dòng vật tư này đã được xác nhận số chồng trước đó.',
    },
    ORDER_NOT_CONFIRMABLE: {
      status: 409,
      message: 'Order hoặc OrderItem không ở trạng thái có thể xác nhận.',
    },
    STACK_APPROVAL_NOT_COMPATIBLE: {
      status: 409,
      message: 'Số lượng đã duyệt không tương thích với quy cách SET/chồng.',
    },
    CONFIRM_REASON_REQUIRED: {
      status: 400,
      message: 'Số chồng xác nhận khác số đã duyệt: phải chọn lý do.',
    },
    CONFIRM_REASON_DIRECTION_MISMATCH: {
      status: 400,
      message: 'Lý do không khớp chiều chênh lệch (nhận ít hơn / nhận thêm).',
    },
    DISCREPANCY_TRANSACTION_TYPE_NOT_FOUND: {
      status: 500,
      message: 'Thiếu transaction type DISCREPANCY_CORRECTION.',
    },
  };
  const failure = failures[code];
  if (failure) serviceError(failure.status, failure.message, details, code);
  serviceError(400, code, details);
}

function issueRpcError(error: SupabaseErrorLike): never {
  const code = error.message ?? 'ISSUE_FAILED';
  const details = parseRpcDetails(error.details);
  const failures: Record<string, { status: number; message: string }> = {
    ISSUE_FORBIDDEN: {
      status: 403,
      message: 'Bạn không có quyền cấp hàng theo Order.',
    },
    ORDER_NOT_FOUND: { status: 404, message: 'Không tìm thấy Order.' },
    ORDER_ITEM_NOT_FOUND: { status: 404, message: 'Không tìm thấy OrderItem.' },
    ORDER_NOT_ISSUABLE: {
      status: 409,
      message: 'Order không ở trạng thái có thể cấp hàng.',
    },
    ORDER_ALREADY_ISSUED: {
      status: 409,
      message: 'Order đã được cấp hàng; không thể trừ tồn lần nữa.',
    },
    STACK_ALLOCATIONS_NOT_CONFIRMED: {
      status: 409,
      message: 'Còn vật tư kiện tiêu chuẩn chưa xác nhận số chồng trước khi xuất hàng.',
    },
    NORMAL_ISSUE_STOCK_CONFLICT: {
      status: 409,
      message: 'Tồn kho không đủ để cấp hàng.',
    },
    ORDER_ISSUE_EXCEEDS_APPROVED: {
      status: 409,
      message: 'Số lượng cấp không được vượt số lượng đã duyệt.',
    },
    ISSUE_ITEMS_INVALID: {
      status: 400,
      message: 'Danh sách vật tư cấp hàng không hợp lệ.',
    },
    ISSUE_LOOKUP_NOT_FOUND: {
      status: 500,
      message: 'Thiếu dữ liệu danh mục phục vụ thao tác cấp hàng.',
    },
  };
  const failure = failures[code];
  if (failure) serviceError(failure.status, failure.message, details, code);
  rpcError(error);
}

const generateOrderCode = (): string => {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `ORD-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
};

const STACK_CATEGORY_CODE = 'KIEN_SAT_TC';

const firstRelation = <T>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : value;

const ORDER_USER_SELECT = 'id, vinfast_id, email, first_name, last_name';

const ORDER_LIST_SELECT = `
  *,
  status_lookup:order_statuses!orders_status_id_fkey(
    id, code, name, is_active, is_deleted
  ),
  from_area:areas!orders_from_area_id_fkey(id, code, name),
  to_area:areas!orders_to_area_id_fkey(id, code, name),
  requester:users!orders_requested_by_fkey(${ORDER_USER_SELECT}),
  approver:users!orders_approved_by_fkey(${ORDER_USER_SELECT}),
  forklift:users!orders_forklift_by_fkey(${ORDER_USER_SELECT}),
  taken_away:users!orders_taken_away_by_fkey(${ORDER_USER_SELECT})
  ,shift_order_sheet:supply_shift_order_sheets!orders_shift_order_sheet_id_fkey(
    id, area_id, work_shift_id, work_date, leader_id,
    area:areas!supply_shift_order_sheets_area_id_fkey(id, code, name),
    work_shift:work_shifts!supply_shift_order_sheets_work_shift_id_fkey(
      id, code, name, start_time, end_time, crosses_midnight
    ),
    leader:users!supply_shift_order_sheets_leader_id_fkey(
      ${ORDER_USER_SELECT}
    )
  )
`;

const ORDER_LIST_WORK_SHIFT_FILTER_SELECT = ORDER_LIST_SELECT.replace(
  'supply_shift_order_sheets!orders_shift_order_sheet_id_fkey',
  'supply_shift_order_sheets!inner',
);

const ORDER_DETAIL_SELECT = `
  ${ORDER_LIST_SELECT},
  order_items(
    *,
    supply:supplies!order_items_supply_id_fkey(id, code, description),
    provider:providers!order_items_provider_id_fkey(
      id, code, name, description
    ),
    unit:units!order_items_unit_id_fkey(id, code, symbol),
    allocations:order_item_allocations!order_item_allocations_order_item_fkey(
      id,
      order_item_id,
      stock_balance_id,
      expected_stack_quantity,
      actual_stack_quantity,
      status,
      reason_note,
      allocated_at,
      confirmed_at,
      issued_at,
      is_active,
      is_deleted,
      reason:allocation_confirm_reasons!order_item_allocations_reason_fkey(
        id, code, name, direction, corrects_stock
      ),
      discrepancies:inventory_discrepancies!inventory_discrepancies_allocation_fkey(
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
        source,
        reported_by,
        reported_at,
        resolved_by,
        resolved_at,
        resolution_note,
        reporter:users!inventory_discrepancies_reported_by_fkey(
          id, vinfast_id, first_name, last_name
        ),
        resolver:users!inventory_discrepancies_resolved_by_fkey(
          id, vinfast_id, first_name, last_name
        )
      ),
      stock_balance:stock_balances!order_item_allocations_stock_balance_fkey(
        id,
        location_labels:stock_balance_locations!stock_balance_locations_balance_fkey(
          storage_location:storage_locations!stock_balance_locations_location_fkey(
            id, code, name
          )
        )
      )
    )
  ),
  order_revisions(
    id, order_id, action_id, old_status_id, new_status_id, reason, created_by, created_at,
    action:order_revision_actions!order_revisions_action_id_fkey(id, code, name),
    creator:users!order_revisions_created_by_fkey(
      ${ORDER_USER_SELECT}
    ),
    old_status:order_statuses!order_revisions_old_status_id_fkey(id, code, name),
    new_status:order_statuses!order_revisions_new_status_id_fkey(id, code, name)
  )
`;

export class OrderService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get db() {
    return this.fastify.supabaseAdmin;
  }

  private statusCode(order: OrderData): OrderStatus {
    const status = order.status_lookup;
    if (!status || !status.is_active || status.is_deleted) {
      serviceError(409, 'Order status lookup is inactive or missing');
    }
    return status.code;
  }

  private async getStatusId(code: string): Promise<string> {
    const normalized = code.trim().toUpperCase();
    const { data, error } = await this.db
      .from('order_statuses')
      .select('id')
      .eq('code', normalized)
      .eq('is_active', true)
      .eq('is_deleted', false)
      .single();
    if (error || !data) serviceError(400, `Invalid order status code: ${normalized}`);
    return data.id as string;
  }

  private async findOrder(orderId: string): Promise<OrderData> {
    const { data, error } = await this.db
      .from('orders')
      .select(ORDER_DETAIL_SELECT)
      .eq('id', orderId)
      .eq('is_deleted', false)
      .single();

    if (error || !data) databaseError(error, 'Cannot get order');
    const order = data as OrderData;
    const normalizedOrder: OrderData = {
      ...order,
      order_items: order.order_items.map((item) => ({
        ...item,
        allocations: (item.allocations ?? [])
          .filter((allocation) => allocation.is_active && !allocation.is_deleted)
          .map((allocation) => {
          const stockBalance = firstRelation(allocation.stock_balance ?? null);
          const locations = (stockBalance?.location_labels ?? [])
            .map((label) => firstRelation(label.storage_location))
            .filter((location): location is AllocationLocationData => location !== null)
            .sort((left, right) => left.code.localeCompare(right.code));
          return {
            id: allocation.id,
            order_item_id: allocation.order_item_id,
            stock_balance_id: allocation.stock_balance_id,
            expected_stack_quantity: Number(allocation.expected_stack_quantity),
            actual_stack_quantity: allocation.actual_stack_quantity === null
              ? null
              : Number(allocation.actual_stack_quantity),
            status: allocation.status,
            reason: firstRelation(allocation.reason ?? null),
            reason_note: allocation.reason_note,
            allocated_at: allocation.allocated_at,
            confirmed_at: allocation.confirmed_at,
            issued_at: allocation.issued_at,
            is_active: allocation.is_active,
            is_deleted: allocation.is_deleted,
            locations,
            discrepancies: (allocation.discrepancies ?? []).map((discrepancy) => ({
              ...discrepancy,
              expected_stack_quantity: Number(discrepancy.expected_stack_quantity),
              actual_stack_quantity: Number(discrepancy.actual_stack_quantity),
              difference_stack_quantity: Number(discrepancy.difference_stack_quantity),
              reporter: firstRelation(discrepancy.reporter ?? null),
              resolver: firstRelation(discrepancy.resolver ?? null),
            })),
            };
          }),
      })),
    };
    return this.attachStockAvailability(normalizedOrder);
  }

  /**
   * Receive / complete / cancel. The status write and its order_revisions row
   * commit together (transition_order_status), which is what the Teams outbox
   * hooks on. When the Order has moved on since `order` was read, nothing is
   * written — the same outcome the old conditional UPDATE had.
   */
  private async transitionStatus(
    actor: OrderActor,
    order: OrderData,
    target: OrderStatus,
    extra: { cancelReason?: string; takenAwayBy?: string },
    failure: string,
  ): Promise<void> {
    const { error } = await this.db.rpc('transition_order_status', {
      p_order_id: order.id,
      p_actor_id: actor.id,
      p_expected_status_id: order.status_id,
      p_target_status_code: target,
      p_cancel_reason: extra.cancelReason ?? null,
      p_taken_away_by: extra.takenAwayBy ?? null,
    });
    if (error) databaseError(error, failure);
  }

  private async finishStatusTransition(
    actor: OrderActor,
    previous: OrderData,
    type: NotificationType = NOTIFICATION_TYPE.ORDER_STATUS_CHANGED,
  ): Promise<OrderData> {
    const current = await this.findOrder(previous.id);
    if (previous.status_id === current.status_id) return current;
    // The revision has committed and queued its Teams message; send it now.
    kickTeamsDispatcher(this.fastify);
    try {
      await new NotificationsService(this.fastify).persistOrderTransition(
        actor,
        previous,
        current,
        type,
      );
    } catch (error) {
      // The Order transition has already committed. Do not return a misleading
      // mutation failure; persistence is post-commit, idempotent and observable.
      this.fastify.log.error({
        err: error,
        orderId: current.id,
        previousStatusId: previous.status_id,
        currentStatusId: current.status_id,
      }, 'Order notification persistence failed after committed transition');
    }
    return current;
  }

  private async attachStockAvailability(order: OrderData): Promise<OrderData> {
    const supplyIds = [...new Set(order.order_items.map((item) => item.supply_id))];
    if (supplyIds.length === 0) return order;

    const { data, error } = await this.db
      .from('stock_balances')
      .select(`
        supply_id, provider_id, quantity, set_per_qty, stack_quantity,
        location_labels:stock_balance_locations!stock_balance_locations_balance_fkey(
          storage_location:storage_locations!stock_balance_locations_location_fkey(id, code, name)
        )
      `)
      .eq('area_id', order.from_area_id)
      .eq('is_active', true)
      .eq('is_deleted', false)
      .in('supply_id', supplyIds);

    if (error) databaseError(error, 'Cannot calculate order stock availability');

    const availableByDimension = new Map<string, number>();
    const availableStacksByDimension = new Map<string, number>();
    // Where to go and pick, known before anyone confirms a count. Collected even
    // for empty rows: a label on a row the books show as empty is exactly where
    // a picker should look when the books are wrong.
    const locationsByDimension = new Map<string, AllocationLocationData[]>();
    for (const balance of (data ?? []) as unknown as StockBalanceAvailabilityRow[]) {
      const stackDimension = balance.set_per_qty === null
        ? 'normal'
        : String(Number(balance.set_per_qty));
      const key = `${balance.supply_id}:${balance.provider_id}:${stackDimension}`;
      locationsByDimension.set(key, (balance.location_labels ?? [])
        .map((label) => firstRelation(label.storage_location))
        .filter((location): location is AllocationLocationData => location !== null)
        .sort((left, right) => left.code.localeCompare(right.code)));
      const quantity = Number(balance.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      availableByDimension.set(
        key,
        (availableByDimension.get(key) ?? 0) + quantity,
      );
      if (balance.set_per_qty !== null) {
        const stackQuantity = Number(balance.stack_quantity);
        if (Number.isFinite(stackQuantity) && stackQuantity > 0) {
          availableStacksByDimension.set(
            key,
            (availableStacksByDimension.get(key) ?? 0) + stackQuantity,
          );
        }
      }
    }

    return {
      ...order,
      order_items: order.order_items.map((item) => {
        const stackDimension = item.set_per_qty === null
          ? 'normal'
          : String(Number(item.set_per_qty));
        const key = `${item.supply_id}:${item.provider_id}:${stackDimension}`;
        return {
          ...item,
          ...calculateStockAvailability(
            Number(item.quantity_requested),
            availableByDimension.get(key) ?? 0,
          ),
          available_stack_quantity: item.set_per_qty === null
            ? undefined
            : (availableStacksByDimension.get(key) ?? 0),
          locations: locationsByDimension.get(key) ?? [],
        };
      }),
    };
  }

  private assertPackingOwner(actor: OrderActor, order: OrderData): void {
    if (actor.isSystemAdmin) return;
    if (
      !hasPermission(actor, PERMISSION_CODE.SUPPLY_ORDER_CREATE) ||
      order.requested_by !== actor.id ||
      order.to_area_id !== actor.areaId
    ) {
      serviceError(403, 'Only the packing owner can modify this order');
    }
  }

  private assertOrderVisible(actor: OrderActor, order: OrderData): void {
    if (!canReadOrder(actor, order)) {
      serviceError(403, 'Order is outside your area scope');
    }
  }

  private async getOrderSourceAreaId(): Promise<string> {
    const { data, error } = await this.db
      .from('areas')
      .select('id')
      .eq('code', ORDER_SOURCE_AREA_CODE)
      .eq('is_active', true)
      .eq('is_deleted', false)
      .single();

    if (error || !data) {
      serviceError(
        500,
        `Order source area ${ORDER_SOURCE_AREA_CODE} is missing or inactive`,
      );
    }
    return data.id;
  }

  private async assertActiveReceivingArea(areaId: string): Promise<void> {
    const { data, error } = await this.db
      .from('areas')
      .select('id')
      .eq('id', areaId)
      .eq('is_active', true)
      .eq('is_deleted', false)
      .single();

    if (error || !data) {
      serviceError(400, 'User receiving area is missing or inactive');
    }
  }

  private async prepareOrderItems(
    orderList: OrderListItemInput[],
    fromAreaId: string,
  ): Promise<Array<OrderListItemInput & { unit_id: string }>> {
    if (!Array.isArray(orderList) || orderList.length === 0) {
      serviceError(400, 'order_list must contain at least one item');
    }

    for (const item of orderList) {
      if (!item?.supply_id) serviceError(400, 'supply_id is required');
      if (!item?.provider_id) serviceError(400, 'provider_id is required');
    }

    const supplyIds = [...new Set(orderList.map((item) => item.supply_id))];
    const providerIds = [...new Set(orderList.map((item) => item.provider_id))];
    const [suppliesResult, providersResult] = await Promise.all([
      this.db
        .from('supplies')
        .select(`
          id, unit_id, is_active, is_deleted,
          category:supply_categories!supplies_category_id_fkey(
            code, is_active, is_deleted
          )
        `)
        .in('id', supplyIds),
      this.db
        .from('supply_providers')
        .select(`
          supply_id,
          provider_id,
          provider:providers!supply_providers_provider_id_fkey!inner(id)
        `)
        .in('supply_id', supplyIds)
        .in('provider_id', providerIds)
        .eq('is_active', true)
        .eq('is_deleted', false)
        .eq('provider.is_active', true)
        .eq('provider.is_deleted', false),
    ]);

    if (suppliesResult.error) {
      databaseError(suppliesResult.error, 'Cannot validate supplies');
    }
    if (providersResult.error) {
      databaseError(providersResult.error, 'Cannot validate Supply Providers');
    }
    const supplyMap = new Map(
      ((suppliesResult.data ?? []) as SupplyLookup[])
        .map((supply) => [supply.id, supply]),
    );
    const linkedProviders = new Set(
      ((providersResult.data ?? []) as SupplyProviderLookup[])
        .map((relation) => `${relation.supply_id}:${relation.provider_id}`),
    );

    const stackItems = orderList.filter((item) => {
      const supply = supplyMap.get(item.supply_id);
      return firstRelation(supply?.category ?? null)?.code === STACK_CATEGORY_CODE;
    });
    const eligibleStackOptions = new Set<string>();
    if (stackItems.length > 0) {
      const { data: balances, error: balanceError } = await this.db
        .from('stock_balances')
        .select('supply_id, provider_id, set_per_qty, stack_quantity')
        .eq('area_id', fromAreaId)
        .eq('is_active', true)
        .eq('is_deleted', false)
        .gt('stack_quantity', 0)
        .not('set_per_qty', 'is', null)
        .in('supply_id', [...new Set(stackItems.map((item) => item.supply_id))])
        .in('provider_id', [...new Set(stackItems.map((item) => item.provider_id))]);
      if (balanceError) databaseError(balanceError, 'Cannot validate stack options');
      for (const balance of (balances ?? []) as Array<{
        supply_id: string;
        provider_id: string;
        set_per_qty: number | string;
      }>) {
        eligibleStackOptions.add(
          `${balance.supply_id}:${balance.provider_id}:${Number(balance.set_per_qty)}`,
        );
      }
    }

    return orderList.map((item) => {
      const supply = supplyMap.get(item.supply_id);
      if (!supply) {
        serviceError(400, `Supply ${item.supply_id} does not exist or is inactive`);
      }
      if (!supply.is_active || supply.is_deleted) {
        serviceError(400, `Supply ${item.supply_id} does not exist or is inactive`);
      }
      const category = firstRelation(supply.category);
      if (!category || !category.is_active || category.is_deleted) {
        serviceError(400, `Supply ${item.supply_id} category is inactive`);
      }
      if (!linkedProviders.has(`${item.supply_id}:${item.provider_id}`)) {
        serviceError(
          400,
          `Provider ${item.provider_id} is inactive or is not linked to Supply ${item.supply_id}`,
        );
      }
      if (category.code === STACK_CATEGORY_CODE) {
        try {
          assertPositiveQuantity(item.set_per_qty, 'set_per_qty');
          assertPositiveQuantity(
            item.requested_stack_quantity,
            'requested_stack_quantity',
          );
        } catch (error) {
          translateRuleError(error);
        }
        const setPerQty = Number(item.set_per_qty);
        const requestedStackQuantity = Number(item.requested_stack_quantity);
        const requestedTotal = setPerQty * requestedStackQuantity;
        if (Number(item.quantity_requested) !== requestedTotal) {
          serviceError(400, `quantity_requested mismatch: expected ${requestedTotal}`);
        }
        if (item.requested_total_set_quantity !== undefined
            && Number(item.requested_total_set_quantity) !== requestedTotal) {
          serviceError(
            400,
            `requested_total_set_quantity mismatch: expected ${requestedTotal}`,
          );
        }
        if (!eligibleStackOptions.has(
          `${item.supply_id}:${item.provider_id}:${setPerQty}`,
        )) {
          serviceError(
            400,
            'Selected set_per_qty is not available for Supply, Provider and source Area',
          );
        }
        return {
          ...item,
          quantity_requested: requestedTotal,
          set_per_qty: setPerQty,
          requested_stack_quantity: requestedStackQuantity,
          requested_total_set_quantity: requestedTotal,
          unit_id: item.unit_id ?? supply.unit_id,
        };
      }

      if (item.set_per_qty !== undefined
          || item.requested_stack_quantity !== undefined
          || item.requested_total_set_quantity !== undefined) {
        serviceError(400, 'Stack fields are only allowed for KIEN_SAT_TC');
      }
      try {
        assertPositiveQuantity(item.quantity_requested, 'quantity_requested');
      } catch (error) {
        translateRuleError(error);
      }
      return {
        ...item,
        quantity_requested: Number(item.quantity_requested),
        unit_id: item.unit_id ?? supply.unit_id,
      };
    });
  }

  /**
   * Refuses a create raised outside the nominal window of the requester's shift
   * instance.
   *
   * The authoritative guard lives inside create_pending_order_with_items, where
   * it runs in the same transaction as the inserts and therefore cannot be
   * bypassed by calling the API directly. This copy exists only to fail fast,
   * before the per-item supply/provider/stock reads are spent, and it reuses the
   * same resolver and the same timestamp so the two can never disagree.
   */
  private async assertWithinWorkShiftWindow(
    actorId: string,
    at: string,
  ): Promise<void> {
    const { data, error } = await this.db.rpc('resolve_user_work_shift_instance', {
      p_user_id: actorId,
      p_at: at,
    });
    if (error) {
      // Leave every other resolution failure to the transactional guard so this
      // pre-check can never invent an error the real create would not raise.
      return;
    }
    const shift = (data as Array<{ is_overtime: boolean }> | null)?.[0];
    if (shift?.is_overtime) {
      serviceError(403, ORDER_OUTSIDE_WORK_SHIFT_MESSAGE);
    }
  }

  async create(actor: OrderActor, body: CreateOrderBody) {
    if (!hasPermission(actor, PERMISSION_CODE.SUPPLY_ORDER_CREATE)) {
      serviceError(403, 'Missing supply.order.create permission');
    }
    if (!body?.from_area_id || !body.to_area_id) {
      serviceError(400, 'from_area_id and to_area_id are required');
    }
    const [sourceAreaId] = await Promise.all([
      this.getOrderSourceAreaId(),
      this.assertActiveReceivingArea(actor.areaId),
    ]);
    if (body.from_area_id !== sourceAreaId) {
      serviceError(400, `from_area_id must reference area code ${ORDER_SOURCE_AREA_CODE}`);
    }
    if (body.to_area_id !== actor.areaId) {
      serviceError(400, 'to_area_id must equal the current user area_id');
    }
    // The supplying Area fulfils Orders, it does not raise them. Left open, the
    // warehouse would appear as its own customer and its Sheets would mix real
    // market demand with its own entries.
    if (actor.areaId === sourceAreaId && !actor.isSystemAdmin) {
      serviceError(
        409,
        `Khu vực ${ORDER_SOURCE_AREA_CODE} là nguồn cấp phát nên không thể tự tạo Order cho chính mình.`,
      );
    }
    const submittedAt = new Date().toISOString();
    await this.assertWithinWorkShiftWindow(actor.id, submittedAt);
    const items = await this.prepareOrderItems(body.order_list, sourceAreaId);
    const { data: orderId, error } = await this.db.rpc(
      'create_pending_order_with_items',
      {
        p_code: generateOrderCode(),
        p_from_area_id: sourceAreaId,
        p_to_area_id: actor.areaId,
        p_requested_by: actor.id,
        p_note: body.note ?? null,
        p_items: items.map((item) => ({
          supply_id: item.supply_id,
          provider_id: item.provider_id,
          unit_id: item.unit_id,
          quantity_requested: item.quantity_requested,
          set_per_qty: item.set_per_qty ?? null,
          requested_stack_quantity: item.requested_stack_quantity ?? null,
          requested_total_set_quantity: item.requested_total_set_quantity ?? null,
          note: item.note ?? null,
        })),
        p_shift_order_sheet_id: body.shift_order_sheet_id ?? null,
        p_submitted_at: submittedAt,
      },
    );
    if (error) createOrderRpcError(error);
    if (!orderId) serviceError(400, 'Không thể tạo Order.');
    // The CREATE revision was written at commit and queued its Teams message.
    kickTeamsDispatcher(this.fastify);
    const order = await this.findOrder(orderId as string);
    try {
      await new NotificationsService(this.fastify).persistOrderCreated(actor, order);
    } catch (notificationError) {
      // Order creation has committed. Notification persistence is post-commit
      // and must never turn a successful Order into a false client failure.
      this.fastify.log.error({
        err: notificationError,
        orderId: order.id,
      }, 'Order notification persistence failed after committed create');
    }
    return order;
  }

  /**
   * Refuses a status change raised more than three hours after the shift the
   * Order belongs to has ended.
   *
   * The shift comes from the Order's own Sheet, already loaded by
   * ORDER_DETAIL_SELECT, so this costs no extra read. An Order with no Sheet has
   * no shift to age against and is left alone.
   */
  private assertWithinStatusUpdateWindow(order: OrderData): void {
    const sheet = firstRelation(
      (order.shift_order_sheet ?? null) as ShiftSheetWindow | ShiftSheetWindow[] | null,
    );
    const shift = firstRelation(sheet?.work_shift ?? null);
    const workDate = sheet?.work_date;
    const endTime = shift?.end_time;
    if (!workDate || !endTime) return;

    if (isOrderStatusUpdateExpired(workDate, {
      end_time: endTime,
      crosses_midnight: shift?.crosses_midnight,
    })) {
      serviceError(
        403,
        ORDER_STATUS_UPDATE_EXPIRED_MESSAGE,
        undefined,
        'ORDER_STATUS_UPDATE_WINDOW_EXPIRED',
      );
    }
  }

  async patch(actor: OrderActor, orderId: string, body: PatchOrderBody) {
    const order = await this.findOrder(orderId);
    this.assertWithinStatusUpdateWindow(order);
    this.assertPackingOwner(actor, order);
    const currentStatus = this.statusCode(order);
    try {
      assertOrderActionAllowed(currentStatus, 'edit');
    } catch (error) {
      translateRuleError(error);
    }

    if (!body || body.note === undefined) {
      serviceError(400, 'note is required');
    }

    if (body.note !== undefined) {
      const { data, error } = await this.db
        .from('orders')
        .update({ note: body.note })
        .eq('id', orderId)
        .eq('status_id', order.status_id)
        .select('id')
        .maybeSingle();
      if (error) databaseError(error, 'Cannot update order');
      if (!data) {
        serviceError(409, 'Trạng thái Order đã thay đổi. Vui lòng tải lại dữ liệu.');
      }
    }

    return this.findOrder(orderId);
  }

  async list(actor: OrderActor, query: OrderListQuery = {}) {
    const statusId = query.status ? await this.getStatusId(query.status) : null;
    const pagination = parsePagination(query, {
      allowedSortBy: ORDER_SORT_FIELDS,
      defaultSortBy: 'created_at',
      defaultSortOrder: 'desc',
    });

    let request = this.db
      .from('orders')
      .select(
        query.workShiftId
          ? ORDER_LIST_WORK_SHIFT_FILTER_SELECT
          : ORDER_LIST_SELECT,
        { count: 'exact' },
      )
      .eq('is_deleted', false);
    if (isOrderAreaScoped(actor)) {
      request = request.eq('to_area_id', actor.areaId);
    }
    if (statusId) request = request.eq('status_id', statusId);
    if (query.from_area_id) request = request.eq('from_area_id', query.from_area_id);
    if (query.to_area_id) request = request.eq('to_area_id', query.to_area_id);
    if (query.createdBy) request = request.eq('requested_by', query.createdBy);
    if (query.areaId) {
      request = request.or(
        `from_area_id.eq.${query.areaId},to_area_id.eq.${query.areaId}`,
      );
    }
    if (query.workShiftId) {
      request = request.eq('shift_order_sheet.work_shift_id', query.workShiftId);
    }
    if (pagination.search) {
      request = request.or(
        `code.ilike.*${pagination.search}*,note.ilike.*${pagination.search}*,rejected_reason.ilike.*${pagination.search}*,cancel_reason.ilike.*${pagination.search}*`,
      );
    }

    if (query.date) {
      const start = new Date(`${query.date}T00:00:00.000Z`);
      if (Number.isNaN(start.getTime())) serviceError(400, 'date must be YYYY-MM-DD');
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      request = request.gte('created_at', start.toISOString()).lt('created_at', end.toISOString());
    } else {
      const dateFrom = normalizeListDate(query.dateFrom, 'dateFrom');
      const dateTo = normalizeListDate(query.dateTo, 'dateTo', true);
      if (dateFrom && dateTo && dateFrom > dateTo) {
        serviceError(400, 'dateFrom phải nhỏ hơn hoặc bằng dateTo');
      }
      if (dateFrom) request = request.gte('created_at', dateFrom);
      if (dateTo) request = request.lte('created_at', dateTo);
    }
    const sortBy = pagination.sortBy === 'status' ? 'status_id' : pagination.sortBy;
    request = request.order(sortBy, {
      ascending: pagination.sortOrder === 'asc',
    });
    if (sortBy !== 'id') request = request.order('id', { ascending: true });

    const { data, error, count } = await request.range(pagination.from, pagination.to);
    const result = resolvePaginatedQueryResult({ data, error, count }, pagination);
    if (result) return result;
    if (error) databaseError(error, 'Cannot list orders');
    throw new Error('Unreachable pagination state');
  }

  async get(actor: OrderActor, orderId: string) {
    const order = await this.findOrder(orderId);
    this.assertOrderVisible(actor, order);
    return order;
  }

  async approve(actor: OrderActor, orderId: string, body: ApproveOrderBody) {
    if (!hasPermission(actor, PERMISSION_CODE.SUPPLY_ORDER_APPROVE)) {
      serviceError(403, 'Missing supply.order.approve permission');
    }
    const order = await this.findOrder(orderId);
    this.assertWithinStatusUpdateWindow(order);
    try {
      assertOrderActionAllowed(this.statusCode(order), 'approve');
    } catch (error) {
      translateRuleError(error);
    }

    if (!Array.isArray(body?.items) || body.items.length !== order.order_items.length) {
      serviceError(400, 'Approval must include every order item');
    }
    const approvalMap = new Map(body.items.map((item) => [item.order_item_id, item]));
    if (approvalMap.size !== body.items.length) serviceError(400, 'Duplicate order_item_id');

    const updates = order.order_items.map((item) => {
      const approval = approvalMap.get(item.id);
      if (!approval) serviceError(400, `Missing approval for order item ${item.id}`);
      try {
        const quantityApproved = assertApprovedQuantity(
          approval.quantity_approved,
          Number(item.quantity_requested),
        );
        assertWholeStackApproval(quantityApproved, item.set_per_qty);
        return {
          id: item.id,
          order_id: item.order_id,
          supply_id: item.supply_id,
          provider_id: item.provider_id,
          unit_id: item.unit_id,
          quantity_requested: Number(item.quantity_requested),
          quantity_approved: quantityApproved,
          quantity_issued:
            item.quantity_issued === null ? null : Number(item.quantity_issued),
          note: item.note,
        };
      } catch (error) {
        return translateRuleError(error);
      }
    });

    // Snapshot check against the stock attached by findOrder. Approval reserves
    // nothing, so issue still revalidates; this only stops promising more than
    // the source Area holds at the moment of approval.
    const excess = findApprovalStockExcess(order.order_items.map((item, index) => ({
      supply_id: item.supply_id,
      provider_id: item.provider_id,
      set_per_qty: item.set_per_qty,
      quantity_approved: updates[index].quantity_approved,
      available_quantity: item.available_quantity ?? 0,
    })));
    if (excess) {
      const supplyCode = firstRelation(
        order.order_items.find((item) =>
          item.supply_id === excess.supply_id)?.supply ?? null,
      )?.code ?? excess.supply_id;
      serviceError(
        409,
        `Số duyệt vượt tồn khu vực cấp: ${supplyCode} duyệt ${excess.approved_quantity}, tồn ${excess.available_quantity}.`,
        { ...excess, supply_code: supplyCode },
        'ORDER_APPROVAL_EXCEEDS_STOCK',
      );
    }

    const { error: orderError } = await this.db.rpc('review_order', {
      p_order_id: orderId,
      p_actor_id: actor.id,
      p_action_code: 'APPROVE',
      p_items: updates.map((item) => ({
        order_item_id: item.id,
        quantity_approved: item.quantity_approved,
      })),
      p_reason: null,
      p_note: body.note ?? null,
    });
    if (orderError) approvalRpcError(orderError);
    return this.finishStatusTransition(actor, order);
  }

  /**
   * Data vật tư's stack count for one KIEN_SAT_TC item. It may differ from the
   * approval in either direction; the RPC demands a reason when it does and
   * decides from that reason whether the books are corrected.
   */
  async confirmStackItem(
    actor: OrderActor,
    orderId: string,
    orderItemId: string,
    body: ConfirmStackItemBody,
  ) {
    if (!hasPermission(actor, PERMISSION_CODE.SUPPLY_ORDER_CONFIRM_ALLOCATION)) {
      serviceError(403, 'Missing supply.order.confirm_allocation permission');
    }

    const order = await this.findOrder(orderId);
    if (!order.order_items.some((item) => item.id === orderItemId)) {
      serviceError(404, 'Order item not found for this Order');
    }
    this.assertWithinStatusUpdateWindow(order);

    const { data: confirmation, error } = await this.db.rpc(
      'confirm_stack_order_item',
      {
        p_order_item_id: orderItemId,
        p_actual_stack_quantity: body.actual_stack_quantity,
        p_reason_code: body.reason_code?.trim() || null,
        p_reason_note: body.reason_note?.trim() || null,
        p_actor_id: actor.id,
      },
    );
    if (error) confirmationRpcError(error);

    return {
      order: await this.findOrder(orderId),
      confirmation,
    };
  }

  async reject(actor: OrderActor, orderId: string, body: RejectOrderBody) {
    if (!hasPermission(actor, PERMISSION_CODE.SUPPLY_ORDER_APPROVE)) {
      serviceError(403, 'Missing supply.order.approve permission');
    }
    const order = await this.findOrder(orderId);
    this.assertWithinStatusUpdateWindow(order);
    try {
      assertOrderActionAllowed(this.statusCode(order), 'reject');
      const rejectedReason = assertRejectedReason(body?.rejected_reason);
      const { error } = await this.db.rpc('review_order', {
        p_order_id: orderId,
        p_actor_id: actor.id,
        p_action_code: 'REJECT',
        p_items: null,
        p_reason: rejectedReason,
        p_note: null,
      });
      if (error) rpcError(error);
    } catch (error) {
      translateRuleError(error);
    }
    return this.finishStatusTransition(actor, order);
  }

  async issue(actor: OrderActor, orderId: string, body: IssueOrderBody) {
    if (!hasPermission(actor, PERMISSION_CODE.SUPPLY_ORDER_ISSUE)) {
      serviceError(403, 'Missing supply.order.issue permission');
    }
    const order = await this.findOrder(orderId);
    this.assertWithinStatusUpdateWindow(order);
    try {
      const currentStatus = this.statusCode(order);
      if (['ISSUED', 'RECEIVED', 'COMPLETED'].includes(currentStatus)) {
        serviceError(
          409,
          'Order đã được cấp hàng; không thể trừ tồn lần nữa.',
          { current_status: currentStatus },
          'ORDER_ALREADY_ISSUED',
        );
      }
      if (!['APPROVED', 'PARTIAL_ISSUED'].includes(currentStatus)) {
        serviceError(
          409,
          'Order không ở trạng thái có thể cấp hàng.',
          { current_status: currentStatus },
          'ORDER_NOT_ISSUABLE',
        );
      }
      const issueItems = body?.items ?? [];
      const hasStackItem = order.order_items.some((item) => item.set_per_qty !== null);
      if (!Array.isArray(issueItems) || (issueItems.length === 0 && !hasStackItem)) {
        serviceError(400, 'items must contain at least one issue');
      }
      for (const item of issueItems) {
        if (!item.order_item_id) serviceError(400, 'order_item_id is required');
        assertPositiveQuantity(item.quantity, 'issue quantity');
      }
    } catch (error) {
      translateRuleError(error);
    }

    const { error } = await this.db.rpc('issue_order', {
      p_order_id: orderId,
      p_actor_id: actor.id,
      p_items: body?.items ?? [],
      p_forklift_by: body.forklift_by ?? null,
      p_taken_away_by: body.taken_away_by ?? null,
    });
    if (error) issueRpcError(error);

    const result = await this.finishStatusTransition(actor, order);
    const { data: transactions, error: transactionError } = await this.db
      .from('stock_transactions')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });
    if (transactionError) databaseError(transactionError, 'Cannot get issue transactions');
    return { ...result, stock_transactions: transactions ?? [] };
  }

  async receive(actor: OrderActor, orderId: string, body: ReceiveOrderBody) {
    const order = await this.findOrder(orderId);
    this.assertWithinStatusUpdateWindow(order);
    this.assertPackingOwner(actor, order);
    try {
      assertOrderActionAllowed(this.statusCode(order), 'receive');
    } catch (error) {
      translateRuleError(error);
    }

    await this.transitionStatus(actor, order, ORDER_STATUS.RECEIVED, {
      takenAwayBy: body?.taken_away_by,
    }, 'Cannot receive order');
    return this.finishStatusTransition(actor, order);
  }

  async complete(actor: OrderActor, orderId: string) {
    if (!hasPermission(actor, PERMISSION_CODE.SUPPLY_ORDER_ISSUE)) {
      serviceError(403, 'Missing supply.order.issue permission');
    }
    const order = await this.findOrder(orderId);
    this.assertWithinStatusUpdateWindow(order);
    try {
      assertOrderActionAllowed(this.statusCode(order), 'complete');
    } catch (error) {
      translateRuleError(error);
    }

    const hasPendingIssue = order.order_items.some((item) => !isOrderItemIssueClosed(item));
    if (hasPendingIssue) serviceError(409, 'Order still has quantity pending issue');

    await this.transitionStatus(actor, order, ORDER_STATUS.COMPLETED, {}, 'Cannot complete order');
    return this.finishStatusTransition(actor, order);
  }

  async cancel(actor: OrderActor, orderId: string, body: CancelOrderBody) {
    const order = await this.findOrder(orderId);
    this.assertWithinStatusUpdateWindow(order);
    this.assertPackingOwner(actor, order);
    try {
      const currentStatus = this.statusCode(order);
      assertOrderActionAllowed(currentStatus, 'cancel');
      const cancelReason = assertCancelReason(body?.cancel_reason);
      await this.transitionStatus(actor, order, ORDER_STATUS.CANCELLED, {
        cancelReason,
      }, 'Cannot cancel order');
    } catch (error) {
      translateRuleError(error);
    }
    return this.finishStatusTransition(actor, order);
  }
}

import type {
  Order,
  OrderAreaSummary,
  OrderSupplySummary,
  OrderUnitSummary,
  OrderUserSummary,
} from './orders';
import type { Provider } from './providers';
import type { PaginatedListParams } from './pagination.types';

export interface ShiftOrderSheetWorkShift {
  id: string;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  crosses_midnight: boolean;
}

export interface ShiftOrderSheetSummary {
  id: string;
  area_id: string;
  work_shift_id: string;
  work_date: string;
  leader_id: string;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  area: OrderAreaSummary | null;
  work_shift: ShiftOrderSheetWorkShift | null;
  leader: OrderUserSummary | null;
  shift_start_at: string;
  shift_end_at: string;
  order_count: number;
  item_count: number;
  business_time_zone: 'Asia/Ho_Chi_Minh';
}

export interface ShiftOrderSheetCreateContext {
  id: string | null;
  area_id: string;
  work_shift_id: string;
  work_date: string;
  area: OrderAreaSummary | null;
  work_shift: Pick<ShiftOrderSheetWorkShift, 'id' | 'code' | 'name'> | null;
  leader?: OrderUserSummary | null;
  /**
   * Absolute bounds of this shift instance, computed server side in
   * Asia/Ho_Chi_Minh with the shift's crosses-midnight flag already applied.
   * Present for the Sheet currently being worked; absent when the caller only
   * has the create context.
   */
  shift_start_at?: string;
  shift_end_at?: string;
  /** Server verdict at fetch time. The UI re-derives from the bounds as time passes. */
  is_outside_working_hours?: boolean;
  /**
   * Whether this Area may raise Orders at all. The supplying Area fulfils them
   * instead, so its staff get the approval view without the create action.
   */
  can_create_order?: boolean;
}

export interface ShiftOrderSheetOrderItem {
  id: string;
  order_id: string;
  supply_id: string;
  provider_id: string;
  unit_id: string;
  quantity_requested: number;
  set_per_qty: number | null;
  requested_stack_quantity: number | null;
  requested_total_set_quantity: number | null;
  quantity_approved: number | null;
  quantity_issued: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  supply: (OrderSupplySummary & {
    category?: { id: string; code: string; name: string } | null;
  }) | null;
  provider: Pick<Provider, 'id' | 'code' | 'name' | 'description'> | null;
  unit: OrderUnitSummary | null;
}

export interface ShiftOrderSheetOrder extends Omit<Order, 'order_items'> {
  order_items: ShiftOrderSheetOrderItem[];
}

export interface ShiftOrderSheetDetail extends ShiftOrderSheetSummary {
  orders: ShiftOrderSheetOrder[];
}

export interface CurrentShiftOrderSheetContext extends Omit<ShiftOrderSheetCreateContext, 'id' | 'area' | 'work_shift'> {
  area: OrderAreaSummary;
  work_shift: Pick<ShiftOrderSheetWorkShift, 'id' | 'code' | 'name'>;
  shift_start_at: string;
  shift_end_at: string;
  is_outside_working_hours: boolean;
  can_create_order: boolean;
  business_time_zone: 'Asia/Ho_Chi_Minh';
}

export interface CurrentShiftOrderSheetResponse {
  context: CurrentShiftOrderSheetContext;
  sheet: ShiftOrderSheetDetail | null;
}

export interface ShiftOrderSheetListParams extends PaginatedListParams {
  workDate?: string;
  workShiftId?: string;
  leaderId?: string;
  areaId?: string;
  statusId?: string;
  categoryId?: string;
}

export interface ShiftOrderSheetDetailParams {
  search?: string;
  statusId?: string;
  categoryId?: string;
}

/** The shift instance the approver is working, taken from their Sheet context. */
export interface ShiftOrderSheetIncomingParams {
  workDate: string;
  workShiftId: string;
}

/**
 * A market's Sheet for that same shift instance, as seen by an approver in the
 * supplying Area. `pending_order_count` is what still needs a decision.
 */
export interface IncomingShiftOrderSheet extends ShiftOrderSheetSummary {
  pending_order_count: number;
}

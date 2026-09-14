import type { PaginatedListParams } from './pagination.types';
import type { Provider } from './providers';
import type { InventoryDiscrepancy } from './inventory-discrepancies';
import type { ShiftOrderSheetSummary } from './shift-order-sheets';

import type {
  OrderRevisionActionLookup,
  OrderStatusLookup,
} from './lookups';

export const ORDER_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PARTIAL_ISSUED: 'PARTIAL_ISSUED',
  ISSUED: 'ISSUED',
  RECEIVED: 'RECEIVED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];
export const ORDER_STATUSES = Object.values(ORDER_STATUS) as OrderStatus[];

export interface OrderAreaSummary {
  id: string;
  code: string;
  name: string;
}

export interface OrderUserSummary {
  id: string;
  vinfast_id: number;
  email: string;
  first_name: string;
  last_name: string;
}

export interface OrderSupplySummary {
  id: string;
  code: string;
  description: string | null;
}

export interface OrderUnitSummary {
  id: string;
  code: string;
  symbol: string;
}

export interface OrderAllocationLocation {
  id: string;
  code: string;
  name: string;
}

export interface OrderItemAllocation {
  id: string;
  order_item_id: string;
  stock_balance_id: string;
  expected_stack_quantity: number;
  actual_stack_quantity: number | null;
  status: string | null;
  discrepancy_reason: string | null;
  allocated_at: string;
  confirmed_at: string | null;
  location?: OrderAllocationLocation | null;
  discrepancies?: InventoryDiscrepancy[];
}

export interface AllocationConfirmation {
  allocation_id: string;
  actual_stack_quantity: number;
  discrepancy_id: string | null;
  difference_stack_quantity: number;
  reallocation_status: 'NOT_REQUIRED' | 'REALLOCATED' | 'INSUFFICIENT';
  required_stack_quantity: number;
  available_stack_quantity: number;
  unallocated_stack_quantity: number;
  reallocation_count?: number;
  new_allocations: Array<{
    id: string;
    stock_balance_id: string;
    expected_stack_quantity: number;
  }>;
}

export interface ConfirmAllocationInput {
  actual_stack_quantity: number;
  reason?: string;
}

export interface ConfirmAllocationResult {
  order: Order;
  confirmation: AllocationConfirmation;
}

export interface StackAllocationErrorDetails {
  order_item_id?: string;
  supply_code?: string;
  quantity_approved?: number;
  set_per_qty?: number;
  required_stack_quantity?: number;
  available_stack_quantity?: number;
  shortage_stack_quantity?: number;
  current_status?: string;
}

export interface StackIssueStockConflictDetails {
  reason?: string;
  stock_balance_id?: string;
  order_item_id?: string;
  supply_code?: string;
  provider_code?: string;
  location_code?: string;
  set_per_qty?: number;
  required_stack_quantity?: number;
  current_stack_quantity?: number;
  shortage_stack_quantity?: number;
}

export interface OrderItem {
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
  available_quantity: number;
  shortage_quantity: number;
  has_stock_shortage: boolean;
  available_stack_quantity?: number;
  note: string | null;
  supply?: OrderSupplySummary | null;
  provider?: Pick<Provider, 'id' | 'code' | 'name' | 'description'> | null;
  unit?: OrderUnitSummary | null;
  allocations?: OrderItemAllocation[];
}

export interface OrderRevision {
  id: string;
  order_id: string;
  action_id: string;
  old_status_id: string | null;
  new_status_id: string | null;
  reason: string | null;
  created_by: string;
  created_at: string;
  action?: Pick<OrderRevisionActionLookup, 'id' | 'code' | 'name'> | null;
  old_status?: Pick<OrderStatusLookup, 'id' | 'code' | 'name'> | null;
  new_status?: Pick<OrderStatusLookup, 'id' | 'code' | 'name'> | null;
  creator?: OrderUserSummary | null;
}

export interface Order {
  id: string;
  code: string;
  from_area_id: string;
  to_area_id: string;
  requested_by: string;
  approved_by: string | null;
  forklift_by: string | null;
  taken_away_by: string | null;
  status_id: string;
  shift_order_sheet_id: string | null;
  status: OrderStatus;
  status_lookup?: OrderStatusLookup | null;
  note: string | null;
  rejected_reason: string | null;
  cancel_reason: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  issued_at: string | null;
  received_at: string | null;
  completed_at: string | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  from_area?: OrderAreaSummary | null;
  to_area?: OrderAreaSummary | null;
  requester?: OrderUserSummary | null;
  approver?: OrderUserSummary | null;
  forklift?: OrderUserSummary | null;
  taken_away?: OrderUserSummary | null;
  order_items?: OrderItem[];
  order_revisions?: OrderRevision[];
  shift_order_sheet?: ShiftOrderSheetSummary | null;
}

export interface OrderListParams extends PaginatedListParams {
  status?: OrderStatus;
  createdBy?: string;
  areaId?: string;
  workShiftId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface OrderItemInput {
  supply_id: string;
  provider_id: string;
  quantity_requested: number;
  set_per_qty?: number;
  requested_stack_quantity?: number;
  requested_total_set_quantity?: number;
  unit_id?: string;
  note?: string;
}

export interface CreateOrderInput {
  from_area_id: string;
  to_area_id: string;
  shift_order_sheet_id?: string;
  note?: string;
  order_list: OrderItemInput[];
}

export interface ZeroStockErrorDetails {
  order_item_id: string;
  supply_code: string;
  provider_code: string;
  set_per_qty: number | null;
  available_quantity: number;
  inventory_mode: 'NORMAL' | 'STACK';
}

export interface UpdateOrderInput {
  note?: string;
}

export interface ApproveOrderInput {
  items: Array<{ order_item_id: string; quantity_approved: number }>;
  note?: string;
}

export interface RejectOrderInput {
  rejected_reason: string;
}

export interface IssueOrderInput {
  items: Array<{
    order_item_id: string;
    issues: Array<{ storage_location_id: string; quantity: number }>;
  }>;
  forklift_by?: string;
  taken_away_by?: string;
}

export interface ReceiveOrderInput {
  taken_away_by?: string;
}

export interface CancelOrderInput {
  cancel_reason: string;
}

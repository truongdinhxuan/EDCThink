import type { PaginationQuery } from './pagination';

export interface OrderListItemInput {
  supply_id: string;
  provider_id: string;
  quantity_requested: number;
  set_per_qty?: number;
  requested_stack_quantity?: number;
  requested_total_set_quantity?: number;
  unit_id?: string;
  note?: string;
}

export interface CreateOrderBody {
  from_area_id: string;
  to_area_id: string;
  shift_order_sheet_id?: string;
  note?: string;
  order_list: OrderListItemInput[];
}

export interface PatchOrderBody {
  note?: string;
}

export interface OrderApprovalItemInput {
  order_item_id: string;
  /**
   * A non-negative review result. Zero rejects the item; positive values are
   * approved and are not capped by quantity_requested.
   */
  quantity_approved: number;
}

export interface ApproveOrderBody {
  items: OrderApprovalItemInput[];
  note?: string;
}

export interface RejectOrderBody {
  rejected_reason: string;
}

export interface IssueOrderBody {
  items: Array<{
    order_item_id: string;
    issues: Array<{
      storage_location_id: string;
      quantity: number;
    }>;
  }>;
  forklift_by?: string;
  taken_away_by?: string;
}

export interface ReceiveOrderBody {
  taken_away_by?: string;
}

export interface CancelOrderBody {
  cancel_reason: string;
}

export interface ConfirmAllocationBody {
  actual_stack_quantity: number;
  reason?: string;
}

export interface OrderListQuery extends PaginationQuery {
  status?: string;
  from_area_id?: string;
  to_area_id?: string;
  date?: string;
  createdBy?: string;
  areaId?: string;
  workShiftId?: string;
  dateFrom?: string;
  dateTo?: string;
}

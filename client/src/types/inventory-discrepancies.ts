import type { PaginatedListParams } from './pagination.types';

export type InventoryDiscrepancyStatus = 'OPEN' | 'RESOLVED';

/**
 * CONFIRMATION: the picker reported stacks as not available.
 * ISSUE: the books held fewer stacks than were confirmed and shipped.
 */
export type InventoryDiscrepancySource = 'CONFIRMATION' | 'ISSUE';

export interface DiscrepancyUserSummary {
  id: string;
  vinfast_id: string;
  first_name: string;
  last_name: string;
}

export interface InventoryDiscrepancy {
  id: string;
  stock_balance_id: string;
  order_id: string;
  order_item_id: string;
  allocation_id: string;
  expected_stack_quantity: number;
  actual_stack_quantity: number;
  difference_stack_quantity: number;
  reason: string | null;
  status: InventoryDiscrepancyStatus;
  source: InventoryDiscrepancySource;
  reported_by: string;
  reported_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  reporter?: DiscrepancyUserSummary | null;
  resolver?: DiscrepancyUserSummary | null;
  order?: { id: string; code: string } | null;
  order_item?: {
    id: string;
    set_per_qty: number | null;
    supply?: { id: string; code: string; description: string | null } | null;
    provider?: { id: string; code: string; name: string } | null;
  } | null;
  allocation?: {
    id: string;
    expected_stack_quantity: number;
    actual_stack_quantity: number | null;
  } | null;
  /** Every location the code is labelled at: where to go and recount. */
  locations?: Array<{ id: string; code: string; name: string | null }>;
}

export interface InventoryDiscrepancyListParams extends PaginatedListParams {
  status?: InventoryDiscrepancyStatus;
}

export interface ResolveInventoryDiscrepancyInput {
  resolution_note: string;
}

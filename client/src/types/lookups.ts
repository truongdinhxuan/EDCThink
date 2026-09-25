import type { PaginatedListParams } from './pagination.types';

export interface LookupBase {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrderStatusLookup extends LookupBase {
  description: string | null;
  sort_order: number;
  is_system: boolean;
}

export interface StockTransactionTypeLookup extends LookupBase {
  effect: 'INCREASE' | 'DECREASE' | 'NEUTRAL';
  requires_reason: boolean;
  is_system: boolean;
}

export interface AdjustmentReasonLookup extends LookupBase {
  description: string | null;
  requires_note: boolean;
}

/**
 * Why a confirmed stack count differs from the approval. `direction` says which
 * side of the approval it may be used on; `corrects_stock` means the difference
 * is missing stock, so the books are corrected and a recount is opened.
 */
export interface AllocationConfirmReasonLookup extends LookupBase {
  description: string | null;
  direction: 'LOWER' | 'HIGHER';
  corrects_stock: boolean;
  sort_order: number;
  is_system: boolean;
}

export interface OrderRevisionActionLookup extends LookupBase {
  description: string | null;
  is_system: boolean;
}

export interface LookupListParams extends PaginatedListParams {
  isActive?: boolean;
}

export interface StockTransactionTypeListParams extends LookupListParams {
  effect?: StockTransactionTypeLookup['effect'];
  requiresReason?: boolean;
}

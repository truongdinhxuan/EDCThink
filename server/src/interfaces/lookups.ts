import type { PaginationQuery } from './pagination';

export interface LookupListQuery extends PaginationQuery {
  isActive?: string | boolean;
  effect?: 'INCREASE' | 'DECREASE' | 'NEUTRAL';
  requiresReason?: string | boolean;
}

export type LookupTableName =
  | 'order_statuses'
  | 'stock_transaction_types'
  | 'adjustment_reasons'
  | 'order_revision_actions'
  | 'allocation_confirm_reasons';

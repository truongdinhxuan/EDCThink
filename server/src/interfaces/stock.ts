import type { PermissionCode } from '../domain/permission-codes';
import type { StockTransactionType } from '../domain/enums';
import type { PaginationQuery } from './pagination';

export interface StockBalanceListQuery extends PaginationQuery {
  supply_id?: string;
  supplyId?: string;
  provider_id?: string;
  providerId?: string;
  area_id?: string;
  areaId?: string;
  storage_location_id?: string;
  storageLocationId?: string;
  low_stock?: string | boolean;
  warning?: 'all' | 'warning' | 'no_warning';
}

export interface InventoryDiscrepancyListQuery extends PaginationQuery {
  status?: 'OPEN' | 'RESOLVED';
}

export interface ResolveInventoryDiscrepancyBody {
  resolution_note: string;
}

export interface StockTransactionListQuery extends PaginationQuery {
  supply_id?: string;
  supplyId?: string;
  provider_id?: string;
  providerId?: string;
  area_id?: string;
  areaId?: string;
  storageLocationId?: string;
  type?: string;
  transactionTypeId?: string;
  order_id?: string;
  createdBy?: string;
  date_from?: string;
  date_to?: string;
  dateFrom?: string;
  dateTo?: string;
}

export type StockAdjustmentType = Extract<
  StockTransactionType,
  'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT' | 'IMPORT' | 'EXPORT'
>;

export interface CreateStockAdjustmentBody {
  supply_id: string;
  provider_id: string;
  area_id: string;
  /** Labels to add to the pooled row. Never a place the quantity is kept. */
  location_ids?: string[];
  type?: StockAdjustmentType;
  transaction_type_id?: string;
  transaction_type_code?: StockAdjustmentType;
  adjustment_reason_id?: string;
  quantity?: number;
  stack_quantity?: number;
  set_per_qty?: number;
  reason?: string;
  reason_note?: string;
  note?: string | null;
}

export interface ReplaceStockBalanceLocationsBody {
  location_ids: string[];
}

export interface StockActor {
  id: string;
  areaId: string | null;
  roleIds: string[];
  permissions: readonly PermissionCode[];
  isSystemAdmin: boolean;
}

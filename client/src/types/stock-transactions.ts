import type { Area } from './areas';
import type { StorageLocation } from './storage-locations';
import type { PaginatedListParams } from './pagination.types';
import type { Provider } from './providers';
import type {
  AdjustmentReasonLookup,
  StockTransactionTypeLookup,
} from './lookups';

export const STOCK_TRANSACTION_TYPES = [
  'ISSUE',
  'RECEIVE',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'IMPORT',
  'EXPORT',
  'REVERSAL_IN',
  'REVERSAL_OUT',
  'DISCREPANCY_CORRECTION',
] as const;

export type StockTransactionType = (typeof STOCK_TRANSACTION_TYPES)[number];
export type StockAdjustmentType = Extract<
  StockTransactionType,
  'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT' | 'IMPORT' | 'EXPORT'
>;

export interface StockTransaction {
  id: string;
  supply_id: string;
  provider_id: string;
  area_id: string;
  /** Historical only: null on rows written after stock stopped tracking locations. */
  storage_location_id: string | null;
  order_id: string | null;
  order_item_id: string | null;
  inventory_discrepancy_id: string | null;
  transaction_type_id: string;
  quantity: number;
  before_quantity: number;
  after_quantity: number;
  set_per_qty: number | null;
  stack_quantity: number | null;
  before_stack_quantity: number | null;
  after_stack_quantity: number | null;
  reason: string | null;
  reason_id: string | null;
  reason_note: string | null;
  note: string | null;
  created_by: string;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  transaction_type?: StockTransactionTypeLookup | null;
  adjustment_reason?: AdjustmentReasonLookup | null;
  supply?: { id: string; code: string; description: string | null } | null;
  order?: { id: string; code: string } | null;
  provider?: Pick<Provider, 'id' | 'code' | 'name' | 'description'> | null;
  area?: Pick<Area, 'id' | 'code' | 'name'> | null;
  storage_location?: Pick<StorageLocation, 'id' | 'code' | 'name'> | null;
  creator?: {
    id: string;
    first_name: string;
    last_name: string;
    vinfast_id: string;
  } | null;
  discrepancy?: {
    id: string;
    allocation_id: string;
    status: 'OPEN' | 'RESOLVED';
  } | null;
}

export interface StockTransactionListParams extends PaginatedListParams {
  supplyId?: string;
  providerId?: string;
  areaId?: string;
  storageLocationId?: string;
  type?: StockTransactionType;
  transactionTypeId?: string;
  createdBy?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface CreateStockAdjustmentInput {
  supply_id: string;
  provider_id: string;
  area_id: string;
  /** Labels added to the pooled row; never where the quantity is kept. */
  location_ids?: string[];
  type?: StockAdjustmentType;
  transaction_type_id?: string;
  transaction_type_code?: StockAdjustmentType;
  adjustment_reason_id?: string;
  quantity?: number;
  stack_quantity?: number;
  set_per_qty?: number;
  reason: string;
  reason_note?: string;
  note?: string | null;
}

export interface StockAdjustmentResult {
  balance: {
    id: string;
    supply_id: string;
    provider_id: string;
    area_id: string;
    quantity: number;
    set_per_qty: number | null;
    stack_quantity: number | null;
    total_set_quantity: number | null;
    created_at: string;
    updated_at: string;
  };
  transaction: StockTransaction;
}

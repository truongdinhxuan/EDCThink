import type { Area } from './areas';
import type { StorageLocation } from './storage-locations';
import type { UnitSummary } from './supplies';
import type { PaginatedListParams } from './pagination.types';
import type { Provider } from './providers';

export interface StockBalanceSupplySummary {
  id: string;
  code: string;
  description: string | null;
  min_stock: number | null;
  unit: UnitSummary | null;
  category: {
    id: string;
    code: string;
    name: string;
  } | null;
}

/**
 * One row per (supply, provider, area[, set_per_qty]) holding the whole
 * quantity. `locations` says where the code sits and carries no quantity.
 */
export interface StockBalance {
  id: string;
  supply_id: string;
  provider_id: string;
  area_id: string;
  quantity: number;
  set_per_qty: number | null;
  stack_quantity: number | null;
  total_set_quantity: number | null;
  has_open_discrepancy: boolean;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  supply: StockBalanceSupplySummary | null;
  provider: Pick<Provider, 'id' | 'code' | 'name' | 'description'> | null;
  area: Pick<Area, 'id' | 'code' | 'name'> | null;
  locations: Array<Pick<StorageLocation, 'id' | 'code' | 'name'>>;
}

export interface StockBalanceListParams extends PaginatedListParams {
  supplyId?: string;
  providerId?: string;
  areaId?: string;
  /** Rows labelled with this location. */
  storageLocationId?: string;
  warning?: 'all' | 'warning' | 'no_warning';
}

export interface ReplaceStockBalanceLocationsInput {
  location_ids: string[];
}

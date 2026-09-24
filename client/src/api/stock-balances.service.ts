import type { ApiEnvelope } from '../types/api';
import type {
  ReplaceStockBalanceLocationsInput,
  StockBalance,
  StockBalanceListParams,
} from '../types/stock-balances';
import type { PaginatedResponse } from '../types/pagination.types';
import instance from './http';
import { unwrapData } from './response';
import type {
  InventoryDiscrepancy,
  InventoryDiscrepancyListParams,
} from '../types/inventory-discrepancies';

export const listStockBalances = async (
  params: StockBalanceListParams = {},
  signal?: AbortSignal,
): Promise<PaginatedResponse<StockBalance>> =>
  instance.get<PaginatedResponse<StockBalance>, PaginatedResponse<StockBalance>>(
    'stock-balances',
    { params, signal },
  );

export const getStockBalance = async (id: string): Promise<StockBalance> =>
  unwrapData(
    await instance.get<ApiEnvelope<StockBalance>, ApiEnvelope<StockBalance>>(
      `stock-balances/${id}`,
    ),
  );

/** Relabels where a code sits. Quantities are not touched. */
export const replaceStockBalanceLocations = async (
  id: string,
  input: ReplaceStockBalanceLocationsInput,
): Promise<StockBalance> =>
  unwrapData(
    await instance.put<ApiEnvelope<StockBalance>, ApiEnvelope<StockBalance>>(
      `stock-balances/${id}/locations`,
      input,
    ),
  );

export const listStockBalanceDiscrepancies = async (
  stockBalanceId: string,
  params: InventoryDiscrepancyListParams = {},
  signal?: AbortSignal,
): Promise<PaginatedResponse<InventoryDiscrepancy>> =>
  instance.get<
    PaginatedResponse<InventoryDiscrepancy>,
    PaginatedResponse<InventoryDiscrepancy>
  >(`stock-balances/${stockBalanceId}/discrepancies`, { params, signal });

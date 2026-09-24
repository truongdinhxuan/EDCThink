import type {
  AdjustmentReasonLookup,
  AllocationConfirmReasonLookup,
  LookupListParams,
  OrderRevisionActionLookup,
  OrderStatusLookup,
  StockTransactionTypeListParams,
  StockTransactionTypeLookup,
} from '../types/lookups';
import type { PaginatedResponse } from '../types/pagination.types';
import instance from './http';

const listLookup = <T>(
  path: string,
  params: LookupListParams,
  signal?: AbortSignal,
): Promise<PaginatedResponse<T>> =>
  instance.get<PaginatedResponse<T>, PaginatedResponse<T>>(path, {
    params,
    signal,
  });

export const listOrderStatuses = (
  params: LookupListParams = {},
  signal?: AbortSignal,
) => listLookup<OrderStatusLookup>('lookup/order-statuses', params, signal);

export const listStockTransactionTypes = (
  params: StockTransactionTypeListParams = {},
  signal?: AbortSignal,
) =>
  listLookup<StockTransactionTypeLookup>(
    'lookup/stock-transaction-types',
    params,
    signal,
  );

export const listAdjustmentReasons = (
  params: LookupListParams = {},
  signal?: AbortSignal,
) =>
  listLookup<AdjustmentReasonLookup>(
    'lookup/adjustment-reasons',
    params,
    signal,
  );

export const listAllocationConfirmReasons = (
  params: LookupListParams = {},
  signal?: AbortSignal,
) =>
  listLookup<AllocationConfirmReasonLookup>(
    'lookup/allocation-confirm-reasons',
    params,
    signal,
  );

export const listOrderRevisionActions = (
  params: LookupListParams = {},
  signal?: AbortSignal,
) =>
  listLookup<OrderRevisionActionLookup>(
    'lookup/order-revision-actions',
    params,
    signal,
  );

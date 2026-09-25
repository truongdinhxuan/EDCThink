import type { ApiEnvelope } from '../types/api';
import type { StockAreaScopes } from '../types/stock-area-scopes';
import instance from './http';
import { unwrapData } from './response';

export const getMyStockAreaScopes = async (
  signal?: AbortSignal,
): Promise<StockAreaScopes> => unwrapData(
  await instance.get<ApiEnvelope<StockAreaScopes>, ApiEnvelope<StockAreaScopes>>(
    'me/stock-area-scopes',
    { signal },
  ),
);

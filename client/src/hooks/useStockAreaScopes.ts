import { useQuery } from '@tanstack/react-query';
import { getMyStockAreaScopes } from '../api/stock-area-scopes.service';
import { queryKeys } from '../lib/queryKeys';
import type { StockAreaScopes } from '../types/stock-area-scopes';

const EMPTY: StockAreaScopes = { areas: [], writableAreaId: null, readsAllAreas: false };

/**
 * The one way the stock screens learn which Areas they may show.
 *
 * Sole owner of this query key, the same rule useAreaLookup follows: two callers
 * storing different shapes under one key is what made StockBalancesPage crash on
 * `.map` before.
 */
export const useStockAreaScopes = () => {
  const query = useQuery({
    queryKey: queryKeys.meStockAreaScopes.all,
    queryFn: ({ signal }) => getMyStockAreaScopes(signal),
    staleTime: 5 * 60 * 1000,
  });
  return {
    scopes: query.data ?? EMPTY,
    loading: query.isPending,
    error: query.isError,
  };
};

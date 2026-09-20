import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { getApiErrorMessage } from '../api/errors';

export interface CrudFeedback {
  type: 'success' | 'error';
  message: string;
}

/** One identity for every empty result, so consumers can memoise on `items`. */
const EMPTY_ITEMS: never[] = [];

export const useCrudResource = <T,>(
  loader: (signal: AbortSignal) => Promise<T[]>,
  loadErrorMessage: string,
  queryKey: QueryKey,
  options: {
    staleTime?: number;
    invalidateQueryKeys?: readonly QueryKey[];
  } = {},
) => {
  const [feedback, setFeedback] = useState<CrudFeedback | null>(null);
  const queryClient = useQueryClient();
  const resourceQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) => loader(signal),
    staleTime: options.staleTime ?? 15 * 60 * 1000,
  });
  const resourceMutation = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
  });
  const reload = useCallback(
    () => resourceQuery.refetch().then(() => undefined),
    [resourceQuery],
  );

  const data = resourceQuery.data;
  // A value that is not an array can only have got into this key from another
  // caller storing a different shape under it. Rendering an empty list is far
  // better than throwing `.map is not a function` mid-render and blanking the
  // page, but it must never pass quietly: without the log the real defect just
  // becomes a table that is mysteriously empty.
  const malformed = data !== undefined && !Array.isArray(data);
  const queryKeyLabel = JSON.stringify(queryKey);

  useEffect(() => {
    if (!malformed) return;
    console.error(
      `[useCrudResource] Query key ${queryKeyLabel} holds a non-array value. `
      + 'Another caller caches a different shape under this key; '
      + 'the list stays empty until both agree. See src/hooks/useAreaLookup.ts.',
    );
  }, [malformed, queryKeyLabel]);

  const runMutation = async (
    action: () => Promise<unknown>,
    successMessage: string,
    failureMessage: string,
  ): Promise<boolean> => {
    setFeedback(null);
    try {
      await resourceMutation.mutateAsync(action);
      setFeedback({ type: 'success', message: successMessage });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        ...(options.invalidateQueryKeys ?? []).map((key) =>
          queryClient.invalidateQueries({ queryKey: key }),
        ),
      ]);
      return true;
    } catch (requestError) {
      setFeedback({
        type: 'error',
        message: getApiErrorMessage(requestError, failureMessage),
      });
      return false;
    }
  };

  return {
    items: Array.isArray(data) ? data : EMPTY_ITEMS,
    loading: resourceQuery.isPending || resourceQuery.isFetching,
    error: resourceQuery.isError
      ? getApiErrorMessage(resourceQuery.error, loadErrorMessage)
      : null,
    mutating: resourceMutation.isPending,
    feedback,
    setFeedback,
    reload,
    runMutation,
  };
};

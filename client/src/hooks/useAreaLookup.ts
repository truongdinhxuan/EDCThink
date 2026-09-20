import { listAreas } from '../api/areas.service';
import { queryKeys } from '../lib/queryKeys';
import { useCrudResource } from './useCrudResource';

const loadAreas = async (signal: AbortSignal) =>
  (await listAreas(
    { page: 1, pageSize: 100, isActive: true, sortBy: 'code', sortOrder: 'asc' },
    signal,
  )).data;

/**
 * The one way to read the active Area list.
 *
 * Seven screens used to declare this themselves against the same query key, and
 * one of them cached the paginated envelope while the rest cached the array.
 * React Query stores one value per key, so whichever loaded last decided the
 * shape and the other screens crashed on `.map`. Keeping the key and the loader
 * in a single place makes that mismatch unrepresentable.
 */
export const useAreaLookup = () => useCrudResource(
  loadAreas,
  'Không thể tải danh sách khu vực.',
  queryKeys.areas.lookup({ pageSize: 100, isActive: true }),
);

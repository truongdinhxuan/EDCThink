import type { ApiEnvelope } from '../types/api';
import type { AreaTypeSummary } from '../types/area-scopes';
import instance from './http';
import { unwrapData } from './response';

export const listAreaTypes = async (signal?: AbortSignal): Promise<AreaTypeSummary[]> =>
  unwrapData(await instance.get<
    ApiEnvelope<AreaTypeSummary[]>,
    ApiEnvelope<AreaTypeSummary[]>
  >('area-types', { signal }));

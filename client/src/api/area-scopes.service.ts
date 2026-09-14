import type { ApiEnvelope } from '../types/api';
import type { EffectiveAreaScopesResponse } from '../types/area-scopes';
import instance from './http';
import { unwrapData } from './response';

export const getMyAreaScopes = async (
  signal?: AbortSignal,
): Promise<EffectiveAreaScopesResponse> => unwrapData(
  await instance.get<
    ApiEnvelope<EffectiveAreaScopesResponse>,
    ApiEnvelope<EffectiveAreaScopesResponse>
  >('me/area-scopes', { signal }),
);

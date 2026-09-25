import instance from './http';
import type { ApiEnvelope } from '../types/api';
import type { PaginatedResponse } from '../types/pagination.types';
import type {
  SaveTeamsWorkflowInput,
  TeamsDelivery,
  TeamsDeliveryListParams,
  TeamsTestResult,
  TeamsWorkflow,
} from '../types/teams-workflows';

export const listTeamsWorkflows = async (signal?: AbortSignal): Promise<TeamsWorkflow[]> =>
  (await instance.get<ApiEnvelope<TeamsWorkflow[]>, ApiEnvelope<TeamsWorkflow[]>>(
    'teams-workflows',
    { signal },
  )).data;

export const saveTeamsWorkflow = async (
  functionCode: string,
  input: SaveTeamsWorkflowInput,
): Promise<TeamsWorkflow> =>
  (await instance.put<ApiEnvelope<TeamsWorkflow>, ApiEnvelope<TeamsWorkflow>>(
    `teams-workflows/${encodeURIComponent(functionCode)}`,
    input,
  )).data;

export const sendTeamsWorkflowTest = async (functionCode: string): Promise<TeamsTestResult> =>
  (await instance.post<ApiEnvelope<TeamsTestResult>, ApiEnvelope<TeamsTestResult>>(
    `teams-workflows/${encodeURIComponent(functionCode)}/test`,
  )).data;

export const listTeamsDeliveries = (
  params: TeamsDeliveryListParams = {},
  signal?: AbortSignal,
): Promise<PaginatedResponse<TeamsDelivery>> =>
  instance.get<PaginatedResponse<TeamsDelivery>, PaginatedResponse<TeamsDelivery>>(
    'teams-workflows/deliveries',
    { params, signal },
  );

export const retryTeamsDelivery = async (id: string): Promise<{ id: string; status: string }> =>
  (await instance.post<
    ApiEnvelope<{ id: string; status: string }>,
    ApiEnvelope<{ id: string; status: string }>
  >(`teams-workflows/deliveries/${id}/retry`)).data;

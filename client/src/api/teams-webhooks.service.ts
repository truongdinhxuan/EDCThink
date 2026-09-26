import instance from './http';
import type { ApiEnvelope } from '../types/api';
import type { TeamsWebhook, TeamsWebhookTestResult } from '../types/teams-webhooks';

export const listTeamsWebhooks = async (signal?: AbortSignal): Promise<TeamsWebhook[]> =>
  (await instance.get<ApiEnvelope<TeamsWebhook[]>, ApiEnvelope<TeamsWebhook[]>>(
    'teams-webhooks',
    { signal },
  )).data;

export const setTeamsWebhookActive = async (code: string, isActive: boolean): Promise<TeamsWebhook> =>
  (await instance.patch<ApiEnvelope<TeamsWebhook>, ApiEnvelope<TeamsWebhook>>(
    `teams-webhooks/${encodeURIComponent(code)}`,
    { is_active: isActive },
  )).data;

/** Write-only: the URL goes to Supabase Vault and is never returned. */
export const saveTeamsWebhookUrl = async (code: string, webhookUrl: string): Promise<TeamsWebhook> =>
  (await instance.put<ApiEnvelope<TeamsWebhook>, ApiEnvelope<TeamsWebhook>>(
    `teams-webhooks/${encodeURIComponent(code)}/url`,
    { webhook_url: webhookUrl },
  )).data;

export const sendTeamsWebhookTest = async (code: string): Promise<TeamsWebhookTestResult> =>
  (await instance.post<ApiEnvelope<TeamsWebhookTestResult>, ApiEnvelope<TeamsWebhookTestResult>>(
    `teams-webhooks/${encodeURIComponent(code)}/test`,
  )).data;

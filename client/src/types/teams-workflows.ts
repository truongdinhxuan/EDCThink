import type { PaginatedListParams } from './pagination.types';

export type TeamsDeliveryStatus = 'PENDING' | 'SENT' | 'FAILED';

export interface TeamsDelivery {
  id: string;
  function_code: string;
  entity_type: string;
  entity_id: string;
  order_code: string | null;
  is_test: boolean;
  /** Order status the message announced, e.g. "Đã xác nhận". */
  order_status: string | null;
  status: TeamsDeliveryStatus;
  attempts: number;
  last_http_status: number | null;
  last_error: string | null;
  next_attempt_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamsWorkflow {
  function_code: string;
  function_name: string;
  description: string;
  workflow_id: string | null;
  name: string;
  is_active: boolean;
  /** Server env variable holding the Workflow URL, e.g. TEAMS_WEBHOOK_URL_ORDER_STATUS_CHANGED. */
  url_env_key: string;
  has_url: boolean;
  /** False when the env URL is not https on an allowed host. */
  url_allowed: boolean;
  /** host + "…" + last 6 characters; the full URL never leaves the server. */
  masked_url: string | null;
  updated_at: string | null;
  last_delivery: TeamsDelivery | null;
}

/** On/off only: the URL is configured in the server .env. */
export interface SaveTeamsWorkflowInput {
  is_active: boolean;
}

export interface TeamsTestResult {
  ok: boolean;
  http_status: number | null;
  error: string | null;
}

export interface TeamsDeliveryListParams extends PaginatedListParams {
  functionCode?: string;
  status?: TeamsDeliveryStatus;
  orderCode?: string;
}

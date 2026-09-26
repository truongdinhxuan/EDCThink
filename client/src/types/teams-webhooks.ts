/** One Teams function (one Workflow) as GET /teams-webhooks returns it. */
export interface TeamsWebhook {
  code: string;
  title: string;
  description: string | null;
  is_active: boolean;
  /** The Workflow URL exists in Supabase Vault. The URL itself never leaves the server. */
  configured: boolean;
  last_sent_at: string | null;
  last_success: boolean | null;
  last_http_status: number | null;
  last_error: string | null;
}

export interface TeamsWebhookTestResult {
  success: boolean;
  http_status: number | null;
}

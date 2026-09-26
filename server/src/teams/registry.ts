import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildOrderStatusHtml,
  buildTestHtml,
  type OrderStatusSnapshot,
} from './orderStatusTemplate';

/** The one NOTIFY channel; each payload names its function in `code`. */
export const TEAMS_EVENTS_CHANNEL = 'teams_webhook_events';

export interface TeamsRenderContext {
  appBaseUrl: string;
}

/**
 * One entry per app function that posts to its own Teams Workflow. Adding a
 * function: a Workflow in Teams, a Vault secret `teams_webhook:{CODE}`, a
 * seeded teams_webhooks row, and one entry here (event + template). The admin
 * page renders whatever teams_webhooks holds, so it needs no change.
 */
export interface TeamsHookDefinition<Event = unknown, Snapshot = unknown> {
  code: string;
  /**
   * Reads a NOTIFY payload that carries this `code`. `queueKey` orders
   * delivery: messages with the same key are sent one after another.
   * Returns null for a payload it cannot use.
   */
  parseEvent: (payload: Record<string, unknown>) => { queueKey: string; event: Event } | null;
  /** Loads what the message shows, after the change committed. Null skips it. */
  loadEvent: (db: SupabaseClient, event: Event) => Promise<Snapshot | null>;
  buildHtml: (snapshot: Snapshot, context: TeamsRenderContext) => string;
  buildTestHtml: (title: string) => string;
}

const isUuid = (value: unknown): value is string =>
  typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

interface OrderStatusEvent {
  orderId: string;
  revisionId: string;
}

const orderStatusChanged: TeamsHookDefinition<OrderStatusEvent, OrderStatusSnapshot> = {
  code: 'ORDER_STATUS_CHANGED',
  // Published by notify_order_status_teams_event() on order_revisions.
  parseEvent: (payload) => isUuid(payload.order_id) && isUuid(payload.revision_id)
    ? {
      queueKey: `order:${payload.order_id}`,
      event: { orderId: payload.order_id, revisionId: payload.revision_id },
    }
    : null,
  loadEvent: async (db, event) => {
    const { data, error } = await db.rpc('get_order_status_teams_event', {
      p_revision_id: event.revisionId,
    });
    if (error) throw new Error(`get_order_status_teams_event: ${error.message}`);
    return (data as OrderStatusSnapshot | null) ?? null;
  },
  buildHtml: buildOrderStatusHtml,
  buildTestHtml: (title) => buildTestHtml(title),
};

export const TEAMS_HOOKS: Readonly<Record<string, TeamsHookDefinition>> = {
  ORDER_STATUS_CHANGED: orderStatusChanged as TeamsHookDefinition,
};

export const TEAMS_HOOK_CODES = Object.keys(TEAMS_HOOKS);

export const getTeamsHook = (code: unknown): TeamsHookDefinition | null =>
  typeof code === 'string' && Object.hasOwn(TEAMS_HOOKS, code) ? TEAMS_HOOKS[code] : null;

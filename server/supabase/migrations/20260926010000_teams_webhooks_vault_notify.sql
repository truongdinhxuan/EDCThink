-- Teams webhooks, reworked: one row per app function, the Workflow URL in
-- Supabase Vault (never in the app, the repo or .env), and events pushed to the
-- backend with NOTIFY instead of an outbox table.
--
-- Replaces the outbox of 20260925020000 / 20260925030000 (teams_workflows,
-- teams_webhook_deliveries, claim and enqueue functions). Kept from it: the
-- RECEIVE/COMPLETE actions, transition_order_status, the CREATE revision written
-- at commit and the guard that refuses a status change without a revision.
-- Together they make order_revisions the one place every status change shows up,
-- including the creation of an Order, and the only place that knows the actor.
--
-- Admin enters or changes a URL in the Supabase SQL Editor; the app only reads:
--   -- new
--   select vault.create_secret('<Workflow URL>', 'teams_webhook:ORDER_STATUS_CHANGED',
--                              'Teams workflow: trạng thái đơn hàng');
--   -- change
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'teams_webhook:ORDER_STATUS_CHANGED'),
--     '<new Workflow URL>');
begin;

-- ---------------------------------------------------------------------------
-- 1. Drop the outbox
-- ---------------------------------------------------------------------------
drop trigger if exists order_revisions_enqueue_teams_delivery on public.order_revisions;
drop function if exists public.enqueue_order_status_teams_delivery();
drop function if exists public.claim_teams_webhook_deliveries(integer, integer);
drop function if exists public.save_teams_workflow(text, text, boolean, uuid);
drop table if exists public.teams_webhook_deliveries;
drop table if exists public.teams_workflows;

-- ---------------------------------------------------------------------------
-- 2. One row per function = one card on the admin page
-- ---------------------------------------------------------------------------
create extension if not exists supabase_vault with schema vault;

create table public.teams_webhooks (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  title text not null,
  description text,
  vault_secret_name text not null,
  is_active boolean not null default false,
  -- Outcome of the latest send only, overwritten each time. Not a log.
  last_sent_at timestamptz,
  last_success boolean,
  last_http_status integer,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_webhooks_code_key unique (code),
  constraint teams_webhooks_vault_secret_name_key unique (vault_secret_name),
  constraint teams_webhooks_code_format check (code ~ '^[A-Z][A-Z0-9_]*$'),
  constraint teams_webhooks_last_error_length check (char_length(last_error) <= 500)
);

comment on table public.teams_webhooks is
  'One Teams Workflow per app function. code must match an entry of the backend registry (src/teams/registry.ts). The URL lives in Vault under vault_secret_name.';
comment on column public.teams_webhooks.last_error is
  'Short message about the latest failed send. Never contains the Workflow URL.';

create trigger teams_webhooks_set_updated_at
before update on public.teams_webhooks
for each row execute function public.set_updated_at();

alter table public.teams_webhooks enable row level security;
revoke all on table public.teams_webhooks from public, anon, authenticated;
grant select, update on table public.teams_webhooks to service_role;

insert into public.teams_webhooks (code, title, description, vault_secret_name)
values (
  'ORDER_STATUS_CHANGED',
  'Thông báo trạng thái đơn hàng',
  'Gửi 1 tin vào nhóm chat mỗi khi đơn đổi trạng thái, kể cả lúc tạo đơn.',
  'teams_webhook:ORDER_STATUS_CHANGED'
)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Vault access: backend (service_role) only
-- ---------------------------------------------------------------------------
create or replace function public.get_teams_webhook_url(p_code text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select secret.decrypted_secret
  from public.teams_webhooks webhook
  join vault.decrypted_secrets secret on secret.name = webhook.vault_secret_name
  where webhook.code = p_code;
$$;

-- Every function with whether its secret exists; never the secret itself.
create or replace function public.list_teams_webhooks()
returns table (
  code text,
  title text,
  description text,
  is_active boolean,
  configured boolean,
  last_sent_at timestamptz,
  last_success boolean,
  last_http_status integer,
  last_error text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    webhook.code,
    webhook.title,
    webhook.description,
    webhook.is_active,
    exists (select 1 from vault.secrets secret where secret.name = webhook.vault_secret_name),
    webhook.last_sent_at,
    webhook.last_success,
    webhook.last_http_status,
    webhook.last_error
  from public.teams_webhooks webhook
  order by webhook.created_at, webhook.code;
$$;

revoke all on function public.get_teams_webhook_url(text) from public, anon, authenticated;
grant execute on function public.get_teams_webhook_url(text) to service_role;
revoke all on function public.list_teams_webhooks() from public, anon, authenticated;
grant execute on function public.list_teams_webhooks() to service_role;

-- ---------------------------------------------------------------------------
-- 4. What an ORDER_STATUS_CHANGED message shows, read by the backend on send
-- ---------------------------------------------------------------------------
-- Status, actor and time come from the revision, so they describe that change.
-- Order fields and quantities are read as they are when the message is built.
create or replace function public.get_order_status_teams_event(p_revision_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'order', jsonb_build_object(
      'id', o.id,
      'code', o.code,
      'from_area', jsonb_build_object('code', from_area.code, 'name', from_area.name),
      'to_area', jsonb_build_object('code', to_area.code, 'name', to_area.name),
      'requester', btrim(coalesce(requester.first_name, '') || ' ' || coalesce(requester.last_name, '')),
      'rejected_reason', o.rejected_reason,
      'cancel_reason', o.cancel_reason
    ),
    'revision_id', revision.id,
    'occurred_at', revision.created_at,
    'actor', btrim(coalesce(actor.first_name, '') || ' ' || coalesce(actor.last_name, '')),
    'old_status', case when old_status.id is null then null
      else jsonb_build_object('code', old_status.code, 'name', old_status.name) end,
    'new_status', jsonb_build_object('code', new_status.code, 'name', new_status.name),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', coalesce(nullif(btrim(supply.short_text), ''), supply.code),
        'unit', coalesce(nullif(btrim(unit.name), ''), unit.symbol, unit.code),
        'quantity_requested', item.quantity_requested,
        'quantity_approved', item.quantity_approved,
        'quantity_issued', item.quantity_issued
      ) order by item.created_at, item.id)
      from public.order_items item
      join public.supplies supply on supply.id = item.supply_id
      left join public.units unit on unit.id = item.unit_id
      where item.order_id = o.id and item.is_active = true and item.is_deleted = false
    ), '[]'::jsonb)
  )
  from public.order_revisions revision
  join public.orders o on o.id = revision.order_id
  join public.order_statuses new_status on new_status.id = revision.new_status_id
  left join public.order_statuses old_status on old_status.id = revision.old_status_id
  left join public.areas from_area on from_area.id = o.from_area_id
  left join public.areas to_area on to_area.id = o.to_area_id
  left join public.users requester on requester.id = o.requested_by
  left join public.users actor on actor.id = revision.created_by
  where revision.id = p_revision_id;
$$;

revoke all on function public.get_order_status_teams_event(uuid) from public, anon, authenticated;
grant execute on function public.get_order_status_teams_event(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. NOTIFY on every status change
-- ---------------------------------------------------------------------------
-- NOTIFY is delivered only when the transaction commits, so a rolled-back
-- change never reaches Teams, and it fires for RPCs and direct SQL alike. The
-- payload carries ids only (NOTIFY caps it at 8000 bytes).
create or replace function public.notify_order_status_teams_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.new_status_id is null
     or new.old_status_id is not distinct from new.new_status_id
     or new.is_deleted then
    return null;
  end if;

  perform pg_notify('teams_webhook_events', jsonb_build_object(
    'code', 'ORDER_STATUS_CHANGED',
    'order_id', new.order_id,
    'revision_id', new.id,
    'old_status_id', new.old_status_id,
    'new_status_id', new.new_status_id,
    'actor_id', new.created_by
  )::text);
  return null;
end;
$$;

drop trigger if exists order_revisions_notify_teams on public.order_revisions;
create trigger order_revisions_notify_teams
after insert on public.order_revisions
for each row execute function public.notify_order_status_teams_event();

-- ---------------------------------------------------------------------------
-- 6. Permissions (already seeded and granted to ADMIN; refresh descriptions)
-- ---------------------------------------------------------------------------
update public.permissions
set description = case code
      when 'teams_webhook.view' then 'Guard GET /teams-webhooks'
      else 'Guard PATCH /teams-webhooks/:code and test send'
    end,
    updated_at = now()
where code in ('teams_webhook.view', 'teams_webhook.manage');

insert into public.role_permissions (role_id, permission_id, is_active, is_deleted)
select role_row.id, permission_row.id, true, false
from public.roles role_row
cross join public.permissions permission_row
where role_row.code = 'ADMIN'
  and role_row.is_system = true
  and permission_row.code in ('teams_webhook.view', 'teams_webhook.manage')
on conflict (role_id, permission_id) do update
set is_active = true, is_deleted = false, updated_at = now();

commit;

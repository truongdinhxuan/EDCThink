-- Microsoft Teams Workflows webhook: one Workflow URL per app "function", and
-- an outbox that sends one message per Order status change.
--
-- The single hook is AFTER INSERT ON order_revisions. A revision already carries
-- the old and new status, the actor and the reason, and its id makes a stable
-- event key. Before this migration four status changes wrote no revision at all
-- (create, receive, complete, cancel); sections 1-3 close that gap, and a
-- deferred constraint trigger makes any future status change without a revision
-- fail at commit instead of silently skipping Teams.

begin;

-- ---------------------------------------------------------------------------
-- 1. Revision actions for the status changes that had none
-- ---------------------------------------------------------------------------
insert into public.order_revision_actions (code, name, description, is_system, is_active, is_deleted)
values
  ('RECEIVE', 'Nhận hàng', 'Khu vực nhận xác nhận đã nhận hàng', true, true, false),
  ('COMPLETE', 'Hoàn thành', 'Order được đóng sau khi nhận hàng', true, true, false)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    is_system = true,
    is_active = true,
    is_deleted = false,
    updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. Creating an Order writes its CREATE revision
-- ---------------------------------------------------------------------------
-- Deferred to commit: create_pending_order_with_items inserts the Order before
-- its items, and the Teams snapshot taken from this revision must see them.
create or replace function public.write_order_create_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action_id uuid;
begin
  select action.id into v_action_id
  from public.order_revision_actions action
  where action.code = 'CREATE' and action.is_active = true and action.is_deleted = false;

  if v_action_id is null then
    raise exception 'order_revision_actions CREATE is missing';
  end if;

  insert into public.order_revisions (
    order_id, action_id, old_status_id, new_status_id, old_data, new_data, created_by
  )
  values (
    new.id, v_action_id, null, new.status_id,
    null, jsonb_build_object('status_id', new.status_id), new.requested_by
  );
  return null;
end;
$$;

drop trigger if exists orders_write_create_revision on public.orders;
create constraint trigger orders_write_create_revision
after insert on public.orders
deferrable initially deferred
for each row execute function public.write_order_create_revision();

-- ---------------------------------------------------------------------------
-- 3. Receive / complete / cancel become one atomic RPC that writes a revision
-- ---------------------------------------------------------------------------
-- The service keeps every business rule (permission, owner, status machine,
-- window); this only moves the write and its audit row into one transaction.
-- Returns false, with no change, when the Order is no longer in the status the
-- caller read — the same outcome the previous conditional UPDATE had.
create or replace function public.transition_order_status(
  p_order_id uuid,
  p_actor_id uuid,
  p_expected_status_id uuid,
  p_target_status_code text,
  p_cancel_reason text default null,
  p_taken_away_by uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_target_status_id uuid;
  v_action_code text;
  v_action_id uuid;
begin
  v_action_code := case p_target_status_code
    when 'RECEIVED' then 'RECEIVE'
    when 'COMPLETED' then 'COMPLETE'
    when 'CANCELLED' then 'CANCEL'
  end;
  if v_action_code is null then
    raise exception using message = 'ORDER_TRANSITION_UNSUPPORTED';
  end if;

  select status.id into v_target_status_id
  from public.order_statuses status
  where status.code = p_target_status_code and status.is_active = true and status.is_deleted = false;
  select action.id into v_action_id
  from public.order_revision_actions action
  where action.code = v_action_code and action.is_active = true and action.is_deleted = false;
  if v_target_status_id is null or v_action_id is null then
    raise exception using message = 'ORDER_TRANSITION_LOOKUP_NOT_FOUND';
  end if;

  select o.* into v_order
  from public.orders o
  where o.id = p_order_id and o.is_deleted = false
  for update;

  if not found or v_order.status_id is distinct from p_expected_status_id then
    return false;
  end if;

  update public.orders
  set status_id = v_target_status_id,
      received_at = case when p_target_status_code = 'RECEIVED' then now() else received_at end,
      completed_at = case when p_target_status_code = 'COMPLETED' then now() else completed_at end,
      cancel_reason = case when p_target_status_code = 'CANCELLED' then p_cancel_reason else cancel_reason end,
      taken_away_by = coalesce(p_taken_away_by, taken_away_by),
      updated_at = now()
  where id = p_order_id;

  insert into public.order_revisions (
    order_id, action_id, old_status_id, new_status_id, old_data, new_data, reason, created_by
  )
  values (
    p_order_id, v_action_id, v_order.status_id, v_target_status_id,
    jsonb_build_object('status_id', v_order.status_id),
    jsonb_build_object('status_id', v_target_status_id),
    case when p_target_status_code = 'CANCELLED' then p_cancel_reason else null end,
    p_actor_id
  );
  return true;
end;
$$;

revoke all on function public.transition_order_status(uuid, uuid, uuid, text, text, uuid)
from public, anon, authenticated;
grant execute on function public.transition_order_status(uuid, uuid, uuid, text, text, uuid)
to service_role;

-- ---------------------------------------------------------------------------
-- 4. Guard: a status change without a revision cannot commit
-- ---------------------------------------------------------------------------
-- order_revisions.created_at defaults to now(), the transaction start, so a
-- revision written in the same transaction matches exactly.
create or replace function public.assert_order_status_change_has_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.order_revisions revision
    where revision.order_id = new.id
      and revision.new_status_id = new.status_id
      and revision.created_at >= now()
  ) then
    raise exception using
      message = 'ORDER_STATUS_CHANGE_WITHOUT_REVISION',
      detail = jsonb_build_object('order_id', new.id, 'status_id', new.status_id)::text,
      hint = 'Change Order status through an RPC that writes order_revisions.';
  end if;
  return null;
end;
$$;

drop trigger if exists orders_status_change_requires_revision on public.orders;
create constraint trigger orders_status_change_requires_revision
after update of status_id on public.orders
deferrable initially deferred
for each row
when (old.status_id is distinct from new.status_id)
execute function public.assert_order_status_change_has_revision();

-- ---------------------------------------------------------------------------
-- 5. Workflows: one row per app function; the URL lives in Supabase Vault
-- ---------------------------------------------------------------------------
create extension if not exists supabase_vault with schema vault;

create table public.teams_workflows (
  id uuid primary key default gen_random_uuid(),
  function_code text not null,
  name text not null,
  webhook_secret_id uuid,
  is_active boolean not null default false,
  created_by uuid references public.users (id) on delete set null on update cascade,
  updated_by uuid references public.users (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_workflows_function_code_key unique (function_code),
  constraint teams_workflows_function_code_format check (function_code ~ '^[A-Z][A-Z0-9_]*$')
);

create trigger teams_workflows_set_updated_at
before update on public.teams_workflows
for each row execute function public.set_updated_at();

comment on column public.teams_workflows.webhook_secret_id is
  'vault.secrets id of the Workflow HTTP POST URL. The URL itself is never stored in this table.';

-- Saves name/active and, when p_webhook_url is not null, replaces the URL.
-- URL policy (https + host allowlist) is enforced by the backend before this.
create or replace function public.save_teams_workflow(
  p_function_code text,
  p_name text,
  p_webhook_url text,
  p_is_active boolean,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow public.teams_workflows%rowtype;
  v_secret_name text := 'teams_workflow_url:' || p_function_code;
begin
  insert into public.teams_workflows (function_code, name, is_active, created_by, updated_by)
  values (p_function_code, p_name, false, p_actor_id, p_actor_id)
  on conflict (function_code) do nothing;

  select * into v_workflow
  from public.teams_workflows
  where function_code = p_function_code
  for update;

  if nullif(btrim(p_webhook_url), '') is not null then
    if v_workflow.webhook_secret_id is null then
      v_workflow.webhook_secret_id := vault.create_secret(
        btrim(p_webhook_url), v_secret_name, 'Teams Workflow URL for ' || p_function_code
      );
    else
      perform vault.update_secret(v_workflow.webhook_secret_id, btrim(p_webhook_url));
    end if;
  end if;

  update public.teams_workflows
  set name = coalesce(nullif(btrim(p_name), ''), name),
      webhook_secret_id = v_workflow.webhook_secret_id,
      is_active = coalesce(p_is_active, is_active),
      updated_by = p_actor_id
  where id = v_workflow.id;

  return v_workflow.id;
end;
$$;

create or replace function public.get_teams_workflow_url(p_workflow_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select secret.decrypted_secret
  from public.teams_workflows workflow
  join vault.decrypted_secrets secret on secret.id = workflow.webhook_secret_id
  where workflow.id = p_workflow_id;
$$;

revoke all on function public.save_teams_workflow(text, text, text, boolean, uuid)
from public, anon, authenticated;
grant execute on function public.save_teams_workflow(text, text, text, boolean, uuid)
to service_role;
revoke all on function public.get_teams_workflow_url(uuid)
from public, anon, authenticated;
grant execute on function public.get_teams_workflow_url(uuid)
to service_role;

-- ---------------------------------------------------------------------------
-- 6. Outbox and delivery log
-- ---------------------------------------------------------------------------
-- status: PENDING (waiting or retrying: next_attempt_at says when), SENT, or
-- FAILED (gave up; only a manual retry moves it again).
-- payload: { snapshot } at enqueue; the backend renders { body: { html } } on the
-- first attempt and every retry resends exactly that body.
create table public.teams_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  workflow_id uuid not null references public.teams_workflows (id) on delete restrict,
  function_code text not null,
  entity_type text not null,
  entity_id uuid not null,
  event_key text not null,
  payload jsonb not null,
  status text not null default 'PENDING',
  attempts integer not null default 0,
  last_http_status integer,
  last_error text,
  next_attempt_at timestamptz default now(),
  locked_until timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_webhook_deliveries_event_key_key unique (event_key),
  constraint teams_webhook_deliveries_status_valid check (status in ('PENDING', 'SENT', 'FAILED'))
);

create index teams_webhook_deliveries_status_next_idx
  on public.teams_webhook_deliveries (status, next_attempt_at);
create index teams_webhook_deliveries_entity_idx
  on public.teams_webhook_deliveries (entity_type, entity_id, seq);
create index teams_webhook_deliveries_created_idx
  on public.teams_webhook_deliveries (created_at desc);

create trigger teams_webhook_deliveries_set_updated_at
before update on public.teams_webhook_deliveries
for each row execute function public.set_updated_at();

-- Claims due rows for one worker pass. SKIP LOCKED lets several server
-- instances share the queue; the lease stops a second instance from picking a
-- row up again while the first is still sending it. A row waits while an older
-- row of the same entity is still PENDING, so Teams shows statuses in order.
create or replace function public.claim_teams_webhook_deliveries(
  p_limit integer default 20,
  p_lease_seconds integer default 60
)
returns setof public.teams_webhook_deliveries
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select delivery.id
    from public.teams_webhook_deliveries delivery
    where delivery.status = 'PENDING'
      and coalesce(delivery.next_attempt_at, delivery.created_at) <= now()
      and (delivery.locked_until is null or delivery.locked_until < now())
      and not exists (
        select 1
        from public.teams_webhook_deliveries earlier
        where earlier.entity_type = delivery.entity_type
          and earlier.entity_id = delivery.entity_id
          and earlier.seq < delivery.seq
          and earlier.status = 'PENDING'
      )
    order by delivery.seq
    limit greatest(p_limit, 1)
    for update of delivery skip locked
  )
  update public.teams_webhook_deliveries delivery
  set locked_until = now() + make_interval(secs => p_lease_seconds)
  from due
  where delivery.id = due.id
  returning delivery.*;
end;
$$;

revoke all on function public.claim_teams_webhook_deliveries(integer, integer)
from public, anon, authenticated;
grant execute on function public.claim_teams_webhook_deliveries(integer, integer)
to service_role;

-- ---------------------------------------------------------------------------
-- 7. Enqueue on every Order status revision
-- ---------------------------------------------------------------------------
-- The snapshot holds what the message shows as of this event, so a retry ten
-- minutes later still says what happened then, not what the Order says now.
create or replace function public.enqueue_order_status_teams_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow public.teams_workflows%rowtype;
  v_snapshot jsonb;
begin
  if new.new_status_id is null
     or new.old_status_id is not distinct from new.new_status_id
     or new.is_deleted then
    return null;
  end if;

  select * into v_workflow
  from public.teams_workflows workflow
  where workflow.function_code = 'ORDER_STATUS_CHANGED'
    and workflow.is_active = true
    and workflow.webhook_secret_id is not null;
  if not found then
    return null;
  end if;

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
    'revision_id', new.id,
    'occurred_at', new.created_at,
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
  into v_snapshot
  from public.orders o
  join public.order_statuses new_status on new_status.id = new.new_status_id
  left join public.order_statuses old_status on old_status.id = new.old_status_id
  left join public.areas from_area on from_area.id = o.from_area_id
  left join public.areas to_area on to_area.id = o.to_area_id
  left join public.users requester on requester.id = o.requested_by
  left join public.users actor on actor.id = new.created_by
  where o.id = new.order_id;

  insert into public.teams_webhook_deliveries (
    workflow_id, function_code, entity_type, entity_id, event_key, payload
  )
  values (
    v_workflow.id, 'ORDER_STATUS_CHANGED', 'order', new.order_id,
    'ORDER_STATUS_CHANGED:' || new.order_id || ':' || new.id,
    jsonb_build_object('snapshot', v_snapshot)
  )
  on conflict (event_key) do nothing;

  return null;
end;
$$;

drop trigger if exists order_revisions_enqueue_teams_delivery on public.order_revisions;
create trigger order_revisions_enqueue_teams_delivery
after insert on public.order_revisions
for each row execute function public.enqueue_order_status_teams_delivery();

-- ---------------------------------------------------------------------------
-- 8. Access: backend only
-- ---------------------------------------------------------------------------
alter table public.teams_workflows enable row level security;
alter table public.teams_webhook_deliveries enable row level security;
revoke all on table public.teams_workflows from public, anon, authenticated;
revoke all on table public.teams_webhook_deliveries from public, anon, authenticated;
grant select on table public.teams_workflows to service_role;
grant select, update on table public.teams_webhook_deliveries to service_role;

-- ---------------------------------------------------------------------------
-- 9. Permissions
-- ---------------------------------------------------------------------------
insert into public.permissions (code, name, module, description, is_system, is_active, is_deleted)
values
  ('teams_webhook.view', 'Xem Teams Webhook', 'Admin', 'Guard GET /teams-workflows and the delivery log', true, true, false),
  ('teams_webhook.manage', 'Quản lý Teams Webhook', 'Admin', 'Guard PUT /teams-workflows, test send and manual retry', true, true, false)
on conflict (code) do update
set name = excluded.name,
    module = excluded.module,
    description = excluded.description,
    is_system = true,
    is_active = true,
    is_deleted = false,
    updated_at = now();

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

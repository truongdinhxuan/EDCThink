-- Teams Workflow URLs move out of the database into the server environment
-- (TEAMS_WEBHOOK_URL_<FUNCTION_CODE> in .env). The database keeps only the
-- per-function on/off switch; it never holds the URL, not even encrypted.
--
-- The enqueue trigger can no longer see whether a URL exists, so it queues
-- whenever the function is on. A row whose URL is missing from the env fails at
-- send time with a readable error in the delivery log.
begin;

-- The URL was already copied to server/.env before this migration ran.
delete from vault.secrets
where id in (select webhook_secret_id from public.teams_workflows where webhook_secret_id is not null);

drop function if exists public.get_teams_workflow_url(uuid);
drop function if exists public.save_teams_workflow(text, text, text, boolean, uuid);

alter table public.teams_workflows drop column webhook_secret_id;

create or replace function public.save_teams_workflow(
  p_function_code text,
  p_name text,
  p_is_active boolean,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.teams_workflows (function_code, name, is_active, created_by, updated_by)
  values (
    p_function_code,
    coalesce(nullif(btrim(p_name), ''), p_function_code),
    coalesce(p_is_active, false),
    p_actor_id,
    p_actor_id
  )
  on conflict (function_code) do update
  set name = coalesce(nullif(btrim(p_name), ''), public.teams_workflows.name),
      is_active = coalesce(p_is_active, public.teams_workflows.is_active),
      updated_by = p_actor_id
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.save_teams_workflow(text, text, boolean, uuid)
from public, anon, authenticated;
grant execute on function public.save_teams_workflow(text, text, boolean, uuid)
to service_role;

-- Same trigger body as 20260925020000, minus the URL condition.
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
    and workflow.is_active = true;
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

comment on table public.teams_workflows is
  'One row per Teams function: name and on/off switch. The Workflow URL lives in the server env as TEAMS_WEBHOOK_URL_<function_code>.';

commit;

-- review_order: approval is bounded by stock, not by the request.
--
-- The only definition (202607290001) refused any quantity_approved above
-- quantity_requested with 'Invalid approved quantity or order item', although
-- the column comment (20260909014522) and the API both allow it. The client used
-- to block the case first, so the refusal never surfaced; once the client
-- stopped capping at the request it became reachable.
--
-- Rules now, per item:
--   * quantity_approved >= 0 and a whole number (0 rejects the line)
--   * a KIEN_SAT_TC line is a whole number of stacks
--   * lines of one code (supply, provider, set_per_qty) together do not exceed
--     that code's pooled stock in the source Area
--
-- Authorisation stays on supply.order.approve, as patched into the live
-- function by 202608110002; this full redefinition keeps that guard.

begin;

create or replace function public.review_order(
  p_order_id uuid,
  p_actor_id uuid,
  p_action_code text,
  p_items jsonb default null,
  p_reason text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_action_id uuid;
  v_target_status_id uuid;
  v_item_count integer;
  v_payload_count integer;
  v_excess record;
begin
  if p_action_code not in ('APPROVE', 'REJECT') then
    raise exception 'Unsupported review action';
  end if;

  if not public.has_permission(p_actor_id, 'supply.order.approve') then
    raise exception 'Actor is not allowed to approve or reject orders';
  end if;

  select o.*
  into v_order
  from public.orders o
  where o.id = p_order_id
    and o.is_deleted = false
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if not exists (
    select 1
    from public.order_statuses s
    where s.id = v_order.status_id
      and s.code = 'PENDING'
      and s.is_active = true
      and s.is_deleted = false
  ) then
    raise exception 'Order must be PENDING';
  end if;

  select a.id
  into v_action_id
  from public.order_revision_actions a
  where a.code = p_action_code
    and a.is_active = true
    and a.is_deleted = false;

  select s.id
  into v_target_status_id
  from public.order_statuses s
  where s.code = case p_action_code
    when 'APPROVE' then 'APPROVED'
    else 'REJECTED'
  end
    and s.is_active = true
    and s.is_deleted = false;

  if v_action_id is null or v_target_status_id is null then
    raise exception 'Required review lookup data is missing';
  end if;

  if p_action_code = 'APPROVE' then
    if p_items is null or jsonb_typeof(p_items) <> 'array' then
      raise exception 'Approval items are required';
    end if;

    select count(*)
    into v_item_count
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.is_deleted = false;

    select count(*)
    into v_payload_count
    from jsonb_array_elements(p_items);

    if v_payload_count <> v_item_count
      or (
        select count(distinct item ->> 'order_item_id')
        from jsonb_array_elements(p_items) item
      ) <> v_item_count
    then
      raise exception 'Approval must include every order item exactly once';
    end if;

    -- No upper bound against quantity_requested: approving more than asked is
    -- allowed. The ceiling is stock, checked below.
    if exists (
      select 1
      from jsonb_array_elements(p_items) item
      left join public.order_items oi
        on oi.id = (item ->> 'order_item_id')::uuid
        and oi.order_id = p_order_id
        and oi.is_deleted = false
      where oi.id is null
        or jsonb_typeof(item -> 'quantity_approved') is distinct from 'number'
        or (item ->> 'quantity_approved')::numeric < 0
        or (item ->> 'quantity_approved')::numeric
           <> trunc((item ->> 'quantity_approved')::numeric)
    ) then
      raise exception 'Invalid approved quantity or order item';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_items) item
      join public.order_items oi
        on oi.id = (item ->> 'order_item_id')::uuid
      where oi.set_per_qty is not null
        and mod((item ->> 'quantity_approved')::numeric, oi.set_per_qty) <> 0
    ) then
      raise exception using message = 'STACK_APPROVAL_NOT_COMPATIBLE';
    end if;

    -- Snapshot, not a reservation: issue revalidates. Lines of one code draw
    -- from one pooled row, so they are summed first.
    select
      demand.supply_id,
      demand.provider_id,
      demand.set_per_qty,
      demand.approved_quantity,
      coalesce(balance.quantity, 0) as available_quantity,
      supply.code as supply_code
    into v_excess
    from (
      select
        oi.supply_id,
        oi.provider_id,
        oi.set_per_qty,
        sum((item ->> 'quantity_approved')::numeric) as approved_quantity
      from jsonb_array_elements(p_items) item
      join public.order_items oi
        on oi.id = (item ->> 'order_item_id')::uuid
      group by oi.supply_id, oi.provider_id, oi.set_per_qty
    ) demand
    join public.supplies supply on supply.id = demand.supply_id
    left join public.stock_balances balance
      on balance.supply_id = demand.supply_id
     and balance.provider_id = demand.provider_id
     and balance.area_id = v_order.from_area_id
     and balance.set_per_qty is not distinct from demand.set_per_qty
     and balance.is_active = true
     and balance.is_deleted = false
    where demand.approved_quantity > coalesce(balance.quantity, 0)
    limit 1;

    if found then
      raise exception using
        message = 'ORDER_APPROVAL_EXCEEDS_STOCK',
        detail = jsonb_build_object(
          'supply_id', v_excess.supply_id,
          'supply_code', v_excess.supply_code,
          'provider_id', v_excess.provider_id,
          'set_per_qty', v_excess.set_per_qty,
          'approved_quantity', v_excess.approved_quantity,
          'available_quantity', v_excess.available_quantity
        )::text;
    end if;

    update public.order_items oi
    set quantity_approved = (item.value ->> 'quantity_approved')::numeric
    from jsonb_array_elements(p_items) item(value)
    where oi.id = (item.value ->> 'order_item_id')::uuid
      and oi.order_id = p_order_id
      and oi.is_deleted = false;

    update public.orders
    set
      status_id = v_target_status_id,
      approved_by = p_actor_id,
      approved_at = now(),
      note = coalesce(p_note, note)
    where id = p_order_id;
  else
    if nullif(btrim(p_reason), '') is null then
      raise exception 'rejected_reason is required';
    end if;

    update public.orders
    set
      status_id = v_target_status_id,
      rejected_reason = btrim(p_reason)
    where id = p_order_id;
  end if;

  insert into public.order_revisions (
    order_id,
    action_id,
    old_status_id,
    new_status_id,
    old_data,
    new_data,
    reason,
    created_by
  )
  values (
    p_order_id,
    v_action_id,
    v_order.status_id,
    v_target_status_id,
    jsonb_build_object('status_id', v_order.status_id),
    jsonb_build_object('status_id', v_target_status_id),
    case when p_action_code = 'REJECT' then btrim(p_reason) else null end,
    p_actor_id
  );

  return p_order_id;
end;
$$;

revoke all on function public.review_order(uuid, uuid, text, jsonb, text, text)
from public, anon, authenticated;
grant execute on function public.review_order(uuid, uuid, text, jsonb, text, text)
to service_role;

commit;

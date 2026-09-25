-- Standard-pack (KIEN_SAT_TC) orders: confirm once, issue what was confirmed.
--
-- Before: an Order was split across locations (allocate_stack_order), each
-- location confirmed separately, and a shortfall re-allocated to other
-- locations as new unconfirmed rows. Issue then refused until the confirmed
-- total equalled the approval, so any shortfall meant going back to review.
--
-- Now there are no locations to split across (20260924010000). Data vật tư
-- confirms one stack count per order item. That count may be below or above the
-- approval; a difference needs a reason from allocation_confirm_reasons. Issue
-- ships exactly the confirmed count and closes the item. If the books hold
-- fewer stacks than that, the item still ships, the books go to zero and a
-- recount is opened.

begin;

drop function if exists public.allocate_stack_order(uuid, uuid);
drop function if exists public.confirm_stack_allocation_actual(uuid, numeric, uuid, text);

-- ---------------------------------------------------------------------------
-- Confirm
-- ---------------------------------------------------------------------------
create or replace function public.confirm_stack_order_item(
  p_order_item_id uuid,
  p_actual_stack_quantity numeric,
  p_reason_code text,
  p_reason_note text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_item public.order_items%rowtype;
  v_balance public.stock_balances%rowtype;
  v_reason public.allocation_confirm_reasons%rowtype;
  v_status_code text;
  v_category_code text;
  v_supply_code text;
  v_approved_stack numeric;
  v_allocation_id uuid;
  v_discrepancy_id uuid;
  v_transaction_type_id uuid;
  v_correction_stack numeric := 0;
  v_note text := nullif(btrim(p_reason_note), '');
begin
  if not public.has_permission(p_actor_id, 'supply.order.confirm_allocation') then
    raise exception using
      message = 'CONFIRM_ALLOCATION_FORBIDDEN',
      detail = 'Actor does not have supply.order.confirm_allocation';
  end if;

  if p_actual_stack_quantity is null
     or p_actual_stack_quantity < 0
     or p_actual_stack_quantity <> trunc(p_actual_stack_quantity) then
    raise exception using message = 'ACTUAL_STACK_INVALID';
  end if;

  -- The Order first, as issue_order does, so the two never lock in opposite order.
  select orders.*
  into v_order
  from public.orders orders
  join public.order_items item on item.order_id = orders.id
  where item.id = p_order_item_id
    and orders.is_active = true
    and orders.is_deleted = false
  for update of orders;

  if not found then
    raise exception using message = 'ORDER_ITEM_NOT_FOUND';
  end if;

  select item.*
  into v_item
  from public.order_items item
  where item.id = p_order_item_id
    and item.is_active = true
    and item.is_deleted = false
  for update of item;

  if not found then
    raise exception using message = 'ORDER_ITEM_NOT_FOUND';
  end if;

  select status.code
  into v_status_code
  from public.order_statuses status
  where status.id = v_order.status_id
    and status.is_active = true
    and status.is_deleted = false;

  if v_status_code is distinct from 'APPROVED' then
    raise exception using
      message = 'ORDER_NOT_CONFIRMABLE',
      detail = jsonb_build_object('current_status', v_status_code)::text;
  end if;

  select category.code, supply.code
  into v_category_code, v_supply_code
  from public.supplies supply
  join public.supply_categories category on category.id = supply.category_id
  where supply.id = v_item.supply_id;

  if v_category_code is distinct from 'KIEN_SAT_TC'
     or v_item.set_per_qty is null
     or v_item.set_per_qty <= 0 then
    raise exception using message = 'ORDER_NOT_CONFIRMABLE';
  end if;

  if v_item.quantity_approved is null
     or v_item.quantity_approved <= 0
     or mod(v_item.quantity_approved, v_item.set_per_qty) <> 0 then
    raise exception using
      message = 'STACK_APPROVAL_NOT_COMPATIBLE',
      detail = jsonb_build_object(
        'order_item_id', v_item.id,
        'supply_code', v_supply_code,
        'quantity_approved', v_item.quantity_approved,
        'set_per_qty', v_item.set_per_qty
      )::text;
  end if;

  v_approved_stack := v_item.quantity_approved / v_item.set_per_qty;

  if exists (
    select 1
    from public.order_item_allocations allocation
    where allocation.order_item_id = v_item.id
      and allocation.is_deleted = false
  ) then
    raise exception using message = 'ALLOCATION_ALREADY_CONFIRMED';
  end if;

  -- A count equal to the approval needs no explanation, so any reason sent
  -- with it is ignored rather than stored against nothing.
  if p_actual_stack_quantity <> v_approved_stack then
    select reason.*
    into v_reason
    from public.allocation_confirm_reasons reason
    where reason.code = upper(btrim(coalesce(p_reason_code, '')))
      and reason.is_active = true
      and reason.is_deleted = false;

    if not found then
      raise exception using
        message = 'CONFIRM_REASON_REQUIRED',
        detail = jsonb_build_object(
          'approved_stack_quantity', v_approved_stack,
          'actual_stack_quantity', p_actual_stack_quantity
        )::text;
    end if;

    if (p_actual_stack_quantity < v_approved_stack)
       <> (v_reason.direction = 'LOWER') then
      raise exception using
        message = 'CONFIRM_REASON_DIRECTION_MISMATCH',
        detail = jsonb_build_object(
          'reason_code', v_reason.code,
          'direction', v_reason.direction,
          'approved_stack_quantity', v_approved_stack,
          'actual_stack_quantity', p_actual_stack_quantity
        )::text;
    end if;
  end if;

  -- The pooled row issue_order will deduct from. Created empty when missing so
  -- the confirmation always has a row to point at.
  insert into public.stock_balances (
    supply_id, provider_id, area_id, quantity,
    set_per_qty, stack_quantity, total_set_quantity, is_active, is_deleted
  )
  values (
    v_item.supply_id, v_item.provider_id, v_order.from_area_id, 0,
    v_item.set_per_qty, 0, 0, true, false
  )
  on conflict (supply_id, provider_id, area_id, set_per_qty)
  where set_per_qty is not null and is_deleted = false
  do nothing;

  select balance.*
  into v_balance
  from public.stock_balances balance
  where balance.supply_id = v_item.supply_id
    and balance.provider_id = v_item.provider_id
    and balance.area_id = v_order.from_area_id
    and balance.set_per_qty = v_item.set_per_qty
    and balance.is_deleted = false
  for update of balance;

  insert into public.order_item_allocations (
    order_item_id,
    stock_balance_id,
    expected_stack_quantity,
    actual_stack_quantity,
    status,
    reason_id,
    reason_note,
    allocated_at,
    confirmed_at,
    confirmed_by,
    is_active,
    is_deleted
  )
  values (
    v_item.id,
    v_balance.id,
    v_approved_stack,
    p_actual_stack_quantity,
    'CONFIRMED',
    v_reason.id,
    case when v_reason.id is null then null else v_note end,
    now(),
    now(),
    p_actor_id,
    true,
    false
  )
  returning id into v_allocation_id;

  if v_reason.corrects_stock then
    -- The books claim stacks the picker could not find. Only the part of the
    -- shortfall the books actually hold is phantom stock; if the books already
    -- hold less than was confirmed, issue_order records that gap instead, and
    -- deducting here as well would count the same missing stacks twice.
    v_correction_stack := least(
      v_approved_stack - p_actual_stack_quantity,
      greatest(v_balance.stack_quantity - p_actual_stack_quantity, 0)
    );

    insert into public.inventory_discrepancies (
      stock_balance_id,
      order_id,
      order_item_id,
      allocation_id,
      expected_stack_quantity,
      actual_stack_quantity,
      difference_stack_quantity,
      reason,
      status,
      source,
      reported_by,
      reported_at,
      is_active,
      is_deleted
    )
    values (
      v_balance.id,
      v_order.id,
      v_item.id,
      v_allocation_id,
      v_approved_stack,
      p_actual_stack_quantity,
      v_approved_stack - p_actual_stack_quantity,
      coalesce(v_note, v_reason.name),
      'OPEN',
      'CONFIRMATION',
      p_actor_id,
      now(),
      true,
      false
    )
    returning id into v_discrepancy_id;

    if v_correction_stack > 0 then
      select transaction_type.id
      into v_transaction_type_id
      from public.stock_transaction_types transaction_type
      where transaction_type.code = 'DISCREPANCY_CORRECTION'
        and transaction_type.effect = 'DECREASE'
        and transaction_type.is_active = true
        and transaction_type.is_deleted = false;

      if not found then
        raise exception using message = 'DISCREPANCY_TRANSACTION_TYPE_NOT_FOUND';
      end if;

      update public.stock_balances
      set stack_quantity = stack_quantity - v_correction_stack,
          total_set_quantity = (stack_quantity - v_correction_stack) * set_per_qty,
          quantity = (stack_quantity - v_correction_stack) * set_per_qty,
          updated_at = now()
      where id = v_balance.id;

      insert into public.stock_transactions (
        supply_id,
        provider_id,
        area_id,
        storage_location_id,
        order_id,
        order_item_id,
        inventory_discrepancy_id,
        transaction_type_id,
        quantity,
        before_quantity,
        after_quantity,
        set_per_qty,
        stack_quantity,
        before_stack_quantity,
        after_stack_quantity,
        reason,
        reason_note,
        note,
        created_by,
        is_active,
        is_deleted
      )
      values (
        v_item.supply_id,
        v_item.provider_id,
        v_balance.area_id,
        null,
        v_order.id,
        v_item.id,
        v_discrepancy_id,
        v_transaction_type_id,
        v_correction_stack * v_balance.set_per_qty,
        v_balance.quantity,
        v_balance.quantity - v_correction_stack * v_balance.set_per_qty,
        v_balance.set_per_qty,
        v_correction_stack,
        v_balance.stack_quantity,
        v_balance.stack_quantity - v_correction_stack,
        coalesce(v_note, v_reason.name),
        v_note,
        'Automatic correction: approved stacks were reported as not available',
        p_actor_id,
        true,
        false
      );
    end if;
  end if;

  return jsonb_build_object(
    'allocation_id', v_allocation_id,
    'order_item_id', v_item.id,
    'approved_stack_quantity', v_approved_stack,
    'actual_stack_quantity', p_actual_stack_quantity,
    'reason_code', v_reason.code,
    'discrepancy_id', v_discrepancy_id,
    'corrected_stack_quantity', v_correction_stack
  );
end;
$$;

revoke all on function public.confirm_stack_order_item(uuid, numeric, text, text, uuid)
from public, anon, authenticated;
grant execute on function public.confirm_stack_order_item(uuid, numeric, text, text, uuid)
to service_role;

comment on function public.confirm_stack_order_item(uuid, numeric, text, text, uuid) is
  'Confirms the stack count of one KIEN_SAT_TC order item. A count different from the approval needs a reason; NOT_AVAILABLE-type reasons correct phantom stock and open a recount.';

-- ---------------------------------------------------------------------------
-- Issue
-- ---------------------------------------------------------------------------
create or replace function public.issue_order(
  p_order_id uuid,
  p_actor_id uuid,
  p_items jsonb,
  p_forklift_by uuid default null,
  p_taken_away_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_order_item record;
  v_balance public.stock_balances%rowtype;
  v_allocation public.order_item_allocations%rowtype;
  v_current_status_code text;
  v_new_status_code text;
  v_new_status_id uuid;
  v_issue_type_id uuid;
  v_issue_action_id uuid;
  v_item_payload jsonb;
  v_payload_item_ids uuid[] := array[]::uuid[];
  v_transaction_ids uuid[] := array[]::uuid[];
  v_discrepancy_ids uuid[] := array[]::uuid[];
  v_transaction_id uuid;
  v_discrepancy_id uuid;
  v_item_id uuid;
  v_quantity numeric;
  v_take_stack numeric;
  v_shortage_stack numeric;
  v_issued_any boolean := false;
begin
  if not public.has_permission(p_actor_id, 'supply.order.issue') then
    raise exception using
      message = 'ISSUE_FORBIDDEN',
      detail = 'Actor does not have supply.order.issue';
  end if;

  if p_items is null then
    p_items := '[]'::jsonb;
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception using message = 'ISSUE_ITEMS_INVALID';
  end if;

  select orders.*
  into v_order
  from public.orders orders
  where orders.id = p_order_id
    and orders.is_active = true
    and orders.is_deleted = false
  for update of orders;

  if not found then
    raise exception using message = 'ORDER_NOT_FOUND';
  end if;

  select status.code
  into v_current_status_code
  from public.order_statuses status
  where status.id = v_order.status_id
    and status.is_active = true
    and status.is_deleted = false;

  if v_current_status_code in ('ISSUED', 'RECEIVED', 'COMPLETED') then
    raise exception using
      message = 'ORDER_ALREADY_ISSUED',
      detail = jsonb_build_object('current_status', v_current_status_code)::text;
  end if;
  if v_current_status_code not in ('APPROVED', 'PARTIAL_ISSUED') then
    raise exception using
      message = 'ORDER_NOT_ISSUABLE',
      detail = jsonb_build_object('current_status', v_current_status_code)::text;
  end if;

  select transaction_type.id
  into v_issue_type_id
  from public.stock_transaction_types transaction_type
  where transaction_type.code = 'ISSUE'
    and transaction_type.effect = 'DECREASE'
    and transaction_type.is_active = true
    and transaction_type.is_deleted = false;

  select action.id
  into v_issue_action_id
  from public.order_revision_actions action
  where action.code = 'ISSUE'
    and action.is_active = true
    and action.is_deleted = false;

  if v_issue_type_id is null or v_issue_action_id is null then
    raise exception using message = 'ISSUE_LOOKUP_NOT_FOUND';
  end if;

  perform item.id
  from public.order_items item
  where item.order_id = p_order_id
    and item.is_active = true
    and item.is_deleted = false
  order by item.id
  for update of item;

  -- Every balance this Order can touch, locked once in id order before any
  -- mutation, so two Issues sharing balances cannot deadlock. The normal side
  -- is a superset of what the payload names; it only costs a few extra locks.
  perform balance.id
  from public.stock_balances balance
  where balance.id in (
      select allocation.stock_balance_id
      from public.order_item_allocations allocation
      join public.order_items item on item.id = allocation.order_item_id
      where item.order_id = p_order_id
        and allocation.is_deleted = false
    )
    or (
      balance.set_per_qty is null
      and balance.area_id = v_order.from_area_id
      and balance.is_deleted = false
      and exists (
        select 1
        from public.order_items item
        where item.order_id = p_order_id
          and item.is_active = true
          and item.is_deleted = false
          and item.set_per_qty is null
          and item.supply_id = balance.supply_id
          and item.provider_id = balance.provider_id
      )
    )
  order by balance.id
  for update of balance;

  -- -------------------------------------------------------------------------
  -- Kiện tiêu chuẩn: every confirmed item leaves in full, now.
  -- -------------------------------------------------------------------------
  for v_order_item in
    select
      item.*,
      supply.code as supply_code,
      provider.code as provider_code,
      supply.is_active and not supply.is_deleted as supply_is_valid,
      category.is_active and not category.is_deleted as category_is_valid,
      provider.is_active and not provider.is_deleted as provider_is_valid,
      supply_provider.is_active and not supply_provider.is_deleted
        as supply_provider_is_valid
    from public.order_items item
    join public.supplies supply on supply.id = item.supply_id
    join public.supply_categories category on category.id = supply.category_id
    join public.providers provider on provider.id = item.provider_id
    join public.supply_providers supply_provider
      on supply_provider.supply_id = item.supply_id
     and supply_provider.provider_id = item.provider_id
    where item.order_id = p_order_id
      and item.is_active = true
      and item.is_deleted = false
      and category.code = 'KIEN_SAT_TC'
    order by item.id
  loop
    -- Approved at zero means rejected at review: nothing to ship.
    if coalesce(v_order_item.quantity_approved, 0) = 0 then
      continue;
    end if;

    if not v_order_item.supply_is_valid
       or not v_order_item.category_is_valid
       or not v_order_item.provider_is_valid
       or not v_order_item.supply_provider_is_valid then
      raise exception using
        message = 'ORDER_NOT_ISSUABLE',
        detail = jsonb_build_object(
          'order_item_id', v_order_item.id,
          'reason', 'INACTIVE_ORDER_ITEM_REFERENCE'
        )::text;
    end if;

    select allocation.*
    into v_allocation
    from public.order_item_allocations allocation
    where allocation.order_item_id = v_order_item.id
      and allocation.is_active = true
      and allocation.is_deleted = false
    for update of allocation;

    if not found or v_allocation.confirmed_at is null then
      raise exception using
        message = 'STACK_ALLOCATIONS_NOT_CONFIRMED',
        detail = jsonb_build_object(
          'order_item_id', v_order_item.id,
          'supply_code', v_order_item.supply_code
        )::text;
    end if;

    if v_allocation.status = 'ISSUED' then
      continue;
    end if;

    select balance.*
    into v_balance
    from public.stock_balances balance
    where balance.id = v_allocation.stock_balance_id;

    v_take_stack := least(
      v_allocation.actual_stack_quantity,
      greatest(coalesce(v_balance.stack_quantity, 0), 0)
    );
    v_shortage_stack := v_allocation.actual_stack_quantity - v_take_stack;

    if v_take_stack > 0 then
      update public.stock_balances
      set stack_quantity = stack_quantity - v_take_stack,
          total_set_quantity = (stack_quantity - v_take_stack) * set_per_qty,
          quantity = (stack_quantity - v_take_stack) * set_per_qty,
          updated_at = now()
      where id = v_balance.id;

      insert into public.stock_transactions (
        supply_id, provider_id, area_id, storage_location_id,
        order_id, order_item_id, transaction_type_id,
        quantity, before_quantity, after_quantity,
        set_per_qty, stack_quantity, before_stack_quantity, after_stack_quantity,
        created_by, is_active, is_deleted
      )
      values (
        v_balance.supply_id, v_balance.provider_id, v_balance.area_id, null,
        p_order_id, v_order_item.id, v_issue_type_id,
        v_take_stack * v_balance.set_per_qty,
        v_balance.quantity,
        v_balance.quantity - v_take_stack * v_balance.set_per_qty,
        v_balance.set_per_qty, v_take_stack,
        v_balance.stack_quantity, v_balance.stack_quantity - v_take_stack,
        p_actor_id, true, false
      )
      returning id into v_transaction_id;

      v_transaction_ids := array_append(v_transaction_ids, v_transaction_id);
    end if;

    -- The stacks physically left, so the item ships in full. What the books
    -- could not cover is a recount, not a reason to hold the goods back.
    if v_shortage_stack > 0 then
      insert into public.inventory_discrepancies (
        stock_balance_id, order_id, order_item_id, allocation_id,
        expected_stack_quantity, actual_stack_quantity, difference_stack_quantity,
        reason, status, source, reported_by, reported_at, is_active, is_deleted
      )
      values (
        v_balance.id, p_order_id, v_order_item.id, v_allocation.id,
        v_allocation.actual_stack_quantity, v_take_stack, v_shortage_stack,
        'Đã cấp theo số chồng xác nhận nhưng tồn sổ không đủ',
        'OPEN', 'ISSUE', p_actor_id, now(), true, false
      )
      returning id into v_discrepancy_id;

      v_discrepancy_ids := array_append(v_discrepancy_ids, v_discrepancy_id);
    end if;

    update public.order_items
    set quantity_issued = v_allocation.actual_stack_quantity * v_order_item.set_per_qty,
        updated_at = now()
    where id = v_order_item.id;

    update public.order_item_allocations
    set status = 'ISSUED',
        issued_at = now(),
        updated_at = now()
    where id = v_allocation.id;

    v_issued_any := true;
  end loop;

  -- -------------------------------------------------------------------------
  -- Normal supplies: client-directed quantity, one pooled balance per item.
  -- -------------------------------------------------------------------------
  for v_item_payload in
    select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item_payload) <> 'object'
       or nullif(v_item_payload ->> 'order_item_id', '') is null
       or jsonb_typeof(v_item_payload -> 'quantity') is distinct from 'number' then
      raise exception using message = 'ISSUE_ITEMS_INVALID';
    end if;

    v_item_id := (v_item_payload ->> 'order_item_id')::uuid;
    if v_item_id = any(v_payload_item_ids) then
      raise exception using message = 'ISSUE_ITEMS_INVALID', detail = 'Duplicate order_item_id';
    end if;
    v_payload_item_ids := array_append(v_payload_item_ids, v_item_id);

    v_quantity := (v_item_payload ->> 'quantity')::numeric;
    if v_quantity <= 0 or v_quantity <> trunc(v_quantity) then
      raise exception using message = 'ISSUE_ITEMS_INVALID';
    end if;

    select
      item.*,
      supply.code as supply_code,
      category.code as category_code,
      provider.code as provider_code,
      supply.is_active and not supply.is_deleted as supply_is_valid,
      category.is_active and not category.is_deleted as category_is_valid,
      provider.is_active and not provider.is_deleted as provider_is_valid,
      supply_provider.is_active and not supply_provider.is_deleted
        as supply_provider_is_valid
    into v_order_item
    from public.order_items item
    join public.supplies supply on supply.id = item.supply_id
    join public.supply_categories category on category.id = supply.category_id
    join public.providers provider on provider.id = item.provider_id
    join public.supply_providers supply_provider
      on supply_provider.supply_id = item.supply_id
     and supply_provider.provider_id = item.provider_id
    where item.id = v_item_id
      and item.order_id = p_order_id
      and item.is_active = true
      and item.is_deleted = false;

    if not found then
      raise exception using message = 'ORDER_ITEM_NOT_FOUND';
    end if;
    if not v_order_item.supply_is_valid
       or not v_order_item.category_is_valid
       or not v_order_item.provider_is_valid
       or not v_order_item.supply_provider_is_valid then
      raise exception using
        message = 'ORDER_NOT_ISSUABLE',
        detail = jsonb_build_object(
          'order_item_id', v_order_item.id,
          'reason', 'INACTIVE_ORDER_ITEM_REFERENCE'
        )::text;
    end if;
    -- Stack quantities come from the confirmation, never from the payload.
    if v_order_item.category_code = 'KIEN_SAT_TC' then
      raise exception using
        message = 'ISSUE_ITEMS_INVALID',
        detail = jsonb_build_object(
          'order_item_id', v_order_item.id,
          'reason', 'STACK_ITEM_IN_PAYLOAD'
        )::text;
    end if;
    if v_order_item.quantity_approved is null
       or v_order_item.quantity_approved <= 0 then
      raise exception using message = 'ORDER_NOT_ISSUABLE';
    end if;
    if coalesce(v_order_item.quantity_issued, 0) + v_quantity
       > v_order_item.quantity_approved then
      raise exception using
        message = 'ORDER_ISSUE_EXCEEDS_APPROVED',
        detail = jsonb_build_object(
          'order_item_id', v_order_item.id,
          'quantity_approved', v_order_item.quantity_approved,
          'quantity_issued', v_order_item.quantity_issued,
          'requested_issue_quantity', v_quantity
        )::text;
    end if;

    select balance.*
    into v_balance
    from public.stock_balances balance
    where balance.supply_id = v_order_item.supply_id
      and balance.provider_id = v_order_item.provider_id
      and balance.area_id = v_order.from_area_id
      and balance.set_per_qty is null
      and balance.is_active = true
      and balance.is_deleted = false;

    if not found or v_balance.quantity < v_quantity then
      raise exception using
        message = 'NORMAL_ISSUE_STOCK_CONFLICT',
        detail = jsonb_build_object(
          'order_item_id', v_order_item.id,
          'supply_code', v_order_item.supply_code,
          'provider_code', v_order_item.provider_code,
          'required_quantity', v_quantity,
          'current_quantity', coalesce(v_balance.quantity, 0),
          'shortage_quantity', greatest(v_quantity - coalesce(v_balance.quantity, 0), 0)
        )::text;
    end if;

    update public.stock_balances
    set quantity = quantity - v_quantity,
        updated_at = now()
    where id = v_balance.id;

    insert into public.stock_transactions (
      supply_id, provider_id, area_id, storage_location_id,
      order_id, order_item_id, transaction_type_id,
      quantity, before_quantity, after_quantity,
      created_by, is_active, is_deleted
    )
    values (
      v_balance.supply_id, v_balance.provider_id, v_balance.area_id, null,
      p_order_id, v_order_item.id, v_issue_type_id,
      v_quantity, v_balance.quantity, v_balance.quantity - v_quantity,
      p_actor_id, true, false
    )
    returning id into v_transaction_id;

    v_transaction_ids := array_append(v_transaction_ids, v_transaction_id);

    update public.order_items
    set quantity_issued = coalesce(quantity_issued, 0) + v_quantity,
        updated_at = now()
    where id = v_order_item.id;

    v_issued_any := true;
  end loop;

  if not v_issued_any then
    raise exception using message = 'ISSUE_ITEMS_INVALID';
  end if;

  -- A stack item is done once its confirmation has been issued, whatever the
  -- count; a normal item is done when it reaches its approval.
  if exists (
    select 1
    from public.order_items item
    left join public.order_item_allocations allocation
      on allocation.order_item_id = item.id
     and allocation.is_deleted = false
    where item.order_id = p_order_id
      and item.is_active = true
      and item.is_deleted = false
      and (
        item.quantity_approved is null
        or (
          item.set_per_qty is not null
          and item.quantity_approved > 0
          and allocation.status is distinct from 'ISSUED'
        )
        or (
          item.set_per_qty is null
          and coalesce(item.quantity_issued, 0) < item.quantity_approved
        )
      )
  ) then
    v_new_status_code := 'PARTIAL_ISSUED';
  else
    v_new_status_code := 'ISSUED';
  end if;

  select status.id
  into v_new_status_id
  from public.order_statuses status
  where status.code = v_new_status_code
    and status.is_active = true
    and status.is_deleted = false;

  if v_new_status_id is null then
    raise exception using message = 'ISSUE_LOOKUP_NOT_FOUND';
  end if;

  update public.orders
  set status_id = v_new_status_id,
      forklift_by = coalesce(p_forklift_by, forklift_by),
      taken_away_by = coalesce(p_taken_away_by, taken_away_by),
      issued_at = case
        when v_new_status_code = 'ISSUED' then now()
        else issued_at
      end,
      updated_at = now()
  where id = p_order_id;

  insert into public.order_revisions (
    order_id, action_id, old_status_id, new_status_id, old_data, new_data, created_by
  )
  values (
    p_order_id,
    v_issue_action_id,
    v_order.status_id,
    v_new_status_id,
    jsonb_build_object('status_id', v_order.status_id),
    jsonb_build_object(
      'status_id', v_new_status_id,
      'transaction_ids', to_jsonb(v_transaction_ids),
      'discrepancy_ids', to_jsonb(v_discrepancy_ids),
      'stack_issue_source', 'CONFIRMED_STACK_COUNT'
    ),
    p_actor_id
  );

  return jsonb_build_object(
    'order_id', p_order_id,
    'status', v_new_status_code,
    'transaction_ids', to_jsonb(v_transaction_ids),
    'discrepancy_ids', to_jsonb(v_discrepancy_ids)
  );
end;
$$;

revoke all on function public.issue_order(uuid, uuid, jsonb, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.issue_order(uuid, uuid, jsonb, uuid, uuid)
to service_role;

comment on function public.issue_order(uuid, uuid, jsonb, uuid, uuid) is
  'Authoritative atomic Order Issue. KIEN_SAT_TC ships the confirmed stack count and records a recount when the books fall short; normal supplies take a client quantity from the pooled balance.';

commit;

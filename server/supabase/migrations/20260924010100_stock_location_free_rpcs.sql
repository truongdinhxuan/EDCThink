-- Stock RPCs rewritten for location-free stock rows.
--
-- The previous migration dropped stock_balances.storage_location_id. Every
-- function below joined through that column to decide whether a row counted;
-- with one pooled row per code there is nothing left to join, and the only
-- behaviour change is that a location being deactivated no longer hides stock.

begin;

-- ---------------------------------------------------------------------------
-- Read paths used while creating an Order
-- ---------------------------------------------------------------------------

create or replace function public.get_supply_stack_options(
  p_supply_id uuid,
  p_provider_id uuid,
  p_area_id uuid
)
returns table (
  set_per_qty numeric,
  available_stack_quantity numeric,
  available_total_set_quantity numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category_code text;
begin
  select sc.code
  into v_category_code
  from public.supplies s
  join public.supply_categories sc on sc.id = s.category_id
  where s.id = p_supply_id
    and s.is_active = true
    and s.is_deleted = false
    and sc.is_active = true
    and sc.is_deleted = false;

  if not found then
    raise exception 'Supply not found or inactive';
  end if;

  if v_category_code <> 'KIEN_SAT_TC' then
    raise exception 'Stack options are only available for KIEN_SAT_TC';
  end if;

  if not exists (
    select 1
    from public.supply_providers sp
    join public.providers p on p.id = sp.provider_id
    where sp.supply_id = p_supply_id
      and sp.provider_id = p_provider_id
      and sp.is_active = true
      and sp.is_deleted = false
      and p.is_active = true
      and p.is_deleted = false
  ) then
    raise exception 'Provider is inactive or is not linked to Supply';
  end if;

  if not exists (
    select 1
    from public.areas a
    where a.id = p_area_id
      and a.is_active = true
      and a.is_deleted = false
  ) then
    raise exception 'Area not found or inactive';
  end if;

  return query
  select
    sb.set_per_qty,
    sb.stack_quantity as available_stack_quantity,
    sb.stack_quantity * sb.set_per_qty as available_total_set_quantity
  from public.stock_balances sb
  where sb.supply_id = p_supply_id
    and sb.provider_id = p_provider_id
    and sb.area_id = p_area_id
    and sb.is_active = true
    and sb.is_deleted = false
    and sb.set_per_qty is not null
    and sb.stack_quantity > 0
  order by sb.set_per_qty desc;
end;
$$;

create or replace function public.normalize_order_item_request(
  p_item jsonb,
  p_from_area_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supply_id uuid;
  v_provider_id uuid;
  v_unit_id uuid;
  v_supply_unit_id uuid;
  v_category_code text;
  v_quantity numeric;
  v_set_per_qty numeric;
  v_requested_stack_quantity numeric;
  v_requested_total_set_quantity numeric;
  v_calculated_total numeric;
begin
  if jsonb_typeof(p_item) <> 'object'
     or nullif(p_item ->> 'supply_id', '') is null
     or nullif(p_item ->> 'provider_id', '') is null then
    raise exception 'supply_id and provider_id are required for every OrderItem';
  end if;

  v_supply_id := (p_item ->> 'supply_id')::uuid;
  v_provider_id := (p_item ->> 'provider_id')::uuid;
  v_unit_id := nullif(p_item ->> 'unit_id', '')::uuid;

  select s.unit_id, sc.code
  into v_supply_unit_id, v_category_code
  from public.supplies s
  join public.supply_categories sc on sc.id = s.category_id
  where s.id = v_supply_id
    and s.is_active = true
    and s.is_deleted = false
    and sc.is_active = true
    and sc.is_deleted = false;

  if not found then
    raise exception 'Supply not found or inactive';
  end if;

  if v_unit_id is null then
    v_unit_id := v_supply_unit_id;
  end if;

  if v_unit_id <> v_supply_unit_id or not exists (
    select 1
    from public.units u
    where u.id = v_unit_id
      and u.is_active = true
      and u.is_deleted = false
  ) then
    raise exception 'Unit is inactive or does not belong to Supply';
  end if;

  if not exists (
    select 1
    from public.supply_providers sp
    join public.providers p on p.id = sp.provider_id
    where sp.supply_id = v_supply_id
      and sp.provider_id = v_provider_id
      and sp.is_active = true
      and sp.is_deleted = false
      and p.is_active = true
      and p.is_deleted = false
  ) then
    raise exception 'Provider is inactive or is not linked to Supply';
  end if;

  if v_category_code = 'KIEN_SAT_TC' then
    v_set_per_qty := nullif(p_item ->> 'set_per_qty', '')::numeric;
    v_requested_stack_quantity :=
      nullif(p_item ->> 'requested_stack_quantity', '')::numeric;

    if v_set_per_qty is null or v_set_per_qty <= 0 then
      raise exception 'set_per_qty must be greater than 0 for KIEN_SAT_TC';
    end if;
    if v_requested_stack_quantity is null or v_requested_stack_quantity <= 0 then
      raise exception 'requested_stack_quantity must be greater than 0 for KIEN_SAT_TC';
    end if;

    v_calculated_total := v_set_per_qty * v_requested_stack_quantity;
    v_quantity := nullif(p_item ->> 'quantity_requested', '')::numeric;
    v_requested_total_set_quantity :=
      nullif(p_item ->> 'requested_total_set_quantity', '')::numeric;

    if v_quantity is not null and v_quantity <> v_calculated_total then
      raise exception 'quantity_requested mismatch: expected %', v_calculated_total;
    end if;
    if v_requested_total_set_quantity is not null
       and v_requested_total_set_quantity <> v_calculated_total then
      raise exception 'requested_total_set_quantity mismatch: expected %', v_calculated_total;
    end if;

    if not exists (
      select 1
      from public.stock_balances sb
      where sb.supply_id = v_supply_id
        and sb.provider_id = v_provider_id
        and sb.area_id = p_from_area_id
        and sb.set_per_qty = v_set_per_qty
        and sb.stack_quantity > 0
        and sb.is_active = true
        and sb.is_deleted = false
    ) then
      raise exception 'Selected set_per_qty is not available for Supply, Provider and source Area';
    end if;

    v_quantity := v_calculated_total;
    v_requested_total_set_quantity := v_calculated_total;
  else
    if (p_item ? 'set_per_qty' and p_item -> 'set_per_qty' <> 'null'::jsonb)
       or (p_item ? 'requested_stack_quantity'
           and p_item -> 'requested_stack_quantity' <> 'null'::jsonb)
       or (p_item ? 'requested_total_set_quantity'
           and p_item -> 'requested_total_set_quantity' <> 'null'::jsonb) then
      raise exception 'Stack fields are only allowed for KIEN_SAT_TC';
    end if;

    v_quantity := nullif(p_item ->> 'quantity_requested', '')::numeric;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'quantity_requested must be greater than 0';
    end if;
    v_set_per_qty := null;
    v_requested_stack_quantity := null;
    v_requested_total_set_quantity := null;
  end if;

  return jsonb_build_object(
    'supply_id', v_supply_id,
    'provider_id', v_provider_id,
    'unit_id', v_unit_id,
    'quantity_requested', v_quantity,
    'set_per_qty', v_set_per_qty,
    'requested_stack_quantity', v_requested_stack_quantity,
    'requested_total_set_quantity', v_requested_total_set_quantity,
    'note', nullif(btrim(p_item ->> 'note'), '')
  );
end;
$$;

create or replace function public.create_pending_order_with_items(
  p_code text,
  p_from_area_id uuid,
  p_to_area_id uuid,
  p_requested_by uuid,
  p_note text,
  p_items jsonb,
  p_shift_order_sheet_id uuid default null,
  p_submitted_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_pending_status_id uuid;
  v_requester public.users%rowtype;
  v_leader_id uuid;
  v_shift record;
  v_sheet public.supply_shift_order_sheets%rowtype;
  v_input record;
  v_item jsonb;
  v_normalized_items jsonb := '[]'::jsonb;
  v_supply_code text;
  v_provider_code text;
  v_category_code text;
  v_available numeric;
  v_inventory_mode text;
begin
  if p_submitted_at is null then
    raise exception using message = 'ORDER_SUBMITTED_AT_INVALID';
  end if;

  if not public.has_permission(p_requested_by, 'supply.order.create') then
    raise exception using message = 'ORDER_CREATE_FORBIDDEN';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception using message = 'ORDER_ITEMS_REQUIRED';
  end if;

  select requester.*
  into v_requester
  from public.users requester
  join public.areas area_row
    on area_row.id = requester.area_id
   and area_row.is_active = true
   and area_row.is_deleted = false
  where requester.id = p_requested_by
    and requester.is_active = true
    and requester.is_verified = true
    and requester.is_deleted = false;

  if not found or v_requester.area_id is distinct from p_to_area_id then
    raise exception using message = 'ORDER_REQUESTER_CONTEXT_INVALID';
  end if;

  if not exists (
    select 1
    from public.areas source_area
    where source_area.id = p_from_area_id
      and source_area.code = 'VTDG'
      and source_area.is_active = true
      and source_area.is_deleted = false
  ) then
    raise exception using message = 'ORDER_SOURCE_AREA_INVALID';
  end if;

  v_leader_id := v_requester.managed_by_user_id;
  if v_leader_id is null and exists (
    select 1
    from public.users member
    where member.managed_by_user_id = v_requester.id
      and member.is_active = true
      and member.is_deleted = false
  ) then
    v_leader_id := v_requester.id;
  end if;

  if v_leader_id is null or not exists (
    select 1
    from public.users leader
    where leader.id = v_leader_id
      and leader.is_active = true
      and leader.is_verified = true
      and leader.is_deleted = false
  ) then
    raise exception using message = 'ORDER_SHIFT_LEADER_NOT_FOUND';
  end if;

  select *
  into v_shift
  from public.resolve_user_work_shift_instance(p_requested_by, p_submitted_at);

  if not found then
    raise exception using message = 'WORK_SHIFT_ASSIGNMENT_NOT_FOUND';
  end if;

  -- Orders may only be raised inside the nominal window of the resolved shift
  -- instance. resolve_user_work_shift_instance computes is_overtime entirely in
  -- Asia/Ho_Chi_Minh and already accounts for shifts crossing midnight, so this
  -- is the single authoritative gate. It sits before every write and cannot be
  -- bypassed by calling the API directly or by omitting p_shift_order_sheet_id.
  if v_shift.is_overtime then
    raise exception using message = 'ORDER_OUTSIDE_WORK_SHIFT_WINDOW';
  end if;

  select status_row.id
  into v_pending_status_id
  from public.order_statuses status_row
  where status_row.code = 'PENDING'
    and status_row.is_active = true
    and status_row.is_deleted = false;

  if v_pending_status_id is null then
    raise exception using message = 'ORDER_STATUS_NOT_FOUND';
  end if;

  -- Normalize and validate every item before inserting the Order. The stock
  -- check intentionally requires only positive availability; Issue revalidates
  -- the full approved quantity later and no reservation is created here.
  for v_input in
    select input.value, input.ordinality::integer as item_index
    from jsonb_array_elements(p_items) with ordinality as input(value, ordinality)
  loop
    v_item := public.normalize_order_item_request(v_input.value, p_from_area_id);

    select supply.code, provider.code, category.code
    into v_supply_code, v_provider_code, v_category_code
    from public.supplies supply
    join public.supply_categories category
      on category.id = supply.category_id
     and category.is_active = true
     and category.is_deleted = false
    join public.providers provider
      on provider.id = (v_item ->> 'provider_id')::uuid
     and provider.is_active = true
     and provider.is_deleted = false
    where supply.id = (v_item ->> 'supply_id')::uuid
      and supply.is_active = true
      and supply.is_deleted = false;

    if not found then
      raise exception using message = 'ORDER_ITEM_REFERENCE_INVALID';
    end if;

    if v_category_code = 'KIEN_SAT_TC' then
      v_inventory_mode := 'STACK';
      select coalesce(sum(balance.stack_quantity), 0)
      into v_available
      from public.stock_balances balance
      where balance.supply_id = (v_item ->> 'supply_id')::uuid
        and balance.provider_id = (v_item ->> 'provider_id')::uuid
        and balance.area_id = p_from_area_id
        and balance.set_per_qty = (v_item ->> 'set_per_qty')::numeric
        and balance.is_active = true
        and balance.is_deleted = false;
    else
      v_inventory_mode := 'NORMAL';
      select coalesce(sum(balance.quantity), 0)
      into v_available
      from public.stock_balances balance
      where balance.supply_id = (v_item ->> 'supply_id')::uuid
        and balance.provider_id = (v_item ->> 'provider_id')::uuid
        and balance.area_id = p_from_area_id
        and balance.set_per_qty is null
        and balance.is_active = true
        and balance.is_deleted = false;
    end if;

    if coalesce(v_available, 0) <= 0 then
      raise exception using
        message = 'ORDER_ITEM_ZERO_STOCK',
        detail = jsonb_build_object(
          'order_item_index', v_input.item_index - 1,
          'supply_code', v_supply_code,
          'provider_code', v_provider_code,
          'set_per_qty', nullif(v_item ->> 'set_per_qty', '')::numeric,
          'available_quantity', coalesce(v_available, 0),
          'inventory_mode', v_inventory_mode
        )::text;
    end if;

    v_normalized_items := v_normalized_items || jsonb_build_array(v_item);
  end loop;

  if p_shift_order_sheet_id is not null then
    select sheet.*
    into v_sheet
    from public.supply_shift_order_sheets sheet
    where sheet.id = p_shift_order_sheet_id
      and sheet.is_active = true
      and sheet.is_deleted = false
    for update of sheet;

    if not found
       or v_sheet.area_id <> p_to_area_id
       or v_sheet.work_shift_id <> v_shift.work_shift_id
       or v_sheet.work_date <> v_shift.work_date then
      raise exception using message = 'ORDER_SHIFT_SHEET_CONTEXT_INVALID';
    end if;
  else
    insert into public.supply_shift_order_sheets (
      area_id, work_shift_id, work_date, leader_id, is_active, is_deleted
    ) values (
      p_to_area_id, v_shift.work_shift_id, v_shift.work_date,
      v_leader_id, true, false
    )
    on conflict (area_id, work_shift_id, work_date)
      where is_deleted = false
    do nothing
    returning * into v_sheet;

    if v_sheet.id is null then
      select sheet.*
      into v_sheet
      from public.supply_shift_order_sheets sheet
      where sheet.area_id = p_to_area_id
        and sheet.work_shift_id = v_shift.work_shift_id
        and sheet.work_date = v_shift.work_date
        and sheet.is_deleted = false
      for update of sheet;
    end if;

    if v_sheet.id is null or not v_sheet.is_active then
      raise exception using message = 'SHIFT_ORDER_SHEET_NOT_AVAILABLE';
    end if;
  end if;

  insert into public.orders (
    code, from_area_id, to_area_id, requested_by, status_id, note,
    submitted_at, shift_order_sheet_id, is_active, is_deleted
  ) values (
    p_code, p_from_area_id, p_to_area_id, p_requested_by,
    v_pending_status_id, nullif(btrim(p_note), ''), p_submitted_at,
    v_sheet.id, true, false
  )
  returning id into v_order_id;

  for v_item in
    select value from jsonb_array_elements(v_normalized_items)
  loop
    insert into public.order_items (
      order_id, supply_id, provider_id, unit_id,
      quantity_requested, set_per_qty, requested_stack_quantity,
      requested_total_set_quantity, quantity_approved, quantity_issued,
      note, is_active, is_deleted
    ) values (
      v_order_id,
      (v_item ->> 'supply_id')::uuid,
      (v_item ->> 'provider_id')::uuid,
      (v_item ->> 'unit_id')::uuid,
      (v_item ->> 'quantity_requested')::numeric,
      nullif(v_item ->> 'set_per_qty', '')::numeric,
      nullif(v_item ->> 'requested_stack_quantity', '')::numeric,
      nullif(v_item ->> 'requested_total_set_quantity', '')::numeric,
      null,
      0,
      nullif(btrim(v_item ->> 'note'), ''),
      true,
      false
    );
  end loop;

  return v_order_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Manual adjustments
-- ---------------------------------------------------------------------------
-- Every earlier version takes a storage location and upserts on a key that no
-- longer exists. The server calls only v4; all of them go so nothing can write
-- a row in the old shape. (v1 was already dropped in 202607290001.)
drop function if exists public.apply_stock_adjustment_v2(
  uuid, uuid, uuid, uuid, numeric, uuid, text, text, uuid
);
drop function if exists public.apply_stock_adjustment_v3(
  uuid, uuid, uuid, uuid, uuid, numeric, uuid, text, text, uuid
);
drop function if exists public.apply_stock_adjustment_v4(
  uuid, uuid, uuid, uuid, uuid, numeric, numeric, numeric, uuid, text, text, uuid
);

-- Adds labels only; removing one is replace_stock_balance_locations' job, so an
-- IMPORT that names one shelf cannot silently forget the others.
create or replace function public.attach_stock_balance_locations(
  p_stock_balance_id uuid,
  p_area_id uuid,
  p_location_ids uuid[],
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(cardinality(p_location_ids), 0) = 0 then
    return;
  end if;

  if exists (
    select 1
    from unnest(p_location_ids) requested(id)
    where not exists (
      select 1
      from public.storage_locations location
      where location.id = requested.id
        and location.area_id = p_area_id
        and location.is_active = true
        and location.is_deleted = false
    )
  ) then
    raise exception 'StorageLocation not in Area';
  end if;

  insert into public.stock_balance_locations (
    stock_balance_id, storage_location_id, area_id, created_by
  )
  select distinct p_stock_balance_id, requested.id, p_area_id, p_actor_id
  from unnest(p_location_ids) requested(id)
  on conflict (stock_balance_id, storage_location_id) do nothing;
end;
$$;

revoke all on function public.attach_stock_balance_locations(uuid, uuid, uuid[], uuid)
from public, anon, authenticated;
grant execute on function public.attach_stock_balance_locations(uuid, uuid, uuid[], uuid)
to service_role;

create or replace function public.apply_stock_adjustment_v5(
  p_supply_id uuid,
  p_provider_id uuid,
  p_area_id uuid,
  p_transaction_type_id uuid,
  p_quantity numeric,
  p_stack_quantity numeric,
  p_set_per_qty numeric,
  p_adjustment_reason_id uuid,
  p_reason_note text,
  p_note text,
  p_created_by uuid,
  p_location_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.stock_transaction_types%rowtype;
  v_reason public.adjustment_reasons%rowtype;
  v_balance public.stock_balances%rowtype;
  v_transaction public.stock_transactions%rowtype;
  v_category_code text;
  v_is_stack_supply boolean;
  v_delta_quantity numeric;
  v_before_quantity numeric;
  v_after_quantity numeric;
  v_before_stack_quantity numeric;
  v_after_stack_quantity numeric;
begin
  if not public.has_permission(p_created_by, 'supply.stock.adjust') then
    raise exception 'Actor does not have supply.stock.adjust';
  end if;

  select stt.*
  into v_type
  from public.stock_transaction_types stt
  where stt.id = p_transaction_type_id
    and stt.code in ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'IMPORT', 'EXPORT')
    and stt.is_active = true
    and stt.is_deleted = false;

  if not found then
    raise exception 'Transaction type invalid';
  end if;

  select sc.code
  into v_category_code
  from public.supplies s
  join public.supply_categories sc on sc.id = s.category_id
  where s.id = p_supply_id
    and s.is_active = true
    and s.is_deleted = false
    and sc.is_active = true
    and sc.is_deleted = false;

  if not found then
    raise exception 'Supply not found';
  end if;

  v_is_stack_supply := v_category_code = 'KIEN_SAT_TC';

  if v_is_stack_supply then
    if v_type.code <> 'IMPORT' then
      raise exception 'Stack operation not supported for this transaction type';
    end if;
    if v_type.effect <> 'INCREASE' then
      raise exception 'Transaction type invalid for Stack IMPORT';
    end if;
    if p_stack_quantity is null or p_stack_quantity <= 0 then
      raise exception 'Invalid stack_quantity';
    end if;
    if p_set_per_qty is null or p_set_per_qty <= 0 then
      raise exception 'Invalid set_per_qty';
    end if;

    v_delta_quantity := p_stack_quantity * p_set_per_qty;
    if p_quantity is not null and p_quantity <> v_delta_quantity then
      raise exception 'Quantity mismatch: expected %', v_delta_quantity;
    end if;
  else
    if p_stack_quantity is not null or p_set_per_qty is not null then
      raise exception 'Stack fields are only supported for KIEN_SAT_TC IMPORT';
    end if;
    if p_quantity is null or p_quantity <= 0 then
      raise exception 'quantity must be greater than 0';
    end if;
    v_delta_quantity := p_quantity;
  end if;

  if p_provider_id is null or not exists (
    select 1
    from public.supply_providers sp
    join public.providers p on p.id = sp.provider_id
    where sp.supply_id = p_supply_id
      and sp.provider_id = p_provider_id
      and sp.is_active = true
      and sp.is_deleted = false
      and p.is_active = true
      and p.is_deleted = false
  ) then
    raise exception 'Provider not valid for Supply';
  end if;

  if not exists (
    select 1
    from public.areas a
    where a.id = p_area_id
      and a.is_active = true
      and a.is_deleted = false
  ) then
    raise exception 'Area not found or inactive';
  end if;

  if p_adjustment_reason_id is not null then
    select ar.*
    into v_reason
    from public.adjustment_reasons ar
    where ar.id = p_adjustment_reason_id
      and ar.is_active = true
      and ar.is_deleted = false;

    if not found then
      raise exception 'adjustment_reason_id does not exist or is inactive';
    end if;

    if v_reason.requires_note and nullif(btrim(p_reason_note), '') is null then
      raise exception 'reason_note is required for this reason';
    end if;
  elsif nullif(btrim(p_reason_note), '') is null then
    raise exception 'adjustment_reason_id or reason_note is required';
  end if;

  if v_is_stack_supply then
    -- Concurrent inserts of the same stack dimension serialize on the partial
    -- unique index. The subsequent SELECT locks the authoritative row.
    insert into public.stock_balances (
      supply_id, provider_id, area_id, quantity,
      set_per_qty, stack_quantity, total_set_quantity, is_active, is_deleted
    )
    values (
      p_supply_id, p_provider_id, p_area_id, 0,
      p_set_per_qty, 0, 0, true, false
    )
    on conflict (supply_id, provider_id, area_id, set_per_qty)
    where set_per_qty is not null and is_deleted = false
    do nothing;

    select sb.*
    into v_balance
    from public.stock_balances sb
    where sb.supply_id = p_supply_id
      and sb.provider_id = p_provider_id
      and sb.area_id = p_area_id
      and sb.set_per_qty = p_set_per_qty
      and sb.is_deleted = false
    for update;

    if not found then
      raise exception 'Stack balance not found after upsert';
    end if;

    v_before_stack_quantity := v_balance.stack_quantity;
    v_after_stack_quantity := v_before_stack_quantity + p_stack_quantity;
    v_before_quantity := v_balance.quantity;
    v_after_quantity := v_after_stack_quantity * p_set_per_qty;

    update public.stock_balances
    set stack_quantity = v_after_stack_quantity,
        total_set_quantity = v_after_quantity,
        quantity = v_after_quantity,
        is_active = true,
        updated_at = now()
    where id = v_balance.id
    returning * into v_balance;
  else
    if v_type.effect = 'INCREASE' then
      insert into public.stock_balances (
        supply_id, provider_id, area_id, quantity, is_active, is_deleted
      )
      values (p_supply_id, p_provider_id, p_area_id, 0, true, false)
      on conflict (supply_id, provider_id, area_id)
      where set_per_qty is null and is_deleted = false
      do update set is_active = true, is_deleted = false;
    end if;

    select sb.*
    into v_balance
    from public.stock_balances sb
    where sb.supply_id = p_supply_id
      and sb.provider_id = p_provider_id
      and sb.area_id = p_area_id
      and sb.set_per_qty is null
      and sb.is_deleted = false
    for update;

    if not found then
      raise exception 'Stock balance not found';
    end if;

    v_before_quantity := v_balance.quantity;
    if v_type.effect = 'INCREASE' then
      v_after_quantity := v_before_quantity + v_delta_quantity;
    elsif v_type.effect = 'DECREASE' then
      if v_before_quantity < v_delta_quantity then
        raise exception 'Insufficient stock';
      end if;
      v_after_quantity := v_before_quantity - v_delta_quantity;
    else
      raise exception 'Neutral transaction type cannot adjust a balance';
    end if;

    update public.stock_balances
    set quantity = v_after_quantity,
        updated_at = now()
    where id = v_balance.id
    returning * into v_balance;

    v_before_stack_quantity := null;
    v_after_stack_quantity := null;
  end if;

  perform public.attach_stock_balance_locations(
    v_balance.id, p_area_id, p_location_ids, p_created_by
  );

  insert into public.stock_transactions (
    supply_id,
    provider_id,
    area_id,
    storage_location_id,
    order_id,
    order_item_id,
    transaction_type_id,
    quantity,
    before_quantity,
    after_quantity,
    set_per_qty,
    stack_quantity,
    before_stack_quantity,
    after_stack_quantity,
    reason_id,
    reason_note,
    reason,
    note,
    created_by
  )
  values (
    p_supply_id,
    p_provider_id,
    p_area_id,
    null,
    null,
    null,
    p_transaction_type_id,
    v_delta_quantity,
    v_before_quantity,
    v_after_quantity,
    case when v_is_stack_supply then p_set_per_qty else null end,
    case when v_is_stack_supply then p_stack_quantity else null end,
    v_before_stack_quantity,
    v_after_stack_quantity,
    p_adjustment_reason_id,
    nullif(btrim(p_reason_note), ''),
    nullif(btrim(p_reason_note), ''),
    nullif(btrim(p_note), ''),
    p_created_by
  )
  returning * into v_transaction;

  return jsonb_build_object(
    'balance', to_jsonb(v_balance),
    'transaction', to_jsonb(v_transaction)
  );
end;
$$;

revoke all on function public.apply_stock_adjustment_v5(
  uuid, uuid, uuid, uuid, numeric, numeric, numeric,
  uuid, text, text, uuid, uuid[]
)
from public, anon, authenticated;

grant execute on function public.apply_stock_adjustment_v5(
  uuid, uuid, uuid, uuid, numeric, numeric, numeric,
  uuid, text, text, uuid, uuid[]
)
to service_role;

-- ---------------------------------------------------------------------------
-- Editing labels
-- ---------------------------------------------------------------------------
create or replace function public.replace_stock_balance_locations(
  p_stock_balance_id uuid,
  p_location_ids uuid[],
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance public.stock_balances%rowtype;
  v_location_ids uuid[] := coalesce(p_location_ids, array[]::uuid[]);
begin
  if not public.has_permission(p_actor_id, 'supply.stock.adjust') then
    raise exception using message = 'STOCK_LOCATIONS_FORBIDDEN';
  end if;

  select balance.*
  into v_balance
  from public.stock_balances balance
  where balance.id = p_stock_balance_id
    and balance.is_deleted = false
  for update of balance;

  if not found then
    raise exception using message = 'STOCK_BALANCE_NOT_FOUND';
  end if;

  delete from public.stock_balance_locations label
  where label.stock_balance_id = v_balance.id
    and not (label.storage_location_id = any(v_location_ids));

  perform public.attach_stock_balance_locations(
    v_balance.id, v_balance.area_id, v_location_ids, p_actor_id
  );

  return jsonb_build_object(
    'stock_balance_id', v_balance.id,
    'storage_location_ids', (
      select coalesce(jsonb_agg(label.storage_location_id order by label.created_at), '[]'::jsonb)
      from public.stock_balance_locations label
      where label.stock_balance_id = v_balance.id
    )
  );
end;
$$;

revoke all on function public.replace_stock_balance_locations(uuid, uuid[], uuid)
from public, anon, authenticated;
grant execute on function public.replace_stock_balance_locations(uuid, uuid[], uuid)
to service_role;

commit;

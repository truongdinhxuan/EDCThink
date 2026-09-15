-- Refuse Order creation outside the nominal window of the requester's resolved
-- work shift instance.
--
-- The window itself is not recomputed here: resolve_user_work_shift_instance
-- already derives it in Asia/Ho_Chi_Minh from work_date plus the shift's
-- start_time/end_time, shifting end_time to the next day when crosses_midnight
-- is set, and returns is_overtime for exactly this question. Reusing that flag
-- keeps one implementation of the shift window in the system.

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
      join public.storage_locations location
        on location.id = balance.storage_location_id
       and location.area_id = balance.area_id
       and location.is_active = true
       and location.is_deleted = false
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
      join public.storage_locations location
        on location.id = balance.storage_location_id
       and location.area_id = balance.area_id
       and location.is_active = true
       and location.is_deleted = false
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

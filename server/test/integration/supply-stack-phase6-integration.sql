-- LOCAL/DISPOSABLE DATABASE ONLY.
-- Phase 6 PostgreSQL integration tests. Fixtures are rolled back by the inner
-- exception block; only pg_temp helpers survive for the current session.

create or replace function pg_temp.make_p6_stack_case(
  p_suffix text,
  p_supply_id uuid,
  p_provider_id uuid,
  p_unit_id uuid,
  p_from_area_id uuid,
  p_to_area_id uuid,
  p_actor_id uuid,
  p_status_id uuid,
  p_set_per_qty numeric,
  p_approved_stacks numeric,
  p_balance_stacks numeric,
  out order_id uuid,
  out item_id uuid,
  out balance_id uuid,
  out allocation_id uuid
)
returns record
language plpgsql
set search_path = ''
as $$
declare
  v_location_id uuid;
begin
  insert into public.storage_locations(code, area_id, name)
  values ('P6IT_' || p_suffix, p_from_area_id, 'P6 ' || p_suffix)
  returning id into v_location_id;

  insert into public.stock_balances(
    supply_id, provider_id, area_id, storage_location_id, quantity,
    set_per_qty, stack_quantity, total_set_quantity
  ) values (
    p_supply_id, p_provider_id, p_from_area_id, v_location_id,
    p_balance_stacks * p_set_per_qty,
    p_set_per_qty, p_balance_stacks, p_balance_stacks * p_set_per_qty
  ) returning id into balance_id;

  insert into public.orders(code, from_area_id, to_area_id, requested_by, status_id)
  values ('P6IT_' || p_suffix, p_from_area_id, p_to_area_id, p_actor_id, p_status_id)
  returning id into order_id;

  insert into public.order_items(
    order_id, supply_id, provider_id, unit_id,
    quantity_requested, quantity_approved, quantity_issued,
    set_per_qty, requested_stack_quantity, requested_total_set_quantity
  ) values (
    order_id, p_supply_id, p_provider_id, p_unit_id,
    p_approved_stacks * p_set_per_qty,
    p_approved_stacks * p_set_per_qty,
    0, p_set_per_qty, p_approved_stacks,
    p_approved_stacks * p_set_per_qty
  ) returning id into item_id;

  insert into public.order_item_allocations(
    order_item_id, stock_balance_id, expected_stack_quantity
  ) values (item_id, balance_id, p_approved_stacks)
  returning id into allocation_id;
end;
$$;

create or replace function pg_temp.add_p6_stack_balance(
  p_suffix text,
  p_supply_id uuid,
  p_provider_id uuid,
  p_area_id uuid,
  p_set_per_qty numeric,
  p_stacks numeric
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_location_id uuid;
  v_balance_id uuid;
begin
  insert into public.storage_locations(code, area_id, name)
  values ('P6IT_' || p_suffix, p_area_id, 'P6 ' || p_suffix)
  returning id into v_location_id;
  insert into public.stock_balances(
    supply_id, provider_id, area_id, storage_location_id, quantity,
    set_per_qty, stack_quantity, total_set_quantity
  ) values (
    p_supply_id, p_provider_id, p_area_id, v_location_id,
    p_stacks * p_set_per_qty,
    p_set_per_qty, p_stacks, p_stacks * p_set_per_qty
  ) returning id into v_balance_id;
  return v_balance_id;
end;
$$;

create or replace function pg_temp.fail_p6_issue_ledger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.stock_transaction_types transaction_type
    where transaction_type.id = new.transaction_type_id
      and transaction_type.code = 'ISSUE'
  ) then
    raise exception 'P6_FORCED_LEDGER_FAILURE';
  end if;
  return new;
end;
$$;

do $p6$
#variable_conflict use_variable
declare
  v_stack_supply uuid;
  v_normal_supply uuid;
  v_special_supply uuid;
  v_stack_category uuid;
  v_special_category uuid;
  v_normal_category uuid;
  v_unit uuid;
  v_provider uuid;
  v_from_area uuid;
  v_to_area uuid;
  v_admin_role uuid;
  v_actor uuid;
  v_outsider uuid;
  v_approved uuid;
  v_partial uuid;
  v_order uuid;
  v_item uuid;
  v_balance uuid;
  v_allocation uuid;
  v_balance_b uuid;
  v_allocation_b uuid;
  v_normal_item uuid;
  v_normal_balance uuid;
  v_normal_location uuid;
  v_result jsonb;
  v_error text;
  v_count bigint;
  v_before numeric;
  v_tx uuid;
  v_status_code text;
begin
  begin
    select id into strict v_stack_category
    from public.supply_categories where code = 'KIEN_SAT_TC';
    select id into strict v_special_category
    from public.supply_categories where code = 'KIEN_SAT_SPECIAL';
    select id into strict v_approved
    from public.order_statuses where code = 'APPROVED';
    select id into strict v_partial
    from public.order_statuses where code = 'PARTIAL_ISSUED';
    select id into strict v_admin_role
    from public.roles where code = 'ADMIN' and is_system;

    insert into public.units(code, name, symbol)
    values ('P6IT_SET', 'Phase 6 set', 'SET') returning id into v_unit;
    insert into public.supply_categories(code, name, description)
    values ('P6IT_NORMAL', 'Phase 6 normal', 'Normal fixture')
    returning id into v_normal_category;
    insert into public.supplies(code, short_text, description, category_id, unit_id)
    values ('P6IT_STACK', 'P6 stack', 'Stack fixture', v_stack_category, v_unit)
    returning id into v_stack_supply;
    insert into public.supplies(code, short_text, description, category_id, unit_id)
    values ('P6IT_NORMAL', 'P6 normal', 'Normal fixture', v_normal_category, v_unit)
    returning id into v_normal_supply;
    insert into public.supplies(code, short_text, description, category_id, unit_id)
    values ('P6IT_SPECIAL', 'P6 special', 'Special normal fixture', v_special_category, v_unit)
    returning id into v_special_supply;
    insert into public.providers(code, name)
    values ('P6IT_PROVIDER', 'P6 Provider') returning id into v_provider;
    insert into public.supply_providers(supply_id, provider_id)
    values
      (v_stack_supply, v_provider),
      (v_normal_supply, v_provider),
      (v_special_supply, v_provider);
    insert into public.areas(code, name)
    values ('P6IT_FROM', 'P6 From') returning id into v_from_area;
    insert into public.areas(code, name)
    values ('P6IT_TO', 'P6 To') returning id into v_to_area;
    insert into public.users(
      vinfast_id, email, role_id, area_id, first_name, last_name,
      is_active, is_verified, is_deleted
    ) values (
      960000001, 'p6it_admin@local.test', v_admin_role, v_from_area,
      'P6', 'Admin', true, true, false
    ) returning id into v_actor;
    insert into public.user_roles(user_id, role_id)
    values (v_actor, v_admin_role)
    on conflict (user_id, role_id) do update set is_active=true,is_deleted=false;
    insert into public.users(
      vinfast_id, email, role_id, area_id, first_name, last_name,
      is_active, is_verified, is_deleted
    ) values (
      960000002, 'p6it_outsider@local.test', v_admin_role, v_from_area,
      'P6', 'Outsider', true, true, false
    ) returning id into v_outsider;
    delete from public.user_roles where user_id = v_outsider;

    -- T-001/T-003/T-007/T-013/T-020/T-021/T-023/T-024/T-032:
    -- canonical shortage + successful full reallocation. Balance A alone follows
    -- 5 -> 3 discrepancy correction -> 2 actual Issue; correction is not repeated.
    select * into v_order, v_item, v_balance, v_allocation
    from pg_temp.make_p6_stack_case(
      'CANONICAL', v_stack_supply, v_provider, v_unit, v_from_area, v_to_area,
      v_actor, v_approved, 11, 3, 5
    );
    v_balance_b := pg_temp.add_p6_stack_balance(
      'CANONICAL_B', v_stack_supply, v_provider, v_from_area, 11, 5
    );
    perform public.confirm_stack_allocation_actual(v_allocation, 1, v_actor, 'Thiếu 2 chồng');
    select id into strict v_allocation_b
    from public.order_item_allocations
    where order_item_id = v_item and id <> v_allocation;
    perform public.confirm_stack_allocation_actual(v_allocation_b, 2, v_actor, null);
    v_result := public.issue_order(v_order, v_actor, '[]'::jsonb, null, null);
    if (select stack_quantity from public.stock_balances where id=v_balance) <> 2
       or (select quantity from public.stock_balances where id=v_balance) <> 22
       or (select stack_quantity from public.stock_balances where id=v_balance_b) <> 3
       or (select quantity_issued from public.order_items where id=v_item) <> 33
       or v_result->>'status' <> 'ISSUED'
       or (select issued_at from public.orders where id=v_order) is null
       or (select count(*) from public.stock_transactions tx join public.stock_transaction_types tt on tt.id=tx.transaction_type_id where tx.order_id=v_order and tt.code='DISCREPANCY_CORRECTION') <> 1
       or (select count(*) from public.stock_transactions tx join public.stock_transaction_types tt on tt.id=tx.transaction_type_id where tx.order_id=v_order and tt.code='ISSUE') <> 2
       or exists (
         select 1 from public.stock_transactions tx
         join public.stock_transaction_types tt on tt.id=tx.transaction_type_id
         where tx.order_id=v_order and tt.code='ISSUE'
           and (tx.set_per_qty<>11 or tx.stack_quantity not in (1,2)
             or tx.quantity<>tx.stack_quantity*11
             or tx.before_quantity-tx.after_quantity<>tx.quantity
             or tx.before_stack_quantity-tx.after_stack_quantity<>tx.stack_quantity
             or tx.created_by<>v_actor or tx.order_item_id<>v_item)
       )
       or (select available_stack_quantity from public.get_supply_stack_options(v_stack_supply,v_provider,v_from_area) where set_per_qty=11) <> 5 then
      raise exception 'T-001/T-003/T-007/T-013/T-020/T-021/T-023/T-024/T-032 canonical mismatch: %',v_result;
    end if;
    raise notice 'PASS T-001/T-003/T-007/T-013/T-020/T-021/T-023/T-024/T-032 canonical issue';

    -- T-002 exact actual: no discrepancy, 5 -> 2.
    select * into v_order, v_item, v_balance, v_allocation
    from pg_temp.make_p6_stack_case(
      'EXACT',v_stack_supply,v_provider,v_unit,v_from_area,v_to_area,
      v_actor,v_approved,12,3,5
    );
    perform public.confirm_stack_allocation_actual(v_allocation,3,v_actor,null);
    perform public.issue_order(v_order,v_actor,'[]'::jsonb,null,null);
    if (select stack_quantity from public.stock_balances where id=v_balance)<>2
       or exists(select 1 from public.inventory_discrepancies where order_id=v_order) then
      raise exception 'T-002 exact actual mismatch';
    end if;
    raise notice 'PASS T-002 exact actual';

    -- T-004 split locations.
    select * into v_order, v_item, v_balance, v_allocation
    from pg_temp.make_p6_stack_case(
      'SPLIT_A',v_stack_supply,v_provider,v_unit,v_from_area,v_to_area,
      v_actor,v_approved,13,5,7
    );
    update public.order_item_allocations
    set expected_stack_quantity=3,actual_stack_quantity=3,confirmed_at=now()
    where id=v_allocation;
    v_balance_b:=pg_temp.add_p6_stack_balance('SPLIT_B',v_stack_supply,v_provider,v_from_area,13,4);
    insert into public.order_item_allocations(order_item_id,stock_balance_id,expected_stack_quantity,actual_stack_quantity,confirmed_at)
    values(v_item,v_balance_b,2,2,now());
    perform public.issue_order(v_order,v_actor,'[]'::jsonb,null,null);
    if (select stack_quantity from public.stock_balances where id=v_balance)<>4
       or (select stack_quantity from public.stock_balances where id=v_balance_b)<>2 then
      raise exception 'T-004 split location mismatch';
    end if;
    raise notice 'PASS T-004 split locations';

    -- T-005 unconfirmed allocation.
    select * into v_order,v_item,v_balance,v_allocation
    from pg_temp.make_p6_stack_case('UNCONF',v_stack_supply,v_provider,v_unit,v_from_area,v_to_area,v_actor,v_approved,14,2,5);
    v_error:=null;
    begin perform public.issue_order(v_order,v_actor,'[]'::jsonb,null,null); exception when others then v_error:=sqlerrm; end;
    if v_error<>'STACK_ALLOCATIONS_NOT_CONFIRMED' or (select stack_quantity from public.stock_balances where id=v_balance)<>5 then
      raise exception 'T-005 unconfirmed mismatch: %',v_error;
    end if;
    raise notice 'PASS T-005 unconfirmed guard';

    -- T-006 incomplete confirmed actual.
    update public.order_item_allocations set actual_stack_quantity=1,confirmed_at=now() where id=v_allocation;
    v_error:=null;
    begin perform public.issue_order(v_order,v_actor,'[]'::jsonb,null,null); exception when others then v_error:=sqlerrm; end;
    if v_error<>'STACK_ISSUE_ALLOCATION_INCOMPLETE' or (select stack_quantity from public.stock_balances where id=v_balance)<>5 then
      raise exception 'T-006 incomplete mismatch: %',v_error;
    end if;
    raise notice 'PASS T-006 incomplete coverage guard';

    -- T-008 approval incompatible.
    select * into v_order,v_item,v_balance,v_allocation
    from pg_temp.make_p6_stack_case('BAD_APPROVAL',v_stack_supply,v_provider,v_unit,v_from_area,v_to_area,v_actor,v_approved,11,3,5);
    update public.order_items set quantity_approved=25 where id=v_item;
    update public.order_item_allocations set actual_stack_quantity=3,confirmed_at=now() where id=v_allocation;
    v_error:=null;
    begin perform public.issue_order(v_order,v_actor,'[]'::jsonb,null,null); exception when others then v_error:=sqlerrm; end;
    if v_error<>'STACK_APPROVAL_NOT_COMPATIBLE' then raise exception 'T-008 mismatch: %',v_error; end if;
    raise notice 'PASS T-008 approval compatibility';

    -- T-009 stock changed after confirmation.
    select * into v_order,v_item,v_balance,v_allocation
    from pg_temp.make_p6_stack_case('CONFLICT',v_stack_supply,v_provider,v_unit,v_from_area,v_to_area,v_actor,v_approved,15,3,5);
    perform public.confirm_stack_allocation_actual(v_allocation,3,v_actor,null);
    update public.stock_balances set stack_quantity=2,total_set_quantity=30,quantity=30 where id=v_balance;
    v_error:=null;
    begin perform public.issue_order(v_order,v_actor,'[]'::jsonb,null,null); exception when others then v_error:=sqlerrm; end;
    if v_error<>'STACK_ISSUE_STOCK_CONFLICT' or (select stack_quantity from public.stock_balances where id=v_balance)<>2 then
      raise exception 'T-009 stock conflict mismatch: %',v_error;
    end if;
    raise notice 'PASS T-009 stock conflict';

    -- T-010 same balance multiple allocations aggregate to four.
    select * into v_order,v_item,v_balance,v_allocation
    from pg_temp.make_p6_stack_case('AGG_OK',v_stack_supply,v_provider,v_unit,v_from_area,v_to_area,v_actor,v_approved,16,4,5);
    update public.order_item_allocations set expected_stack_quantity=2,actual_stack_quantity=2,confirmed_at=now() where id=v_allocation;
    insert into public.order_item_allocations(order_item_id,stock_balance_id,expected_stack_quantity,actual_stack_quantity,confirmed_at)
    values(v_item,v_balance,2,2,now());
    perform public.issue_order(v_order,v_actor,'[]'::jsonb,null,null);
    if (select stack_quantity from public.stock_balances where id=v_balance)<>1
       or (select count(*) from public.stock_transactions tx join public.stock_transaction_types tt on tt.id=tx.transaction_type_id where tx.order_id=v_order and tt.code='ISSUE')<>1 then
      raise exception 'T-010 aggregate issue mismatch';
    end if;
    raise notice 'PASS T-010 aggregate same balance';

    -- T-011 aggregate over-consumption.
    select * into v_order,v_item,v_balance,v_allocation
    from pg_temp.make_p6_stack_case('AGG_FAIL',v_stack_supply,v_provider,v_unit,v_from_area,v_to_area,v_actor,v_approved,17,6,5);
    update public.order_item_allocations set expected_stack_quantity=3,actual_stack_quantity=3,confirmed_at=now() where id=v_allocation;
    insert into public.order_item_allocations(order_item_id,stock_balance_id,expected_stack_quantity,actual_stack_quantity,confirmed_at)
    values(v_item,v_balance,3,3,now());
    v_error:=null;
    begin perform public.issue_order(v_order,v_actor,'[]'::jsonb,null,null); exception when others then v_error:=sqlerrm; end;
    if v_error<>'STACK_ISSUE_STOCK_CONFLICT' or (select stack_quantity from public.stock_balances where id=v_balance)<>5 then
      raise exception 'T-011 aggregate conflict mismatch: %',v_error;
    end if;
    raise notice 'PASS T-011 aggregate conflict';

    -- T-012 zero actual creates no zero ledger row when another allocation covers approval.
    select * into v_order,v_item,v_balance,v_allocation
    from pg_temp.make_p6_stack_case('ZERO',v_stack_supply,v_provider,v_unit,v_from_area,v_to_area,v_actor,v_approved,18,2,5);
    update public.order_item_allocations set actual_stack_quantity=0,confirmed_at=now() where id=v_allocation;
    v_balance_b:=pg_temp.add_p6_stack_balance('ZERO_B',v_stack_supply,v_provider,v_from_area,18,4);
    insert into public.order_item_allocations(order_item_id,stock_balance_id,expected_stack_quantity,actual_stack_quantity,confirmed_at)
    values(v_item,v_balance_b,2,2,now());
    perform public.issue_order(v_order,v_actor,'[]'::jsonb,null,null);
    if (select stack_quantity from public.stock_balances where id=v_balance)<>5
       or (select count(*) from public.stock_transactions tx join public.stock_transaction_types tt on tt.id=tx.transaction_type_id where tx.order_id=v_order and tt.code='ISSUE')<>1
       or exists(select 1 from public.stock_transactions where order_id=v_order and quantity=0) then
      raise exception 'T-012 zero actual mismatch';
    end if;
    raise notice 'PASS T-012 zero actual ledger';

    -- T-014 duplicate Issue and T-015 wrong statuses.
    v_before:=(select stack_quantity from public.stock_balances where id=v_balance_b);
    select count(*) into v_count from public.stock_transactions where order_id=v_order;
    v_error:=null;
    begin perform public.issue_order(v_order,v_actor,'[]'::jsonb,null,null); exception when others then v_error:=sqlerrm; end;
    if v_error<>'ORDER_ALREADY_ISSUED'
       or (select stack_quantity from public.stock_balances where id=v_balance_b)<>v_before
       or (select count(*) from public.stock_transactions where order_id=v_order)<>v_count then
      raise exception 'T-014 duplicate mismatch: %',v_error;
    end if;
    select * into v_order,v_item,v_balance,v_allocation
    from pg_temp.make_p6_stack_case('WRONG_STATUS',v_stack_supply,v_provider,v_unit,v_from_area,v_to_area,v_actor,(select id from public.order_statuses where code='PENDING'),19,2,5);
    update public.order_item_allocations set actual_stack_quantity=2,confirmed_at=now() where id=v_allocation;
    for v_status_code in
      select unnest(array['PENDING','REJECTED','CANCELLED','ISSUED','RECEIVED','COMPLETED'])
    loop
      update public.orders
      set status_id=(select id from public.order_statuses where code=v_status_code)
      where id=v_order;
      v_error:=null;
      begin perform public.issue_order(v_order,v_actor,'[]'::jsonb,null,null); exception when others then v_error:=sqlerrm; end;
      if (v_status_code in ('PENDING','REJECTED','CANCELLED') and v_error<>'ORDER_NOT_ISSUABLE')
         or (v_status_code in ('ISSUED','RECEIVED','COMPLETED') and v_error<>'ORDER_ALREADY_ISSUED') then
        raise exception 'T-015 status % mismatch: %',v_status_code,v_error;
      end if;
    end loop;
    raise notice 'PASS T-014/T-015 duplicate and status guards';

    -- T-016 client override/partial Stack is rejected.
    update public.orders set status_id=v_partial where id=v_order;
    update public.order_items set quantity_issued=19 where id=v_item;
    v_error:=null;
    begin perform public.issue_order(v_order,v_actor,'[]'::jsonb,null,null); exception when others then v_error:=sqlerrm; end;
    if v_error<>'STACK_PARTIAL_ISSUE_NOT_SUPPORTED' then raise exception 'T-016 partial mismatch: %',v_error; end if;
    raise notice 'PASS T-016 Stack partial guard';

    -- T-017/T-018/T-031 normal and KIEN_SAT_SPECIAL keep normal partial flow.
    insert into public.storage_locations(code,area_id,name)
    values('P6IT_NORMAL_LOC',v_from_area,'P6 normal') returning id into v_normal_location;
    insert into public.stock_balances(supply_id,provider_id,area_id,storage_location_id,quantity)
    values(v_normal_supply,v_provider,v_from_area,v_normal_location,10) returning id into v_normal_balance;
    insert into public.orders(code,from_area_id,to_area_id,requested_by,status_id)
    values('P6IT_NORMAL_ORDER',v_from_area,v_to_area,v_actor,v_approved) returning id into v_order;
    insert into public.order_items(order_id,supply_id,provider_id,unit_id,quantity_requested,quantity_approved,quantity_issued)
    values(v_order,v_normal_supply,v_provider,v_unit,8,8,0) returning id into v_normal_item;
    v_result:=public.issue_order(v_order,v_actor,jsonb_build_array(jsonb_build_object('order_item_id',v_normal_item,'issues',jsonb_build_array(jsonb_build_object('storage_location_id',v_normal_location,'quantity',5)))),null,null);
    if v_result->>'status'<>'PARTIAL_ISSUED' or (select quantity from public.stock_balances where id=v_normal_balance)<>5 or (select quantity_issued from public.order_items where id=v_normal_item)<>5 then
      raise exception 'T-017/T-031 normal partial regression mismatch';
    end if;
    insert into public.storage_locations(code,area_id,name)
    values('P6IT_SPECIAL_LOC',v_from_area,'P6 special') returning id into v_normal_location;
    insert into public.stock_balances(supply_id,provider_id,area_id,storage_location_id,quantity)
    values(v_special_supply,v_provider,v_from_area,v_normal_location,10) returning id into v_normal_balance;
    insert into public.orders(code,from_area_id,to_area_id,requested_by,status_id)
    values('P6IT_SPECIAL_ORDER',v_from_area,v_to_area,v_actor,v_approved) returning id into v_order;
    insert into public.order_items(order_id,supply_id,provider_id,unit_id,quantity_requested,quantity_approved,quantity_issued)
    values(v_order,v_special_supply,v_provider,v_unit,4,4,0) returning id into v_normal_item;
    perform public.issue_order(v_order,v_actor,jsonb_build_array(jsonb_build_object('order_item_id',v_normal_item,'issues',jsonb_build_array(jsonb_build_object('storage_location_id',v_normal_location,'quantity',4)))),null,null);
    if (select quantity from public.stock_balances where id=v_normal_balance)<>6 then raise exception 'T-018 special regression mismatch'; end if;
    raise notice 'PASS T-017/T-018/T-031 normal regressions';

    -- T-019 mixed Order: a Stack validation failure rolls back/avoids the
    -- normal payload mutation in the same authoritative RPC.
    select * into v_order,v_item,v_balance,v_allocation
    from pg_temp.make_p6_stack_case('MIXED_FAIL',v_stack_supply,v_provider,v_unit,v_from_area,v_to_area,v_actor,v_approved,20,2,5);
    insert into public.storage_locations(code,area_id,name)
    values('P6IT_MIXED_FAIL_NORMAL',v_from_area,'Mixed failure normal') returning id into v_normal_location;
    insert into public.stock_balances(supply_id,provider_id,area_id,storage_location_id,quantity)
    values(v_normal_supply,v_provider,v_from_area,v_normal_location,10) returning id into v_normal_balance;
    insert into public.order_items(order_id,supply_id,provider_id,unit_id,quantity_requested,quantity_approved,quantity_issued)
    values(v_order,v_normal_supply,v_provider,v_unit,3,3,0) returning id into v_normal_item;
    v_error:=null;
    begin
      perform public.issue_order(v_order,v_actor,jsonb_build_array(jsonb_build_object('order_item_id',v_normal_item,'issues',jsonb_build_array(jsonb_build_object('storage_location_id',v_normal_location,'quantity',3)))),null,null);
    exception when others then v_error:=sqlerrm;
    end;
    if v_error<>'STACK_ALLOCATIONS_NOT_CONFIRMED'
       or (select quantity from public.stock_balances where id=v_normal_balance)<>10
       or exists(select 1 from public.stock_transactions where order_id=v_order) then
      raise exception 'T-019 mixed rollback mismatch: %',v_error;
    end if;

    -- Successful mixed Order: Stack source is allocations, normal source is payload.
    select * into v_order,v_item,v_balance,v_allocation
    from pg_temp.make_p6_stack_case('MIXED',v_stack_supply,v_provider,v_unit,v_from_area,v_to_area,v_actor,v_approved,20,2,5);
    update public.order_item_allocations set actual_stack_quantity=2,confirmed_at=now() where id=v_allocation;
    insert into public.storage_locations(code,area_id,name)
    values('P6IT_MIXED_NORMAL',v_from_area,'Mixed normal') returning id into v_normal_location;
    insert into public.stock_balances(supply_id,provider_id,area_id,storage_location_id,quantity)
    values(v_normal_supply,v_provider,v_from_area,v_normal_location,10) returning id into v_normal_balance;
    insert into public.order_items(order_id,supply_id,provider_id,unit_id,quantity_requested,quantity_approved,quantity_issued)
    values(v_order,v_normal_supply,v_provider,v_unit,3,3,0) returning id into v_normal_item;
    perform public.issue_order(v_order,v_actor,jsonb_build_array(jsonb_build_object('order_item_id',v_normal_item,'issues',jsonb_build_array(jsonb_build_object('storage_location_id',v_normal_location,'quantity',3)))),null,null);
    if (select stack_quantity from public.stock_balances where id=v_balance)<>3
       or (select quantity from public.stock_balances where id=v_normal_balance)<>7
       or (select os.code from public.orders o join public.order_statuses os on os.id=o.status_id where o.id=v_order)<>'ISSUED' then
      raise exception 'T-019 mixed mismatch';
    end if;
    raise notice 'PASS T-019 mixed atomic success';

    -- T-022 immutable new ISSUE transaction.
    select tx.id into strict v_tx from public.stock_transactions tx join public.stock_transaction_types tt on tt.id=tx.transaction_type_id where tx.order_id=v_order and tt.code='ISSUE' limit 1;
    v_error:=null; begin update public.stock_transactions set note='x' where id=v_tx; exception when others then v_error:=sqlerrm; end;
    if v_error not like 'StockTransactions are immutable%' then raise exception 'T-022 update immutability mismatch: %',v_error; end if;
    v_error:=null; begin delete from public.stock_transactions where id=v_tx; exception when others then v_error:=sqlerrm; end;
    if v_error not like 'StockTransactions are immutable%' then raise exception 'T-022 delete immutability mismatch: %',v_error; end if;
    raise notice 'PASS T-022 immutable ledger';

    -- T-025 authorization.
    select * into v_order,v_item,v_balance,v_allocation
    from pg_temp.make_p6_stack_case('RBAC',v_stack_supply,v_provider,v_unit,v_from_area,v_to_area,v_actor,v_approved,21,1,3);
    update public.order_item_allocations set actual_stack_quantity=1,confirmed_at=now() where id=v_allocation;
    v_error:=null; begin perform public.issue_order(v_order,v_outsider,'[]'::jsonb,null,null); exception when others then v_error:=sqlerrm; end;
    if v_error<>'ISSUE_FORBIDDEN' or (select stack_quantity from public.stock_balances where id=v_balance)<>3 then raise exception 'T-025 auth mismatch: %',v_error; end if;
    raise notice 'PASS T-025 authorization';

    -- T-030 forced ledger failure must roll back the preceding balance update.
    select * into v_order,v_item,v_balance,v_allocation
    from pg_temp.make_p6_stack_case('ATOMIC',v_stack_supply,v_provider,v_unit,v_from_area,v_to_area,v_actor,v_approved,22,1,3);
    update public.order_item_allocations set actual_stack_quantity=1,confirmed_at=now() where id=v_allocation;
    execute 'create trigger p6_force_issue_ledger_failure before insert on public.stock_transactions for each row execute function pg_temp.fail_p6_issue_ledger()';
    v_error:=null;
    begin perform public.issue_order(v_order,v_actor,'[]'::jsonb,null,null); exception when others then v_error:=sqlerrm; end;
    execute 'drop trigger p6_force_issue_ledger_failure on public.stock_transactions';
    if v_error<>'P6_FORCED_LEDGER_FAILURE'
       or (select stack_quantity from public.stock_balances where id=v_balance)<>3
       or (select quantity_issued from public.order_items where id=v_item)<>0
       or exists(select 1 from public.stock_transactions where order_id=v_order) then
      raise exception 'T-030 atomic rollback mismatch: %',v_error;
    end if;
    raise notice 'PASS T-030 forced ledger rollback';

    -- T-026..T-029 run in the separate real two-session harness.
    raise notice 'T-026/T-027/T-028/T-029 delegated to supply-stack-phase6-concurrency-*';
    raise exception using message='P6_ROLLBACK_FIXTURES';
  exception when others then
    if sqlerrm<>'P6_ROLLBACK_FIXTURES' then raise; end if;
  end;
  raise notice 'PASS Phase 6 PostgreSQL integration T-001..T-025 and T-030..T-032';
end
$p6$;

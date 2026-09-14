-- LOCAL/DISPOSABLE DATABASE ONLY. Direct integration tests for Phase 4 allocation.
do $p4$
#variable_conflict use_variable
declare
  area_a uuid; area_b uuid; supply_id uuid; unit_id uuid;
  provider_a uuid; provider_b uuid; admin_role uuid; actor uuid; outsider uuid;
  approved uuid; status_id uuid; order_id uuid; item_id uuid; balance_id uuid;
  location_id uuid; expected_balance uuid; n bigint; amount numeric;
  tx_before bigint; err text; status_code text; q numeric;
begin
  -- The nested subtransaction is deliberately rolled back after assertions.
  -- This keeps the local database clean without invoking legacy DELETE triggers.
  begin
  select s.id,s.unit_id into strict supply_id,unit_id from public.supplies s
  join public.supply_categories c on c.id=s.category_id
  where s.code='71000860' and c.code='KIEN_SAT_TC';
  select id into strict admin_role from public.roles
  where code='ADMIN' and is_system and is_active and not is_deleted;
  select id into strict approved from public.order_statuses where code='APPROVED';

  insert into public.areas(code,name) values('P4IT_AREA_A','P4IT A') returning id into area_a;
  insert into public.areas(code,name) values('P4IT_AREA_B','P4IT B') returning id into area_b;
  insert into public.users(vinfast_id,email,role_id,area_id,first_name,last_name,is_active,is_verified,is_deleted)
    values(940000001,'p4it_admin@local.test',admin_role,area_a,'P4','Admin',true,true,false)
    returning id into actor;
  insert into public.user_roles(user_id,role_id) values(actor,admin_role)
    on conflict (user_id,role_id) do update set is_active=true,is_deleted=false;
  insert into public.users(vinfast_id,email,role_id,area_id,first_name,last_name,is_active,is_verified,is_deleted)
    values(940000002,'p4it_outsider@local.test',admin_role,area_a,'P4','Outsider',true,true,false)
    returning id into outsider;
  -- The compatibility trigger mirrors users.role_id; remove that RBAC mapping so
  -- legacy users.role_id alone can be proven insufficient for authorization.
  delete from public.user_roles where user_id=outsider;
  insert into public.providers(code,name) values('P4IT_PROVIDER_A','P4IT Provider A') returning id into provider_a;
  insert into public.providers(code,name) values('P4IT_PROVIDER_B','P4IT Provider B') returning id into provider_b;
  insert into public.supply_providers(supply_id,provider_id) values(supply_id,provider_a),(supply_id,provider_b);
  select count(*) into tx_before from public.stock_transactions;

  -- Largest-first: balances 3/8/2 stacks, request 5; only the 8-stack balance is used.
  insert into public.orders(code,from_area_id,to_area_id,requested_by,status_id)
    values('P4IT_LARGEST',area_a,area_b,actor,approved) returning id into order_id;
  insert into public.order_items(order_id,supply_id,provider_id,unit_id,quantity_requested,quantity_approved,
    quantity_issued,set_per_qty,requested_stack_quantity,requested_total_set_quantity)
    values(order_id,supply_id,provider_a,unit_id,55,55,0,11,5,55) returning id into item_id;
  foreach q in array array[3::numeric,8::numeric,2::numeric] loop
    insert into public.storage_locations(code,area_id,name) values('P4IT_L11_'||q,area_a,'L11') returning id into location_id;
    insert into public.stock_balances(supply_id,provider_id,area_id,storage_location_id,quantity,set_per_qty,stack_quantity,total_set_quantity)
      values(supply_id,provider_a,area_a,location_id,q*11,11,q,q*11) returning id into balance_id;
    if q=8 then expected_balance:=balance_id; end if;
  end loop;
  perform public.allocate_stack_order(order_id,actor);
  select count(*),coalesce(sum(expected_stack_quantity),0) into n,amount
    from public.order_item_allocations where order_item_id=item_id;
  if n<>1 or amount<>5 or not exists(select 1 from public.order_item_allocations
    where order_item_id=item_id and stock_balance_id=expected_balance) then
    raise exception 'largest-first mismatch: rows %, amount %',n,amount;
  end if;
  raise notice 'PASS largest-first';

  -- Split allocation: 3 + 2 satisfies five stacks.
  insert into public.orders(code,from_area_id,to_area_id,requested_by,status_id)
    values('P4IT_SPLIT',area_a,area_b,actor,approved) returning id into order_id;
  insert into public.order_items(order_id,supply_id,provider_id,unit_id,quantity_requested,quantity_approved,
    quantity_issued,set_per_qty,requested_stack_quantity,requested_total_set_quantity)
    values(order_id,supply_id,provider_a,unit_id,60,60,0,12,5,60) returning id into item_id;
  foreach q in array array[3::numeric,2::numeric] loop
    insert into public.storage_locations(code,area_id,name) values('P4IT_L12_'||q,area_a,'L12') returning id into location_id;
    insert into public.stock_balances(supply_id,provider_id,area_id,storage_location_id,quantity,set_per_qty,stack_quantity,total_set_quantity)
      values(supply_id,provider_a,area_a,location_id,q*12,12,q,q*12);
  end loop;
  perform public.allocate_stack_order(order_id,actor);
  select count(*),sum(expected_stack_quantity) into n,amount from public.order_item_allocations where order_item_id=item_id;
  if n<>2 or amount<>5 then raise exception 'split mismatch: rows %, amount %',n,amount; end if;
  raise notice 'PASS split allocation';

  -- Provider isolation.
  insert into public.orders(code,from_area_id,to_area_id,requested_by,status_id)
    values('P4IT_PROVIDER',area_a,area_b,actor,approved) returning id into order_id;
  insert into public.order_items(order_id,supply_id,provider_id,unit_id,quantity_requested,quantity_approved,
    quantity_issued,set_per_qty,requested_stack_quantity,requested_total_set_quantity)
    values(order_id,supply_id,provider_a,unit_id,39,39,0,13,3,39) returning id into item_id;
  insert into public.storage_locations(code,area_id,name) values('P4IT_L13_A',area_a,'L13 A') returning id into location_id;
  insert into public.stock_balances(supply_id,provider_id,area_id,storage_location_id,quantity,set_per_qty,stack_quantity,total_set_quantity)
    values(supply_id,provider_a,area_a,location_id,39,13,3,39) returning id into expected_balance;
  insert into public.storage_locations(code,area_id,name) values('P4IT_L13_B',area_a,'L13 B') returning id into location_id;
  insert into public.stock_balances(supply_id,provider_id,area_id,storage_location_id,quantity,set_per_qty,stack_quantity,total_set_quantity)
    values(supply_id,provider_b,area_a,location_id,260,13,20,260);
  perform public.allocate_stack_order(order_id,actor);
  if not exists(select 1 from public.order_item_allocations where order_item_id=item_id
    and stock_balance_id=expected_balance and expected_stack_quantity=3)
    or exists(select 1 from public.order_item_allocations a join public.stock_balances b on b.id=a.stock_balance_id
      where a.order_item_id=item_id and b.provider_id<>provider_a) then
    raise exception 'provider isolation mismatch';
  end if;
  raise notice 'PASS provider isolation';

  -- Area, set_per_qty and legacy/null stock isolation.
  insert into public.orders(code,from_area_id,to_area_id,requested_by,status_id)
    values('P4IT_DIMENSIONS',area_a,area_b,actor,approved) returning id into order_id;
  insert into public.order_items(order_id,supply_id,provider_id,unit_id,quantity_requested,quantity_approved,
    quantity_issued,set_per_qty,requested_stack_quantity,requested_total_set_quantity)
    values(order_id,supply_id,provider_a,unit_id,42,42,0,14,3,42) returning id into item_id;
  insert into public.storage_locations(code,area_id,name) values('P4IT_L14_OK',area_a,'Correct') returning id into location_id;
  insert into public.stock_balances(supply_id,provider_id,area_id,storage_location_id,quantity,set_per_qty,stack_quantity,total_set_quantity)
    values(supply_id,provider_a,area_a,location_id,42,14,3,42) returning id into expected_balance;
  insert into public.storage_locations(code,area_id,name) values('P4IT_L14_AREA',area_b,'Other area') returning id into location_id;
  insert into public.stock_balances(supply_id,provider_id,area_id,storage_location_id,quantity,set_per_qty,stack_quantity,total_set_quantity)
    values(supply_id,provider_a,area_b,location_id,280,14,20,280);
  insert into public.storage_locations(code,area_id,name) values('P4IT_L14_SET',area_a,'Other set') returning id into location_id;
  insert into public.stock_balances(supply_id,provider_id,area_id,storage_location_id,quantity,set_per_qty,stack_quantity,total_set_quantity)
    values(supply_id,provider_a,area_a,location_id,160,8,20,160);
  insert into public.storage_locations(code,area_id,name) values('P4IT_L14_LEGACY',area_a,'Legacy') returning id into location_id;
  insert into public.stock_balances(supply_id,provider_id,area_id,storage_location_id,quantity)
    values(supply_id,provider_a,area_a,location_id,999);
  perform public.allocate_stack_order(order_id,actor);
  if not exists(select 1 from public.order_item_allocations where order_item_id=item_id
    and stock_balance_id=expected_balance and expected_stack_quantity=3)
    or exists(select 1 from public.order_item_allocations where order_item_id=item_id and stock_balance_id<>expected_balance) then
    raise exception 'dimension isolation mismatch';
  end if;
  raise notice 'PASS area/set-per-qty/legacy isolation';

  -- Approval compatibility: 22 SET at 11 SET/stack becomes two stacks.
  insert into public.orders(code,from_area_id,to_area_id,requested_by,status_id)
    values('P4IT_VALID_APPROVAL',area_a,area_b,actor,approved) returning id into order_id;
  insert into public.order_items(order_id,supply_id,provider_id,unit_id,quantity_requested,quantity_approved,
    quantity_issued,set_per_qty,requested_stack_quantity,requested_total_set_quantity)
    values(order_id,supply_id,provider_a,unit_id,22,22,0,11,2,22) returning id into item_id;
  perform public.allocate_stack_order(order_id,actor);
  select coalesce(sum(expected_stack_quantity),0) into amount
    from public.order_item_allocations where order_item_id=item_id;
  if amount<>2 then raise exception 'valid approval mismatch: expected 2, got %',amount; end if;
  raise notice 'PASS approval compatibility 22/11=2';

  -- Incompatible approval rolls back.
  insert into public.orders(code,from_area_id,to_area_id,requested_by,status_id)
    values('P4IT_BAD_APPROVAL',area_a,area_b,actor,approved) returning id into order_id;
  insert into public.order_items(order_id,supply_id,provider_id,unit_id,quantity_requested,quantity_approved,
    quantity_issued,set_per_qty,requested_stack_quantity,requested_total_set_quantity)
    values(order_id,supply_id,provider_a,unit_id,30,25,0,15,2,30) returning id into item_id;
  insert into public.storage_locations(code,area_id,name) values('P4IT_L15',area_a,'Bad approval') returning id into location_id;
  insert into public.stock_balances(supply_id,provider_id,area_id,storage_location_id,quantity,set_per_qty,stack_quantity,total_set_quantity)
    values(supply_id,provider_a,area_a,location_id,150,15,10,150);
  err:=null; begin perform public.allocate_stack_order(order_id,actor); exception when others then err:=sqlerrm; end;
  if err<>'STACK_APPROVAL_NOT_COMPATIBLE' or exists(select 1 from public.order_item_allocations where order_item_id=item_id)
    then raise exception 'bad approval guard mismatch: %',err; end if;
  raise notice 'PASS approval divisibility guard';

  -- Insufficient stock rolls back without stock mutation.
  insert into public.orders(code,from_area_id,to_area_id,requested_by,status_id)
    values('P4IT_INSUFFICIENT',area_a,area_b,actor,approved) returning id into order_id;
  insert into public.order_items(order_id,supply_id,provider_id,unit_id,quantity_requested,quantity_approved,
    quantity_issued,set_per_qty,requested_stack_quantity,requested_total_set_quantity)
    values(order_id,supply_id,provider_a,unit_id,80,80,0,16,5,80) returning id into item_id;
  insert into public.storage_locations(code,area_id,name) values('P4IT_L16',area_a,'Insufficient') returning id into location_id;
  insert into public.stock_balances(supply_id,provider_id,area_id,storage_location_id,quantity,set_per_qty,stack_quantity,total_set_quantity)
    values(supply_id,provider_a,area_a,location_id,48,16,3,48) returning id into balance_id;
  err:=null; begin perform public.allocate_stack_order(order_id,actor); exception when others then err:=sqlerrm; end;
  if err<>'INSUFFICIENT_STACK_STOCK' or exists(select 1 from public.order_item_allocations where order_item_id=item_id)
    or (select quantity from public.stock_balances where id=balance_id)<>48
    then raise exception 'insufficient rollback mismatch: %',err; end if;
  raise notice 'PASS insufficient-stock rollback';

  -- Whole-order atomicity: 3 + 3 cannot consume a five-stack snapshot.
  insert into public.orders(code,from_area_id,to_area_id,requested_by,status_id)
    values('P4IT_ATOMIC_FAIL',area_a,area_b,actor,approved) returning id into order_id;
  insert into public.order_items(order_id,supply_id,provider_id,unit_id,quantity_requested,quantity_approved,quantity_issued,
    set_per_qty,requested_stack_quantity,requested_total_set_quantity,created_at) values
    (order_id,supply_id,provider_a,unit_id,51,51,0,17,3,51,now()),
    (order_id,supply_id,provider_a,unit_id,51,51,0,17,3,51,now()+interval '1 ms');
  insert into public.storage_locations(code,area_id,name) values('P4IT_L17',area_a,'Atomic fail') returning id into location_id;
  insert into public.stock_balances(supply_id,provider_id,area_id,storage_location_id,quantity,set_per_qty,stack_quantity,total_set_quantity)
    values(supply_id,provider_a,area_a,location_id,85,17,5,85);
  err:=null; begin perform public.allocate_stack_order(order_id,actor); exception when others then err:=sqlerrm; end;
  select count(*) into n from public.order_item_allocations a join public.order_items i on i.id=a.order_item_id where i.order_id=order_id;
  if err<>'INSUFFICIENT_STACK_STOCK' or n<>0 then raise exception 'whole-order rollback mismatch: %, rows %',err,n; end if;
  raise notice 'PASS whole-order atomic rollback';

  -- Working availability: 3 + 2 consumes exactly five stacks without double allocation.
  insert into public.orders(code,from_area_id,to_area_id,requested_by,status_id)
    values('P4IT_ATOMIC_OK',area_a,area_b,actor,approved) returning id into order_id;
  insert into public.order_items(order_id,supply_id,provider_id,unit_id,quantity_requested,quantity_approved,quantity_issued,
    set_per_qty,requested_stack_quantity,requested_total_set_quantity,created_at) values
    (order_id,supply_id,provider_a,unit_id,54,54,0,18,3,54,now()),
    (order_id,supply_id,provider_a,unit_id,36,36,0,18,2,36,now()+interval '1 ms');
  insert into public.storage_locations(code,area_id,name) values('P4IT_L18',area_a,'Atomic ok') returning id into location_id;
  insert into public.stock_balances(supply_id,provider_id,area_id,storage_location_id,quantity,set_per_qty,stack_quantity,total_set_quantity)
    values(supply_id,provider_a,area_a,location_id,90,18,5,90);
  perform public.allocate_stack_order(order_id,actor);
  select count(*),sum(a.expected_stack_quantity) into n,amount from public.order_item_allocations a
    join public.order_items i on i.id=a.order_item_id where i.order_id=order_id;
  if n<>2 or amount<>5 then raise exception 'working availability mismatch: rows %, amount %',n,amount; end if;
  raise notice 'PASS shared working availability';

  -- Duplicate call is rejected and prior rows remain unchanged.
  insert into public.orders(code,from_area_id,to_area_id,requested_by,status_id)
    values('P4IT_REPEAT',area_a,area_b,actor,approved) returning id into order_id;
  insert into public.order_items(order_id,supply_id,provider_id,unit_id,quantity_requested,quantity_approved,
    quantity_issued,set_per_qty,requested_stack_quantity,requested_total_set_quantity)
    values(order_id,supply_id,provider_a,unit_id,38,38,0,19,2,38) returning id into item_id;
  insert into public.storage_locations(code,area_id,name) values('P4IT_L19',area_a,'Repeat') returning id into location_id;
  insert into public.stock_balances(supply_id,provider_id,area_id,storage_location_id,quantity,set_per_qty,stack_quantity,total_set_quantity)
    values(supply_id,provider_a,area_a,location_id,38,19,2,38);
  perform public.allocate_stack_order(order_id,actor);
  select count(*) into n from public.order_item_allocations where order_item_id=item_id;
  err:=null; begin perform public.allocate_stack_order(order_id,actor); exception when others then err:=sqlerrm; end;
  if err<>'ALLOCATION_ALREADY_EXISTS' or (select count(*) from public.order_item_allocations where order_item_id=item_id)<>n
    then raise exception 'repeat guard mismatch: %',err; end if;
  raise notice 'PASS duplicate-allocation guard';

  -- Only APPROVED may allocate.
  foreach status_code in array array['PENDING','REJECTED','PARTIAL_ISSUED','ISSUED'] loop
    select id into strict status_id from public.order_statuses where code=status_code;
    insert into public.orders(code,from_area_id,to_area_id,requested_by,status_id)
      values('P4IT_STATUS_'||status_code,area_a,area_b,actor,status_id) returning id into order_id;
    insert into public.order_items(order_id,supply_id,provider_id,unit_id,quantity_requested,quantity_approved,
      quantity_issued,set_per_qty,requested_stack_quantity,requested_total_set_quantity)
      values(order_id,supply_id,provider_a,unit_id,20,20,0,20,1,20);
    err:=null; begin perform public.allocate_stack_order(order_id,actor); exception when others then err:=sqlerrm; end;
    if err<>'ORDER_NOT_APPROVED' then raise exception 'status % guard mismatch: %',status_code,err; end if;
  end loop;
  raise notice 'PASS status guards';

  -- Effective-permission guard.
  insert into public.orders(code,from_area_id,to_area_id,requested_by,status_id)
    values('P4IT_FORBIDDEN',area_a,area_b,actor,approved) returning id into order_id;
  insert into public.order_items(order_id,supply_id,provider_id,unit_id,quantity_requested,quantity_approved,
    quantity_issued,set_per_qty,requested_stack_quantity,requested_total_set_quantity)
    values(order_id,supply_id,provider_a,unit_id,20,20,0,20,1,20) returning id into item_id;
  err:=null; begin perform public.allocate_stack_order(order_id,outsider); exception when others then err:=sqlerrm; end;
  if err<>'ALLOCATION_FORBIDDEN' or exists(select 1 from public.order_item_allocations where order_item_id=item_id)
    then raise exception 'permission guard mismatch: %',err; end if;
  raise notice 'PASS permission guard';

  -- Allocation is proposal-only.
  select count(*) into n from public.order_item_allocations
    where actual_stack_quantity is not null or confirmed_at is not null or status is not null or discrepancy_reason is not null;
  if n<>0 then raise exception 'proposal-only columns unexpectedly populated: %',n; end if;
  if (select count(*) from public.stock_transactions)<>tx_before then raise exception 'allocation wrote stock ledger'; end if;
  if exists(select 1 from public.stock_balances where storage_location_id in
    (select id from public.storage_locations where code like 'P4IT_%') and set_per_qty is not null
    and (quantity<>total_set_quantity or total_set_quantity<>stack_quantity*set_per_qty))
    then raise exception 'allocation changed stock mirror fields'; end if;
  raise notice 'PASS proposal-only no-stock/no-ledger behavior';

    raise exception using message='P4_ROLLBACK_FIXTURES';
  exception when others then
    if sqlerrm <> 'P4_ROLLBACK_FIXTURES' then raise; end if;
  end;
  raise notice 'PASS Phase 4 database integration suite';
end
$p4$;

-- LOCAL/DISPOSABLE DATABASE ONLY.
-- Final regression coverage for the Phase 2/3 receipt and create-order paths.
-- All fixtures are rolled back by the inner exception block.

do $p7$
#variable_conflict use_variable
declare
  v_stack_supply uuid;
  v_stack_unit uuid;
  v_provider uuid;
  v_admin_role uuid;
  v_actor uuid;
  v_area_a uuid;
  v_area_b uuid;
  v_location_exact uuid;
  v_location_multi uuid;
  v_location_legacy uuid;
  v_import_type uuid;
  v_adjustment_type uuid;
  v_pending uuid;
  v_order uuid;
  v_normal_category uuid;
  v_special_category uuid;
  v_normal_supply uuid;
  v_special_supply uuid;
  v_error text;
  v_count bigint;
  v_quantity numeric;
begin
  begin
    select s.id, s.unit_id
    into strict v_stack_supply, v_stack_unit
    from public.supplies s
    join public.supply_categories c on c.id = s.category_id
    where s.code = '71000860'
      and c.code = 'KIEN_SAT_TC';

    select id into strict v_admin_role
    from public.roles
    where code = 'ADMIN' and is_system and is_active and not is_deleted;
    select id into strict v_import_type
    from public.stock_transaction_types where code = 'IMPORT';
    select id into strict v_adjustment_type
    from public.stock_transaction_types where code = 'ADJUSTMENT_IN';
    select id into strict v_pending
    from public.order_statuses where code = 'PENDING';

    insert into public.areas(code, name)
    values ('P7IT_AREA_A', 'P7 source') returning id into v_area_a;
    insert into public.areas(code, name)
    values ('P7IT_AREA_B', 'P7 destination') returning id into v_area_b;

    insert into public.users(
      vinfast_id, email, role_id, area_id, first_name, last_name,
      is_active, is_verified, is_deleted
    ) values (
      970000001, 'p7it_admin@local.test', v_admin_role, v_area_a,
      'P7', 'Admin', true, true, false
    ) returning id into v_actor;
    insert into public.user_roles(user_id, role_id)
    values (v_actor, v_admin_role)
    on conflict (user_id, role_id) do update
      set is_active = true, is_deleted = false;

    insert into public.providers(code, name)
    values ('P7IT_PROVIDER', 'P7 Provider')
    returning id into v_provider;
    insert into public.supply_providers(supply_id, provider_id)
    values (v_stack_supply, v_provider);

    insert into public.storage_locations(code, area_id, name)
    values ('P7IT_EXACT', v_area_a, 'P7 exact') returning id into v_location_exact;
    insert into public.storage_locations(code, area_id, name)
    values ('P7IT_MULTI', v_area_a, 'P7 multi') returning id into v_location_multi;
    insert into public.storage_locations(code, area_id, name)
    values ('P7IT_LEGACY', v_area_a, 'P7 legacy') returning id into v_location_legacy;

    -- F-001: exact Stack IMPORT. Server owns the 8 * 11 calculation.
    perform public.apply_stock_adjustment_v4(
      v_stack_supply, v_provider, v_area_a, v_location_exact,
      v_import_type, 88, 8, 11, null,
      'P7 exact import', 'P7 final integration', v_actor
    );
    select quantity into strict v_quantity
    from public.stock_balances
    where supply_id = v_stack_supply and provider_id = v_provider
      and area_id = v_area_a and storage_location_id = v_location_exact
      and set_per_qty = 11 and is_active and not is_deleted;
    if v_quantity <> 88 then
      raise exception 'F-001 exact receipt mismatch: %', v_quantity;
    end if;
    if not exists (
      select 1 from public.stock_transactions tx
      where tx.supply_id = v_stack_supply
        and tx.storage_location_id = v_location_exact
        and tx.quantity = 88 and tx.stack_quantity = 8
        and tx.set_per_qty = 11
    ) then
      raise exception 'F-001 exact receipt ledger missing';
    end if;
    raise notice 'PASS F-001 exact receipt 8 x 11 = 88';

    -- F-002/F-041: two set sizes are independent balance dimensions.
    perform public.apply_stock_adjustment_v4(
      v_stack_supply, v_provider, v_area_a, v_location_multi,
      v_import_type, 77, 7, 11, null,
      'P7 multi 11', 'P7 final integration', v_actor
    );
    perform public.apply_stock_adjustment_v4(
      v_stack_supply, v_provider, v_area_a, v_location_multi,
      v_import_type, 9, 1, 9, null,
      'P7 multi 9', 'P7 final integration', v_actor
    );
    select count(*), sum(quantity)
    into v_count, v_quantity
    from public.stock_balances
    where supply_id = v_stack_supply and provider_id = v_provider
      and area_id = v_area_a and storage_location_id = v_location_multi
      and set_per_qty in (9, 11) and is_active and not is_deleted;
    if v_count <> 2 or v_quantity <> 86 then
      raise exception 'F-002 multi-size mismatch: rows %, total %', v_count, v_quantity;
    end if;
    raise notice 'PASS F-002/F-041 multi-size dimensions total 86';

    -- F-020: deferred Stack manual adjustment fails cleanly and mutates nothing.
    v_error := null;
    begin
      perform public.apply_stock_adjustment_v4(
        v_stack_supply, v_provider, v_area_a, v_location_exact,
        v_adjustment_type, 11, 1, 11, null,
        'P7 deferred adjustment', 'Must reject', v_actor
      );
    exception when others then
      v_error := sqlerrm;
    end;
    if v_error <> 'Stack operation not supported for this transaction type'
       or (select quantity from public.stock_balances
           where storage_location_id = v_location_exact and set_per_qty = 11) <> 88 then
      raise exception 'F-020 deferred adjustment mismatch: %', v_error;
    end if;
    raise notice 'PASS F-020 deferred Stack adjustment rejects without mutation';

    -- F-024 receipt total tampering is rejected.
    v_error := null;
    begin
      perform public.apply_stock_adjustment_v4(
        v_stack_supply, v_provider, v_area_a, v_location_exact,
        v_import_type, 80, 8, 11, null,
        'P7 tamper receipt', 'Must reject', v_actor
      );
    exception when others then
      v_error := sqlerrm;
    end;
    if v_error not like 'Quantity mismatch: expected 88%'
       or (select quantity from public.stock_balances
           where storage_location_id = v_location_exact and set_per_qty = 11) <> 88 then
      raise exception 'F-024 receipt tamper mismatch: %', v_error;
    end if;
    raise notice 'PASS F-024 receipt total tampering rejected';

    -- F-021: legacy rows remain visible as legacy data but never become options.
    insert into public.stock_balances(
      supply_id, provider_id, area_id, storage_location_id, quantity,
      set_per_qty, stack_quantity, total_set_quantity
    ) values (
      v_stack_supply, v_provider, v_area_a, v_location_legacy, 22,
      null, null, null
    );
    if exists (
      select 1 from public.get_supply_stack_options(v_stack_supply, v_provider, v_area_a)
      where set_per_qty is null
    ) then
      raise exception 'F-021 legacy balance leaked into Stack options';
    end if;
    raise notice 'PASS F-021 legacy balance excluded from Stack options';

    -- F-003: options are server-scoped and only return positive Stack rows.
    if not exists (
      select 1 from public.get_supply_stack_options(v_stack_supply, v_provider, v_area_a)
      where set_per_qty = 11 and available_stack_quantity = 15
    ) or not exists (
      select 1 from public.get_supply_stack_options(v_stack_supply, v_provider, v_area_a)
      where set_per_qty = 9 and available_stack_quantity = 1
    ) then
      raise exception 'F-003 Stack options mismatch';
    end if;
    raise notice 'PASS F-003 Stack options scoped by Supply, Provider and Area';

    -- F-004/F-005: authoritative create and one Stack size per OrderItem.
    v_order := public.create_order_with_items(
      'P7IT_ORDER', v_area_a, v_area_b, v_actor, v_pending, null,
      jsonb_build_array(
        jsonb_build_object(
          'supply_id', v_stack_supply, 'provider_id', v_provider,
          'unit_id', v_stack_unit, 'set_per_qty', 11,
          'requested_stack_quantity', 3, 'quantity_requested', 33,
          'requested_total_set_quantity', 33
        ),
        jsonb_build_object(
          'supply_id', v_stack_supply, 'provider_id', v_provider,
          'unit_id', v_stack_unit, 'set_per_qty', 9,
          'requested_stack_quantity', 2, 'quantity_requested', 18,
          'requested_total_set_quantity', 18
        )
      )
    );
    select count(*), sum(quantity_requested)
    into v_count, v_quantity
    from public.order_items where order_id = v_order;
    if v_count <> 2 or v_quantity <> 51
       or exists (select 1 from public.stock_transactions where order_id = v_order) then
      raise exception 'F-004/F-005 create mismatch: rows %, total %', v_count, v_quantity;
    end if;
    raise notice 'PASS F-004/F-005 create keeps two Stack OrderItems and no stock effect';

    -- F-024 order total spoof and client category spoof cannot bypass DB category.
    v_error := null;
    begin
      perform public.create_order_with_items(
        'P7IT_TAMPER_TOTAL', v_area_a, v_area_b, v_actor, v_pending, null,
        jsonb_build_array(jsonb_build_object(
          'supply_id', v_stack_supply, 'provider_id', v_provider,
          'unit_id', v_stack_unit, 'category', 'NORMAL',
          'set_per_qty', 11, 'requested_stack_quantity', 3,
          'quantity_requested', 30
        ))
      );
    exception when others then
      v_error := sqlerrm;
    end;
    if v_error not like 'quantity_requested mismatch: expected 33%' then
      raise exception 'F-024 order total/category spoof mismatch: %', v_error;
    end if;
    raise notice 'PASS F-024 category and order total spoof rejected';

    -- F-016/F-017: normal and KIEN_SAT_SPECIAL remain normal quantity flows.
    insert into public.supply_categories(code, name)
    values ('P7_NORMAL', 'P7 normal') returning id into v_normal_category;
    select id into strict v_special_category
    from public.supply_categories where code = 'KIEN_SAT_SPECIAL';
    insert into public.supplies(code, short_text, category_id, unit_id)
    values ('P7IT_NORMAL', 'P7 normal', v_normal_category, v_stack_unit)
    returning id into v_normal_supply;
    insert into public.supplies(code, short_text, category_id, unit_id)
    values ('P7IT_SPECIAL', 'P7 special', v_special_category, v_stack_unit)
    returning id into v_special_supply;
    insert into public.supply_providers(supply_id, provider_id)
    values (v_normal_supply, v_provider), (v_special_supply, v_provider);

    v_order := public.create_order_with_items(
      'P7IT_NORMAL_ORDER', v_area_a, v_area_b, v_actor, v_pending, null,
      jsonb_build_array(
        jsonb_build_object(
          'supply_id', v_normal_supply, 'provider_id', v_provider,
          'unit_id', v_stack_unit, 'quantity_requested', 5
        ),
        jsonb_build_object(
          'supply_id', v_special_supply, 'provider_id', v_provider,
          'unit_id', v_stack_unit, 'quantity_requested', 7
        )
      )
    );
    if exists (
      select 1 from public.order_items
      where order_id = v_order
        and (set_per_qty is not null or requested_stack_quantity is not null)
    ) then
      raise exception 'F-016/F-017 normal categories received Stack metadata';
    end if;
    raise notice 'PASS F-016/F-017 normal and KIEN_SAT_SPECIAL regressions';

    raise exception using message = 'P7_ROLLBACK_FIXTURES';
  exception when others then
    if sqlerrm <> 'P7_ROLLBACK_FIXTURES' then
      raise;
    end if;
  end;
  raise notice 'PASS Phase 7 receipt/create-order final integration';
end
$p7$;

begin;

do $$
declare
  v_actor_id uuid;
  v_role_id uuid := gen_random_uuid();
  v_packing_id uuid;
  v_logistics_id uuid;
  v_invalid_id uuid := gen_random_uuid();
  v_admin_role_id uuid;
  v_count integer;
begin
  select users.id
  into v_actor_id
  from public.users users
  join public.user_roles user_role
    on user_role.user_id = users.id
   and user_role.is_active = true
   and user_role.is_deleted = false
  join public.roles role
    on role.id = user_role.role_id
   and role.code = 'ADMIN'
   and role.is_system = true
   and role.is_active = true
   and role.is_deleted = false
  where users.is_active = true
    and users.is_deleted = false
  limit 1;

  if v_actor_id is null then
    raise exception 'Integration fixture requires one active system ADMIN user';
  end if;

  select id into v_packing_id
  from public.area_types
  where code = 'PACKING' and is_active = true and is_deleted = false;

  select id into v_logistics_id
  from public.area_types
  where code = 'LOGISTICS' and is_active = true and is_deleted = false;

  insert into public.roles (
    id, code, name, description, is_system, is_active, is_deleted
  ) values (
    v_role_id, 'PHASE6_AREA_SCOPE_TEST', 'Phase 6 Area Scope Test',
    'Rolled back integration fixture', false, true, false
  );

  perform public.replace_role_area_type_scopes(
    v_role_id,
    array[v_packing_id, v_logistics_id, v_packing_id],
    v_actor_id
  );

  select count(*) into v_count
  from public.role_area_type_scopes
  where role_id = v_role_id;
  if v_count <> 2 then
    raise exception 'Expected duplicate-free two-scope replacement, got %', v_count;
  end if;

  perform public.replace_role_area_type_scopes(
    v_role_id,
    array[v_packing_id],
    v_actor_id
  );

  if exists (
    select 1 from public.role_area_type_scopes
    where role_id = v_role_id and area_type_id = v_logistics_id
  ) then
    raise exception 'Complete desired state did not remove LOGISTICS';
  end if;

  begin
    perform public.replace_role_area_type_scopes(
      v_role_id,
      array[v_invalid_id],
      v_actor_id
    );
    raise exception 'Invalid Area Type was accepted';
  exception
    when sqlstate '22023' then null;
  end;

  select id into v_admin_role_id
  from public.roles
  where code = 'ADMIN' and is_system = true;

  begin
    perform public.replace_role_area_type_scopes(
      v_admin_role_id,
      array[]::uuid[],
      v_actor_id
    );
    raise exception 'System ADMIN scope replacement was accepted';
  exception
    when sqlstate 'P0001' then null;
  end;
end;
$$;

rollback;

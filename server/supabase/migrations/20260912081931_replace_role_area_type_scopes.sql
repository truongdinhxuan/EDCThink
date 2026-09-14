-- Atomically replace the Area Type data scope assigned to one Role.
-- The mapping is configuration state rather than historical business data, so
-- omitted rows are deleted and desired rows are inserted in the same transaction.

begin;

create or replace function public.replace_role_area_type_scopes(
  p_role_id uuid,
  p_area_type_ids uuid[],
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role_code text;
  v_role_is_system boolean;
  v_requested_count integer;
  v_valid_count integer;
begin
  if not public.has_permission(p_actor_id, 'admin.role.update') then
    raise exception using
      errcode = '42501',
      message = 'Actor does not have admin.role.update';
  end if;

  select role.code, role.is_system
  into v_role_code, v_role_is_system
  from public.roles role
  where role.id = p_role_id
    and role.is_active = true
    and role.is_deleted = false
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Role not found or inactive';
  end if;

  if v_role_code = 'ADMIN' and v_role_is_system = true then
    raise exception using
      errcode = 'P0001',
      message = 'System ADMIN always has access to every active Area Type';
  end if;

  select coalesce(array_agg(distinct requested_id), array[]::uuid[])
  into p_area_type_ids
  from unnest(coalesce(p_area_type_ids, array[]::uuid[])) requested_id;

  select count(distinct requested_id), count(distinct area_type.id)
  into v_requested_count, v_valid_count
  from unnest(coalesce(p_area_type_ids, array[]::uuid[])) requested_id
  left join public.area_types area_type
    on area_type.id = requested_id
   and area_type.is_active = true
   and area_type.is_deleted = false;

  if v_requested_count <> v_valid_count then
    raise exception using
      errcode = '22023',
      message = 'One or more Area Types are invalid or inactive';
  end if;

  delete from public.role_area_type_scopes scope
  where scope.role_id = p_role_id
    and scope.area_type_id <> all(coalesce(p_area_type_ids, array[]::uuid[]));

  insert into public.role_area_type_scopes (role_id, area_type_id)
  select p_role_id, requested_id
  from unnest(coalesce(p_area_type_ids, array[]::uuid[])) requested_id
  on conflict (role_id, area_type_id) do nothing;
end;
$$;

revoke all on function public.replace_role_area_type_scopes(uuid, uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.replace_role_area_type_scopes(uuid, uuid[], uuid)
  to service_role;

comment on function public.replace_role_area_type_scopes(uuid, uuid[], uuid) is
  'Atomically replaces Role Area Type scopes after admin.role.update authorization; exact system ADMIN is protected.';

commit;

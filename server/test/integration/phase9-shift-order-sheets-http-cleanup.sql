\set ON_ERROR_STOP on

begin;
set local session_replication_role = replica;

delete from public.supply_shift_order_sheets
where id in (
  '69200000-0000-4000-8000-000000000011',
  '69200000-0000-4000-8000-000000000012'
);
delete from public.user_roles
where user_id in (
  '69200000-0000-4000-8000-000000000001',
  '69200000-0000-4000-8000-000000000002',
  '69200000-0000-4000-8000-000000000003'
);
delete from public.users
where id in (
  '69200000-0000-4000-8000-000000000001',
  '69200000-0000-4000-8000-000000000002',
  '69200000-0000-4000-8000-000000000003'
);
delete from public.role_permissions
where role_id in (select id from public.roles where code in ('PHASE9_HTTP_MANAGER', 'PHASE9_HTTP_PACKING', 'PHASE9_HTTP_OUTSIDER'));
delete from public.role_area_type_scopes
where role_id in (select id from public.roles where code in ('PHASE9_HTTP_MANAGER', 'PHASE9_HTTP_PACKING', 'PHASE9_HTTP_OUTSIDER'));
delete from public.roles where code in ('PHASE9_HTTP_MANAGER', 'PHASE9_HTTP_PACKING', 'PHASE9_HTTP_OUTSIDER');

commit;

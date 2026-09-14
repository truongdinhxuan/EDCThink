\set ON_ERROR_STOP on

insert into public.areas(code, name, area_type_id, is_active, is_deleted)
select fixture.code, fixture.name, area_type.id, true, false
from (
  values
    ('VTDG', 'Vật tư đóng gói', null::text),
    ('EDC_LOGISTICS', 'EDC Logistics', 'LOGISTICS')
) fixture(code, name, area_type_code)
left join public.area_types area_type on area_type.code = fixture.area_type_code
on conflict (code) do update
set area_type_id = excluded.area_type_id,
    is_active = true,
    is_deleted = false;

insert into public.roles(code, name, description, is_system, is_active, is_deleted)
values
  ('PHASE9_HTTP_MANAGER', 'Phase 9 HTTP manager', 'LOCAL TEST ONLY', false, true, false),
  ('PHASE9_HTTP_PACKING', 'Phase 9 HTTP packing', 'LOCAL TEST ONLY', false, true, false),
  ('PHASE9_HTTP_OUTSIDER', 'Phase 9 HTTP outsider', 'LOCAL TEST ONLY', false, true, false)
on conflict (code) do update set is_active = true, is_deleted = false;

insert into public.role_permissions(role_id, permission_id, is_active, is_deleted)
select role_record.id, permission_record.id, true, false
from public.roles role_record
join public.permissions permission_record on (
  (role_record.code = 'PHASE9_HTTP_MANAGER' and permission_record.code in ('supply.order.approve', 'supply.shift_order_sheet.read'))
  or (role_record.code = 'PHASE9_HTTP_PACKING' and permission_record.code in ('supply.order.create', 'supply.shift_order_sheet.read'))
  or (role_record.code = 'PHASE9_HTTP_OUTSIDER' and permission_record.code = 'supply.shift_order_sheet.read')
)
on conflict (role_id, permission_id) do update
set is_active = true, is_deleted = false, updated_at = now();

insert into public.role_area_type_scopes(role_id, area_type_id)
select role_record.id, area_type.id
from public.roles role_record
cross join public.area_types area_type
where role_record.code in ('PHASE9_HTTP_MANAGER', 'PHASE9_HTTP_PACKING')
  and area_type.code = 'LOGISTICS'
on conflict (role_id, area_type_id) do nothing;

insert into public.users(
  id, vinfast_id, email, role_id, area_id, is_active, is_verified,
  is_deleted, first_name, last_name
)
select fixture.id, fixture.vinfast_id, fixture.email, role_record.id, area.id,
  true, true, false, 'Phase9', fixture.last_name
from (
  values
    ('69200000-0000-4000-8000-000000000001'::uuid, 969200001, 'p9-http-manager@local.test', 'PHASE9_HTTP_MANAGER', 'Manager', 'EDC_LOGISTICS'),
    ('69200000-0000-4000-8000-000000000002'::uuid, 969200002, 'p9-http-packing@local.test', 'PHASE9_HTTP_PACKING', 'Packing', 'EDC_LOGISTICS'),
    ('69200000-0000-4000-8000-000000000003'::uuid, 969200003, 'p9-http-outsider@local.test', 'PHASE9_HTTP_OUTSIDER', 'Outsider', 'VTDG')
) fixture(id, vinfast_id, email, role_code, last_name, area_code)
join public.roles role_record on role_record.code = fixture.role_code
join public.areas area on area.code = fixture.area_code
on conflict (id) do update
set role_id = excluded.role_id,
    area_id = excluded.area_id,
    is_active = true,
    is_verified = true,
    is_deleted = false,
    updated_at = now();

insert into public.user_roles(user_id, role_id, is_active, is_deleted)
select user_record.id, user_record.role_id, true, false
from public.users user_record
where user_record.id in (
  '69200000-0000-4000-8000-000000000001',
  '69200000-0000-4000-8000-000000000002',
  '69200000-0000-4000-8000-000000000003'
)
on conflict (user_id, role_id) do update set is_active = true, is_deleted = false;

insert into public.supply_shift_order_sheets(
  id, area_id, work_shift_id, work_date, leader_id, is_active, is_deleted
)
select fixture.id, area.id, shift.id, fixture.work_date,
  '69200000-0000-4000-8000-000000000001', true, false
from (
  values
    ('69200000-0000-4000-8000-000000000011'::uuid, date '2026-09-01'),
    ('69200000-0000-4000-8000-000000000012'::uuid, date '2026-09-02')
) fixture(id, work_date)
join public.areas area on area.code = 'EDC_LOGISTICS'
join public.work_shifts shift on shift.code = 'S1'
on conflict (area_id, work_shift_id, work_date) where is_deleted = false
do update set leader_id = excluded.leader_id, is_active = true, is_deleted = false;

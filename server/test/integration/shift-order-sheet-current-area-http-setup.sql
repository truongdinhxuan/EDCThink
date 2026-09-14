\set ON_ERROR_STOP on

insert into public.areas(id, code, name, area_type_id, is_active, is_deleted)
select fixture.id, fixture.code, fixture.name, area_type.id, true, false
from (
  values
    ('69500000-0000-4000-8000-000000000001'::uuid, 'SO_AREA_A', 'Shift Order Area A', 'PACKING'),
    ('69500000-0000-4000-8000-000000000002'::uuid, 'SO_AREA_B', 'Shift Order Area B', 'LOGISTICS')
) fixture(id, code, name, area_type_code)
join public.area_types area_type on area_type.code = fixture.area_type_code
on conflict (id) do update
set area_type_id = excluded.area_type_id,
    is_active = true, is_deleted = false, updated_at = now();

insert into public.roles(id, code, name, description, is_system, is_active, is_deleted)
values
  ('69500000-0000-4000-8000-000000000010', 'SO_PACKING', 'Shift Order packing', 'LOCAL TEST ONLY', false, true, false),
  ('69500000-0000-4000-8000-000000000014', 'SO_LOGISTICS', 'Shift Order logistics', 'LOCAL TEST ONLY', false, true, false)
on conflict (id) do update
set is_active = true, is_deleted = false, updated_at = now();

insert into public.role_permissions(role_id, permission_id, is_active, is_deleted)
select role_record.id, permission.id, true, false
from public.roles role_record
cross join public.permissions permission
where role_record.id in (
  '69500000-0000-4000-8000-000000000010',
  '69500000-0000-4000-8000-000000000014'
)
  and permission.code in ('supply.order.create', 'supply.shift_order_sheet.read')
on conflict (role_id, permission_id) do update
set is_active = true, is_deleted = false, updated_at = now();

insert into public.role_area_type_scopes(role_id, area_type_id)
select role_record.id, area_type.id
from (
  values
    ('69500000-0000-4000-8000-000000000010'::uuid, 'PACKING'),
    ('69500000-0000-4000-8000-000000000014'::uuid, 'LOGISTICS')
) fixture(role_id, area_type_code)
join public.roles role_record on role_record.id = fixture.role_id
join public.area_types area_type on area_type.code = fixture.area_type_code
on conflict (role_id, area_type_id) do nothing;

insert into public.users(
  id, vinfast_id, email, role_id, area_id, first_name, last_name,
  is_active, is_verified, is_deleted
)
values
  (
    '69500000-0000-4000-8000-000000000011',
    969500011,
    'so-area-a@local.test',
    '69500000-0000-4000-8000-000000000010',
    '69500000-0000-4000-8000-000000000001',
    'SO',
    'Area A',
    true,
    true,
    false
  ),
  (
    '69500000-0000-4000-8000-000000000012',
    969500012,
    'so-area-b@local.test',
    '69500000-0000-4000-8000-000000000014',
    '69500000-0000-4000-8000-000000000002',
    'SO',
    'Area B',
    true,
    true,
    false
  ),
  (
    '69500000-0000-4000-8000-000000000013',
    969500013,
    'so-area-a-peer@local.test',
    '69500000-0000-4000-8000-000000000010',
    '69500000-0000-4000-8000-000000000001',
    'SO',
    'Area A Peer',
    true,
    true,
    false
  )
on conflict (id) do update
set role_id = excluded.role_id,
    area_id = excluded.area_id,
    is_active = true,
    is_verified = true,
    is_deleted = false,
    updated_at = now();

insert into public.user_roles(user_id, role_id, is_active, is_deleted)
values
  ('69500000-0000-4000-8000-000000000011', '69500000-0000-4000-8000-000000000010', true, false),
  ('69500000-0000-4000-8000-000000000012', '69500000-0000-4000-8000-000000000014', true, false),
  ('69500000-0000-4000-8000-000000000013', '69500000-0000-4000-8000-000000000010', true, false)
on conflict (user_id, role_id) do update
set is_active = true, is_deleted = false, updated_at = now();

insert into public.user_work_shift_assignments(
  id, user_id, work_shift_id, effective_from, assigned_by,
  is_active, is_deleted
)
select
  fixture.id,
  fixture.user_id,
  shift.id,
  now() - interval '1 day',
  fixture.user_id,
  true,
  false
from (
  values
    ('69500000-0000-4000-8000-000000000021'::uuid, '69500000-0000-4000-8000-000000000011'::uuid),
    ('69500000-0000-4000-8000-000000000022'::uuid, '69500000-0000-4000-8000-000000000012'::uuid),
    ('69500000-0000-4000-8000-000000000023'::uuid, '69500000-0000-4000-8000-000000000013'::uuid)
) fixture(id, user_id)
join public.work_shifts shift on shift.code = 'S1'
on conflict (id) do update
set effective_from = excluded.effective_from,
    effective_to = null,
    is_active = true,
    is_deleted = false,
    updated_at = now();

insert into public.supply_shift_order_sheets(
  id, area_id, work_shift_id, work_date, leader_id, is_active, is_deleted
)
select
  fixture.sheet_id,
  fixture.area_id,
  resolved.work_shift_id,
  resolved.work_date,
  fixture.user_id,
  true,
  false
from (
  values (
    '69500000-0000-4000-8000-000000000031'::uuid,
    '69500000-0000-4000-8000-000000000011'::uuid,
    '69500000-0000-4000-8000-000000000001'::uuid
  )
) fixture(sheet_id, user_id, area_id)
cross join lateral public.resolve_user_work_shift_instance(fixture.user_id, now()) resolved
on conflict (area_id, work_shift_id, work_date) where is_deleted = false
do update set leader_id = excluded.leader_id, is_active = true, is_deleted = false;

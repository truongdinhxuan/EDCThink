begin;

-- Area is shared master data. Dedicated permissions let custom Roles manage
-- Areas without receiving every Supply catalog capability.
insert into public.permissions (
  code, name, module, description, is_system, is_active, is_deleted
)
values
  ('supply.area.read', 'Xem khu vực', 'Supply', 'Guard GET /areas and Area management page', true, true, false),
  ('supply.area.create', 'Tạo khu vực', 'Supply', 'Guard POST /areas', true, true, false),
  ('supply.area.update', 'Sửa khu vực', 'Supply', 'Guard PATCH /areas/:id', true, true, false),
  ('supply.area.deactivate', 'Ngừng sử dụng khu vực', 'Supply', 'Guard soft deactivate DELETE /areas/:id', true, true, false)
on conflict (code) do update
set name = excluded.name,
    module = excluded.module,
    description = excluded.description,
    is_system = true,
    is_active = true,
    is_deleted = false,
    updated_at = now();

-- Preserve current access once. Future Role edits can manage Area access
-- independently from the generic Supply catalog permissions.
with permission_map(old_code, new_code) as (
  values
    ('supply.catalog.read', 'supply.area.read'),
    ('supply.catalog.create', 'supply.area.create'),
    ('supply.catalog.update', 'supply.area.update'),
    ('supply.catalog.delete', 'supply.area.deactivate')
)
insert into public.role_permissions (role_id, permission_id, is_active, is_deleted)
select old_mapping.role_id, new_permission.id, true, false
from public.role_permissions old_mapping
join public.permissions old_permission
  on old_permission.id = old_mapping.permission_id
join permission_map mapping
  on mapping.old_code = old_permission.code
join public.permissions new_permission
  on new_permission.code = mapping.new_code
where old_mapping.is_active = true
  and old_mapping.is_deleted = false
on conflict (role_id, permission_id) do update
set is_active = true, is_deleted = false, updated_at = now();

-- Explicitly map the protected system ADMIN as defense in depth. The runtime
-- bypass remains restricted to code ADMIN together with is_system = true.
insert into public.role_permissions (role_id, permission_id, is_active, is_deleted)
select role_row.id, permission_row.id, true, false
from public.roles role_row
cross join public.permissions permission_row
where role_row.code = 'ADMIN'
  and role_row.is_system = true
  and permission_row.code in (
    'supply.area.read',
    'supply.area.create',
    'supply.area.update',
    'supply.area.deactivate'
  )
on conflict (role_id, permission_id) do update
set is_active = true, is_deleted = false, updated_at = now();

commit;

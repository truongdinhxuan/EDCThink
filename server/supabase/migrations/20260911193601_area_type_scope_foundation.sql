-- Area Type and role-scoped Area access foundation.
--
-- Phase 1 is database-only:
--   * Permission controls access to Shift Order Sheets.
--   * Role Area Type mappings are the real data-scope boundary used in Phase 2.
--   * No per-user/per-Area assignment layer is introduced.
--   * Historical Order work shifts continue to resolve through
--     orders.shift_order_sheet_id -> supply_shift_order_sheets.work_shift_id.

begin;

create extension if not exists pgcrypto;

create table public.area_types (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint area_types_code_key unique (code),
  constraint area_types_code_not_blank check (btrim(code) <> ''),
  constraint area_types_name_not_blank check (btrim(name) <> '')
);

create table public.role_area_type_scopes (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null,
  area_type_id uuid not null,
  created_at timestamptz not null default now(),
  constraint role_area_type_scopes_role_id_fkey
    foreign key (role_id) references public.roles(id)
    on update cascade on delete restrict,
  constraint role_area_type_scopes_area_type_id_fkey
    foreign key (area_type_id) references public.area_types(id)
    on update cascade on delete restrict,
  constraint role_area_type_scopes_role_area_type_key
    unique (role_id, area_type_id)
);

alter table public.areas
  add column area_type_id uuid;

alter table public.areas
  add constraint areas_area_type_id_fkey
  foreign key (area_type_id) references public.area_types(id)
  on update cascade on delete restrict;

create index areas_area_type_id_idx
  on public.areas(area_type_id);

create index role_area_type_scopes_area_type_id_idx
  on public.role_area_type_scopes(area_type_id);

drop trigger if exists area_types_set_updated_at on public.area_types;
create trigger area_types_set_updated_at
before update on public.area_types
for each row execute function public.set_updated_at();

insert into public.area_types (
  code,
  name,
  description,
  is_active,
  is_deleted
)
values
  ('PACKING', 'Đóng gói', 'Nhóm Area đóng gói', true, false),
  ('LOGISTICS', 'Logistics', 'Nhóm Area logistics', true, false),
  ('SHOP', 'Shop', 'Nhóm Area shop', true, false)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    is_active = true,
    is_deleted = false,
    updated_at = now();

-- Only the mappings explicitly confirmed after Phase 0 are backfilled.
-- VTDG intentionally remains nullable until its business Area Type is known.
update public.areas area
set area_type_id = area_type.id,
    updated_at = now()
from public.area_types area_type
where area_type.code = 'PACKING'
  and area.code in ('DG_HATINH', 'DG_INDIA', 'DG_INDO');

update public.areas area
set area_type_id = area_type.id,
    updated_at = now()
from public.area_types area_type
where area_type.code = 'LOGISTICS'
  and area.code = 'EDC_LOGISTICS';

insert into public.permissions (
  code,
  name,
  module,
  description,
  is_system,
  is_active,
  is_deleted
)
values (
  'supply.shift_order_sheet.read',
  'Xem Phiếu Order Ca',
  'Supply',
  'Cho phép xem Phiếu Order Ca; Area được giới hạn riêng bằng Area Type Scope',
  true,
  true,
  false
)
on conflict (code) do update
set name = excluded.name,
    module = excluded.module,
    description = excluded.description,
    is_system = true,
    is_active = true,
    is_deleted = false,
    updated_at = now();

-- Keep the established system-ADMIN catalog mapping without assigning this
-- new feature permission to any unconfirmed business role.
insert into public.role_permissions (
  role_id,
  permission_id,
  is_active,
  is_deleted
)
select role.id, permission.id, true, false
from public.roles role
join public.permissions permission
  on permission.code = 'supply.shift_order_sheet.read'
where role.code = 'ADMIN'
  and role.is_system = true
  and role.is_active = true
  and role.is_deleted = false
on conflict (role_id, permission_id) do update
set is_active = true,
    is_deleted = false,
    updated_at = now();

-- Both new tables are backend-only. Fastify uses service_role and Phase 2 will
-- enforce effective permissions plus the union of active role scopes.
alter table public.area_types enable row level security;
alter table public.role_area_type_scopes enable row level security;

revoke all on table public.area_types
  from public, anon, authenticated, service_role;
revoke all on table public.role_area_type_scopes
  from public, anon, authenticated, service_role;

grant select on table public.area_types to service_role;
grant select, insert, update, delete on table public.role_area_type_scopes
  to service_role;

comment on table public.area_types is
  'Shared Area Type master data used to group public.areas.';
comment on table public.role_area_type_scopes is
  'Role-level Area Type data scopes; effective user scope is the union across active roles.';
comment on column public.areas.area_type_id is
  'Nullable during legacy backfill; VTDG remains unmapped until business confirmation.';

commit;

-- Per-Area stock authorization.
--
-- Until now `supply.stock.read` and `supply.stock.adjust` were global: anyone
-- holding them saw and could move every Area's stock. Authorization moves into
-- Fastify (the application reaches Postgres through the service role, so RLS is
-- not the boundary here) and follows two rules:
--
--   read  = Areas of the role's Area Types, plus the actor's own Area
--   write = the actor's own Area only
--
-- This migration supplies the two pieces of state those rules need. It changes
-- no behaviour on its own: the enforcement ships with the application code.

begin;

-- Read every Area, including Areas created later. A supervisor needs this to
-- stay correct without someone remembering to re-grant it each time a market
-- opens, which is why it is a permission rather than a list of Areas.
insert into public.permissions (
  code, name, module, description, is_system, is_active, is_deleted
)
values (
  'supply.stock.read_all_areas',
  'Xem tồn kho toàn bộ khu vực',
  'Supply',
  'Mở rộng supply.stock.read ra mọi Area, kể cả Area tạo sau này. Không cấp quyền điều chỉnh.',
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

-- Trưởng bộ phận supervises the material flow across every market but adjusts
-- nothing; the role holds supply.stock.read and not supply.stock.adjust, so this
-- widens what it can see without widening what it can change.
insert into public.role_permissions (role_id, permission_id, is_active, is_deleted)
select r.id, p.id, true, false
from public.roles r
cross join public.permissions p
where r.code = 'TBP'
  and r.is_deleted = false
  and p.code = 'supply.stock.read_all_areas'
on conflict (role_id, permission_id) do update
set is_active = true, is_deleted = false;

-- The supplying Area fulfils Orders rather than raising them, so it has no Shift
-- Order Sheet of its own and belongs in no Area Type. Leaving it in PACKING made
-- every packing role a co-owner of the warehouse's stock — it holds most of the
-- rows in stock_balances — which is the leak this whole change exists to close.
--
-- Its own staff keep access through the "own Area" half of the read rule, which
-- needs no Area Type. Nothing else reads areas.area_type_id for stock.
update public.areas
set area_type_id = null,
    updated_at = now()
where code = 'VTDG';

commit;

-- Storage locations stop being part of a stock row's identity.
--
-- Until now one stock_balances row was (supply, provider, area, location
-- [, set_per_qty]), so a quantity always belonged to one shelf such as R01-01-01.
-- From here a row is (supply, provider, area[, set_per_qty]) and holds the whole
-- quantity of that code in that Area. Where the code physically sits becomes a
-- set of labels in stock_balance_locations, which carries no quantity at all.
--
-- The Area stays: stock authorization is scoped per Area (see
-- 20260921010000_stock_area_scope.sql) and needs stock_balances.area_id.
--
-- This migration changes structure only. The RPCs that still reference the
-- dropped column are replaced by the two migrations that follow it.

begin;

-- ---------------------------------------------------------------------------
-- 1. Refuse to run if two locations hold the same code
-- ---------------------------------------------------------------------------
-- Merging would have to repoint allocations, discrepancies and the ledger. At
-- the time of writing no such pair exists, so fail loudly instead of guessing.
do $$
begin
  if exists (
    select 1
    from public.stock_balances balance
    where balance.is_deleted = false
    group by balance.supply_id, balance.provider_id, balance.area_id, balance.set_per_qty
    having count(*) > 1
  ) then
    raise exception
      'stock_balances holds one (supply, provider, area, set_per_qty) at several locations; merge those rows before applying this migration';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Location labels
-- ---------------------------------------------------------------------------
-- The composite keys make a label on a location of another Area impossible,
-- without a trigger.
create unique index stock_balances_id_area_id_key
  on public.stock_balances (id, area_id);

create table public.stock_balance_locations (
  stock_balance_id uuid not null,
  storage_location_id uuid not null,
  area_id uuid not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint stock_balance_locations_pkey
    primary key (stock_balance_id, storage_location_id),
  constraint stock_balance_locations_balance_fkey
    foreign key (stock_balance_id, area_id)
    references public.stock_balances (id, area_id)
    on delete cascade on update cascade,
  constraint stock_balance_locations_location_fkey
    foreign key (storage_location_id, area_id)
    references public.storage_locations (id, area_id)
    on delete restrict on update cascade,
  constraint stock_balance_locations_created_by_fkey
    foreign key (created_by) references public.users (id)
    on delete set null on update cascade
);

create index stock_balance_locations_location_idx
  on public.stock_balance_locations (storage_location_id);

insert into public.stock_balance_locations (
  stock_balance_id, storage_location_id, area_id
)
select balance.id, balance.storage_location_id, balance.area_id
from public.stock_balances balance
where balance.storage_location_id is not null;

alter table public.stock_balance_locations enable row level security;
revoke all on table public.stock_balance_locations
  from public, anon, authenticated;
-- Writes go through replace_stock_balance_locations / apply_stock_adjustment_v5.
grant select on table public.stock_balance_locations to service_role;

comment on table public.stock_balance_locations is
  'Where a stock row''s code physically sits. A label only: quantities live on stock_balances.';

-- ---------------------------------------------------------------------------
-- 3. Drop the location from the stock identity
-- ---------------------------------------------------------------------------
-- CASCADE removes every index and foreign key built on the column, including
-- both partial identity indexes, which are recreated without it below.
alter table public.stock_balances
  drop column storage_location_id cascade;

create unique index stock_balances_normal_identity_key
  on public.stock_balances (supply_id, provider_id, area_id)
  where set_per_qty is null and is_deleted = false;

create unique index stock_balances_stack_identity_key
  on public.stock_balances (supply_id, provider_id, area_id, set_per_qty)
  where set_per_qty is not null and is_deleted = false;

-- ---------------------------------------------------------------------------
-- 4. The ledger keeps the location only as history
-- ---------------------------------------------------------------------------
-- Rows written before this migration keep the location they were written with;
-- the quantity on those rows already equals the pooled total, because no two
-- locations held the same code (checked in step 1). New rows leave it null.
alter table public.stock_transactions
  alter column storage_location_id drop not null;

comment on column public.stock_transactions.storage_location_id is
  'Historical only. Set on rows written before 20260924010000; null afterwards, since stock no longer has a quantity per location.';

-- ---------------------------------------------------------------------------
-- 5. Reasons for a confirmed stack count that differs from the approval
-- ---------------------------------------------------------------------------
-- direction says which side of the approval the reason may be used on;
-- corrects_stock says the difference is missing stock rather than an agreement,
-- so the books are corrected and a recount is opened. The confirm RPC reads
-- these two columns and never branches on a reason code.
create table public.allocation_confirm_reasons (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  direction text not null,
  corrects_stock boolean not null default false,
  sort_order integer not null default 0,
  is_system boolean not null default false,
  is_active boolean not null default true,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint allocation_confirm_reasons_code_key unique (code),
  constraint allocation_confirm_reasons_direction_valid
    check (direction in ('LOWER', 'HIGHER')),
  -- More stacks than approved cannot mean stock is missing.
  constraint allocation_confirm_reasons_correction_lowers
    check (not corrects_stock or direction = 'LOWER')
);

insert into public.allocation_confirm_reasons (
  code, name, description, direction, corrects_stock, sort_order, is_system
)
values
  (
    'NEGOTIATED_LOWER',
    'Thoả thuận nhận ít hơn',
    'Khu vực nhận đồng ý lấy ít hơn số đã duyệt. Không thay đổi tồn kho.',
    'LOWER', false, 10, true
  ),
  (
    'NOT_AVAILABLE',
    'Không có hàng',
    'Kho không đủ số đã duyệt. Tồn sổ được trừ phần chênh và mở phiếu kiểm kê.',
    'LOWER', true, 20, true
  ),
  (
    'NEGOTIATED_HIGHER',
    'Thoả thuận nhận thêm',
    'Khu vực nhận đồng ý lấy nhiều hơn số đã duyệt.',
    'HIGHER', false, 30, true
  );

alter table public.allocation_confirm_reasons enable row level security;
revoke all on table public.allocation_confirm_reasons
  from public, anon, authenticated;
grant select on table public.allocation_confirm_reasons to service_role;

-- ---------------------------------------------------------------------------
-- 6. One confirmation per stack order item
-- ---------------------------------------------------------------------------
-- An allocation used to be "take N stacks from this location"; with no
-- locations left it is the confirmation of one order item: expected = approved
-- stacks, actual = confirmed stacks, pointing at the pooled balance row.
alter table public.order_item_allocations
  add column reason_id uuid,
  add column reason_note text,
  add column confirmed_by uuid,
  add column issued_at timestamptz,
  add constraint order_item_allocations_reason_fkey
    foreign key (reason_id) references public.allocation_confirm_reasons (id)
    on delete restrict on update cascade,
  add constraint order_item_allocations_confirmed_by_fkey
    foreign key (confirmed_by) references public.users (id)
    on delete restrict on update cascade;

-- status was never written before; give the existing rows the value they
-- would have had, so the rule below holds for history too.
update public.order_item_allocations allocation
set status = case
      when coalesce(item.quantity_issued, 0) > 0 then 'ISSUED'
      when allocation.confirmed_at is not null then 'CONFIRMED'
      else null
    end,
    issued_at = case
      when coalesce(item.quantity_issued, 0) > 0 then allocation.updated_at
      else null
    end
from public.order_items item
where item.id = allocation.order_item_id;

alter table public.order_item_allocations
  add constraint order_item_allocations_status_valid
    check (status is null or status in ('CONFIRMED', 'ISSUED'));

create unique index order_item_allocations_order_item_key
  on public.order_item_allocations (order_item_id)
  where is_deleted = false;

-- ---------------------------------------------------------------------------
-- 7. A recount can now come from the confirmation or from the issue
-- ---------------------------------------------------------------------------
drop index public.inventory_discrepancies_allocation_key;

alter table public.inventory_discrepancies
  add column source text not null default 'CONFIRMATION',
  add constraint inventory_discrepancies_source_valid
    check (source in ('CONFIRMATION', 'ISSUE'));

create unique index inventory_discrepancies_allocation_source_key
  on public.inventory_discrepancies (allocation_id, source)
  where is_deleted = false;

comment on column public.inventory_discrepancies.source is
  'CONFIRMATION: the picker reported stacks as not available. ISSUE: the books held fewer stacks than were confirmed and issued.';

commit;

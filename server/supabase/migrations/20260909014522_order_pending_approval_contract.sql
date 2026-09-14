-- Phase 1 foundation for the direct-PENDING Order flow.
--
-- quantity_approved semantics from this point forward:
--   NULL = the item has not been reviewed yet
--   0    = the reviewer rejected the item
--   > 0  = the reviewer approved the item
--
-- The following migration removes the legacy DRAFT status after this contract
-- and the direct-PENDING create RPC are in place.

set lock_timeout = '10s';

alter table public.order_items
  alter column quantity_approved drop default;

alter table public.order_items
  drop constraint if exists order_items_quantity_approved_valid,
  drop constraint if exists order_items_quantity_issued_valid;

alter table public.order_items
  add constraint order_items_quantity_approved_valid
  check (
    quantity_approved is null
    or quantity_approved >= 0
  ) not valid;

alter table public.order_items
  validate constraint order_items_quantity_approved_valid;

alter table public.order_items
  add constraint order_items_quantity_issued_valid
  check (
    quantity_issued is null
    or (
      quantity_issued >= 0
      and (
        quantity_approved is not null
        or quantity_issued = 0
      )
      and (
        quantity_approved is null
        or quantity_issued <= quantity_approved
      )
    )
  ) not valid;

-- Under the previous workflow, DRAFT/PENDING items were initialized to zero
-- before review. Normalize only those unreviewed states after both dependent
-- checks accept the new NULL-before-review contract. Reviewed history remains
-- untouched.
update public.order_items item
set quantity_approved = null
from public.orders order_row
join public.order_statuses status_row
  on status_row.id = order_row.status_id
where item.order_id = order_row.id
  and status_row.code in ('DRAFT', 'PENDING')
  and item.quantity_approved = 0
  and coalesce(item.quantity_issued, 0) = 0;

alter table public.order_items
  validate constraint order_items_quantity_issued_valid;

comment on column public.order_items.quantity_approved is
  'NULL before review; 0 means rejected item; positive values are approved and may exceed quantity_requested.';

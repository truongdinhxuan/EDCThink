-- A stack item may ship more than was approved.
--
-- order_items_quantity_issued_valid capped every item at its approval. Since
-- 20260924010200 a KIEN_SAT_TC item ships its confirmed stack count, and data
-- vật tư may confirm above the approval when the receiving Area agrees to take
-- more (reason NEGOTIATED_HIGHER). The cap now applies to normal items only,
-- where issue_order still refuses anything past the approval.

begin;

alter table public.order_items
  drop constraint order_items_quantity_issued_valid;

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
        or set_per_qty is not null
        or quantity_issued <= quantity_approved
      )
    )
  );

comment on constraint order_items_quantity_issued_valid on public.order_items is
  'Normal items never exceed their approval. Stack items ship the confirmed count, which a NEGOTIATED_HIGHER confirmation may put above it.';

commit;

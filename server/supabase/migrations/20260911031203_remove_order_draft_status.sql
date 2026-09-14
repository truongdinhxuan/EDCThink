-- Remove DRAFT from the active Order lifecycle without deleting historical
-- Order rows. Existing unsubmitted drafts are cancelled rather than promoted
-- to live requests, because they have never passed the current stock/shift
-- validation required by create_pending_order_with_items.

do $$
declare
  v_draft_status_id uuid;
  v_cancelled_status_id uuid;
begin
  select status_row.id
  into v_cancelled_status_id
  from public.order_statuses status_row
  where status_row.code = 'CANCELLED'
    and status_row.is_active = true
    and status_row.is_deleted = false
  for update;

  if v_cancelled_status_id is null then
    raise exception using message = 'CANCELLED_ORDER_STATUS_NOT_FOUND';
  end if;

  select status_row.id
  into v_draft_status_id
  from public.order_statuses status_row
  where status_row.code = 'DRAFT'
  for update;

  if v_draft_status_id is not null then
    if exists (
      select 1
      from public.order_revisions revision
      where revision.old_status_id = v_draft_status_id
         or revision.new_status_id = v_draft_status_id
    ) then
      raise exception using message = 'DRAFT_STATUS_REFERENCED_BY_ORDER_REVISIONS';
    end if;

    update public.orders order_row
    set
      status_id = v_cancelled_status_id,
      cancel_reason = coalesce(
        nullif(btrim(order_row.cancel_reason), ''),
        'SYSTEM_MIGRATION_REMOVE_DRAFT'
      ),
      updated_at = now()
    where order_row.status_id = v_draft_status_id;

    if exists (
      select 1
      from public.orders order_row
      where order_row.status_id = v_draft_status_id
    ) then
      raise exception using message = 'DRAFT_ORDER_BACKFILL_INCOMPLETE';
    end if;

    delete from public.order_statuses
    where id = v_draft_status_id;
  end if;
end
$$;

-- Retire every backend database entry point that can create, edit or submit a
-- draft. Historical migration files remain unchanged so a fresh database can
-- still replay forward to this final state.
drop function if exists public.submit_order_to_pending(
  uuid,
  uuid,
  uuid,
  timestamptz
);

drop function if exists public.replace_order_items_with_providers(uuid, jsonb);

drop function if exists public.create_order_with_items(
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  jsonb
);

drop trigger if exists orders_allow_only_draft_delete on public.orders;
drop function if exists public.allow_only_draft_order_delete();

do $$
begin
  if exists (
    select 1
    from public.order_statuses status_row
    where status_row.code = 'DRAFT'
  ) then
    raise exception using message = 'DRAFT_ORDER_STATUS_STILL_EXISTS';
  end if;
end
$$;

comment on function public.create_pending_order_with_items(
  text,
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  uuid,
  timestamptz
) is
  'Validates positive stock and creates a sheet-linked PENDING Order with all OrderItems atomically.';

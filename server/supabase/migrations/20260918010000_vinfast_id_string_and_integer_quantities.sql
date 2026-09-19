-- Two system-wide changes.
--
-- 1. users.vinfast_id becomes text. The stored values are plain digit strings
--    with no leading zeros, so the cast is lossless; text is what the identifier
--    actually is (an employee code that is never arithmetic).
--
-- 2. Every supply quantity becomes whole-number only. The columns stay numeric
--    so no data is rewritten and no precision is lost on the way in; a CHECK
--    rejects any value carrying a fractional part.

begin;

-- ---------------------------------------------------------------------------
-- 1. vinfast_id: integer -> text
-- ---------------------------------------------------------------------------

alter table public.users
  alter column vinfast_id type text using vinfast_id::text;

-- The unique index is rebuilt by the type change; a text identifier also has to
-- be stopped from being blank, which the integer type used to make impossible.
alter table public.users
  add constraint users_vinfast_id_not_blank check (btrim(vinfast_id) <> '');

-- Both functions take the id as a parameter, so their signature changes and
-- CREATE OR REPLACE cannot be used. create_internal_user_with_roles calls
-- create_internal_user, so the pair has to move together or the inner call
-- would pass text into an integer parameter at run time.
drop function if exists public.create_internal_user_with_roles(
  text, text, text, integer, text, text, uuid[], uuid, uuid, text, uuid
);
drop function if exists public.create_internal_user(
  text, text, text, integer, text, text, uuid, uuid, uuid, text
);

create function public.create_internal_user(
  p_email text,
  p_first_name text,
  p_last_name text,
  p_vinfast_id text,
  p_phone_number text,
  p_avatar_url text,
  p_role_id uuid,
  p_area_id uuid,
  p_managed_by_user_id uuid,
  p_password_hash text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := gen_random_uuid();
begin
  insert into public.users (
    id,
    email,
    first_name,
    last_name,
    vinfast_id,
    phone_number,
    avatar_url,
    role_id,
    area_id,
    managed_by_user_id,
    is_verified,
    is_active,
    is_deleted
  )
  values (
    v_user_id,
    p_email,
    p_first_name,
    p_last_name,
    btrim(p_vinfast_id),
    p_phone_number,
    p_avatar_url,
    p_role_id,
    p_area_id,
    p_managed_by_user_id,
    false,
    true,
    false
  );

  insert into public.user_credentials (user_id, password_hash)
  values (v_user_id, p_password_hash);

  return v_user_id;
end;
$function$;

create function public.create_internal_user_with_roles(
  p_email text,
  p_first_name text,
  p_last_name text,
  p_vinfast_id text,
  p_phone_number text,
  p_avatar_url text,
  p_role_ids uuid[],
  p_area_id uuid,
  p_managed_by_user_id uuid,
  p_password_hash text,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id uuid;
  v_primary_role_id uuid;
begin
  if not public.has_permission(p_actor_id, 'admin.user.create')
     or not public.has_permission(p_actor_id, 'admin.user.assign_role') then
    raise exception 'Actor cannot create users and assign roles';
  end if;
  if cardinality(coalesce(p_role_ids, array[]::uuid[])) = 0 then
    raise exception 'At least one role is required';
  end if;

  select min(value::text)::uuid into v_primary_role_id from unnest(p_role_ids) value;
  v_user_id := public.create_internal_user(
    p_email, p_first_name, p_last_name, p_vinfast_id, p_phone_number,
    p_avatar_url, v_primary_role_id, p_area_id, p_managed_by_user_id,
    p_password_hash
  );
  perform public.replace_user_roles(v_user_id, p_role_ids, p_actor_id);
  return v_user_id;
end;
$function$;

-- DROP discarded the old grants; restore exactly what was there before.
revoke all on function public.create_internal_user(
  text, text, text, text, text, text, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.create_internal_user(
  text, text, text, text, text, text, uuid, uuid, uuid, text
) to service_role;

revoke all on function public.create_internal_user_with_roles(
  text, text, text, text, text, text, uuid[], uuid, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.create_internal_user_with_roles(
  text, text, text, text, text, text, uuid[], uuid, uuid, text, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Whole-number supply quantities
-- ---------------------------------------------------------------------------
-- Verified against live data before writing this: every column below is already
-- clean except order_items.quantity_approved, which holds two rows of 0.000001
-- left behind by the old form's fractional floor. This migration changes types
-- and rules only; it does not touch a single row of business data.
--
-- That one constraint is therefore added NOT VALID so the migration cannot abort
-- on historical junk. NOT VALID still enforces the rule on every insert and
-- update from here on; it only skips the scan of existing rows.

alter table public.order_items
  add constraint order_items_quantity_requested_integer
    check (quantity_requested = trunc(quantity_requested)),
  add constraint order_items_quantity_issued_integer
    check (quantity_issued is null or quantity_issued = trunc(quantity_issued)),
  add constraint order_items_set_per_qty_integer
    check (set_per_qty is null or set_per_qty = trunc(set_per_qty)),
  add constraint order_items_requested_stack_quantity_integer
    check (requested_stack_quantity is null
           or requested_stack_quantity = trunc(requested_stack_quantity));

alter table public.order_items
  add constraint order_items_quantity_approved_integer
    check (quantity_approved is null or quantity_approved = trunc(quantity_approved))
    not valid;

alter table public.order_item_allocations
  add constraint order_item_allocations_expected_stack_integer
    check (expected_stack_quantity = trunc(expected_stack_quantity)),
  add constraint order_item_allocations_actual_stack_integer
    check (actual_stack_quantity is null
           or actual_stack_quantity = trunc(actual_stack_quantity));

alter table public.stock_balances
  add constraint stock_balances_quantity_integer
    check (quantity = trunc(quantity)),
  add constraint stock_balances_stack_quantity_integer
    check (stack_quantity is null or stack_quantity = trunc(stack_quantity));

alter table public.stock_transactions
  add constraint stock_transactions_quantity_integer
    check (quantity = trunc(quantity)),
  add constraint stock_transactions_before_quantity_integer
    check (before_quantity = trunc(before_quantity)),
  add constraint stock_transactions_after_quantity_integer
    check (after_quantity = trunc(after_quantity));

comment on constraint order_items_quantity_approved_integer on public.order_items is
  'NOT VALID: two historical 0.000001 approvals predate this rule. New and updated rows are already enforced; validate once that data is cleaned up.';

commit;

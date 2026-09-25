-- save_teams_workflow: a null p_name broke the insert-if-missing step even when
-- the row already existed (ON CONFLICT still evaluates the VALUES row against
-- NOT NULL). A missing name now falls back to the stored one, or to the code
-- for a brand-new row.
begin;

create or replace function public.save_teams_workflow(
  p_function_code text,
  p_name text,
  p_webhook_url text,
  p_is_active boolean,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow public.teams_workflows%rowtype;
  v_secret_name text := 'teams_workflow_url:' || p_function_code;
begin
  insert into public.teams_workflows (function_code, name, is_active, created_by, updated_by)
  values (
    p_function_code,
    coalesce(nullif(btrim(p_name), ''), p_function_code),
    false,
    p_actor_id,
    p_actor_id
  )
  on conflict (function_code) do nothing;

  select * into v_workflow
  from public.teams_workflows
  where function_code = p_function_code
  for update;

  if nullif(btrim(p_webhook_url), '') is not null then
    if v_workflow.webhook_secret_id is null then
      v_workflow.webhook_secret_id := vault.create_secret(
        btrim(p_webhook_url), v_secret_name, 'Teams Workflow URL for ' || p_function_code
      );
    else
      perform vault.update_secret(v_workflow.webhook_secret_id, btrim(p_webhook_url));
    end if;
  end if;

  update public.teams_workflows
  set name = coalesce(nullif(btrim(p_name), ''), name),
      webhook_secret_id = v_workflow.webhook_secret_id,
      is_active = coalesce(p_is_active, is_active),
      updated_by = p_actor_id
  where id = v_workflow.id;

  return v_workflow.id;
end;
$$;

revoke all on function public.save_teams_workflow(text, text, text, boolean, uuid)
from public, anon, authenticated;
grant execute on function public.save_teams_workflow(text, text, text, boolean, uuid)
to service_role;

commit;

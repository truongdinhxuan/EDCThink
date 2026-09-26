-- Admins enter or replace a Workflow URL from the Teams Webhook page. The
-- backend checks it (https + host allowlist) and stores it in Vault through this
-- function; the URL still never leaves Vault except to the sender, and no API
-- returns it. The SQL Editor route (vault.create_secret / update_secret) keeps
-- working, since both write the same secret name.
begin;

create or replace function public.set_teams_webhook_url(p_code text, p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_name text;
  v_secret_id uuid;
  v_url text := nullif(btrim(p_url), '');
begin
  if v_url is null then
    raise exception 'TEAMS_WEBHOOK_URL_REQUIRED';
  end if;

  select webhook.vault_secret_name into v_secret_name
  from public.teams_webhooks webhook
  where webhook.code = p_code
  for update;
  if not found then
    raise exception 'TEAMS_WEBHOOK_NOT_FOUND';
  end if;

  select secret.id into v_secret_id
  from vault.secrets secret
  where secret.name = v_secret_name;

  if v_secret_id is null then
    perform vault.create_secret(v_url, v_secret_name, 'Teams workflow: ' || p_code);
  else
    perform vault.update_secret(v_secret_id, v_url);
  end if;

  update public.teams_webhooks
  set updated_at = now()
  where code = p_code;
end;
$$;

revoke all on function public.set_teams_webhook_url(text, text) from public, anon, authenticated;
grant execute on function public.set_teams_webhook_url(text, text) to service_role;

update public.permissions
set description = 'Guard PATCH /teams-webhooks/:code, PUT /teams-webhooks/:code/url and test send',
    updated_at = now()
where code = 'teams_webhook.manage';

commit;

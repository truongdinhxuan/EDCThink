-- AUTH Phase 2: refresh token reuse detection.
--
-- Rotation was already a compare-and-swap, so two callers could never both spend
-- the same refresh token. What it could not do was tell WHY a swap failed: a
-- replayed stolen token and a second browser tab refreshing a moment too late
-- both looked like "no row updated" and both got a plain 401, leaving a leaked
-- token's session alive for the rest of its 30 day window.
--
-- Rotation now records the hash it just replaced. That makes the previous token
-- identifiable, so the backend can treat a replay of it inside a short grace
-- window as a concurrent client and anything older as a leak.

alter table public.auth_sessions
  add column if not exists previous_refresh_token_hash text,
  add column if not exists previous_rotated_at timestamptz;

create or replace function public.rotate_auth_session(
  p_session_id uuid,
  p_old_refresh_token_hash text,
  p_new_refresh_token_hash text,
  p_used_at timestamptz
)
returns table (
  session_id uuid,
  user_id uuid,
  expires_at timestamptz,
  rotation_counter bigint
)
language sql
security invoker
set search_path = public
as $$
  update public.auth_sessions as session
  set refresh_token_hash = p_new_refresh_token_hash,
      previous_refresh_token_hash = p_old_refresh_token_hash,
      previous_rotated_at = p_used_at,
      last_used_at = p_used_at,
      rotation_counter = session.rotation_counter + 1
  from public.users as app_user
  where session.id = p_session_id
    and session.user_id = app_user.id
    and session.refresh_token_hash = p_old_refresh_token_hash
    and session.revoked_at is null
    and session.expires_at > p_used_at
    and app_user.is_active = true
    and app_user.is_verified = true
    and app_user.is_deleted = false
  returning
    session.id,
    session.user_id,
    session.expires_at,
    session.rotation_counter;
$$;

revoke all on function public.rotate_auth_session(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.rotate_auth_session(uuid, text, text, timestamptz)
  to service_role;

comment on column public.auth_sessions.previous_refresh_token_hash is
  'SHA-256 of the refresh token replaced by the most recent rotation. Used to separate concurrent-client replay from token theft.';
comment on column public.auth_sessions.previous_rotated_at is
  'When the most recent rotation happened. Bounds the window in which replaying the previous token is treated as a concurrent client.';
comment on function public.rotate_auth_session(uuid, text, text, timestamptz) is
  'Atomically rotates one active refresh token, remembers the replaced hash, and rejects replay/concurrent reuse.';

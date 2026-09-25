-- The backend writes "Gửi thử" results into the delivery log directly, so the
-- card can show the latest attempt; it needs INSERT alongside SELECT/UPDATE.
begin;

grant insert on table public.teams_webhook_deliveries to service_role;

commit;

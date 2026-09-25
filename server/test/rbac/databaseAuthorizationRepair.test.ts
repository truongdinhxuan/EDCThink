import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const statements = (sql: string) => sql.replace(/--[^\n]*/g, '').trim();

describe('Phase 4.0.1 database authorization repair', () => {
  it('limits the Order repair to the two existing Cancel columns', () => {
    const sql = statements(read('supabase/migrations/20260904072119_repair_order_cancel_column_authorization.sql'));
    assert.match(sql, /^begin;\s*grant update \(status_id, cancel_reason\) on table public\.orders to service_role;\s*commit;$/i);
    assert.doesNotMatch(sql, /grant all|to authenticated|to anon|security definer|disable row level|create policy/i);
  });

  it('reuses the Role repair without granting hard DELETE or browser writes', () => {
    const sql = statements(read('supabase/migrations/20260904010110_role_service_mutation_privileges.sql'));
    assert.match(sql, /^begin;\s*grant insert, update on table public\.roles to service_role;\s*commit;$/i);
  });

  it('keeps the backend-only client and existing Cancel scope/CAS validation', () => {
    assert.match(read('src/plugins/dbContext.ts'), /createClient\(supabaseUrl, supabaseServiceKey/);
    const service = read('src/services/orders.service.ts');
    const cancel = service.slice(service.indexOf('  async cancel('));
    assert.match(cancel, /this\.assertPackingOwner\(actor, order\)/);
    assert.match(cancel, /assertOrderActionAllowed\(currentStatus, 'cancel'\)/);
    assert.match(cancel, /assertCancelReason\(body\?\.cancel_reason\)/);
    // The write moved into transition_order_status (20260925020000) so it can
    // record its revision; the compare-and-set on the status the caller read
    // moved with it.
    assert.match(cancel, /this\.transitionStatus\(actor, order, ORDER_STATUS\.CANCELLED, \{\s*cancelReason,/);
    assert.match(service, /p_expected_status_id: order\.status_id/);
    const rpc = read('supabase/migrations/20260925020000_teams_webhook.sql');
    assert.match(rpc, /v_order\.status_id is distinct from p_expected_status_id then\s+return false;/);
    assert.match(service, /order\.requested_by !== actor\.id/);
    assert.match(service, /order\.to_area_id !== actor\.areaId/);
  });

  it('keeps permission middleware on the exact failing endpoints', () => {
    const orders = read('src/routes/orders/index.ts');
    assert.match(orders, /requirePermission\(PERMISSION_CODE\.SUPPLY_ORDER_CREATE\)/);
    assert.match(orders, /'\/:id\/cancel',\s*\{ preHandler: ownerPermission \}/);
    assert.match(read('src/routes/roles/index.ts'), /PERMISSION_CODE\.ADMIN_ROLE_CREATE/);
  });
});

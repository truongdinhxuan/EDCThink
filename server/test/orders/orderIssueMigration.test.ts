import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/202607290001_lookup_master_data_foundation.sql',
  ),
  'utf8',
);
const orderService = readFileSync(
  resolve(process.cwd(), 'src/services/orders.service.ts'),
  'utf8',
);
// The current authoritative issue_order. Earlier definitions are history.
const stackIssueMigration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260924010200_stack_confirm_issue_flow.sql',
  ),
  'utf8',
);
const orderRoutes = readFileSync(
  resolve(process.cwd(), 'src/routes/orders/index.ts'),
  'utf8',
);
const orderAccess = readFileSync(
  resolve(process.cwd(), 'src/domain/order-access.ts'),
  'utf8',
);

describe('atomic order issue migration', () => {
  it('locks order, item and stock rows before issuing', () => {
    assert.ok((migration.match(/for update/gi) ?? []).length >= 3);
  });

  it('updates balance and writes immutable audit transactions in one function', () => {
    assert.match(migration, /create or replace function public\.issue_order/i);
    assert.match(migration, /update public\.stock_balances/i);
    assert.match(migration, /insert into public\.stock_transactions/i);
    assert.match(migration, /update public\.order_items/i);
    assert.match(migration, /update public\.orders/i);
  });

  it('contains both approved-quantity and stock-quantity guards', () => {
    assert.match(migration, /Cannot issue more than quantity_approved/i);
    assert.match(migration, /Insufficient stock/i);
  });

  it('only issues from an active location in the order source area', () => {
    assert.match(migration, /l\.area_id\s*=\s*v_order\.from_area_id/i);
    assert.match(migration, /l\.is_active\s*=\s*true/i);
    assert.match(migration, /outside the source area/i);
  });

  it('deducts and records stock against the order source area', () => {
    assert.match(
      migration,
      /from public\.stock_balances[\s\S]*area_id\s*=\s*v_order\.from_area_id/i,
    );
    assert.match(
      migration,
      /insert into public\.stock_transactions[\s\S]*v_order\.from_area_id/i,
    );
  });

  it('is executable only by the service role', () => {
    assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/i);
    assert.match(migration, /grant execute[\s\S]*to service_role/i);
  });

  it('keeps direct stock mutation out of create/submit/approve service code', () => {
    assert.doesNotMatch(
      orderService,
      /\.from\(['"]stock_balances['"]\)[\s\S]{0,500}\.(?:insert|update|delete|upsert)\(/,
    );
    assert.doesNotMatch(
      orderService,
      /\.from\(['"]stock_transactions['"]\)[\s\S]{0,120}\.(?:insert|update|delete)\(/,
    );
    assert.equal((orderService.match(/\.rpc\(['"]issue_order['"]/g) ?? []).length, 1);
  });
});

describe('Stack issue ships the confirmed count', () => {
  const issueBody = stackIssueMigration.slice(
    stackIssueMigration.indexOf('create or replace function public.issue_order'),
  );

  it('keeps one authoritative issue_order RPC', () => {
    assert.match(
      issueBody,
      /create or replace function public\.issue_order\(\s*p_order_id uuid,\s*p_actor_id uuid,\s*p_items jsonb/,
    );
    assert.equal((orderService.match(/\.rpc\(['"]issue_order['"]/g) ?? []).length, 1);
  });

  it('resolves KIEN_SAT_TC in PostgreSQL and never treats KIEN_SAT_SPECIAL as Stack', () => {
    assert.match(issueBody, /category\.code = 'KIEN_SAT_TC'/);
    assert.doesNotMatch(issueBody, /'KIEN_SAT_SPECIAL'/);
  });

  it('no longer holds a short or long count back for review', () => {
    // The old rule refused to issue unless the confirmed total equalled the
    // approval. The confirmed count is now what ships, in either direction.
    assert.doesNotMatch(issueBody, /STACK_ISSUE_ALLOCATION_INCOMPLETE/);
    assert.doesNotMatch(issueBody, /STACK_PARTIAL_ISSUE_NOT_SUPPORTED/);
    assert.match(
      issueBody,
      /set quantity_issued = v_allocation\.actual_stack_quantity \* v_order_item\.set_per_qty/,
    );
    assert.match(issueBody, /set status = 'ISSUED'/);
  });

  it('ships in full when the books fall short and opens a recount instead', () => {
    assert.match(issueBody, /v_take_stack := least\(/);
    assert.match(issueBody, /v_shortage_stack := v_allocation\.actual_stack_quantity - v_take_stack/);
    assert.match(issueBody, /'OPEN', 'ISSUE'/);
    // A shortfall must not abort the issue.
    assert.doesNotMatch(issueBody, /STACK_ISSUE_STOCK_CONFLICT/);
  });

  it('closes a stack item on its ISSUED confirmation, not on reaching the approval', () => {
    const statusRule = issueBody.slice(issueBody.indexOf("v_new_status_code := 'PARTIAL_ISSUED'") - 900);
    assert.match(statusRule, /allocation\.status is distinct from 'ISSUED'/);
    assert.match(statusRule, /item\.set_per_qty is null\s+and coalesce\(item\.quantity_issued, 0\) < item\.quantity_approved/);
  });

  it('locks every balance once, in id order, before mutating', () => {
    const lockAt = issueBody.search(/order by balance\.id\s*for update of balance/);
    const firstUpdate = issueBody.indexOf('update public.stock_balances');
    assert.ok(lockAt > 0 && lockAt < firstUpdate);
    assert.match(issueBody, /transaction_type\.code = 'ISSUE'/);
  });

  it('preserves service-role-only execution and structured semantic errors', () => {
    assert.match(issueBody, /revoke all[\s\S]*from public, anon, authenticated/i);
    assert.match(issueBody, /grant execute[\s\S]*to service_role/i);
    for (const code of [
      'STACK_ALLOCATIONS_NOT_CONFIRMED',
      'NORMAL_ISSUE_STOCK_CONFLICT',
      'ORDER_NOT_ISSUABLE',
      'ORDER_ALREADY_ISSUED',
    ]) {
      assert.match(orderService, new RegExp(code));
    }
  });

  it('lets an issue-only custom role read the Order it must issue', () => {
    const readRequirement = orderRoutes.match(
      /const orderReadPermission =[\s\S]*?const orderReviewPermission/,
    )?.[0] ?? '';
    assert.match(readRequirement, /ORDER_READ_PERMISSIONS/);
    assert.match(orderAccess, /SUPPLY_ORDER_ISSUE/);
    assert.doesNotMatch(readRequirement, /role\s*===|DATA_MATERIAL/);
  });
});

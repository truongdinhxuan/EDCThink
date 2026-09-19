import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { orderApproveSchema } from '../../src/schemas/orders';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260909014522_order_pending_approval_contract.sql',
  ),
  'utf8',
);
const removalMigration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260911031203_remove_order_draft_status.sql',
  ),
  'utf8',
);

describe('Order direct-PENDING Phase 1 contract', () => {
  it('historically normalizes unreviewed quantities before final DRAFT removal', () => {
    assert.match(migration, /status_row\.code in \('DRAFT', 'PENDING'\)/);
    assert.match(migration, /set quantity_approved = null/);
    assert.match(migration, /alter column quantity_approved drop default/);
  });

  it('allows zero or quantities above the request while still rejecting negatives', () => {
    assert.match(
      migration,
      /quantity_approved is null\s+or quantity_approved >= 0/,
    );
    assert.doesNotMatch(
      migration,
      /quantity_approved\s*<=\s*quantity_requested/,
    );

    const quantitySchema = orderApproveSchema.body.properties.items.items
      .properties.quantity_approved;
    assert.deepEqual(quantitySchema, { type: 'integer', minimum: 0 });
    assert.equal('maximum' in quantitySchema, false);
    assert.equal('exclusiveMinimum' in quantitySchema, false);
  });

  it('does not introduce a hard-coded status UUID default', () => {
    assert.doesNotMatch(migration, /delete\s+from\s+public\.order_statuses/i);
    assert.doesNotMatch(migration, /update\s+public\.order_statuses/i);
    assert.doesNotMatch(migration, /alter\s+column\s+status_id\s+set\s+default/i);
  });

  it('backfills old DRAFT Orders to CANCELLED before deleting the lookup', () => {
    assert.match(removalMigration, /status_row\.code = 'CANCELLED'/);
    assert.match(removalMigration, /SYSTEM_MIGRATION_REMOVE_DRAFT/);
    assert.match(removalMigration, /update public\.orders/);
    assert.match(removalMigration, /delete from public\.order_statuses/);
    assert.match(removalMigration, /DRAFT_STATUS_REFERENCED_BY_ORDER_REVISIONS/);
  });
});

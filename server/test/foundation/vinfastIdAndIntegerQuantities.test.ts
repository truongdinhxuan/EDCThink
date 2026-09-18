import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  OrderRuleError,
  assertApprovedQuantity,
  assertPositiveQuantity,
} from '../../src/domain/orderRules';
import { orderApproveSchema, orderCreateSchema, orderIssueSchema } from '../../src/schemas/orders';
import { stockAdjustmentCreateSchema } from '../../src/schemas/stock';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

/** FastifySchema types `body` as unknown, so contract tests read it explicitly. */
const schemaProperties = (schema: { body?: unknown }): Record<string, unknown> =>
  (schema.body as { properties: Record<string, unknown> }).properties;
const migration = read(
  'supabase/migrations/20260918010000_vinfast_id_string_and_integer_quantities.sql',
);
const loginController = read('src/controllers/auth/login.ts');
const usersService = read('src/services/users.service.ts');
const stockSearch = read('src/services/stock-search.ts');
const bootstrap = read('src/scripts/bootstrap-admin-password.ts');
// src/schemas/users.ts carries Swagger `tags`, which only type-check once the
// plugin's declaration merging is loaded, so this file reads it as source text.
const userSchemas = read('src/schemas/users.ts');

describe('vinfast_id is text end to end', () => {
  it('migrates the column and the stored procedures that take it', () => {
    assert.match(
      migration,
      /alter table public\.users\s+alter column vinfast_id type text using vinfast_id::text/,
    );
    // The integer type used to make a blank impossible; text needs the guard.
    assert.match(migration, /users_vinfast_id_not_blank check \(btrim\(vinfast_id\) <> ''\)/);
    for (const routine of ['create_internal_user_with_roles', 'create_internal_user']) {
      assert.ok(
        migration.includes(`drop function if exists public.${routine}(`),
        `${routine} must be dropped before it can change a parameter type`,
      );
      const definition = migration.slice(
        migration.indexOf(`create function public.${routine}(`),
      );
      assert.match(definition.slice(0, 600), /p_vinfast_id text/);
    }
    // A DROP discards the old grants, so they have to be restored.
    assert.match(migration, /grant execute on function public\.create_internal_user/);
  });

  it('types the request schemas as a bounded non-empty string', () => {
    const declarations = userSchemas.match(/vinfast_id: \{[^}]*\}/g) ?? [];
    assert.equal(declarations.length, 2, 'login and create/update both declare it');
    for (const declaration of declarations) {
      assert.equal(
        declaration,
        "vinfast_id: { type: 'string', minLength: 1, maxLength: 50 }",
      );
    }
  });

  it('rejects a non-string or blank login before touching the database', () => {
    assert.match(
      loginController,
      /typeof vinfast_id !== 'string' \|\| !vinfast_id\.trim\(\) \|\| !password/,
    );
  });

  it('searches vinfast_id as text instead of casting it to a number', () => {
    // Number('00123') is 123, which never matches a stored '00123'.
    assert.doesNotMatch(usersService, /vinfast_id\.eq\.\$\{Number\(/);
    assert.doesNotMatch(stockSearch, /vinfast_id\.eq\.\$\{Number\(/);
    assert.match(usersService, /vinfast_id\.ilike\./);
    assert.match(stockSearch, /vinfast_id\.ilike\./);
  });

  it('reads the bootstrap admin id as text', () => {
    assert.doesNotMatch(bootstrap, /Number\(\s*requiredEnvironment\('BOOTSTRAP_ADMIN_VINFAST_ID'/);
    assert.match(bootstrap, /BOOTSTRAP_ADMIN_VINFAST_ID'\)\.trim\(\)/);
  });
});

describe('Supply quantities are whole numbers', () => {
  it('constrains every quantity column in the database', () => {
    const columns: Array<[string, string[]]> = [
      ['order_items', [
        'quantity_requested', 'quantity_approved', 'quantity_issued',
        'set_per_qty', 'requested_stack_quantity',
      ]],
      ['order_item_allocations', ['expected_stack_quantity', 'actual_stack_quantity']],
      ['stock_balances', ['quantity', 'stack_quantity']],
      ['stock_transactions', ['quantity', 'before_quantity', 'after_quantity']],
    ];
    const constraintName: Record<string, string> = {
      // The allocation constraints drop the redundant "_quantity" from the name.
      'order_item_allocations.expected_stack_quantity': 'order_item_allocations_expected_stack_integer',
      'order_item_allocations.actual_stack_quantity': 'order_item_allocations_actual_stack_integer',
    };
    for (const [table, fields] of columns) {
      for (const field of fields) {
        const name = constraintName[`${table}.${field}`] ?? `${table}_${field}_integer`;
        const index = migration.indexOf(`add constraint ${name}`);
        assert.notEqual(index, -1, `${table}.${field} is missing its constraint`);
        assert.ok(
          migration.slice(index, index + 250).includes(`= trunc(${field})`),
          `${name} must compare the column against trunc()`,
        );
      }
    }
  });

  it('changes types and rules only, without touching business data', () => {
    // A migration that silently deleted rows would be far harder to review than
    // one constraint left NOT VALID, so this is a hard contract.
    assert.doesNotMatch(migration, /delete\s+from/i);
    assert.doesNotMatch(migration, /truncate/i);
    // The only UPDATE allowed is the column rewrite the type change implies.
    assert.doesNotMatch(migration, /update\s+public\.(orders|order_items|stock_)/i);
    // The two historical 0.000001 approvals predate the rule, so that one
    // constraint is deferred rather than blocking the migration.
    const index = migration.indexOf('add constraint order_items_quantity_approved_integer');
    assert.notEqual(index, -1);
    assert.match(migration.slice(index, index + 250), /not valid/);
  });

  it('types every quantity in the request schemas as an integer', () => {
    const orderItem = orderCreateSchema.body.properties.order_list.items
      .properties as Record<string, unknown>;
    for (const field of [
      'quantity_requested', 'set_per_qty',
      'requested_stack_quantity', 'requested_total_set_quantity',
    ]) {
      assert.deepEqual(orderItem[field], { type: 'integer', minimum: 1 }, field);
    }
    assert.deepEqual(
      orderApproveSchema.body.properties.items.items.properties.quantity_approved,
      { type: 'integer', minimum: 0 },
    );
    assert.deepEqual(
      orderIssueSchema.body.properties.items.items.properties.issues.items
        .properties.quantity,
      { type: 'integer', minimum: 1 },
    );
    const adjustment = schemaProperties(stockAdjustmentCreateSchema);
    for (const field of ['quantity', 'stack_quantity', 'set_per_qty']) {
      assert.deepEqual(adjustment[field], { type: 'integer', minimum: 1 }, field);
    }
  });

  it('refuses a fraction in the rule layer even when the schema was bypassed', () => {
    for (const fraction of [0.5, 1.5, 0.000001]) {
      assert.throws(
        () => assertPositiveQuantity(fraction, 'quantity_requested'),
        (error: unknown) => error instanceof OrderRuleError
          && /số nguyên/.test((error as OrderRuleError).message),
        `${fraction} should not be accepted`,
      );
      assert.throws(
        () => assertApprovedQuantity(fraction, 10),
        (error: unknown) => error instanceof OrderRuleError
          && /số nguyên/.test((error as OrderRuleError).message),
        `${fraction} should not be approved`,
      );
    }
    assert.equal(assertPositiveQuantity(3, 'quantity_requested'), 3);
    assert.equal(assertApprovedQuantity(0, 10), 0);
  });
});

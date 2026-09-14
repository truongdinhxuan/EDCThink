import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260911193601_area_type_scope_foundation.sql',
  ),
  'utf8',
);

describe('Area Type and role data-scope foundation', () => {
  it('creates the shared Area Type master and role scope mapping', () => {
    assert.match(migration, /create table public\.area_types\s*\(/i);
    assert.match(migration, /create table public\.role_area_type_scopes\s*\(/i);

    for (const field of [
      'id uuid primary key',
      'code text not null',
      'name text not null',
      'description text',
      'is_active boolean not null',
      'is_deleted boolean not null',
      'created_at timestamptz not null',
      'updated_at timestamptz not null',
    ]) {
      assert.ok(migration.includes(field), `${field} must be present`);
    }

    assert.match(
      migration,
      /constraint role_area_type_scopes_role_area_type_key[\s\S]*?unique \(role_id, area_type_id\)/i,
    );
  });

  it('adds a nullable Area foreign key and the required lookup indexes', () => {
    assert.match(
      migration,
      /alter table public\.areas\s+add column area_type_id uuid;/i,
    );
    assert.doesNotMatch(
      migration,
      /alter table public\.areas[\s\S]{0,80}add column area_type_id uuid not null/i,
    );
    assert.doesNotMatch(
      migration,
      /alter (?:column )?area_type_id[\s\S]{0,40}set not null/i,
    );

    for (const constraint of [
      'role_area_type_scopes_role_id_fkey',
      'role_area_type_scopes_area_type_id_fkey',
      'areas_area_type_id_fkey',
    ]) {
      assert.match(migration, new RegExp(`constraint ${constraint}`, 'i'));
    }

    for (const index of [
      'areas_area_type_id_idx',
      'role_area_type_scopes_area_type_id_idx',
    ]) {
      assert.match(migration, new RegExp(`create index ${index}`, 'i'));
    }
  });

  it('seeds only the three approved Area Types and confirmed Area mappings', () => {
    for (const seed of [
      "('PACKING', 'Đóng gói'",
      "('LOGISTICS', 'Logistics'",
      "('SHOP', 'Shop'",
    ]) {
      assert.ok(migration.includes(seed), `${seed} must be seeded`);
    }

    assert.match(
      migration,
      /area\.code in \('DG_HATINH', 'DG_INDIA', 'DG_INDO'\)/i,
    );
    assert.match(migration, /area\.code = 'EDC_LOGISTICS'/i);
    assert.doesNotMatch(migration, /area\.code\s*(?:=|in)\s*\(?\s*'VTDG'/i);
  });

  it('creates the Shift Order Sheet read permission without an Area-filter permission', () => {
    assert.match(migration, /'supply\.shift_order_sheet\.read'/i);
    assert.doesNotMatch(
      migration,
      /'(?:can_use_area_filter|supply\.filter\.area|view_area_filter)'/i,
    );
    assert.match(
      migration,
      /role\.code = 'ADMIN'[\s\S]*?role\.is_system = true/i,
    );
    assert.doesNotMatch(migration, /'DATA_(?:MATERIAL|PACKING)'/i);
  });

  it('keeps the new scope tables backend-only with RLS enabled', () => {
    for (const table of ['area_types', 'role_area_type_scopes']) {
      assert.match(
        migration,
        new RegExp(`alter table public\\.${table} enable row level security`, 'i'),
      );
      assert.match(
        migration,
        new RegExp(`revoke all on table public\\.${table}[\\s\\S]*?from public, anon, authenticated, service_role`, 'i'),
      );
    }

    assert.match(
      migration,
      /grant select on table public\.area_types to service_role/i,
    );
    assert.match(
      migration,
      /grant select, insert, update, delete on table public\.role_area_type_scopes[\s\S]*?to service_role/i,
    );
  });

  it('does not add an Order shift column or a per-user Area assignment layer', () => {
    assert.doesNotMatch(migration, /alter table public\.orders/i);
    assert.doesNotMatch(migration, /orders\.work_shift_id/i);
    assert.doesNotMatch(migration, /create table public\.user_area/i);
    assert.doesNotMatch(migration, /create type\s+/i);
  });
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const migratedPages = [
  'src/pages/catalog/SuppliesPage.tsx',
  'src/pages/catalog/SupplyCategoriesPage.tsx',
  'src/pages/catalog/ProvidersPage.tsx',
  'src/pages/catalog/StorageLocationsPage.tsx',
  'src/pages/management/AreasPage.tsx',
  'src/pages/management/UsersPage.tsx',
  'src/pages/management/RolesPage.tsx',
  'src/pages/stock/StockBalancesPage.tsx',
  'src/pages/stock/StockTransactionsPage.tsx',
];

describe('Phase 7 remaining-page Filter Rail rollout', () => {
  it('uses the one shared rail and disables duplicate DataTable search on every migrated page', () => {
    for (const path of migratedPages) {
      const source = read(path);
      assert.match(source, /PageFilterLayout/ , path);
      assert.match(source, /<PageFilterRail/ , path);
      assert.match(source, /<FilterField label="Tìm kiếm">/ , path);
      assert.match(source, /hideInternalSearch/ , path);
      assert.doesNotMatch(source, /renderTopToolbar/ , path);
      assert.doesNotMatch(source, /searchPlaceholder=/ , path);
    }
  });

  it('keeps actions outside the filter-only rail', () => {
    for (const path of migratedPages) {
      const source = read(path);
      const rail = source.slice(source.indexOf('<PageFilterRail'), source.indexOf('</PageFilterRail>'));
      assert.doesNotMatch(rail, /CrudPageHeader|PrimaryCrudDrawer|StockAdjustmentModal|RowActions/ , path);
    }
  });

  it('keeps page-owned server query, 400ms debounce, pagination and sorting', () => {
    for (const path of migratedPages) {
      const source = read(path);
      assert.match(source, /usePaginatedResource/ , path);
      assert.match(source, /useDebounce\([^\n]+, 400\)/ , path);
      assert.match(source, /pagination=\{resource\.pagination\}/ , path);
      assert.match(source, /onPageChange=\{resource\.setPage\}/ , path);
      assert.match(source, /onPageSizeChange=\{resource\.setPageSize\}/ , path);
      assert.match(source, /sortBy=\{resource\.query\.sortBy\}/ , path);
    }
  });

  it('resets only filters while leaving page size and sort untouched', () => {
    for (const path of migratedPages) {
      const source = read(path);
      const resetStart = source.indexOf('const resetFilters');
      const resetEnd = source.indexOf('\n  };', resetStart);
      const reset = source.slice(resetStart, resetEnd);
      assert.ok(resetStart >= 0, path);
      assert.doesNotMatch(reset, /pageSize|sortBy|sortOrder/ , path);
    }
  });

  it('preserves stock server filters and keeps Area scope out of stock pages', () => {
    const balances = read('src/pages/stock/StockBalancesPage.tsx');
    const transactions = read('src/pages/stock/StockTransactionsPage.tsx');
    for (const source of [balances, transactions]) {
      assert.match(source, /supplyId/);
      assert.match(source, /providerId/);
      assert.match(source, /areaId/);
      assert.match(source, /storageLocationId/);
      assert.doesNotMatch(source, /getMyAreaScopes|me\/area-scopes/);
      assert.doesNotMatch(source, /queryClient\.clear|window\.location\.reload/);
    }
    assert.match(transactions, /dateFrom/);
    assert.match(transactions, /dateTo/);
    assert.match(transactions, /createdBy/);
  });

  it('does not migrate excluded Milkrun pages in this rollout', () => {
    for (const path of [
      'src/pages/milkrun/RacksPage.tsx',
      'src/pages/milkrun/ShopsPage.tsx',
      'src/pages/milkrun/TripsListPage.tsx',
      'src/pages/milkrun/VehiclesPage.tsx',
    ]) {
      assert.doesNotMatch(read(path), /PageFilterLayout|PageFilterRail/ , path);
    }
  });
});

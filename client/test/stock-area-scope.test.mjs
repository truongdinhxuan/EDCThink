import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const walk = (dir) => readdirSync(dir).flatMap((entry) => {
  const full = join(dir, entry);
  return statSync(full).isDirectory() ? walk(full)
    : /\.tsx?$/.test(entry) ? [full] : [];
});

/**
 * Stock screens must offer only the Areas the backend would actually return.
 * Offering more is not a leak — the server filters the rows — but it is a filter
 * that silently yields nothing, which reads as a broken page.
 */
describe('Stock screens follow the server Area scope', () => {
  it('reads Areas through the scope hook, never the full Area list', () => {
    for (const path of [
      'src/pages/stock/StockBalancesPage.tsx',
      'src/pages/stock/StockTransactionsPage.tsx',
      'src/components/stock/StockAdjustmentForm.tsx',
    ]) {
      const source = read(path);
      assert.match(source, /useStockAreaScopes\(\)/, path);
      assert.doesNotMatch(source, /useAreaLookup/, path);
    }
  });

  it('keeps one owner for the scope query key', () => {
    const owners = walk('src')
      .filter((path) => read(path).includes('queryKeys.meStockAreaScopes'))
      .map((path) => path.split(sep).join('/'));
    assert.deepEqual(owners, ['src/hooks/useStockAreaScopes.ts']);
  });

  it('offers only the writable Area for adjustments', () => {
    const form = read('src/components/stock/StockAdjustmentForm.tsx');
    assert.match(form, /writableAreaId/);
    assert.match(form, /writableAreas\.map/);
    // Anything else would let the drawer propose an Area the POST will refuse.
    assert.doesNotMatch(form, /scopedAreas\.map/);
  });

  it('labels the filter as the permitted Areas, not all Areas', () => {
    for (const path of [
      'src/pages/stock/StockBalancesPage.tsx',
      'src/pages/stock/StockTransactionsPage.tsx',
    ]) {
      const source = read(path);
      assert.match(source, /Tất cả khu vực được phép/, path);
    }
  });
});

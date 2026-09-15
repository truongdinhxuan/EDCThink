import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { APP_NAME, formatDocumentTitle } from '../src/constants/documentTitle.ts';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const hook = read('src/hooks/useDocumentTitle.ts');
const indexHtml = read('index.html');

/**
 * Pages the router can actually reach, taken from the route files themselves so
 * a newly routed page is covered without touching this test. Unreferenced files
 * under src/pages are dead code and deliberately out of scope.
 */
const routedPageFiles = () => {
  const routeSources = [
    'src/routes/index.tsx',
    'src/routes/workspace.routes.tsx',
    'src/routes/auth.routes.tsx',
  ]
    .map(read)
    .join('\n')
    .split('\n')
    // Drop commented-out legacy routes; they reach nothing.
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');

  const paths = new Set();
  for (const [, specifier] of routeSources.matchAll(/["'](\.\.\/pages\/[^"']+)["']/g)) {
    paths.add(`src/${specifier.replace('../', '')}.tsx`);
  }
  return [...paths].sort();
};

describe('document title', () => {
  it('suffixes the page with the product name', () => {
    assert.equal(APP_NAME, 'EDCThink');
    assert.equal(formatDocumentTitle('Phiếu order ca'), 'Phiếu order ca · EDCThink');
    assert.equal(formatDocumentTitle('  Tổng quan  '), 'Tổng quan · EDCThink');
  });

  it('falls back to the product name alone while a title is unknown', () => {
    // Detail pages pass undefined until their record loads; the tab must not
    // flash a placeholder that is about to be replaced.
    for (const empty of [undefined, null, '', '   ']) {
      assert.equal(formatDocumentTitle(empty), 'EDCThink');
    }
  });

  it('hands the title back when the page unmounts', () => {
    // Routes are lazy: the old page unmounts before the new one resolves, so
    // without the restore the tab would keep advertising a page already left.
    assert.match(hook, /const previousTitle = document\.title/);
    assert.match(hook, /return \(\) => \{\s*document\.title = previousTitle;/);
    assert.match(hook, /\}, \[title\]\);/);
  });

  it('ships the product name as the pre-hydration title', () => {
    assert.match(indexHtml, /<title>EDCThink<\/title>/);
    assert.doesNotMatch(indexHtml, /<title>client<\/title>/);
  });

  it('gives every routed page a title', () => {
    const routed = routedPageFiles();
    assert.ok(routed.length >= 18, `expected the router to reach more pages, got ${routed.length}`);

    const missing = routed.filter((file) => !read(file).includes('useDocumentTitle('));
    assert.deepEqual(
      missing,
      [],
      `routed pages without a browser tab title: ${missing.join(', ')}`,
    );
  });

  it('calls the hook before any early return in the detail pages', () => {
    // These pages return early while loading; the hook has to run first or the
    // hook order changes between renders.
    for (const file of [
      'src/pages/orders/OrderDetailPage.tsx',
      'src/pages/orders/ShiftOrderSheetDetailPage.tsx',
    ]) {
      const source = read(file);
      const hookAt = source.indexOf('useDocumentTitle(');
      const firstReturn = source.search(/\n\s{2}if \([^)]*\)\s*return|\n\s{2}if \([\s\S]{0,80}?\)\s*\{\s*\n\s{4}return/);
      assert.ok(hookAt > -1, `${file} must set a title`);
      assert.ok(
        firstReturn === -1 || hookAt < firstReturn,
        `${file} must call useDocumentTitle before its first early return`,
      );
    }
  });
});

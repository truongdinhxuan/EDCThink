import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const walk = (dir) => readdirSync(dir).flatMap((entry) => {
  const full = join(dir, entry);
  return statSync(full).isDirectory()
    ? walk(full)
    : /\.tsx?$/.test(entry) ? [full] : [];
});

const SOURCES = walk('src');

/**
 * React Query stores one value per key. Two callers that share a key must agree
 * on what they store, or whichever resolves last decides the shape and the other
 * crashes reading it — which is exactly how StockBalancesPage died on
 * `areas.items.map is not a function`.
 */
describe('Shared query keys have a single owner', () => {
  it('reads the active Area list through one hook only', () => {
    const owners = SOURCES.filter((path) => read(path).includes('queryKeys.areas.lookup'));
    assert.deepEqual(
      owners.map((path) => path.split(sep).join('/')),
      ['src/hooks/useAreaLookup.ts'],
      'every screen must go through useAreaLookup',
    );
  });

  it('leaves no page-local copy of the Area loader behind', () => {
    const copies = SOURCES
      .filter((path) => read(path).includes('const loadAreas'))
      .map((path) => path.split(sep).join('/'));
    assert.deepEqual(copies, ['src/hooks/useAreaLookup.ts']);
  });

  it('keeps the two lookup hooks on their own conventions', () => {
    // useCrudResource stores the unwrapped array; useServerLookup stores the
    // paginated envelope. Mixing them on one key is the bug above.
    assert.match(read('src/hooks/useCrudResource.ts'), /items: Array\.isArray\(data\)/);
    assert.match(read('src/hooks/useServerLookup.ts'), /items: lookupQuery\.data\?\.data \?\? \[\]/);
  });

  it('degrades a mismatched cache entry to an empty list, loudly', () => {
    // The guard alone would turn the crash into a table that is silently empty,
    // which hides the defect instead of fixing it. The log is the other half.
    const hook = read('src/hooks/useCrudResource.ts');
    assert.match(hook, /const malformed = data !== undefined && !Array\.isArray\(data\)/);
    assert.match(hook, /console\.error\(/);
  });
});

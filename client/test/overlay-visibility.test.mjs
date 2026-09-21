import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const walk = (dir) => readdirSync(dir).flatMap((entry) => {
  const full = join(dir, entry);
  return statSync(full).isDirectory()
    ? walk(full)
    : /\.tsx?$/.test(entry) ? [full] : [];
});

const css = read('src/index.css');
const SOURCES = walk('src').map(read);

/**
 * Full-screen backdrops are portaled unconditionally and hidden by CSS, so a
 * missing class name does not fail the build, fail a type-check or throw — it
 * silently paints a dimmed, blurred sheet over every page. That is exactly what
 * happened to the filter rail: `.filter-rail-backdrop` was written in index.css
 * and never put on the element.
 */
describe('State-driven overlays keep their CSS hook', () => {
  const overlayClasses = [...css.matchAll(/^\.([a-z-]+)\[data-open="true"\]/gm)]
    .map((match) => match[1]);

  it('declares at least the two mobile backdrops', () => {
    assert.deepEqual(
      [...overlayClasses].sort(),
      ['filter-rail-backdrop', 'filter-rail-panel', 'workspace-sidebar-backdrop'],
    );
  });

  it('gives every [data-open] rule an element that actually uses it', () => {
    for (const className of overlayClasses) {
      const users = SOURCES.filter((source) => source.includes(className));
      assert.ok(
        users.length > 0,
        `${className} is styled in index.css but no component applies it`,
      );
      // The class and the attribute it keys off must sit on the same element,
      // in whichever order the props happen to be written.
      for (const source of users) {
        const at = source.indexOf(className);
        const element = source.slice(Math.max(0, at - 600), at + 600);
        assert.match(
          element,
          /data-open=/,
          `${className} is applied without the data-open attribute it needs`,
        );
      }
    }
  });

  it('hides each backdrop by default rather than only on close', () => {
    for (const className of overlayClasses) {
      const block = css.slice(
        css.indexOf(`.${className} {`),
        css.indexOf(`.${className}[data-open="true"]`),
      );
      assert.match(block, /visibility:\s*hidden/, `${className} must start hidden`);
      assert.match(block, /pointer-events:\s*none/, `${className} must not catch taps`);
    }
  });
});

/**
 * The skeleton stands in for the table while it loads, so any difference in cell
 * padding or min-width shows up as the rows jumping shorter the moment the data
 * arrives. They have to be changed together.
 */
describe('Table density stays in step with its skeleton', () => {
  const table = read('src/components/common/DataTable.tsx');
  const skeleton = read('src/components/common/skeleton/TableSkeleton.tsx');

  it('uses one cell padding in both', () => {
    for (const source of [table, skeleton]) {
      assert.match(source, /<th[^>]*className="px-3\.5 py-2\.5/);
      assert.match(source, /<td[^>]*className="px-3\.5 py-2\.5/);
    }
  });

  it('uses one horizontal floor in both', () => {
    // Read off the <table> tag itself, and compared rather than pinned to one
    // spelling: min-w-175 and min-w-[700px] are the same width, so asserting the
    // text would fail on a rewrite that changed nothing.
    const widths = (source) => {
      const tag = source.match(/<table className="[^"]*"/)?.[0] ?? '';
      return (tag.match(/(?:lg:)?min-w-[^\s"]+/g) ?? []).sort();
    };
    assert.ok(widths(table).length >= 2, 'expected a base and an lg: min-width');
    assert.deepEqual(widths(skeleton), widths(table));
  });
});

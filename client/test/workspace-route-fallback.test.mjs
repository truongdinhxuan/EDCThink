import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const routes = readFileSync(
  new URL('../src/routes/workspace.routes.tsx', import.meta.url),
  'utf8',
);
const appRoutes = readFileSync(
  new URL('../src/routes/index.tsx', import.meta.url),
  'utf8',
);

describe('workspace unknown-route fallback', () => {
  it('redirects unknown workspace paths to the 404 page', () => {
    assert.match(
      routes,
      /path:\s*['"]\*['"][\s\S]*?<Navigate\s+to=['"]\/404['"]\s+replace\s*\/>/,
    );
    assert.doesNotMatch(
      routes,
      /path:\s*['"]\*['"][\s\S]*?<Navigate\s+to=['"]dashboard['"]\s+replace\s*\/>/,
    );
  });

  it('registers the 404 page and redirects every unknown app path to it', () => {
    assert.match(
      appRoutes,
      /path:\s*['"]\/404['"]\s*,\s*element:\s*<NotFoundPage\s*\/>/,
    );
    assert.match(
      appRoutes,
      /path:\s*['"]\*['"]\s*,\s*element:\s*<Navigate\s+to=['"]\/404['"]\s+replace\s*\/>/,
    );
  });
});

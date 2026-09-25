import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

const sourceFiles = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return sourceFiles(path);
  return /\.(tsx?|css|html)$/.test(name) ? [path] : [];
});

const files = [...sourceFiles(resolve(process.cwd(), 'src')), resolve(process.cwd(), 'index.html')];

describe('icons never depend on a CDN icon font', () => {
  // Hugeicons mapped every glyph to a real CJK codepoint (U+3400-4DBF), so
  // whenever its CDN font had not loaded, icons rendered as Chinese characters.
  it('uses no Hugeicons class or stylesheet', () => {
    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /className="[^"]*\bhgi-|cdn\.hugeicons\.com/.test(source);
    });
    assert.deepEqual(offenders, []);
  });

  it('draws the notification toast icons with bundled SVGs', () => {
    const toast = readFileSync(resolve(process.cwd(), 'src/components/notifications/LiveNotificationToast.tsx'), 'utf8');
    assert.match(toast, /icon=\{faBell\}/);
    assert.match(toast, /icon=\{faXmark\}/);
    assert.doesNotMatch(toast, /<i className=/);
  });
});

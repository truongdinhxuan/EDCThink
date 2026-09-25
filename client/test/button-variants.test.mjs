import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
// Comments are dropped so a remark about a class is not mistaken for its use.
const button = read('src/components/common/Button.tsx')
  .replace(/\r\n/g, '\n')
  .replace(/^\s*\/\/.*$/gm, '');
const confirmation = read('src/components/offcanvas/ConfirmOffcanvas.tsx');
const offcanvas = read('src/components/offcanvas/Offcanvas.tsx');
const css = read('src/index.css');

const variantBody = (name) =>
  button.match(new RegExp(`\\n  ${name}:\\s*([\\s\\S]*?),\\n  \\w+:`))?.[1] ?? '';

describe('button variants', () => {
  it('draws every action and status change as Solid', () => {
    assert.match(button, /const solidClassName =[\s\S]*?bg-stone-800[\s\S]*?hover:bg-stone-700/);
    for (const variant of ['info', 'success', 'violet', 'cyan']) {
      assert.equal(variantBody(variant).trim(), 'solidClassName', variant);
    }
  });

  it('keeps reject/delete red and warnings amber', () => {
    assert.match(variantBody('error'), /from-rose-500 to-rose-600/);
    assert.match(variantBody('textError'), /text-rose-600/);
    assert.match(variantBody('warning'), /from-amber-500 to-amber-600/);
  });

  it('keeps cancel as Outline only', () => {
    const outline = variantBody('secondary');
    assert.match(outline, /border-stone-500 bg-transparent/);
    assert.doesNotMatch(outline, /bg-stone-800 |bg-gradient|after:/);
    assert.doesNotMatch(outline, /hover:opacity/);
  });

  it('keeps a visible keyboard focus ring on every variant', () => {
    assert.match(button, /focus-visible:ring-2 focus-visible:ring-offset-2/);
    assert.doesNotMatch(button, /focus:shadow-none/);
  });
});

describe('warning confirmations pop up as a card', () => {
  it('uses the card presentation for warnings and keeps the drawer for the rest', () => {
    assert.match(confirmation, /presentation=\{isWarning \? 'card' : 'drawer'\}/);
    assert.match(confirmation, /warning: WarningButton/);
    assert.match(offcanvas, /confirm-card fixed left-1\/2 top-1\/2/);
  });

  it('centres and animates the card in CSS, honouring reduced motion', () => {
    assert.match(css, /\.confirm-card\[data-state="open"\][\s\S]*?translate3d\(-50%, -50%, 0\) scale\(1\)/);
    assert.match(css, /prefers-reduced-motion:[\s\S]*?\.confirm-card/);
  });
});

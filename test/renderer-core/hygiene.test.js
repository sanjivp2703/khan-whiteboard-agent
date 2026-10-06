// Source hygiene for player/renderer/core (brief 02 criteria 11 and 13): no literal colors,
// no canvas text measurement, no DOM/SVG insertion; every file parses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = new URL('../../player/renderer/core/', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

test('core renderer has the expected files and each one passes node --check', () => {
  assert.ok(files.includes('index.js'));
  assert.ok(readdirSync(dir).includes('core.css'));
  for (const f of files) execFileSync(process.execPath, ['--check', join(dir, f)], { stdio: 'pipe' });
});

test('criterion 11: no literal hex colors outside comments; colors come from tokens.js by name', () => {
  for (const f of files) {
    const code = stripComments(readFileSync(join(dir, f), 'utf8'));
    const hits = code.match(/#[0-9a-fA-F]{3,6}\b/g) || [];
    assert.deepEqual(hits, [], `${f} hard-codes colors: ${hits.join(', ')}`);
    assert.ok(!/\b(rgb|hsl)a?\(/.test(code), `${f} uses literal rgb()/hsl()`);
  }
  const css = stripComments(readFileSync(join(dir, 'core.css'), 'utf8'));
  assert.deepEqual(css.match(/#[0-9a-fA-F]{3,6}\b/g) || [], [], 'core.css hard-codes colors');
});

test('criterion 13: no measureText, innerHTML, DOMParser, document.createElement or SVG insertion in the core renderer', () => {
  for (const f of files) {
    const code = stripComments(readFileSync(join(dir, f), 'utf8'));
    for (const banned of ['measureText', 'innerHTML', 'DOMParser', 'createElementNS', 'document\\.createElement', 'document\\.body', 'appendChild', 'insertAdjacentHTML', 'eval\\(', 'new Function']) {
      assert.ok(!new RegExp(`(^|[^\\w])${banned}(?![\\w])`).test(code), `${f} contains ${banned}`);
    }
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { texToSvg, checkMathCaps, bannedMacro, normalizeSvg, findEqX, MathError, ready } from '../../shared/math.js';

const rejects = async (lines, re) => {
  await assert.rejects(() => texToSvg(lines), (e) => e instanceof MathError && e.code === 'BAD_MATH' && (!re || re.test(e.message)), `expected rejection: ${lines}`);
};

test('compiles valid lines deterministically with eqX for lines containing =', async () => {
  await ready();
  const lines = ['E = mc^2', 'a^2 + b^2 = c^2', '\\int_0^1 x^2 \\, dx = \\frac{1}{3}', '\\sum_{i=1}^{n} i', 'f(x) = \\sqrt{x} + \\alpha', 'x_{n+1} = x_n - \\frac{f(x_n)}{f\'(x_n)}'];
  const a = await texToSvg(lines);
  const b = await texToSvg(lines);
  assert.deepEqual(a, b);
  assert.equal(a.length, lines.length);
  a.forEach((r, i) => {
    assert.match(r.svg, /^<svg /);
    assert.ok(r.width > 0 && r.height > 0);
    if (lines[i].includes('=')) assert.ok(r.eqX !== null && r.eqX > 0 && r.eqX < r.width, `eqX for ${lines[i]}: ${r.eqX}`);
  });
  // '\sum' line has = only in a subscript: still non-null (fallback) but a top-level '=' is preferred when present
  assert.ok(a[3].eqX !== null);
  // the same '=' position for the same prefix
  const [p, q] = await texToSvg(['x = 1', 'x = 123456']);
  assert.ok(Math.abs(p.eqX - q.eqX) < 1e-9);
  // no '=' → null
  const [none] = await texToSvg(['\\alpha + \\beta']);
  assert.equal(none.eqX, null);
  // fontCache none → inline paths, no <use>
  assert.equal(/<use /.test(a[0].svg), false);
  assert.match(a[0].svg, /data-c="3D"/);
});

test('rejects each banned macro before compiling', async () => {
  for (const line of ['\\def\\x{1} x', '\\href{http://x}{y}', '\\input{x}', '\\newcommand{\\a}{b}', '\\renewcommand{\\a}{b}', '\\let\\a\\b', '\\include{x}', '\\url{x}', '\\require{html}', '\\unicode{x41}', '\\usepackage{x}', '\\includegraphics{x}']) {
    await rejects([line], /not allowed/);
    assert.notEqual(bannedMacro(line), null);
  }
  assert.equal(bannedMacro('\\frac{1}{2}'), null);
  assert.equal(bannedMacro('\\define'), null); // only exact macro names
});

test('compile errors are BAD_MATH', async () => {
  await rejects(['a{'], /does not compile/);
  await rejects(['\\frac{1}'], /does not compile/);
  await rejects(['\\notamacro'], /does not compile/);
  await rejects(['\\color{red}{x}'], /does not compile/); // autoload disabled
  await rejects([42]);
});

test('caps: 61 chars, 6 lines, 0 lines, empty line', () => {
  assert.deepEqual(checkMathCaps(['x = 1']), []);
  assert.equal(checkMathCaps(['x'.repeat(60)]).length, 0);
  assert.equal(checkMathCaps(['x'.repeat(61)])[0].code, 'CAP_CHARS');
  assert.equal(checkMathCaps(Array(6).fill('x'))[0].code, 'CAP_LINES');
  assert.equal(checkMathCaps(Array(5).fill('x')).length, 0);
  assert.equal(checkMathCaps([])[0].code, 'CAP_LINES');
  assert.equal(checkMathCaps(['  '])[0].code, 'BAD_FIELD');
  assert.equal(checkMathCaps(['\\def x'])[0].code, 'BAD_MATH');
  assert.equal(checkMathCaps('x')[0].code, 'BAD_FIELD');
});

test('normalizeSvg sorts attributes and strips inter-tag whitespace; findEqX walks transforms', () => {
  assert.equal(normalizeSvg('<svg b="2" a="1">\n  <g c="3"></g>\n</svg>'), '<svg a="1" b="2"><g c="3"></g></svg>');
  const svg = '<svg viewBox="0 0 100 10"><g transform="scale(1,-1)"><g transform="translate(100,0)"><path data-c="3D" d="M0 0 L20 0 L20 2 L0 2 Z"></path></g></g></svg>';
  assert.equal(findEqX(svg), 110);
  assert.equal(findEqX('<svg><path d="M0 0"/></svg>'), null);
});

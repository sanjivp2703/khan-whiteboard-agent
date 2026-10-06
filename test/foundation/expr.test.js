import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, evaluate, sample, check, tokenize, ExprError } from '../../shared/expr.js';

const ev = (src, x = 0) => evaluate(parse(src), x);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('parse/evaluate table: precedence, unary minus, right-assoc ^, functions, constants', () => {
  close(ev('1 + 2 * 3'), 7);
  close(ev('(1 + 2) * 3'), 9);
  close(ev('2 ^ 3 ^ 2'), 512); // right associative
  close(ev('-2 ^ 2'), -4); // unary binds looser than ^
  close(ev('(-2) ^ 2'), 4);
  close(ev('2 ^ -1'), 0.5);
  close(ev('--3'), 3);
  close(ev('10 / 4'), 2.5);
  close(ev('7 - 2 - 1'), 4); // left associative
  close(ev('x * x', 3), 9);
  close(ev('sin(0)'), 0);
  close(ev('cos(0)'), 1);
  close(ev('tan(0)'), 0);
  close(ev('exp(0)'), 1);
  close(ev('ln(e)'), 1);
  close(ev('log(1000)'), 3);
  close(ev('sqrt(16)'), 4);
  close(ev('abs(-5)'), 5);
  close(ev('floor(2.7)'), 2);
  close(ev('ceil(2.1)'), 3);
  close(ev('min(2, 5)'), 2);
  close(ev('max(2, 5)'), 5);
  close(ev('pi'), Math.PI);
  close(ev('2*pi*x', 1), 2 * Math.PI);
  close(ev('1.5e2'), 150);
  close(ev('.5 + 0.5'), 1);
});

test('rejects identifiers other than x, member access, semicolons, strings, brackets, implicit multiplication', () => {
  const bad = ['y', 'x; process.exit()', 'constructor.constructor("return 1")()', '__proto__', 'x.toString', 'x["a"]', '"abc"', '[1]', '{x}',
    '2x', 'x x', 'x +', '+', '()', 'sin', 'sin()', 'sin(1, 2)', 'min(1)', 'x = 1', 'x & 1', 'x!', 'Math.PI', 'this', 'eval(x)', 'Function', 'x,1', 'x..1', 'x..', ''];
  for (const src of bad) {
    assert.throws(() => parse(src), (e) => e instanceof ExprError && e.code === 'BAD_EXPR', `expected "${src}" to be rejected`);
  }
  assert.throws(() => parse('x'.repeat(201)), /longer/);
  assert.throws(() => parse(42), ExprError);
});

test('tokenizer', () => {
  assert.deepEqual(tokenize('2*x').map((t) => t.type), ['num', 'op', 'ident']);
  assert.deepEqual(tokenize('min(x, 1)').map((t) => t.type), ['ident', 'lparen', 'ident', 'comma', 'num', 'rparen']);
});

test('sampling and finite check', () => {
  const pts = sample(parse('x^2'), [-1, 1], 5);
  assert.deepEqual(pts.map((p) => p.x), [-1, -0.5, 0, 0.5, 1]);
  assert.deepEqual(pts.map((p) => p.y), [1, 0.25, 0, 0.25, 1]);
  assert.equal(check('1/x', [-10, 10], 50).finite.length >= 2, true);
  assert.throws(() => check('sqrt(x)', [-10, -1]), (e) => e.code === 'BAD_EXPR');
  assert.throws(() => check('1/0', [-1, 1]), (e) => e.code === 'BAD_EXPR');
  assert.equal(check('ln(x)', [-10, 10]).finite.length < 50, true);
});

test('source contains neither eval nor Function(', () => {
  const src = readFileSync(new URL('../../shared/expr.js', import.meta.url), 'utf8');
  assert.equal(/\beval\s*\(/.test(src), false);
  assert.equal(/Function\s*\(/.test(src), false);
  assert.equal(/new\s+Function/.test(src), false);
});

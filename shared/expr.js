// shared/expr.js — safe arithmetic grammar for `plot` expressions in `x` (spec §4.4, brief 00 C1).
// Tokenizer + recursive-descent parser → AST; the evaluator walks the AST.
// No eval, no Function constructor, no property access on user input: identifiers are
// looked up in fixed allowlists (FUNCTIONS, CONSTANTS) via hasOwnProperty.
//
// Grammar:
//   expr   := term (('+' | '-') term)*
//   term   := unary (('*' | '/') unary)*
//   unary  := '-' unary | power
//   power  := atom ('^' unary)?            (right-associative)
//   atom   := number | 'x' | constant | function '(' expr (',' expr)* ')' | '(' expr ')'
// Functions: sin cos tan exp log ln sqrt abs min max floor ceil   (log = base 10, ln = natural)
// Constants: pi e

export class ExprError extends Error {
  constructor(message, pos) {
    super(message);
    this.name = 'ExprError';
    this.code = 'BAD_EXPR';
    this.pos = pos;
  }
}

const FUNCTIONS = Object.freeze({
  sin: { arity: 1, fn: Math.sin },
  cos: { arity: 1, fn: Math.cos },
  tan: { arity: 1, fn: Math.tan },
  exp: { arity: 1, fn: Math.exp },
  log: { arity: 1, fn: Math.log10 },
  ln: { arity: 1, fn: Math.log },
  sqrt: { arity: 1, fn: Math.sqrt },
  abs: { arity: 1, fn: Math.abs },
  floor: { arity: 1, fn: Math.floor },
  ceil: { arity: 1, fn: Math.ceil },
  min: { arity: 2, fn: Math.min },
  max: { arity: 2, fn: Math.max },
});
const CONSTANTS = Object.freeze({ pi: Math.PI, e: Math.E });
export const FUNCTION_NAMES = Object.freeze(Object.keys(FUNCTIONS));
export const CONSTANT_NAMES = Object.freeze(Object.keys(CONSTANTS));
export const MAX_SOURCE_LENGTH = 200;

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/** Tokenize into [{type:'num'|'ident'|'op'|'lparen'|'rparen'|'comma', value, pos}]. */
export function tokenize(src) {
  if (typeof src !== 'string') throw new ExprError('expression must be a string', 0);
  if (src.length > MAX_SOURCE_LENGTH) throw new ExprError(`expression longer than ${MAX_SOURCE_LENGTH} characters`, 0);
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t') { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(src.slice(i));
      if (!m || m[0] === '.') throw new ExprError(`bad number at ${i}`, i);
      tokens.push({ type: 'num', value: Number(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      const m = /^[a-zA-Z]+/.exec(src.slice(i));
      tokens.push({ type: 'ident', value: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if ('+-*/^'.includes(ch)) { tokens.push({ type: 'op', value: ch, pos: i }); i++; continue; }
    if (ch === '(') { tokens.push({ type: 'lparen', pos: i }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'rparen', pos: i }); i++; continue; }
    if (ch === ',') { tokens.push({ type: 'comma', pos: i }); i++; continue; }
    throw new ExprError(`unexpected character "${ch}" at ${i}`, i);
  }
  return tokens;
}

/** Parse to an AST. Throws ExprError. */
export function parse(src) {
  const tokens = tokenize(src);
  let p = 0;
  const peek = () => tokens[p];
  const next = () => tokens[p++];
  const expect = (type, what) => {
    const t = next();
    if (!t || t.type !== type) throw new ExprError(`expected ${what} at ${t ? t.pos : 'end'}`, t ? t.pos : src.length);
    return t;
  };

  function expr() {
    let left = term();
    while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value;
      left = { type: 'binary', op, left, right: term() };
    }
    return left;
  }
  function term() {
    let left = unary();
    while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/')) {
      const op = next().value;
      left = { type: 'binary', op, left, right: unary() };
    }
    return left;
  }
  function unary() {
    if (peek() && peek().type === 'op' && peek().value === '-') { next(); return { type: 'unary', op: '-', arg: unary() }; }
    if (peek() && peek().type === 'op' && peek().value === '+') { next(); return unary(); }
    return power();
  }
  function power() {
    const base = atom();
    if (peek() && peek().type === 'op' && peek().value === '^') {
      next();
      return { type: 'binary', op: '^', left: base, right: unary() };
    }
    return base;
  }
  function atom() {
    const t = next();
    if (!t) throw new ExprError('unexpected end of expression', src.length);
    if (t.type === 'num') return { type: 'num', value: t.value };
    if (t.type === 'lparen') {
      const e = expr();
      expect('rparen', '")"');
      return e;
    }
    if (t.type === 'ident') {
      const name = t.value;
      if (name === 'x') return { type: 'x' };
      if (has(CONSTANTS, name)) return { type: 'const', name };
      if (has(FUNCTIONS, name)) {
        expect('lparen', `"(" after ${name}`);
        const args = [expr()];
        while (peek() && peek().type === 'comma') { next(); args.push(expr()); }
        expect('rparen', '")"');
        if (args.length !== FUNCTIONS[name].arity) throw new ExprError(`${name} takes ${FUNCTIONS[name].arity} argument(s), got ${args.length}`, t.pos);
        return { type: 'call', name, args };
      }
      throw new ExprError(`unknown identifier "${name}" at ${t.pos}`, t.pos);
    }
    throw new ExprError(`unexpected token at ${t.pos}`, t.pos);
  }

  const ast = expr();
  if (p < tokens.length) throw new ExprError(`unexpected token at ${tokens[p].pos}`, tokens[p].pos);
  return ast;
}

/** Evaluate an AST at x. Returns a number (may be NaN/±Infinity for undefined values). */
export function evaluate(ast, x) {
  switch (ast.type) {
    case 'num': return ast.value;
    case 'x': return x;
    case 'const': return CONSTANTS[ast.name];
    case 'unary': return -evaluate(ast.arg, x);
    case 'binary': {
      const a = evaluate(ast.left, x);
      const b = evaluate(ast.right, x);
      switch (ast.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
        case '^': return Math.pow(a, b);
        default: throw new ExprError(`bad operator ${ast.op}`);
      }
    }
    case 'call': {
      const f = FUNCTIONS[ast.name];
      const args = ast.args.map((a) => evaluate(a, x));
      return f.fn(...args);
    }
    default: throw new ExprError(`bad node ${ast.type}`);
  }
}

/**
 * Sample an AST over [min, max] at n evenly spaced points: [{x, y}] (y may be non-finite).
 */
export function sample(ast, xRange = [-10, 10], n = 50) {
  const [min, max] = xRange;
  const out = [];
  const count = Math.max(2, n | 0);
  for (let i = 0; i < count; i++) {
    const x = min + ((max - min) * i) / (count - 1);
    out.push({ x, y: evaluate(ast, x) });
  }
  return out;
}

/** Parse, sample and return the finite points; throws ExprError if fewer than `minFinite` are finite. */
export function check(src, xRange = [-10, 10], n = 50, minFinite = 2) {
  const ast = parse(src);
  const pts = sample(ast, xRange, n);
  const finite = pts.filter((p) => Number.isFinite(p.y));
  if (finite.length < minFinite) throw new ExprError(`expression has only ${finite.length} finite values over [${xRange[0]}, ${xRange[1]}]`, 0);
  return { ast, points: pts, finite };
}

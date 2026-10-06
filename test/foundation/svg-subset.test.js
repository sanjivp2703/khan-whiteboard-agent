import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, isValid, SvgError, parseTransform, applyTransforms, ALLOWED_TAGS } from '../../shared/svg-subset.js';

const wrap = (inner, vb = '0 0 100 100') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
const rejects = (svg, re) => assert.throws(() => parse(svg), (e) => e instanceof SvgError && e.code === 'BAD_SVG' && (!re || re.test(e.message)), `expected rejection: ${svg}`);

test('accepts every allowlisted tag with legal attributes', () => {
  const r = parse(wrap(
    '<g transform="translate(5,5) scale(0.5) rotate(10, 50, 50)">' +
    '<path d="M10 10 L 50 50 C 60 60, 70 70, 80 80 Q 85 85 90 90 A 5 5 0 0 1 95 95 H 96 V 97 S 98 98, 99 99 T 99 99 Z" stroke="accent1" stroke-width="2" fill="none"/>' +
    '<line x1="0" y1="0" x2="10" y2="10"/><circle cx="50" cy="50" r="10" fill="accent2"/><ellipse cx="50" cy="50" rx="10" ry="5"/>' +
    '<rect x="1" y="1" width="10" height="10" rx="2" ry="2"/><polyline points="0,0 10,10 20,0"/><polygon points="0 0 10 10 20 0"/>' +
    '<text x="50" y="50" font-size="12" text-anchor="middle" fill="muted">one two three four five six</text></g>'));
  assert.equal(r.shapeCount, 8);
  assert.deepEqual(r.viewBox, { x: 0, y: 0, w: 100, h: 100 });
  assert.equal(r.shapes[0].tag, 'g');
  assert.equal(r.shapes[0].children.length, 8);
  assert.equal(r.shapes[0].children[7].text, 'one two three four five six');
  assert.deepEqual(ALLOWED_TAGS, ['svg', 'g', 'path', 'line', 'circle', 'ellipse', 'rect', 'polyline', 'polygon', 'text']);
  // self-closing root and empty svg are fine
  assert.equal(parse('<svg viewBox="0 0 10 10"/>').shapeCount, 0);
  // entities in text
  assert.equal(parse(wrap('<text x="5" y="50">a &amp; b &lt; c</text>')).shapes[0].text, 'a & b < c');
});

test('rejects every banned tag individually', () => {
  for (const tag of ['script', 'foreignObject', 'image', 'style', 'use', 'a', 'defs', 'symbol', 'animate', 'set', 'iframe', 'filter', 'mask', 'clipPath', 'marker', 'pattern', 'switch', 'video', 'tspan']) {
    rejects(wrap(`<${tag}/>`), new RegExp(`<${tag}> is not allowed`));
    rejects(wrap(`<${tag}></${tag}>`));
  }
});

test('rejects banned attributes and constructs individually', () => {
  rejects(wrap('<rect width="1" height="1" onload="alert(1)"/>'), /event handler/);
  rejects(wrap('<rect width="1" height="1" onClick="x"/>'), /event handler/);
  rejects(wrap('<rect width="1" height="1" href="x"/>'), /not allowed/);
  rejects(wrap('<rect width="1" height="1" xlink:href="x"/>'), /namespaced/);
  rejects(wrap('<rect width="1" height="1" style="fill:red"/>'), /not allowed/);
  rejects(wrap('<rect width="1" height="1" id="a"/>'), /not allowed/);
  rejects(wrap('<rect width="1" height="1" class="a"/>'), /not allowed/);
  rejects(wrap('<rect width="1" height="1" fill="red"/>'), /color token/);
  rejects(wrap('<rect width="1" height="1" fill="url(#x)"/>'), /color token/);
  rejects(wrap('<rect width="1" height="1" stroke="#fff"/>'), /color token/);
  rejects(wrap('<rect width="1" height="1" transform="matrix(1,0,0,1,0,0)"/>'), /transform/);
  rejects(wrap('<rect width="1" height="1" transform="skewX(10)"/>'), /transform/);
  rejects(wrap('<rect width="1em" height="1"/>'), /plain number/);
  rejects(wrap('<rect width="1" height="1" x="javascript:1"/>'), /plain number/);
  rejects(wrap('<svg:rect width="1" height="1"/>'), /namespace/);
  rejects(wrap('<text x="1" y="1">&xxe;</text>'), /entity/);
  rejects(wrap('<text x="1" y="1">a & b</text>'), /bare/);
  rejects(wrap('<rect width="1" height="1" d="&xxe;"/>'), /entity/);
  rejects('<?xml version="1.0"?>' + wrap(''), /processing/);
  rejects('<!DOCTYPE svg>' + wrap(''), /DOCTYPE/);
  rejects(wrap('<!-- c --><rect width="1" height="1"/>'), /comments/);
  rejects(wrap('<![CDATA[x]]>'), /CDATA/);
  rejects(wrap('<rect width="1" height="1">text</rect>'), /text content/);
  rejects(wrap('<rect width="1" height="1"><circle r="1"/></rect>'), /nested/);
  rejects(wrap('<rect width="1" height="1"/><svg viewBox="0 0 1 1"/>'), /single root/);
  rejects('<g><rect width="1" height="1"/></g>', /inside <svg>|no <svg>/);
  rejects(wrap('<rect width="1" height="1" viewBox="0 0 1 1"/>'), /viewBox/);
  rejects(wrap('<rect width="1" height="1"'), /malformed|unterminated/);
  rejects('<svg viewBox="0 0 1 1"', /unterminated/);
  rejects(wrap('<rect width="1" height="1" width="2"/>'), /duplicate/);
  rejects(wrap('<rect width=1 height="1"/>'), /quoted/);
  rejects(wrap('<rect width="1" height="1"></circle>'), /mismatched/);
  rejects(wrap('<g><rect width="1" height="1"/>'), /unclosed|mismatched/);
  rejects('<svg viewBox="0 0 1 1"><g>', /unclosed/);
  rejects(wrap('<rect height="1"/>'), /needs width/);
  rejects(wrap('<path d="M0 0 X 1 1"/>'), /path d/);
  rejects(wrap('<polygon points="0 0 1"/>'), /points/);
  rejects(wrap('<text x="1" y="1" text-anchor="centre">a</text>'), /text-anchor/);
  rejects(wrap('<rect width="1" height="1" xmlns="http://evil"/>'), /xmlns/);
});

test('size cap at exactly 4096 bytes', () => {
  const head = '<svg viewBox="0 0 100 100">';
  const tail = '</svg>';
  const fill = (n) => `<text x="1" y="50">${'a'.repeat(n)}</text>`;
  const base = head + fill(0) + tail;
  const pad = 4096 - Buffer.byteLength(base, 'utf8');
  const exact = head + fill(pad) + tail;
  assert.equal(Buffer.byteLength(exact, 'utf8'), 4096);
  assert.equal(parse(exact).bytes, 4096);
  rejects(head + fill(pad + 1) + tail, /4097 bytes/);
  // multi-byte characters count as bytes: ceil(pad/2)+1 two-byte chars exceed the cap even though the string length is short
  const multi = head + `<text x="1" y="50">${'é'.repeat(Math.ceil(pad / 2) + 1)}</text>` + tail;
  assert.ok(multi.length < 4096 && Buffer.byteLength(multi, 'utf8') > 4096);
  rejects(multi, /bytes/);
});

test('viewBox missing or malformed', () => {
  rejects('<svg><rect width="1" height="1"/></svg>', /viewBox/);
  rejects('<svg viewBox="0 0 0 10"/>', /viewBox/);
  rejects('<svg viewBox="0 0 10"/>', /viewBox/);
  rejects('<svg viewBox="a b c d"/>', /number/);
  assert.deepEqual(parse('<svg viewBox="-5 -5 10 10"/>').viewBox, { x: -5, y: -5, w: 10, h: 10 });
});

test('bounds: every shape kind outside the viewBox is rejected; inside passes', () => {
  rejects(wrap('<rect x="95" y="0" width="10" height="10"/>'), /outside/);
  assert.ok(isValid(wrap('<rect x="90" y="90" width="10" height="10"/>')));
  rejects(wrap('<circle cx="5" cy="5" r="6"/>'), /outside/);
  assert.ok(isValid(wrap('<circle cx="50" cy="50" r="50"/>')));
  rejects(wrap('<ellipse cx="50" cy="50" rx="60" ry="5"/>'), /outside/);
  rejects(wrap('<line x1="0" y1="0" x2="101" y2="0"/>'), /outside/);
  rejects(wrap('<polyline points="0,0 50,50 100,101"/>'), /outside/);
  rejects(wrap('<polygon points="0,0 -1,50 50,50"/>'), /outside/);
  rejects(wrap('<text x="100.5" y="50">a</text>'), /outside/);
  rejects(wrap('<text x="50" y="5" font-size="10">a</text>'), /outside/); // top of the text box is above 0
  // path: control points count (conservative)
  rejects(wrap('<path d="M10 10 C 10 -50, 90 -50, 90 10"/>'), /outside/);
  assert.ok(isValid(wrap('<path d="M10 10 C 10 0, 90 0, 90 10"/>')));
  rejects(wrap('<path d="M10 10 Q 50 150 90 10"/>'), /outside/);
  rejects(wrap('<path d="M 0 50 A 50 50 0 0 1 100 50 L 100 101"/>'), /outside/);
  assert.ok(isValid(wrap('<path d="M 0 50 A 50 50 0 0 1 100 50"/>')));
  // relative commands
  rejects(wrap('<path d="M 90 90 l 20 0"/>'), /outside/);
  // non-zero viewBox origin
  assert.ok(isValid(wrap('<rect x="-5" y="-5" width="10" height="10"/>', '-5 -5 10 10')));
  rejects(wrap('<rect x="0" y="0" width="10" height="10"/>', '-5 -5 10 10'), /outside/);
});

test('nested g with transforms moves bounds', () => {
  rejects(wrap('<g transform="translate(50,50)"><rect x="40" y="40" width="20" height="20"/></g>'), /outside/);
  assert.ok(isValid(wrap('<g transform="translate(10,10)"><g transform="scale(2)"><rect x="0" y="0" width="40" height="40"/></g></g>')));
  rejects(wrap('<g transform="translate(10,10)"><g transform="scale(2)"><rect x="0" y="0" width="46" height="46"/></g></g>'), /outside/);
  assert.ok(isValid(wrap('<g transform="rotate(45, 50, 50)"><rect x="40" y="40" width="20" height="20"/></g>')));
  rejects(wrap('<g transform="rotate(45, 50, 50)"><rect x="0" y="0" width="100" height="100"/></g>'), /outside/);
  const ops = parseTransform('translate(10, 20) scale(2) rotate(90)');
  assert.equal(ops.length, 3);
  const [px, py] = applyTransforms(ops, [1, 0]);
  assert.ok(Math.abs(px - 10) < 1e-9 && Math.abs(py - 22) < 1e-9, `${px},${py}`);
  assert.throws(() => parseTransform('translate()'), SvgError);
  assert.throws(() => parseTransform('rotate(1,2)'), SvgError);
});

test('shape count 41 rejected, 40 accepted; text 7 words rejected', () => {
  const circles = (n) => Array.from({ length: n }, (_, i) => `<circle cx="${(i % 10) * 10 + 5}" cy="${Math.floor(i / 10) * 10 + 5}" r="2"/>`).join('');
  assert.equal(parse(wrap(circles(40))).shapeCount, 40);
  rejects(wrap(circles(41)), /more than 40/);
  rejects(wrap('<text x="1" y="50">a b c d e f g</text>'), /7 words/);
  assert.ok(isValid(wrap('<text x="1" y="50">a b c d e f</text>')));
});

test('fuzz: 300 mutations of valid SVGs with banned tokens are rejected or still valid, never an unexpected error', () => {
  const valid = [
    wrap('<rect x="10" y="10" width="20" height="20" stroke="accent1"/><circle cx="60" cy="60" r="10"/>'),
    wrap('<g transform="translate(5,5)"><path d="M0 0 L 50 50 Q 60 60 70 50"/><text x="10" y="90" font-size="8">hi there</text></g>'),
    wrap('<polyline points="0,0 10,10 20,0" fill="none"/><polygon points="50,50 60,60 70,50" fill="accent3"/><ellipse cx="50" cy="50" rx="5" ry="3"/>'),
  ];
  const payloads = [
    '<script>alert(1)</script>', ' onload="x()"', ' onclick="x"', ' href="javascript:1"', ' xlink:href="#a"', ' style="x"', '<image href="x"/>',
    '<foreignObject/>', '<use/>', '&xxe;', '<!-- c -->', '<![CDATA[x]]>', '<?php ?>', '<a>', ' transform="matrix(1,0,0,1,0,0)"', ' fill="red"',
    '<svg:g/>', '<g xmlns:x="y"/>', ' id="x"', ' class="x"', '<iframe/>', '<animate/>', '"', '<', '>', '&', ' width="1e999"',
  ];
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 48271) % 2147483647; return seed % n; };
  let rejected = 0, stillValid = 0;
  for (let i = 0; i < 300; i++) {
    const base = valid[rnd(valid.length)];
    const payload = payloads[rnd(payloads.length)];
    // insert at a random position, preferring tag boundaries half the time
    let pos = rnd(base.length);
    if (rnd(2) === 0) { const gt = base.indexOf('>', pos); pos = gt >= 0 ? gt + 1 : pos; }
    const mutant = base.slice(0, pos) + payload + base.slice(pos);
    try {
      parse(mutant);
      stillValid++;
    } catch (e) {
      assert.ok(e instanceof SvgError, `unexpected error type for mutant: ${e && e.stack}`);
      assert.equal(e.code, 'BAD_SVG');
      rejected++;
    }
  }
  assert.equal(rejected + stillValid, 300);
  assert.ok(rejected > 250, `expected most mutants rejected, got ${rejected}`);
});

const fs = require('fs');
const assert = require('assert');
const ts = require('typescript');
const source = fs.readFileSync('src/viewers/slideGestureMath.ts', 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', code)(mod, mod.exports);
const { pinchOffset, limitSlideOffset } = mod.exports;
// A short landscape slide in portrait: its touched point must not snap to the centre.
for (const [content, viewport, focal, initial, s0, s1] of [[200, 700, 70, 0, 1, 2], [330, 760, -100, 30, 1.5, 3], [650, 340, 65, -25, 2, 3]]) {
  const offset = pinchOffset(focal, focal, initial, s0, s1);
  assert.equal(limitSlideOffset(offset, content, viewport, s1), offset);
  assert(Math.abs((focal - initial) / s0 - (focal - offset) / s1) < 1e-10);
}
assert.equal(pinchOffset(50, 80, 10, 1, 2), 0);
assert.equal(limitSlideOffset(10000, 200, 700, 2), 518);
console.log('Slide pinch focus, movement and bounds tests OK');

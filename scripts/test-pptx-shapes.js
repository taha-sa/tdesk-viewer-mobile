const fs = require('fs');
const assert = require('assert');
const ts = require('typescript');
const source = fs.readFileSync('src/viewers/PptxViewer.tsx', 'utf8').split('// @@PURE-START')[1].split('// @@PURE-END')[0];
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 't', code)(mod, mod.exports, (key) => key);
const ctx = { slideW: 1000, slideH: 1000, rels: {}, layoutPh: {}, masterPh: {} };
const slide = mod.exports.parseSlide(`<p:sld><p:cSld><p:spTree>
<p:sp><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="400" cy="300"/></a:xfrm><a:prstGeom prst="ellipse"/><a:solidFill><a:srgbClr val="ff0022"/></a:solidFill><a:ln w="25400"><a:solidFill><a:srgbClr val="111111"/></a:solidFill></a:ln></p:spPr><p:txBody><a:p><a:r><a:t>hello</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="50" cy="50"/></a:xfrm><a:prstGeom prst="star5"/><a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill></p:spPr></p:sp>
</p:spTree></p:cSld></p:sld>`, 's', 1, ctx);
assert.deepStrictEqual(slide.elements.map(e => e.kind), ['shape', 'text']);
assert.strictEqual(slide.elements[0].shape.geometry, 'ellipse');
assert.strictEqual(slide.elements[0].shape.fill, '#FF0022');
assert.strictEqual(slide.elements[0].shape.stroke, '#111111');
assert.strictEqual(slide.elements[0].shape.strokeWidth, 2);
assert.strictEqual(slide.text, 'hello');
console.log('PPTX shape parsing tests OK');

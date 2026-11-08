'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const file = path.resolve(__dirname, '../src/renderer/desktopClipboardObservationGate.ts')
const compiled = ts.transpileModule(fs.readFileSync(file,'utf8'), {
  fileName: file, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length,0)
const module_ = {exports: {}}
new Function('module','exports',compiled.outputText)(module_,module_.exports)
const Gate = module_.exports.XDriveDesktopClipboardObservationGate
test('first snapshot is never uploaded and repeated polling is idempotent',()=>{
  const g=new Gate()
  assert.equal(g.consider('existing sensitive text',true),null)
  assert.equal(g.consider('existing sensitive text',true),null)
  assert.equal(g.consider('new explicit change',true),'new explicit change')
  assert.equal(g.consider('new explicit change',true),null)
})
test('only visible UI may observe and a local copy-back is suppressed',()=>{
  const g=new Gate()
  assert.equal(g.consider('a',true),null)
  assert.equal(g.consider('b',false),null)
  assert.equal(g.consider('b',true),'b')
  g.suppressLocalWrite('remote copied text')
  assert.equal(g.consider('remote copied text',true),null)
  assert.equal(g.consider('c',true),'c')
})
test('fails closed for empty/over-limit text and resets on Owner Lock',()=>{
  const g=new Gate()
  assert.equal(g.consider('start',true),null)
  assert.equal(g.consider('',true),null)
  assert.equal(g.consider('A'.repeat(65537),true),null)
  assert.equal(g.consider('后续',true),'后续')
  g.reset()
  assert.equal(g.consider('new owner clipboard',true),null)
})

'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const src = path.join(__dirname, '../../ui/shared/src/viewer-quality-policy.ts')
const compiled = ts.transpileModule(fs.readFileSync(src, 'utf8'), {
  fileName: src, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error), [])
const m = { exports: {} }
new Function('module', 'exports', compiled.outputText)(m, m.exports)
const {xDriveResolveViewerQuality: resolve,
  xDriveViewerQualityRequestIdentity: identity,
  XDRIVE_VIEWER_QUALITY_OPTIONS: options} = m.exports

test('Viewer tier and user/admin effective selection are bounded', () => {
  assert.deepEqual(options.map(x => x.maxEdge), [1280, 2048, 4096])
  assert.deepEqual(resolve(undefined, undefined, undefined),
    { requested: 'high', effective: 'high', adminMaximum: 'high', capped: false })
  assert.deepEqual(resolve('high', '', 'economy'),
    { requested: 'high', effective: 'economy', adminMaximum: 'economy', capped: true })
  assert.deepEqual(resolve('high', 'balanced', 'high'),
    { requested: 'balanced', effective: 'balanced', adminMaximum: 'high', capped: false })
  for (const invalid of ['8k', 'original', 'HIGH', 2, {}, false]) {
    assert.throws(() => resolve(invalid, null, 'high'))
    assert.throws(() => resolve('high', invalid, 'high'))
    assert.throws(() => resolve('high', null, invalid))
  }
})
test('Viewer foreground attempt fences Server, Owner, revision and tier', () => {
  const hash = 'a'.repeat(64)
  const args = ['server-1', 'owner-1', 9, 4, hash, 'high']
  const baseline = identity(...args)
  for (const changed of [
    ['server-2', 'owner-1', 9, 4, hash, 'high'],
    ['server-1', 'owner-2', 9, 4, hash, 'high'],
    ['server-1', 'owner-1', 9, 5, hash, 'high'],
    ['server-1', 'owner-1', 9, 4, hash, 'economy'],
    ['server-1', 'owner-1', 9, 4, 'b'.repeat(64), 'high'],
  ]) assert.notEqual(identity(...changed), baseline)
  assert.equal(identity('server-1', 'owner-1', 9, 4, hash.toUpperCase(), 'high'), baseline)
  assert.throws(() => identity('server-1', 'owner-1', 9, 4, 'bad', 'high'))
})

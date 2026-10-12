const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root=path.resolve(__dirname,'../..')
const source=fs.readFileSync(path.join(root,'web/src/pwaTransferSafety.ts'),'utf8')
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const mod={exports:{}}
new Function('exports','module',js)(mod.exports,mod)
const {xDriveHasPendingBrowserUpload: active, xDriveWarnBeforeLeavingUpload: warn}=mod.exports

test('S4A: only actively pending foreground upload items trigger navigation guard',()=>{
  assert.equal(active([{direction:'upload',state:'running'}]),true)
  assert.equal(active([{direction:'upload',state:'queued'}]),true)
  assert.equal(active([{direction:'upload',state:'retrying'}]),true)
  assert.equal(active([{direction:'upload',state:'cancelling'}]),true)
  assert.equal(active([{direction:'upload',state:'completed'}]),false)
  assert.equal(active([{direction:'upload',state:'failed'}]),false)
  assert.equal(active([{direction:'download',state:'running'}]),false)
  assert.equal(active([{direction:'local',state:'running'}]),false)
  assert.equal(active([]),false)
})
test('S4A: native beforeunload warning is non-destructive and not a Server cancellation',()=>{
  let prevented=0
  const event={preventDefault(){prevented++},returnValue:'test'}
  warn(event)
  assert.equal(prevented,1)
  assert.equal(event.returnValue,'')
  assert.doesNotMatch(source,/cancelTransfer|fetch\(|skipWaiting|removeEventListener\(|api\/v1/)
})
test('S4A: shared Web/Mobile frame wires warning only for current active foreground upload',()=>{
  const app=fs.readFileSync(path.join(root,'web/src/App.tsx'),'utf8')
  assert.ok(app.includes('xDriveHasPendingBrowserUpload(transfers)'))
  assert.ok(app.includes("window.addEventListener('beforeunload', xDriveWarnBeforeLeavingUpload)"))
  assert.ok(app.includes("window.removeEventListener('beforeunload', xDriveWarnBeforeLeavingUpload)"))
  assert.ok(app.includes("<XDriveMobileAppHeader"))
})

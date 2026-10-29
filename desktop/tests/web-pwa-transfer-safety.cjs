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
const {xDriveHasPendingBrowserUpload: active, xDriveWarnBeforeLeavingUpload: warn, xDriveObservePwaBeforeUnload: observe}=mod.exports

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
  const warningOnly = source.slice(source.indexOf('export function xDriveWarnBeforeLeavingUpload'), source.indexOf('export function xDriveObservePwaBeforeUnload'))
  assert.doesNotMatch(warningOnly,/cancelTransfer|fetch\(|skipWaiting|removeEventListener\(|api\/v1/)
})
test('S4A/S3D2C: shared Web/Mobile frame warns on uploads and unsaved local work',()=>{
  const app=fs.readFileSync(path.join(root,'web/src/App.tsx'),'utf8')
  assert.ok(app.includes('xDriveHasPendingBrowserUpload(transfers)'))
  assert.ok(app.includes('return xDriveObservePwaBeforeUnload(window)'))
  assert.ok(app.includes("const hasBlockingUnloadWork = hasPendingUpload || systemDependenciesDraftDirty || hasBlockingMediaEditor"))
  assert.ok(app.includes("  if (!hasBlockingUnloadWork) return"))
  assert.ok(app.includes("<XDriveMobileAppHeader"))
})

test('S4A Safari: denied beforeunload listener leaves mounted Web/PWA usable', () => {
  let addCalls = 0, removeCalls = 0
  const host = {
    addEventListener(name) {
      addCalls++
      assert.equal(name, 'beforeunload')
      throw Error('SecurityError: restricted WebKit event registration')
    },
    removeEventListener() { removeCalls++ },
  }
  let cleanup
  assert.doesNotThrow(() => { cleanup = observe(host) })
  assert.equal(typeof cleanup, 'function')
  assert.doesNotThrow(() => cleanup())
  assert.equal(addCalls, 1)
  assert.equal(removeCalls, 0, 'no subscription was installed')
})

test('S4A Safari: denied optional cleanup cannot crash logout or page teardown', () => {
  let cb = null, addCalls = 0, removeCalls = 0
  const host = {
    addEventListener(name, listener) {
      addCalls++
      assert.equal(name, 'beforeunload')
      cb = listener
    },
    removeEventListener(name, listener) {
      removeCalls++
      assert.equal(name, 'beforeunload')
      assert.equal(listener, cb)
      throw Error('SecurityError: cleanup denied')
    },
  }
  const cleanup = observe(host)
  const event = { prevented: 0, returnValue: 'before',
    preventDefault() { this.prevented++ } }
  cb(event)
  assert.equal(event.prevented, 1, 'normal browsers retain the native prompt')
  assert.equal(event.returnValue, '')
  assert.doesNotThrow(cleanup)
  assert.equal(addCalls, 1)
  assert.equal(removeCalls, 1)
})

test('S4A: successful warning registration removes exactly the same listener', () => {
  let registered = null
  const host = {
    addEventListener(name, callback) { assert.equal(name, 'beforeunload'); registered = callback },
    removeEventListener(name, callback) {
      assert.equal(name, 'beforeunload')
      assert.equal(callback, registered)
      registered = null
    },
  }
  const cleanup = observe(host)
  assert.equal(registered, warn)
  cleanup()
  assert.equal(registered, null)
})

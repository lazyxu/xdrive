'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const sourceFile = 'ui/shared/src/mui/MediaGalleryBaiduPrototypeMap.tsx'
const source = fs.readFileSync(path.join(root, sourceFile), 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: sourceFile,
  reportDiagnostics: true,
  compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
})
assert.deepEqual(compiled.diagnostics || [], [])

// Execute the actual production TypeScript loader, not a recreated mock
// implementation; injectable fake DOM and timers keep tests quota-free.
const timers = new Map()
let nextTimerID = 0
const fakeSetTimeout = (callback, delay) => {
  const id = ++nextTimerID
  timers.set(id, { callback, delay })
  return id
}
const fakeClearTimeout = id => timers.delete(id)
const fire = delay => {
  for (const [id, item] of timers) {
    if (item.delay !== delay) continue
    timers.delete(id)
    item.callback()
  }
}
const moduleState = { exports: {} }
new Function('module', 'exports', 'require', 'setTimeout', 'clearTimeout',
  compiled.outputText)(moduleState, moduleState.exports,
  () => ({}), fakeSetTimeout, fakeClearTimeout)
const { loadBaiduJSAPI4: load } = moduleState.exports
assert.equal(typeof load, 'function')

function fixture() {
  timers.clear()
  const handlers = new Map()
  const scripts = []
  const window = {}
  const document = {
    defaultView: window,
    createElement(tag) {
      assert.equal(tag, 'script')
      return { remove() { this.removed = true } }
    },
    head: { appendChild(script) { scripts.push(script) } },
    addEventListener(name, handler) { handlers.set(name, handler) },
    removeEventListener(name, handler) {
      if (handlers.get(name) === handler) handlers.delete(name)
    },
  }
  const csp = (blockedURI, directive = 'script-src-elem', disposition = 'enforce') =>
    handlers.get('securitypolicyviolation')?.({
      blockedURI, effectiveDirective: directive, disposition,
    })
  return { document, window, scripts, csp, handlers }
}
const namespace = () => ({
  Map: class {}, Point: class {}, Convertor: class {}, ClusterLayer: class {},
})

test('actual direct browser script failure is not misreported as Server Loader failure', async () => {
  const f = fixture()
  const pending = load(f.document, 'PUBLIC_BROWSER_AK')
  assert.equal(f.scripts.length, 1)
  assert.equal(f.scripts[0].referrerPolicy, 'strict-origin-when-cross-origin')
  assert.match(f.scripts[0].src, /^https:\/\/api\.map\.baidu\.com\/api\?v=4\.0&ak=/)
  f.scripts[0].onerror({ message: 'private provider text' })
  await assert.rejects(pending, error => {
    assert.equal(error.code, 'prototype_sdk_script_failed')
    assert.equal(error.message, 'baidu_prototype_runtime_failed')
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE|provider text|PUBLIC_BROWSER_AK/)
    return true
  })
  assert.equal(f.scripts[0].removed, true)
  assert.equal(f.handlers.has('securitypolicyviolation'), false)
})

test('real CSP violations are classified before script.onerror without retaining URL/AK', async () => {
  const f = fixture()
  const pending = load(f.document, 'PUBLIC_BROWSER_AK')
  const urlWithAK = 'https://api.map.baidu.com/api?v=4.0&ak=PUBLIC_BROWSER_AK'
  f.csp(urlWithAK)
  await assert.rejects(pending, error => {
    assert.equal(error.code, 'prototype_csp_script_blocked')
    assert.doesNotMatch(JSON.stringify(error), /PUBLIC_BROWSER_AK|https:/)
    return true
  })
  assert.equal(f.handlers.has('securitypolicyviolation'), false)
})

test('non-Baidu or report-only CSP does not misclassify an SDK script failure', async () => {
  const f = fixture()
  const pending = load(f.document, 'KEY')
  f.csp('https://other.example.test/a?ak=other')
  f.csp('https://api.map.baidu.com/api?v=4.0&ak=KEY', 'script-src', 'report')
  f.scripts[0].onerror()
  await assert.rejects(pending, error => error.code === 'prototype_sdk_script_failed')
})

test('bootstrap timeout and subsequent missing native capability have different codes', async () => {
  const f = fixture()
  const pending = load(f.document, 'KEY')
  fire(12000)
  await assert.rejects(pending, error => error.code === 'prototype_sdk_script_timeout')
  const g = fixture()
  const loaded = load(g.document, 'KEY')
  g.window.BMap = { Map: class {}, Point: class {}, Convertor: class {} }
  g.scripts[0].onload()
  fire(12000)
  await assert.rejects(loaded, error => error.code === 'sdk_missing_cluster_layer')
})

test('fully initialized SDK resolves and memoizes only within same document and AK', async () => {
  const f = fixture()
  const pending = load(f.document, 'KEY')
  const api = namespace()
  f.window.BMap = api
  f.scripts[0].onload()
  assert.equal(await pending, api)
  assert.equal(await load(f.document, 'KEY'), api)
  await assert.rejects(load(f.document, 'ROTATED'), error =>
    error.code === 'prototype_ak_rotated')
  assert.equal(f.scripts.length, 1)
  assert.equal(f.handlers.has('securitypolicyviolation'), false)
})

test('invalid config and no document reject before inserting any SDK script', async () => {
  const f = fixture()
  await assert.rejects(load(f.document, ''), error =>
    error.code === 'prototype_config_invalid')
  await assert.rejects(load({ defaultView: null }, 'KEY'), error =>
    error.code === 'prototype_document_unavailable')
  assert.equal(f.scripts.length, 0)
})

test('bootstrap onload may precede deferred BMap capabilities and still succeed', async () => {
  const f = fixture()
  const pending = load(f.document, 'KEY')
  const sdk = namespace()
  f.scripts[0].onload()
  assert.ok([...timers.values()].some(item => item.delay === 100))
  f.window.BMap = sdk
  fire(100)
  assert.equal(await pending, sdk)
  assert.equal(timers.size, 0)
  assert.equal(f.handlers.has('securitypolicyviolation'), false)
})

test('successful bootstrap without any BMap produces namespace rather than script code', async () => {
  const f = fixture()
  const pending = load(f.document, 'KEY')
  f.scripts[0].onload()
  fire(12000)
  await assert.rejects(pending, error =>
    error.code === 'prototype_sdk_namespace_missing')
  assert.equal(timers.size, 0)
})

test('DOM creation, Trusted Types src and insertion failures are classified at injection stage', async () => {
  const expectSafe = error => {
    assert.equal(error.code, 'prototype_sdk_script_injection_failed')
    assert.doesNotMatch(JSON.stringify(error), /SECRET_AK|secret provider/)
    return true
  }
  const a = fixture()
  a.document.createElement = () => { throw Error('SECRET_AK creation') }
  await assert.rejects(load(a.document, 'KEY'), expectSafe)
  assert.equal(a.scripts.length, 0)

  const b = fixture()
  b.document.createElement = () => ({
    set src(value) { throw Error('SECRET_AK in src') },
    remove() { this.removed = true },
  })
  await assert.rejects(load(b.document, 'KEY'), expectSafe)
  assert.equal(b.scripts.length, 0)
  assert.equal(b.handlers.has('securitypolicyviolation'), false)

  const c = fixture()
  c.document.head.appendChild = () => { throw Error('secret provider insertion') }
  await assert.rejects(load(c.document, 'KEY'), expectSafe)
  assert.equal(c.scripts.length, 0)
  assert.equal(c.handlers.has('securitypolicyviolation'), false)
})

test('SDK failure is not sticky and may be retried with current Browser AK', async () => {
  const f = fixture()
  const pending = load(f.document, 'KEY')
  f.scripts[0].onerror()
  await assert.rejects(pending, error => error.code === 'prototype_sdk_script_failed')
  const retry = load(f.document, 'KEY')
  assert.equal(f.scripts.length, 2)
  const sdk = namespace()
  f.window.BMap = sdk
  f.scripts[1].onload()
  assert.equal(await retry, sdk)
})

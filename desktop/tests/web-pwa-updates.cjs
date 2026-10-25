const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'web/src/pwaUpdates.ts'), 'utf8')
function harness({ supported = true, secure = true, waiting = true, online = true, updateGate = null, lookupGate = null,
  channelFailure = null } = {}) {
  const events = new Map(), workerEvents = new Map(), regEvents = new Map(), messages = []
  let checked = 0, channelClosed = 0
  const registration = {
    waiting: waiting ? {} : null, installing: null,
    addEventListener(kind, fn) { regEvents.set(kind, fn) },
    async update() { checked += 1; if (updateGate) await updateGate },
  }
  const worker = {
    controller: {},
    ready: Promise.resolve(registration),
    async getRegistration() { return lookupGate ? await lookupGate : registration },
    addEventListener(kind, fn) { workerEvents.set(kind, fn) },
  }
  const win = { isSecureContext: secure, addEventListener(kind, fn) { events.set(kind, fn) } }
  const navigator = { onLine: online, ...(supported ? { serviceWorker: worker } : {}) }
  class Channel {
    constructor(name) {
      if (channelFailure === 'constructor') throw new Error('BroadcastChannel denied')
      this.name = name
    }
    addEventListener(kind, fn) {
      if (channelFailure === 'listener') throw new Error('BroadcastChannel listener denied')
      this.receive = fn
    }
    postMessage(data) {
      if (channelFailure === 'send') throw new Error('BroadcastChannel send denied')
      messages.push(data)
    }
    close() { channelClosed++ }
  }
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  new Function('exports', 'window', 'navigator', 'BroadcastChannel', code)(exports, win, navigator, Channel)
  return { mod: exports, win, navigator, registration, events, workerEvents, regEvents, messages,
    get checked() { return checked }, get channelClosed() { return channelClosed } }
}
async function flush() { for (let n = 0; n < 5; n++) await Promise.resolve() }

test('S3A: waiting version is observed and announced without interrupting active clients', async () => {
  const h = harness({ waiting: true })
  h.mod.startXDrivePwaUpdateObservation()
  await flush()
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'waiting')
  assert.ok(h.messages.some(m => m.kind === 'xdrive-public-update-ready'))
  assert.equal(h.checked, 0, 'ordinary render cannot trigger update')
  assert.doesNotMatch(source, /skipWaiting\s*\(|window\.location\.(reload|replace)|postMessage\(\s*\{\s*type:\s*['"]SKIP_WAITING/)
  assert.doesNotMatch(source, /localStorage|sessionStorage|Authorization|api\/v1/)
})

test('S3A: explicit check invokes browser update without activating pages', async () => {
  const h = harness({ waiting: false })
  h.mod.startXDrivePwaUpdateObservation()
  await flush()
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'idle')
  const phase = await h.mod.checkXDrivePwaUpdate()
  assert.equal(phase, 'checked')
  assert.equal(h.checked, 1)
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'checked')
})

test('S3A: offline/online is only a browser hint, never Server authority', async () => {
  const h = harness({ waiting: false, online: true })
  h.mod.startXDrivePwaUpdateObservation()
  await flush()
  h.navigator.onLine = false
  h.events.get('offline')()
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().connectionHint, 'offline')
  h.navigator.onLine = true
  h.events.get('online')()
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().connectionHint, 'online')
})

test('S3A: blocked/unsafe browsers stay usable; no false ready status', async () => {
  const h = harness({ supported: false, secure: false })
  h.mod.startXDrivePwaUpdateObservation()
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'unsupported')
  assert.equal(await h.mod.checkXDrivePwaUpdate(), 'unsupported')
})

test('S3A: other-window announcement is a hint and never starts forced activation', async () => {
  const h = harness({ waiting: false })
  h.mod.startXDrivePwaUpdateObservation()
  await flush()
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'idle')
  assert.ok(source.includes("otherWindowReportedUpdate: remoteUpdateHint"))
  assert.ok(source.includes("event.data?.kind !== 'xdrive-public-update-ready'"))
  assert.doesNotMatch(source, /skipWaiting\s*\(|location\.reload\s*\(/)
})

test('S3A: actual Web install dialog exposes safe update status only on demand', () => {
  const dialog = fs.readFileSync(path.join(root, 'web/src/PwaInstallDialog.tsx'), 'utf8')
  const main = fs.readFileSync(path.join(root, 'web/src/main.tsx'), 'utf8')
  const runtime = fs.readFileSync(path.join(root, 'web/src/pwaRuntime.ts'), 'utf8')
  const section = fs.readFileSync(path.join(root, 'web/src/PwaUpdateSection.tsx'), 'utf8')
  const docs = fs.readFileSync(path.join(root, 'docs/pwa-delivery.md'), 'utf8')
  assert.ok(main.includes('startXDrivePwaUpdateObservation()'))
  assert.ok(dialog.includes('<XDrivePwaUpdateSection'))
  assert.ok(runtime.includes('xdrive-pwa-registered'))
  assert.ok(section.includes('data-xdrive-pwa-check-update'))
  assert.ok(section.includes('data-xdrive-pwa-update-instructions'))
  assert.ok(section.includes('不会因该确认自动关闭、重载或中断'))
  assert.ok(docs.includes('PWA-S3A'))
  assert.doesNotMatch(section, /skipWaiting|location\.reload|api\/v1/)
})

test('S3D1: repeated clicks reuse one in-flight browser update()', async () => {
  let release
  const held = new Promise(resolve => { release = resolve })
  const h = harness({ waiting: false, updateGate: held })
  h.mod.startXDrivePwaUpdateObservation()
  await flush()
  const first = h.mod.checkXDrivePwaUpdate({ timeoutMs: 1000 })
  const second = h.mod.checkXDrivePwaUpdate({ timeoutMs: 1000 })
  assert.strictEqual(second, first)
  await flush()
  assert.equal(h.checked, 1)
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'checking')
  release()
  assert.deepEqual(await Promise.all([first, second]), ['checked', 'checked'])
  assert.equal(h.checked, 1)
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'checked')
})

test('S3D1: expired update() stops waiting, late completion cannot fake success, retry works', async () => {
  let release
  const held = new Promise(resolve => { release = resolve })
  const h = harness({ waiting: false, updateGate: held })
  h.mod.startXDrivePwaUpdateObservation()
  await flush()
  assert.equal(await h.mod.checkXDrivePwaUpdate({ timeoutMs: 20 }), 'error')
  assert.match(h.mod.xDrivePwaUpdateSnapshot().lastError, /仍在后台检查/)
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'error')
  assert.equal(h.checked, 1)
  release()
  await flush()
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'error')
  h.registration.update = async () => {}
  assert.equal(await h.mod.checkXDrivePwaUpdate({ timeoutMs: 100 }), 'checked')
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'checked')
})

test('S3D1: registration lookup and update share a bounded deadline', async () => {
  const h = harness({ waiting: false, lookupGate: new Promise(() => {}) })
  assert.equal(await h.mod.checkXDrivePwaUpdate({ timeoutMs: 20 }), 'error')
  assert.equal(h.checked, 0)
  assert.match(h.mod.xDrivePwaUpdateSnapshot().lastError, /仍在后台检查/)
})

test('S3D1: genuine waiting worker takes precedence over timeout', async () => {
  let release
  const h = harness({ waiting: false, updateGate: new Promise(r => { release = r }) })
  h.mod.startXDrivePwaUpdateObservation()
  await flush()
  const pending = h.mod.checkXDrivePwaUpdate({ timeoutMs: 20 })
  h.registration.waiting = {}
  assert.equal(await pending, 'waiting')
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'waiting')
  release()
  await flush()
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'waiting')
})

test('S3D1: UI and actual Chrome guards never skipWaiting or force reload', () => {
  const ui = fs.readFileSync(path.join(root, 'web/src/PwaUpdateSection.tsx'), 'utf8')
  const docs = fs.readFileSync(path.join(root, 'docs/pwa-delivery.md'), 'utf8')
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/pwa-s2b-browser.yml'), 'utf8')
  const browser = fs.readFileSync(path.join(root, 'desktop/scripts/pwa-browser-install-offline.cjs'), 'utf8')
  assert.ok(source.includes('const maxUpdateCheckMs = 8000'))
  assert.ok(source.includes('updateCheckInFlight = pending'))
  assert.ok(source.includes('Promise.race([found.update(), deadline])'))
  assert.ok(ui.includes('data-xdrive-pwa-update-checking'))
  assert.ok(ui.includes('浏览器内部检查仍可能继续'))
  assert.ok(browser.includes('result.updateCheckSettled = true'))
  assert.ok(workflow.includes("github.head_ref == 'fix/pwa-update-check-timeout-s3d1-20261013'"))
  assert.ok(workflow.includes('x.updateCheckSettled'))
  assert.ok(docs.includes('PWA-S3D1'))
  assert.doesNotMatch(source, /skipWaiting\s*\(|location\.reload\s*\(|Client\.postMessage\s*\(/)
  assert.doesNotMatch(ui, /skipWaiting|location\.reload|api\/v1/)
})

test('S3D1: revoked registration clears stale waiting on pageshow and manual check', async () => {
  const h = harness({ waiting: true })
  h.mod.startXDrivePwaUpdateObservation()
  await flush()
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'waiting')
  h.navigator.serviceWorker.getRegistration = async () => undefined
  h.events.get('pageshow')()
  await flush()
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'idle')
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().otherWindowReportedUpdate, false)
  assert.equal(await h.mod.checkXDrivePwaUpdate(), 'error')
  assert.match(h.mod.xDrivePwaUpdateSnapshot().lastError, /尚未检测到/)
  assert.equal(h.checked, 0, 'unregistered worker must not be updated')
})

test('S3D1: explicit update uses a replacement registration instead of the retired one', async () => {
  const h = harness({ waiting: false })
  h.mod.startXDrivePwaUpdateObservation()
  await flush()
  let updatedNew = 0
  const replacement = {
    waiting: {}, installing: null,
    addEventListener() {},
    async update() { updatedNew++ },
  }
  h.navigator.serviceWorker.getRegistration = async () => replacement
  assert.equal(await h.mod.checkXDrivePwaUpdate(), 'waiting')
  assert.equal(h.checked, 0, 'old registration must not be updated')
  assert.equal(updatedNew, 1)
})

test('S3D1: late old registration lookup and retired worker events cannot resurrect waiting', async () => {
  const h = harness({ waiting: true })
  h.mod.startXDrivePwaUpdateObservation()
  await flush()
  let finishOldLookup
  h.navigator.serviceWorker.getRegistration = () =>
    new Promise(resolve => { finishOldLookup = resolve })
  h.events.get('pageshow')()
  await flush()
  let oldWorkerStateChange
  h.registration.installing = { state: 'installed', addEventListener(_kind, fn) { oldWorkerStateChange = fn } }
  h.regEvents.get('updatefound')()
  h.navigator.serviceWorker.getRegistration = async () => undefined
  h.events.get('pageshow')()
  await flush()
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'idle')
  finishOldLookup(h.registration)
  await flush()
  oldWorkerStateChange()
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'idle')
})

test('S3D1: manual check superseded by a newer missing-registration lookup stays fail closed', async () => {
  const h = harness({ waiting: true })
  h.mod.startXDrivePwaUpdateObservation()
  await flush()
  let finishOld
  h.navigator.serviceWorker.getRegistration = () => new Promise(resolve => { finishOld = resolve })
  const check = h.mod.checkXDrivePwaUpdate()
  await flush()
  h.navigator.serviceWorker.getRegistration = async () => undefined
  h.events.get('pageshow')()
  await flush()
  finishOld(h.registration)
  assert.equal(await check, 'idle')
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'idle')
  assert.equal(h.checked, 0)
})

test('S3D1: controllerchange revalidates unregistered and replaced workers', async () => {
  const h = harness({ waiting: true })
  h.mod.startXDrivePwaUpdateObservation()
  await flush()
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'waiting')
  assert.equal(typeof h.workerEvents.get('controllerchange'), 'function')
  h.navigator.serviceWorker.getRegistration = async () => undefined
  h.workerEvents.get('controllerchange')()
  await flush()
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'idle')
  let updatedNew = 0
  const replacement = {
    waiting: null, installing: null,
    addEventListener() {},
    async update() { updatedNew++ },
  }
  h.navigator.serviceWorker.getRegistration = async () => replacement
  h.workerEvents.get('controllerchange')()
  await flush()
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'idle')
  assert.equal(await h.mod.checkXDrivePwaUpdate(), 'checked')
  assert.equal(updatedNew, 1)
  h.registration.waiting = {}
  h.regEvents.get('updatefound')()
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'checked',
    'retired worker must never advertise waiting again')
})

test('S3D1: successful registration recovery clears stale lookup errors and retired checked state', async () => {
  const h = harness({ waiting: false })
  h.mod.startXDrivePwaUpdateObservation()
  await flush()
  h.navigator.serviceWorker.getRegistration = async () => { throw Error('browser storage temporarily unavailable') }
  h.events.get('pageshow')()
  await flush()
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'error')
  h.navigator.serviceWorker.getRegistration = async () => h.registration
  h.events.get('pageshow')()
  await flush()
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'idle',
    'successful registration discovery must clear obsolete error')
  assert.equal(await h.mod.checkXDrivePwaUpdate(), 'checked')
  const replacement = { waiting: null, installing: null, addEventListener() {}, async update() {} }
  h.navigator.serviceWorker.getRegistration = async () => replacement
  h.events.get('pageshow')()
  await flush()
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'idle',
    'replacement SW is not already checked merely because the retired one was')
})

test('S3D1: pageshow superseding an in-flight update clears checking without false success', async () => {
  const h = harness({ waiting: false })
  h.mod.startXDrivePwaUpdateObservation()
  await flush()
  let release
  h.registration.update = () => new Promise(resolve => { release = resolve })
  const pending = h.mod.checkXDrivePwaUpdate({ timeoutMs: 1000 })
  await flush()
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'checking')
  h.events.get('pageshow')()
  await flush()
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'idle',
    'live browser registration superseded a pending check; UI must be retryable')
  // Do not resolve the old browser update yet: the new user click must really
  // call update() again instead of reusing an obsolete in-flight Promise.
  let retried = 0
  h.registration.update = async () => { retried++ }
  assert.equal(await h.mod.checkXDrivePwaUpdate(), 'checked')
  assert.equal(retried, 1, 'superseded check must not consume a new click')
  release()
  assert.equal(await pending, 'checked')
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'checked',
    'late old browser update must not overwrite the retry result')
})

test('S3A Safari: denied optional BroadcastChannel cannot block Web boot or SW checks', async () => {
  for (const channelFailure of ['constructor', 'listener', 'send']) {
    const h = harness({ waiting: true, channelFailure })
    assert.doesNotThrow(() => h.mod.startXDrivePwaUpdateObservation(),
      `optional channel ${channelFailure} must not throw into main.tsx before React render`)
    await flush()
    assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'waiting',
      'a real local waiting worker must remain visible even without cross-window hints')
    assert.equal(h.mod.xDrivePwaUpdateSnapshot().otherWindowReportedUpdate, false)
    assert.equal(h.channelClosed, channelFailure === 'constructor' ? 0 : 1)
    assert.equal(await h.mod.checkXDrivePwaUpdate(), 'waiting',
      'manual user update checks must still operate without a channel')
    assert.equal(h.checked, 1)
  }
  const h = harness({ waiting: false, channelFailure: 'constructor' })
  h.mod.startXDrivePwaUpdateObservation()
  await flush()
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'idle')
  assert.equal(await h.mod.checkXDrivePwaUpdate(), 'checked')
  assert.equal(h.mod.xDrivePwaUpdateSnapshot().phase, 'checked')
})

test('S3A Safari: denied Service Worker getter, controller listener or ready never aborts pre-React startup', async () => {
  // Exercise the real production module transpiled by the existing harness,
  // not a hand-written approximation of the startup observer.
  for (const failure of ['getter', 'listener', 'ready', 'controller']) {
    const events = new Map()
    let found = {
      waiting: {}, installing: null,
      addEventListener() {},
      async update() {},
    }
    const worker = {
      async getRegistration() { return found },
      addEventListener() {
        if (failure === 'listener') throw new Error('SW controller listener denied')
      },
    }
    if (failure === 'controller') {
      Object.defineProperty(worker, 'controller', {
        get() { throw new Error('SW controller getter denied') },
      })
    } else worker.controller = {}
    if (failure === 'ready') {
      Object.defineProperty(worker, 'ready', {
        get() { throw new Error('SW ready getter denied') },
      })
    } else worker.ready = Promise.resolve(found)
    const navigator = { onLine: true }
    if (failure === 'getter') {
      Object.defineProperty(navigator, 'serviceWorker', {
        get() { throw new Error('SW container getter denied') },
      })
    } else navigator.serviceWorker = worker
    const win = {
      isSecureContext: true,
      addEventListener(kind, fn) { events.set(kind, fn) },
    }
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const exports = {}
    new Function('exports', 'window', 'navigator', 'BroadcastChannel', code)(
      exports, win, navigator, undefined)
    assert.doesNotThrow(() => exports.startXDrivePwaUpdateObservation(), failure)
    await flush()
    const expected = failure === 'getter' ? 'unsupported'
      : failure === 'controller' ? 'idle' : 'waiting'
    assert.equal(exports.xDrivePwaUpdateSnapshot().phase, expected, failure)
    assert.equal(exports.xDrivePwaUpdateSnapshot().hasController,
      failure !== 'getter' && failure !== 'controller')
    assert.equal(await exports.checkXDrivePwaUpdate(),
      failure === 'getter' ? 'unsupported' : failure === 'controller' ? 'checked' : 'waiting')
    if (failure === 'listener' || failure === 'ready') {
      found = undefined
      events.get('pageshow')()
      await flush()
      assert.equal(exports.xDrivePwaUpdateSnapshot().phase, 'idle',
        'a denied optional observer must not strand an obsolete waiting result')
    }
  }
})

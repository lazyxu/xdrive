const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'web/src/pwaUpdates.ts'), 'utf8')
function harness({ supported = true, secure = true, waiting = true, online = true, updateGate = null, lookupGate = null } = {}) {
  const events = new Map(), workerEvents = new Map(), regEvents = new Map(), messages = []
  let checked = 0
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
    constructor(name) { this.name = name }
    addEventListener(kind, fn) { this.receive = fn }
    postMessage(data) { messages.push(data) }
  }
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  new Function('exports', 'window', 'navigator', 'BroadcastChannel', code)(exports, win, navigator, Channel)
  return { mod: exports, win, navigator, registration, events, regEvents, messages,
    get checked() { return checked } }
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

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'web/src/pwaUpdates.ts'), 'utf8')
function harness({ supported = true, secure = true, waiting = true, online = true } = {}) {
  const events = new Map(), workerEvents = new Map(), regEvents = new Map(), messages = []
  let checked = 0
  const registration = {
    waiting: waiting ? {} : null, installing: null,
    addEventListener(kind, fn) { regEvents.set(kind, fn) },
    async update() { checked += 1 },
  }
  const worker = {
    controller: {},
    ready: Promise.resolve(registration),
    async getRegistration() { return registration },
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

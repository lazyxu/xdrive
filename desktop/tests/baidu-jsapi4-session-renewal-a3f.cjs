'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const modulePath = 'ui/shared/src/media-gallery-baidu-jsapi4-session-lifecycle.ts'
const result = ts.transpileModule(read(modulePath), {
  reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
})
assert.equal((result.diagnostics || []).filter(d =>
  d.category === ts.DiagnosticCategory.Error).length, 0)
const obj = { exports: {} }
new Function('module', 'exports', 'require', result.outputText)(obj, obj.exports,
  () => { throw Error('map Cookie renewal cannot have runtime imports') })
const { xDriveKeepBaiduJSAPI4MapSessionAlive: start, XDRIVE_BAIDU_SESSION_RENEW_AFTER_MS: after,
  XDRIVE_BAIDU_SESSION_RENEW_POLL_MS: poll } = obj.exports
const yes = { provider: 'baidu-jsapi-4.0', runtime_enabled: true }
const drain = () => new Promise(resolve => setImmediate(resolve))

function fixture() {
  const original = { now: Date.now, setInterval: global.setInterval,
    clearInterval: global.clearInterval }
  let now = 1000
  let fired
  let stopped = false
  let visible = 'visible'
  const events = new Map(), windowEvents = new Map()
  const host = (map) => ({
    addEventListener(name, fn) { map.set(name, fn) },
    removeEventListener(name, fn) { if (map.get(name) === fn) map.delete(name) },
  })
  const doc = {
    ...host(events), defaultView: host(windowEvents),
    get visibilityState() { return visible },
  }
  Date.now = () => now
  global.setInterval = (fn, duration) => {
    assert.equal(duration, poll)
    fired = fn
    stopped = false
    return 101
  }
  global.clearInterval = id => { assert.equal(id, 101); stopped = true }
  return {
    doc, events, windowEvents,
    advance(ms) { now += ms },
    visibility(value) { visible = value; events.get('visibilitychange')?.() },
    resume() { windowEvents.get('pageshow')?.() },
    tick() { assert.ok(fired); fired() },
    get stopped() { return stopped },
    restore() {
      Date.now = original.now
      global.setInterval = original.setInterval
      global.clearInterval = original.clearInterval
    },
  }
}

test('A3f: 2-minute Map Cookie renews on active map without remount or new AK', async () => {
  const f = fixture()
  try {
    const controller = new AbortController()
    let minted = 0, lost = 0
    const stop = start(async signal => {
      assert.equal(signal, controller.signal)
      minted++
      return yes
    }, controller.signal, f.doc, () => { lost++ })
    assert.equal(after, 60000)
    f.advance(30000); f.tick(); await drain()
    assert.equal(minted, 0, 'do not spam Server between renewals')
    f.advance(30000); f.tick(); await drain()
    assert.equal(minted, 1, 'renew BEFORE 120-second hard expiry')
    f.advance(60000); f.tick(); await drain()
    assert.equal(minted, 2)
    controller.abort()
    assert.equal(f.stopped, true, 'map unmount cancels interval immediately')
    f.advance(60000); f.tick(); await drain()
    assert.equal(minted, 2)
    assert.equal(lost, 0)
    stop()
  } finally { f.restore() }
})

test('A3f: suspended iOS/PWA tab does not poll; foreground resumes real Owner session', async () => {
  const f = fixture()
  try {
    let minted = 0
    const ctl = new AbortController()
    const stop = start(async () => { minted++; return yes },
      ctl.signal, f.doc, () => { throw Error('must not revoke') })
    f.visibility('hidden')
    f.advance(200000); f.tick(); await drain()
    assert.equal(minted, 0)
    f.visibility('visible'); await drain()
    assert.equal(minted, 1)
    f.advance(70000); f.resume(); await drain()
    assert.equal(minted, 2, 'Safari pageshow also renews')
    stop()
    assert.equal(f.stopped, true)
    assert.equal(f.events.size, 0)
    assert.equal(f.windowEvents.size, 0)
  } finally { f.restore() }
})

test('A3f: rejected or revoked session closes native map once; no stale retries', async () => {
  const f = fixture()
  try {
    let lost = 0, tries = 0
    const ctl = new AbortController()
    start(async () => {
      tries++
      return { provider: 'baidu-jsapi-4.0', runtime_enabled: false }
    }, ctl.signal, f.doc, () => { lost++ })
    f.advance(60000); f.tick(); await drain()
    assert.equal(tries, 1)
    assert.equal(lost, 1)
    assert.equal(f.stopped, true)
    f.advance(60000); f.tick(); await drain()
    assert.equal(tries, 1)
    assert.equal(lost, 1)
  } finally { f.restore() }
})

test('A3f: in-flight session is coalesced and late revoked/aborted responses ignored', async () => {
  const f = fixture()
  try {
    let resolve, tries = 0, lost = 0
    const ctl = new AbortController()
    const stop = start(() => {
      tries++
      return new Promise(r => { resolve = r })
    }, ctl.signal, f.doc, () => { lost++ })
    f.advance(60000); f.tick()
    f.advance(30000); f.tick()
    assert.equal(tries, 1, 'one in-flight map refresh')
    ctl.abort()
    resolve({ provider: 'baidu-jsapi-4.0', runtime_enabled: false })
    await drain()
    assert.equal(lost, 0, 'aborted Owner must not mutate next Gallery')
    assert.equal(f.stopped, true)
    stop()
  } finally { f.restore() }
})

test('A3f: shared mounted PhotoSurface owns refresh; Admin reports CURRENT Server authority', () => {
  const surface = read('ui/shared/src/mui/MediaGalleryBaiduJSAPI4PhotoSurface.tsx')
  const panel = read('ui/shared/src/mui/BaiduJSAPIDesiredPanel.tsx')
  const server = read('internal/baidumapjsapi/session.go')
  const api = read('web/src/api.ts')
  assert.match(server, /MapSessionTTL\s*=\s*2 \* time.Minute/)
  assert.match(surface, /xDriveKeepBaiduJSAPI4MapSessionAlive\(/)
  assert.match(surface, /stopRenewal\?\.\(\)/)
  assert.match(surface, /bridge\?\.dispose\(\)/)
  assert.match(surface, /pending\.abort\(\)/)
  assert.match(panel, /result\.runtime_enabled/)
  assert.match(panel, /当前 Server 已完成签名授权/)
  assert.match(panel, /当前 Server 尚未授权运行/)
  assert.match(api, /credentials: 'same-origin'/)
  assert.doesNotMatch(read(modulePath), /localStorage|sessionStorage|BMAP_PROXY_URL|api\.map\.baidu\.com/)
})

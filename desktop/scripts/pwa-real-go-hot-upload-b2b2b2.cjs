#!/usr/bin/env node
'use strict'
// P0-B2b2b-2a: Browser sends REAL 17 MiB chunks to production cmd/server A,
// first chunk physically committed; independently SIGKILL A and use true Caddy
// reload to B; SAME JWT/upload ID/resume key continue on B and finalize.
// This validates actual HTTP protocol, not the production Files picker UI.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')

const env = process.env
const fields = [
  'XD_PWA_HOT_UPLOAD_OUTPUT', 'XD_PWA_HOT_UPLOAD_CADDY_COMMON',
  'XD_PWA_HOT_UPLOAD_CADDY_NAME', 'XD_PWA_HOT_UPLOAD_CADDY_PORT',
  'XD_PWA_HOT_UPLOAD_GO_A_PORT', 'XD_PWA_HOT_UPLOAD_GO_B_PORT',
  'XD_PWA_HOT_UPLOAD_GO_A_PID', 'XD_PWA_HOT_UPLOAD_A_SHA',
  'XD_PWA_HOT_UPLOAD_B_SHA', 'XD_PWA_HOT_UPLOAD_A_DIST',
  'XD_PWA_HOT_UPLOAD_B_DIST', 'XDRIVE_BROWSER_EXECUTABLE'
]
for (const field of fields) assert(env[field], field + ' is required')
const port = env.XD_PWA_HOT_UPLOAD_CADDY_PORT
const origin = 'http://127.0.0.1:' + port
const goAPort = env.XD_PWA_HOT_UPLOAD_GO_A_PORT
const goBPort = env.XD_PWA_HOT_UPLOAD_GO_B_PORT
const container = env.XD_PWA_HOT_UPLOAD_CADDY_NAME
const commonFile = env.XD_PWA_HOT_UPLOAD_CADDY_COMMON
const pidA = Number(env.XD_PWA_HOT_UPLOAD_GO_A_PID)
assert(Number.isSafeInteger(pidA) && pidA > 1)
const output = path.resolve(env.XD_PWA_HOT_UPLOAD_OUTPUT)
fs.mkdirSync(output, { recursive: true })
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const summary = {
  schema: 'xdrive-pwa-real-17m-go-kill-resume-b2b2b2a-v1',
  sourceA: env.XD_PWA_HOT_UPLOAD_A_SHA,
  sourceB: env.XD_PWA_HOT_UPLOAD_B_SHA,
  browser: 'genuine-Chromium-390px-emulation',
  actualGoASigkill: false, realCaddyReload: false,
  originalJWTReused: false, originalUploadSessionReused: false,
  first8MiBCommittedBeforeGoDeath: false, originalChunk0NeverReuploaded: false,
  chunkCount: 3, fileBytes: 17 * 1024 * 1024,
  actualHttpFileChunks: false, productionFilePicker: false,
  oldSWWaitingVerified: false, physicalGoCASPostflight: false,
  physicalIOS: false, passed: false
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
function realCaddyB() {
  const original = fs.readFileSync(commonFile, 'utf8')
  assert(original.includes('reverse_proxy 127.0.0.1:' + goAPort),
    'original Caddy upstream A missing')
  const updated = original.replaceAll('reverse_proxy 127.0.0.1:' + goAPort,
    'reverse_proxy 127.0.0.1:' + goBPort)
  assert.notEqual(updated, original)
  // Rewrite only the private host-mounted Caddyfile; run genuine Caddy reload.
  fs.writeFileSync(commonFile, updated)
  const result = spawnSync('docker', ['exec', container, 'caddy', 'reload',
    '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'],
  { encoding: 'utf8', timeout: 20000 })
  assert.equal(result.status, 0, 'authentic Caddy reload A->B failed')
}
async function version(context, wanted) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const response = await context.request.get(origin + '/api/v1/version',
      { timeout: 3000 }).catch(() => null)
    if (response?.status() === 200) {
      const body = await response.json()
      if (body.version === wanted) return
    }
    await sleep(150)
  }
  throw new Error('genuine Caddy never served the expected Go build')
}
async function verifyDeadOldGo() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + goAPort + '/api/v1/version',
        { signal: AbortSignal.timeout(1200) })
      if (r.ok) {
        await sleep(100)
        continue
      }
    } catch {
      return
    }
    await sleep(100)
  }
  throw new Error('real Go A still serving HTTP after SIGKILL')
}
function parseLazy(dir) {
  const entries = JSON.parse(fs.readFileSync(path.join(dir, '.vite/manifest.json'), 'utf8'))
  const dynamic = Object.values(entries).filter(v => v.isDynamicEntry &&
    /^assets\/[A-Za-z0-9_./-]+-[A-Za-z0-9_-]{6,}\.js$/.test(v.file || ''))
  assert(dynamic.length > 0)
  const file = dynamic[0].file
  const bytes = fs.readFileSync(path.join(dir, file))
  return { path: '/' + file, sha: digest(bytes), bytes: bytes.length }
}
async function phaseA(page) {
  return page.evaluate(async () => {
    const size = 17 * 1024 * 1024
    const chunk = 8 * 1024 * 1024
    const data = new Uint8Array(size)
    for (let i = 0; i < size; i++) data[i] = (i * 31 + (i >> 7)) % 251
    const toHash = async input => Array.from(new Uint8Array(
      await crypto.subtle.digest('SHA-256', input)
    )).map(x => x.toString(16).padStart(2, '0')).join('')
    const entire = await toHash(data)
    const token = localStorage.getItem('xdrive.access_token')
    if (!token || token.length < 16) throw new Error('actual owner login required')
    const rootResponse = await fetch('/api/v1/nodes/root',
      { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' })
    if (!rootResponse.ok) throw new Error('owner root unavailable on Go A')
    const root = await rootResponse.json()
    const key = 'pwa-b2b2b2-17m-hot'
    const descriptor = {
      parent_id: root.id, name: 'pwa-b2b2b2-hot-upload.bin',
      size, chunk_size: chunk, sha256: entire, resume_key: key,
      conflict_policy: 'fail'
    }
    const init = await fetch('/api/v1/uploads', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json' },
      body: JSON.stringify(descriptor), cache: 'no-store'
    })
    if (init.status !== 201) throw new Error('new real upload session not created on Go A')
    const session = await init.json()
    if (!session.id || session.status !== 'active' || session.chunk_count !== 3)
      throw new Error('real initial upload session contract invalid')
    const first = data.subarray(0, chunk)
    const firstHash = await toHash(first)
    const response = await fetch('/api/v1/uploads/' + session.id + '/chunks/0', {
      method: 'PUT', headers: { Authorization: 'Bearer ' + token,
        'X-Chunk-SHA256': firstHash, 'Content-Type': 'application/octet-stream' },
      body: first, cache: 'no-store'
    })
    if (response.status !== 201) throw new Error('real first 8MiB chunk not committed')
    const part = await response.json()
    if (part.index !== 0 || part.size !== chunk || part.sha256 !== firstHash)
      throw new Error('first physical chunk response invalid')
    const status = await fetch('/api/v1/uploads/' + session.id, {
      headers: { Authorization: 'Bearer ' + token }, cache: 'no-store'
    })
    if (!status.ok) throw new Error('original Go A upload status missing')
    const snapshot = await status.json()
    if (snapshot.received_chunks?.length !== 1 ||
      snapshot.received_chunks[0].index !== 0 ||
      snapshot.received_chunks[0].sha256 !== firstHash)
      throw new Error('first upload chunk metadata not durably recorded on Go A')
    window.__pwaHotUpload = { bytes: data, token, descriptor,
      sessionId: session.id, entire, firstHash, rootId: root.id }
    return { firstCommitted: true, chunkCount: session.chunk_count }
  })
}
async function phaseB(page) {
  return page.evaluate(async () => {
    const state = window.__pwaHotUpload
    if (!state || state.bytes.length !== 17 * 1024 * 1024 ||
      localStorage.getItem('xdrive.access_token') !== state.token)
      throw new Error('original browser page, buffer or JWT changed')
    const auth = { Authorization: 'Bearer ' + state.token }
    const id = state.sessionId
    const existing = await fetch('/api/v1/uploads/' + id,
      { headers: auth, cache: 'no-store' })
    if (existing.status !== 200) throw new Error('Go B cannot read Go A original session')
    const snapshot = await existing.json()
    if (snapshot.status !== 'active' || snapshot.received_chunks?.length !== 1 ||
      snapshot.received_chunks[0].index !== 0 ||
      snapshot.received_chunks[0].sha256 !== state.firstHash)
      throw new Error('Go B did not preserve original committed first chunk')
    const resume = await fetch('/api/v1/uploads', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(state.descriptor), cache: 'no-store'
    })
    if (resume.status !== 200) throw new Error('real upload resume lookup failed')
    const reused = await resume.json()
    if (reused.id !== id || reused.received_chunks?.length !== 1 ||
      reused.received_chunks[0].index !== 0)
      throw new Error('real resumed upload session ID/chunk0 changed')
    const chunk = 8 * 1024 * 1024
    for (let i = 1; i < 3; i++) {
      const bytes = state.bytes.subarray(i * chunk, Math.min((i + 1) * chunk, state.bytes.length))
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
        .map(x => x.toString(16).padStart(2, '0')).join('')
      const response = await fetch('/api/v1/uploads/' + id + '/chunks/' + i, {
        method: 'PUT',
        headers: { ...auth, 'X-Chunk-SHA256': hash,
          'Content-Type': 'application/octet-stream' },
        body: bytes, cache: 'no-store'
      })
      if (response.status !== 201) throw new Error('Go B real chunk upload failed')
      const part = await response.json()
      if (part.index !== i || part.sha256 !== hash || part.size !== bytes.length)
        throw new Error('Go B confirmed incorrect physical chunk hash/length')
    }
    const final = await fetch('/api/v1/uploads/' + id + '/finalize',
      { method: 'POST', headers: auth, cache: 'no-store' })
    if (final.status !== 200) throw new Error('Go B durable upload finalize failed')
    const answer = await final.json()
    if (answer.status !== 'finalized' || !answer.result?.id ||
      answer.sha256 !== state.entire)
      throw new Error('Go B finalized mismatched upload or absent Node')
    const query = await fetch('/api/v1/nodes/' + answer.result.id,
      { headers: auth, cache: 'no-store' })
    if (query.status !== 200) throw new Error('Go B new physical Node unreadable')
    const repeated = await fetch('/api/v1/uploads/' + id + '/finalize',
      { method: 'POST', headers: auth, cache: 'no-store' })
    if (repeated.status !== 200) throw new Error('idempotent finalize must be safe')
    const second = await repeated.json()
    if (second.result?.id !== answer.result.id || second.sha256 !== state.entire)
      throw new Error('duplicate finalize unexpectedly changed File/Node')
    const again = await fetch('/api/v1/uploads', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(state.descriptor), cache: 'no-store'
    })
    if (again.status !== 200 || (await again.json()).id !== id)
      throw new Error('post-finalize resume key must not create duplicate upload')
    return { sameOriginalID: true, onlyNewChunksOnB: true,
      idempotentFinalize: true, byteCount: state.bytes.length }
  })
}
async function checkPublicCache(page) {
  const paths = await page.evaluate(async () => {
    const paths = []
    for (const name of await caches.keys()) {
      const c = await caches.open(name)
      for (const r of await c.keys()) paths.push(new URL(r.url).pathname)
    }
    return paths
  })
  assert(paths.includes('/index.html'))
  assert(!paths.some(p => p.startsWith('/api/') ||
    /upload|download|token|media\/items/.test(p)), 'SW leaked private files')
}
async function main() {
  let browser
  try {
    assert(/^[a-f0-9]{40}$/.test(summary.sourceA))
    assert(/^[a-f0-9]{40}$/.test(summary.sourceB))
    assert.notEqual(summary.sourceA, summary.sourceB)
    const a = parseLazy(env.XD_PWA_HOT_UPLOAD_A_DIST)
    const b = parseLazy(env.XD_PWA_HOT_UPLOAD_B_DIST)
    browser = await chromium.launch({ executablePath: env.XDRIVE_BROWSER_EXECUTABLE,
      headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true,
      hasTouch: true, serviceWorkers: 'allow'
    })
    const page = await context.newPage()
    await version(context, 'pwa-b2b2b2-A')
    for (const asset of [a, b]) {
      const response = await context.request.get(origin + asset.path)
      assert.equal(response.status(), 200)
      assert.match(response.headers()['cache-control'] || '', /immutable/)
      assert.match(response.headers()['content-type'] || '', /javascript|ecmascript/)
      const data = await response.body()
      assert.equal(data.length, asset.bytes)
      assert.equal(digest(data), asset.sha)
    }
    const initial = await page.goto(origin + '/#/app/files', { waitUntil: 'commit' })
    assert.equal(initial?.status(), 200)
    await page.locator('#web-login-username').waitFor({ state: 'visible', timeout: 30000 })
    await page.locator('#web-login-username').fill('pwa-b2b2b1-owner')
    await page.locator('#web-login-password').fill('Pwa-B2b2b1-Synthetic-Only_2026!')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.waitForFunction(() =>
      (localStorage.getItem('xdrive.access_token') || '').length > 16)
    await page.evaluate(() => navigator.serviceWorker.ready)
    const controlledReload = await page.reload({ waitUntil: 'commit' })
    assert.equal(controlledReload?.status(), 200)
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null,
      { timeout: 30000 })
    const initialControl = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || '')
    assert(initialControl.endsWith('/sw.js'), 'original Service Worker must control the old Web tab')
    const sentA = await phaseA(page)
    assert(sentA.firstCommitted && sentA.chunkCount === 3)
    summary.first8MiBCommittedBeforeGoDeath = true
    // Independent Node controller terminates the actual native Go A process.
    process.kill(pidA, 'SIGKILL')
    await verifyDeadOldGo()
    summary.actualGoASigkill = true
    // Before native Caddy reload this upstream cannot fake an API success.
    const interrupted = await context.request.get(origin + '/api/v1/version',
      { timeout: 5000 })
    assert.equal(interrupted.status(), 502, 'dead Go A must be surfaced as proxy failure')
    realCaddyB()
    summary.realCaddyReload = true
    await version(context, 'pwa-b2b2b2-B')
    const sentB = await phaseB(page)
    assert.equal(sentB.byteCount, 17 * 1024 * 1024)
    summary.originalUploadSessionReused = sentB.sameOriginalID
    summary.originalChunk0NeverReuploaded = sentB.onlyNewChunksOnB
    summary.originalJWTReused = true
    summary.actualHttpFileChunks = sentB.idempotentFinalize
    assert.equal(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || ''),
      initialControl)
    await checkPublicCache(page)
    summary.passed = true
    console.log('PWA_B2B2B2_REAL_17M_SIGKILL_RESUME_HTTP_PASSED')
    await context.close()
  } catch (error) {
    summary.errorClass = (error?.name || 'Error').replace(/[^A-Za-z0-9]/g, '').slice(0, 50)
    // Don't serialize JWT, session IDs, owner names or browser URLs.
    console.error('PWA_B2B2B2_FAIL ' + summary.errorClass)
    process.exitCode = 1
  } finally {
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
    await browser?.close()
  }
}
void main()

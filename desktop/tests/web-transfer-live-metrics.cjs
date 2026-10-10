const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { createHash, webcrypto } = require('node:crypto')
const { File } = require('node:buffer')

const repo = path.join(__dirname, '..', '..')
const initialNow = Date.parse('2026-10-08T12:00:00Z')

// Only browser/network boundaries are substituted. The API, transfer store,
// rate bookkeeping, shared transfer semantics and transports execute unchanged.
function createBrowser(fetchResponse = () => { throw new Error('Unexpected fetch') }) {
  let now = initialNow
  let nextTimer = 0
  const timers = new Map()
  const persisted = new Map()
  const downloads = []
  const requests = []
  const uploads = []
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return now }
  }
  class UploadRequest {
    upload = {}
    headers = {}
    status = 0
    statusText = ''
    responseText = ''
    open(method, url) { this.method = method; this.url = url }
    setRequestHeader(name, value) { this.headers[name] = value }
    send(body) { this.body = body; uploads.push(this) }
    abort() { this.aborted = true; this.onabort?.() }
    progress(loaded) { this.upload.onprogress?.({ loaded, total: this.body.byteLength, lengthComputable: true }) }
    finish(status = 204, body = '') {
      this.status = status
      this.responseText = body
      this.onload?.()
    }
  }
  const context = vm.createContext({
    console, Date: Clock, Headers, Response, FormData, Blob, File,
    URL, TextEncoder, Uint8Array, ArrayBuffer, ReadableStream,
    AbortController, DOMException, crypto: webcrypto,
    performance: { now: () => now },
    XMLHttpRequest: UploadRequest,
    setTimeout(callback, milliseconds) {
      const id = ++nextTimer
      timers.set(id, { callback, due: now + milliseconds })
      return id
    },
    clearTimeout(id) { timers.delete(id) },
    localStorage: {
      getItem: (key) => persisted.get(key) ?? null,
      setItem: (key, value) => persisted.set(key, value),
      removeItem: (key) => persisted.delete(key),
    },
    document: {
      body: { appendChild() {} },
      createElement(tag) {
        assert.equal(tag, 'a')
        return { href: '', download: '', remove() {}, click() { downloads.push({ url: this.href, name: this.download }) } }
      },
    },
    async fetch(url, init = {}) {
      requests.push({ url, init })
      return fetchResponse(url, init)
    },
  })
  context.window = context
  const modules = new Map()
  function load(filename) {
    filename = path.resolve(filename)
    if (modules.has(filename)) return modules.get(filename).exports
    const module = { exports: {} }
    modules.set(filename, module)
    const source = fs.readFileSync(filename, 'utf8').replace(/import\.meta\.env\.VITE_API_BASE/g, 'undefined')
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const execute = vm.runInContext(`(function(require, module, exports) { ${compiled}\n})`, context, { filename })
    execute((specifier) => {
      if (specifier === '../../ui/shared/src') return load(path.join(repo, 'ui/shared/src/transfers.ts'))
      return load(path.resolve(path.dirname(filename), specifier + '.ts'))
    }, module, module.exports)
    return module.exports
  }
  const { XDriveApi } = load(path.join(repo, 'web/src/api.ts'))
  const { webTransferStore: store } = load(path.join(repo, 'web/src/transfers.ts'))
  const makeApi = (token = 'token-a', refreshToken = '', onSession, accessExpiresAt = 0) => new XDriveApi({ accessToken: token, refreshToken, accessExpiresAt }, onSession)
  async function flush() { for (let index = 0; index < 100; index++) await Promise.resolve() }
  return {
    store, makeApi, context, requests, downloads, uploads, timers,
    now: () => now,
    flush,
    async advance(milliseconds) {
      now += milliseconds
      for (const [id, timer] of [...timers]) {
        if (timer.due > now) continue
        timers.delete(id)
        timer.callback()
      }
      await flush()
    },
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

async function waitForUpload(browser, count = 1) {
  const deadline = Date.now() + 5000
  while (browser.uploads.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.equal(browser.uploads.length, count, 'upload must expose progress before the response arrives')
  return browser.uploads[count - 1]
}

function transferUnmountEffect(api, microtasks) {
  const filename = path.join(repo, 'web/src/App.tsx')
  const source = fs.readFileSync(filename, 'utf8')
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let callback
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useEffect' &&
      node.arguments[0]?.getText(parsed).includes('disposeTransfers')) callback = node.arguments[0].getText(parsed)
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  assert.ok(callback, 'App must clean up transfer ownership on actual unmount')
  const compiled = ts.transpileModule(`const effect = ${callback};`, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText
  return new Function('transferApiRef', 'transferLifetimeRef', 'queueMicrotask', `${compiled}\nreturn effect`)(
    { current: api }, { current: 0 }, (callback) => microtasks.push(callback),
  )
}

test('React effect replay preserves a shared startup refresh while actual unmount disposes transfers', async () => {
  let resolveRefresh
  const sessions = []
  const microtasks = []
  const browser = createBrowser((url) => {
    if (url === '/api/v1/auth/refresh') return new Promise((resolve) => { resolveRefresh = resolve })
    if (url === '/api/v1/me') return json({ username: 'alice' })
    throw new Error(`Unexpected request: ${url}`)
  })
  const api = browser.makeApi('old-token', 'refresh-token', (session) => sessions.push(session), initialNow - 1)
  const effect = transferUnmountEffect(api, microtasks)
  const ordinary = api.me().catch((error) => error)
  api.setTransferSessionKey('server:alice')
  const firstCleanup = effect()
  await browser.flush()
  firstCleanup()
  api.setTransferSessionKey('server:alice')
  const finalCleanup = effect()
  for (const callback of microtasks.splice(0)) callback()
  resolveRefresh(json({ access_token: 'renewed', refresh_token: 'renewed-refresh', expires_in: 3600, username: 'alice' }))
  const result = await ordinary
  assert.equal(result.username, 'alice', 'StrictMode effect replay must not cancel valid startup authentication')
  assert.equal(sessions.length, 1)

  finalCleanup()
  for (const callback of microtasks.splice(0)) callback()
  await assert.rejects(api.download({ id: 7, name: 'closed.bin', size: 1000 }), { name: 'AbortError' })
  assert.equal(browser.downloads.length, 0)
})

test('wire rates ignore resumed logical bytes and preserve independent freshness', async () => {
  const browser = createBrowser()
  const { store } = browser
  const id = store.create({ fileName: 'resumed.bin', kind: 'upload', bytesTotal: 1000, speedSource: 'client' })
  await browser.advance(1000)
  store.progress(id, 600, 1000)
  assert.equal(store.snapshot()[0].instant_bytes_per_second, 0, 'reused completion bytes must not count as bytes sent')

  store.networkProgress(id, 100)
  let item = store.snapshot()[0]
  assert.equal(item.instant_bytes_per_second, 100)
  assert.equal(item.speed_source, 'client')
  const measuredAt = item.speed_updated_at
  await browser.advance(1000)
  store.progress(id, 900, 1000)
  item = store.snapshot()[0]
  assert.equal(item.speed_updated_at, measuredAt, 'logical bookkeeping must not freshen the last wire sample')
  store.complete(id, 1000, 1000)
  item = store.snapshot()[0]
  assert.equal(item.instant_bytes_per_second, 0)
  assert.equal(item.average_bytes_per_second, 100, 'completion must not recalculate speed from logical file size')
})

test('native file download reports server send progress without fetching a Blob', async () => {
  let progress = { transfer_id: 'stream-1', state: 'queued', bytes_sent: 0, bytes_total: 1000, updated_at: new Date(initialNow).toISOString() }
  const browser = createBrowser((url) => {
    if (url === '/api/v1/files/7/download-ticket') return json({ url: '/file-download/7?ticket=signed', transfer_id: 'stream-1', expires_at: '2026-10-08T12:10:00Z' })
    if (url === '/api/v1/download/progress/stream-1') return json(progress)
    throw new Error(`Unexpected body download: ${url}`)
  })
  const api = browser.makeApi()
  await api.download({ id: 7, name: 'native.bin', size: 1000 })
  await browser.flush()
  assert.equal(browser.store.snapshot().length, 1, 'native handoff must create a visible transfer')
  assert.deepEqual(browser.downloads, [{ url: '/file-download/7?ticket=signed', name: 'native.bin' }])
  progress = { ...progress, state: 'running', bytes_sent: 250, updated_at: new Date(initialNow + 1000).toISOString() }
  await browser.advance(1000)
  const running = browser.store.snapshot()[0]
  assert.equal(running.bytes_done, 250)
  assert.equal(running.instant_bytes_per_second, 250)
  assert.equal(running.speed_source, 'server')
  progress = { ...progress, state: 'completed', bytes_sent: 1000, updated_at: new Date(initialNow + 2000).toISOString() }
  await browser.advance(1000)
  assert.equal(browser.store.snapshot()[0].state, 'completed')
  assert.equal(browser.store.snapshot()[0].instant_bytes_per_second, 0)
})

test('native progress uses server sample times and ignores unchanged polling snapshots', async () => {
  const browser = createBrowser()
  const { store } = browser
  const id = store.create({ fileName: 'native.bin', kind: 'download', bytesTotal: 1000, speedSource: 'server' })
  assert.equal(store.snapshot()[0].speed_source, 'server')
  store.networkProgress(id, 0, '2026-10-08T10:00:00Z')
  await browser.advance(500)
  store.networkProgress(id, 100, '2026-10-08T10:00:01Z')
  let item = store.snapshot()[0]
  assert.equal(item.instant_bytes_per_second, 100, 'server sampling cadence, not polling cadence, determines server rate')
  assert.equal(item.speed_updated_at, new Date(initialNow + 500).toISOString(), 'freshness uses the local observation time despite server clock skew')
  await browser.advance(500)
  store.networkProgress(id, 100, '2026-10-08T10:00:01Z')
  item = store.snapshot()[0]
  assert.equal(item.speed_updated_at, new Date(initialNow + 500).toISOString())
})

test('native polling survives same-account API renewal and cannot update a replacement account', async () => {
  let resolveProgress
  const browser = createBrowser((url) => {
    if (url.endsWith('/download-ticket')) return json({ url: '/file-download/7?ticket=signed', transfer_id: 'stream-1', expires_at: '2026-10-08T12:10:00Z' })
    if (url.endsWith('/download/progress/stream-1')) return new Promise((resolve) => { resolveProgress = resolve })
    throw new Error(`Unexpected fetch: ${url}`)
  })
  const first = browser.makeApi()
  first.setTransferSessionKey?.('server:alice')
  await first.download({ id: 7, name: 'private.bin', size: 1000 })
  await browser.flush()
  assert.equal(browser.store.snapshot().length, 1)
  const renewed = browser.makeApi('token-renewed')
  renewed.setTransferSessionKey('server:alice')
  assert.equal(browser.store.snapshot().length, 1, 'token refresh must keep the active transfer')
  const next = browser.makeApi('token-b')
  next.setTransferSessionKey('server:bob')
  assert.equal(browser.store.snapshot().length, 0, 'old account files must leave the current store immediately')
  const oldRequest = browser.requests.find((request) => request.url.endsWith('/download/progress/stream-1'))
  assert.equal(oldRequest.init.signal.aborted, true, 'identity disposal must abort the pending progress request')
  resolveProgress(json({ transfer_id: 'stream-1', state: 'completed', bytes_sent: 1000, bytes_total: 1000, updated_at: new Date(initialNow).toISOString() }))
  await browser.flush()
  await browser.advance(2000)
  assert.equal(browser.store.snapshot().length, 0, 'a late old-account response must not publish history in the new account')
  assert.equal(browser.requests.filter((request) => request.url.endsWith('/download/progress/stream-1')).length, 1)
})

test('logout fences a shared token refresh first started by a normal API request', async () => {
  let resolveRefresh
  const savedSessions = []
  const browser = createBrowser((url) => {
    if (url === '/api/v1/auth/refresh') return new Promise((resolve) => { resolveRefresh = resolve })
    if (url === '/api/v1/me') return json({ username: 'alice' })
    throw new Error(`Unexpected post-logout request: ${url}`)
  })
  const api = browser.makeApi('old-token', 'refresh-token', (session) => savedSessions.push(session), initialNow - 1)
  api.setTransferSessionKey('server:alice')
  const ordinary = api.me().catch((error) => error)
  await browser.flush()
  assert.equal(browser.requests[0].url, '/api/v1/auth/refresh')
  assert.equal(browser.requests[0].init.signal, undefined, 'the refresh originated outside transfer tracking')
  const download = api.download({ id: 7, name: 'private.bin', size: 1000 }).catch((error) => error)
  await browser.flush()
  api.disposeTransfers()
  resolveRefresh(json({ access_token: 'late-token', refresh_token: 'late-refresh', expires_in: 3600, username: 'alice' }))
  const [ordinaryResult, transferResult] = await Promise.all([ordinary, download])
  assert.equal(savedSessions.length, 0, 'a late refresh must not sign the disposed account back in')
  assert.equal(ordinaryResult.name, 'AbortError')
  assert.equal(transferResult.name, 'AbortError')
  assert.equal(browser.downloads.length, 0)
  assert.equal(browser.store.snapshot().length, 0)
})

test('refresh started before session registration cannot restore a disposed lifecycle', async (t) => {
  for (const replacement of ['none', 'new-api', 'same-api']) {
    await t.test(replacement, async () => {
      let resolveRefresh
      const savedSessions = []
      const browser = createBrowser((url) => {
        if (url === '/api/v1/auth/refresh') return new Promise((resolve) => { resolveRefresh = resolve })
        if (url === '/api/v1/me') return json({ username: 'alice' })
        throw new Error(`Unexpected request: ${url}`)
      })
      const api = browser.makeApi('old-token', 'refresh-token', (session) => savedSessions.push(session), initialNow - 1)
      // Child passive effects may request /me before App's session effect runs.
      const ordinary = api.me().catch((error) => error)
      await browser.flush()
      assert.equal(browser.requests[0].url, '/api/v1/auth/refresh')
      api.setTransferSessionKey('server:alice')
      api.disposeTransfers()
      if (replacement === 'new-api') browser.makeApi('new-login').setTransferSessionKey('server:alice')
      if (replacement === 'same-api') api.setTransferSessionKey('server:alice')
      resolveRefresh(json({ access_token: 'late-token', refresh_token: 'late-refresh', expires_in: 3600, username: 'alice' }))
      const result = await ordinary
      assert.equal(savedSessions.length, 0, 'a pre-registration refresh must not restore its disposed lifecycle')
      assert.equal(result.name, 'AbortError')
      assert.equal(browser.requests.some((request) => request.url === '/api/v1/me'), false)
    })
  }
})

test('first registration and same-account API renewal preserve a pending ordinary refresh', async () => {
  let resolveRefresh
  const savedSessions = []
  const browser = createBrowser((url) => url === '/api/v1/auth/refresh'
    ? new Promise((resolve) => { resolveRefresh = resolve })
    : json({ username: 'alice' }))
  const api = browser.makeApi('old-token', 'refresh-token', (session) => savedSessions.push(session), initialNow - 1)
  const ordinary = api.me()
  await browser.flush()
  api.setTransferSessionKey('server:alice')
  browser.makeApi('renewed-token').setTransferSessionKey('server:alice')
  resolveRefresh(json({ access_token: 'fresh-token', refresh_token: 'fresh-refresh', expires_in: 3600, username: 'alice' }))
  assert.equal((await ordinary).username, 'alice')
  assert.equal(savedSessions.length, 1)
  assert.equal(savedSessions[0].accessToken, 'fresh-token')
})

const pickerDownloads = {
  file: (api) => api.download({ id: 7, name: 'private.bin', size: 1000 }),
  version: (api) => api.downloadVersion({ id: 7, name: 'private.bin' }, { id: 2, size: 1000 }),
  archive: (api) => api.downloadArchive([7], 'private.zip'),
}

test('logout while acquiring a save destination aborts its writable before transport starts', async (t) => {
  for (const [name, download] of Object.entries(pickerDownloads)) {
    for (const waitingAt of ['picker', 'writable']) {
      await t.test(`${name}: ${waitingAt}`, async () => {
        let releaseDestination
        let aborted = 0
        let closed = 0
        const browser = createBrowser()
        const writable = { write: async () => {}, close: async () => { closed++ }, abort: async () => { aborted++ } }
        browser.context.showSaveFilePicker = waitingAt === 'picker'
          ? () => new Promise((resolve) => { releaseDestination = () => resolve({ createWritable: async () => writable }) })
          : async () => ({ createWritable: () => new Promise((resolve) => { releaseDestination = () => resolve(writable) }) })
        const api = browser.makeApi()
        api.setTransferSessionKey('server:alice')
        const completion = download(api).catch((error) => error)
        await browser.flush()
        api.disposeTransfers()
        browser.makeApi('new-login').setTransferSessionKey('server:alice')
        releaseDestination()
        const result = await completion
        assert.equal(result.name, 'AbortError')
        assert.equal(aborted, 1, 'the obsolete save destination must be aborted exactly once')
        assert.equal(closed, 0, 'the obsolete destination must not be committed')
        assert.equal(browser.requests.length, 0)
        assert.equal(browser.store.snapshot().length, 0)
      })
    }
  }
})

test('download failures before streaming settle every owned save destination exactly once', async (t) => {
  for (const [name, download] of Object.entries(pickerDownloads)) {
    await t.test(name, async () => {
      let aborted = 0
      let closed = 0
      const browser = createBrowser(() => json({ error: 'preparation unavailable' }, 503))
      browser.context.showSaveFilePicker = async () => ({ createWritable: async () => ({
        write: async () => {}, close: async () => { closed++ }, abort: async () => { aborted++ },
      }) })
      const result = await download(browser.makeApi()).catch((error) => error)
      assert.equal(result.status, 503)
      assert.equal(aborted, 1, 'a failed prepare or transport must release the chosen writable')
      assert.equal(closed, 0)
    })
  }
})

test('native launch timeout and server failure finish the task instead of polling forever', async () => {
  let failure = false
  const browser = createBrowser((url) => url.endsWith('/download-ticket')
    ? json({ url: '/file-download/7?ticket=signed', transfer_id: 'stream-1', expires_at: '2026-10-08T12:10:00Z' })
    : json({ transfer_id: 'stream-1', state: failure ? 'failed' : 'queued', error: failure ? 'connection reset' : '', bytes_sent: 0, bytes_total: 1000, updated_at: new Date(initialNow).toISOString() }))
  const api = browser.makeApi()
  await api.download({ id: 7, name: 'blocked.bin', size: 1000 })
  await browser.flush()
  assert.equal(browser.store.snapshot().length, 1)
  await browser.advance(61_000)
  assert.equal(browser.store.snapshot()[0].state, 'failed')
  assert.match(browser.store.snapshot()[0].error, /浏览器.*开始/)
  failure = true
  await api.downloadVersion({ id: 7, name: 'version.bin' }, { id: 2, size: 1000 })
  await browser.flush()
  assert.equal(browser.store.snapshot()[0].state, 'failed')
  assert.match(browser.store.snapshot()[0].error, /connection reset/)
})

test('upload in-flight bytes update rate before an 8 MiB chunk response arrives', async () => {
  const browser = createBrowser((url, init) => {
    if (url === '/api/v1/uploads') {
      const input = JSON.parse(init.body)
      return json({ id: 'upload-1', status: 'uploading', chunk_count: 1, chunk_size: 8 * 1024 * 1024, received_chunks: [], result: null, ...input })
    }
    if (url === '/api/v1/uploads/upload-1/finalize') return json({ status: 'finalized', result: { id: 9, name: 'large.bin' } })
    if (url.includes('/chunks/')) return new Promise(() => {})
    throw new Error(`Unexpected upload request: ${url}`)
  })
  const api = browser.makeApi()
  const file = new File([new Uint8Array(8 * 1024 * 1024)], 'large.bin')
  let finished = false
  const upload = api.uploadWithConflictPolicy(1, file, 'fail').then((result) => { finished = true; return result })
  // Real hashing is asynchronous; yield the event loop, not just microtasks.
  const request = await waitForUpload(browser)
  assert.equal(request.headers.Authorization, 'Bearer token-a')
  assert.equal(request.headers['Content-Type'], 'application/octet-stream')
  assert.match(request.headers['X-Chunk-SHA256'], /^[a-f0-9]{64}$/)
  await browser.advance(1000)
  request.progress(1024 * 1024)
  assert.equal(finished, false)
  const item = browser.store.snapshot()[0]
  assert.equal(item.bytes_done, 1024 * 1024)
  assert.equal(item.instant_bytes_per_second, 1024 * 1024)
  request.progress(file.size)
  request.finish()
  await upload
  assert.equal(browser.store.snapshot()[0].state, 'completed')
  assert.equal(browser.store.snapshot()[0].instant_bytes_per_second, 0)
})

test('folder wire counters include simultaneous children once without replacing business totals', async () => {
  const browser = createBrowser()
  const { store } = browser
  const group = store.startGroup({ fileName: 'folder', bytesTotal: 2000, itemsTotal: 2, speedSource: 'client' })
  const [first, second] = store.startChildren(group, [
    { fileName: 'a', relativePath: 'a', bytesTotal: 1000 },
    { fileName: 'b', relativePath: 'b', bytesTotal: 1000 },
  ])
  store.begin(first)
  store.begin(second)
  await browser.advance(1000)
  store.networkProgress(first, 100)
  store.networkProgress(second, 100)
  assert.equal(store.snapshot().find((item) => item.id === group).instant_bytes_per_second, 200)
  await browser.advance(1000)
  store.networkProgress(first, 200)
  const parent = store.snapshot().find((item) => item.id === group)
  assert.equal(parent.average_bytes_per_second, 150, 'parent must retain both children when samples arrive in the same millisecond')
  assert.equal(parent.bytes_done, 0, 'wire accounting must not invent logical folder progress')
})

test('unavailable native tracking preserves browser handoff without claiming download failure', async () => {
  for (const status of [0, 404, 503, 'transport', 'malformed']) {
    const withID = status !== 0
    const browser = createBrowser((url) => {
      if (url.endsWith('/download-ticket')) return json({ url: '/file-download/7?ticket=signed', ...(withID ? { transfer_id: 'missing' } : {}), expires_at: '2026-10-08T12:10:00Z' })
      if (status === 'transport') throw new TypeError('telemetry connection unavailable')
      return status === 'malformed' ? json({ state: 'unknown' }) : json({ error: 'progress unavailable' }, status)
    })
    await browser.makeApi().download({ id: 7, name: 'native.bin', size: 1000 })
    await browser.flush()
    assert.equal(browser.downloads.length, 1)
    assert.equal(browser.store.snapshot()[0].state, 'handed_off')
    assert.equal(browser.store.snapshot()[0].speed_source, undefined)
    assert.equal(browser.store.snapshot()[0].error, '')
    assert.equal(browser.timers.size, 0)
  }
})

test('native archive tracking fallback hands off the entire group without inventing success or failure', async () => {
  for (const status of [0, 404, 503, 'transport', 'malformed']) {
    const browser = createBrowser((url) => {
      if (url === '/api/v1/download/archive/prepare') return json({ transfer_id: 'prepare-1', state: 'completed', filename: 'folder.zip', total_bytes: 1000, files: [{ path: 'a.bin', size: 1000 }] })
      if (url.endsWith('/download-ticket')) return json({ url: '/archive-download/prepare-1?ticket=signed', ...(status !== 0 ? { transfer_id: 'wire-1' } : {}) })
      if (url === '/api/v1/download/archive/progress/prepare-1') return json({ transfer_id: 'prepare-1', state: 'completed', bytes_done: 1000, bytes_total: 1000, items_total: 1, items_completed: 1, items_failed: 0, items_running: 0, items_queued: 0, files: [{ path: 'a.bin', size: 1000, done: 1000, state: 'completed' }] })
      if (status === 'transport') throw new TypeError('telemetry connection unavailable')
      return status === 'malformed' ? json({ state: 'unknown' }) : json({ error: 'progress unavailable' }, status)
    })
    assert.equal(await browser.makeApi().downloadArchive([3], 'folder.zip'), true, `native handoff must remain valid: ${status}`)
    assert.equal(browser.downloads.length, 1)
    for (const item of browser.store.snapshot()) {
      assert.equal(item.state, 'handed_off', `unobserved archive results must be informational: ${status}`)
      assert.equal(item.instant_bytes_per_second, 0)
      assert.equal(item.error, '')
    }
    assert.equal(browser.timers.size, 0)
  }
})

test('native archive wire observation remains authoritative when process-local child progress is unavailable', async () => {
  let state = 'running'
  const browser = createBrowser((url) => {
    if (url === '/api/v1/download/archive/prepare') return json({ transfer_id: 'prepare-1', state: 'completed', filename: 'folder.zip', total_bytes: 1000, files: [{ path: 'a.bin', size: 1000 }] })
    if (url.endsWith('/download-ticket')) return json({ url: '/archive-download/prepare-1?ticket=signed', transfer_id: 'wire-1' })
    if (url === '/api/v1/download/archive/progress/prepare-1') return json({ error: 'not on this instance' }, 404)
    if (url === '/api/v1/download/progress/wire-1') return json({ transfer_id: 'wire-1', state, bytes_sent: state === 'completed' ? 1120 : 100, bytes_total: state === 'completed' ? 1120 : 0, updated_at: new Date(browser.now()).toISOString() })
    throw new Error(`Unexpected request: ${url}`)
  })
  const completion = browser.makeApi().downloadArchive([3], 'folder.zip').catch((error) => error)
  await browser.flush()
  assert.equal(browser.store.snapshot().find((item) => item.scope === 'group').state, 'running')
  state = 'completed'
  await browser.advance(1000)
  assert.equal(await completion, true)
  assert.equal(browser.store.snapshot().find((item) => item.scope === 'group').state, 'completed')
})

test('native archive speed uses response bytes while file children keep source progress', async () => {
  let logical = { transfer_id: 'prepare-1', state: 'running', bytes_done: 0, bytes_total: 1000, items_total: 1, items_completed: 0, items_failed: 0, items_running: 1, items_queued: 0, files: [{ path: 'folder/a.bin', size: 1000, done: 0, state: 'transferring' }] }
  let wire = { transfer_id: 'wire-1', state: 'queued', bytes_sent: 0, bytes_total: 0, updated_at: new Date(initialNow).toISOString() }
  const browser = createBrowser((url) => {
    if (url === '/api/v1/download/archive/prepare') return json({ transfer_id: 'prepare-1', state: 'completed', filename: 'folder.zip', total_bytes: 1000, files: [{ path: 'folder/a.bin', size: 1000 }] })
    if (url.endsWith('/download-ticket')) return json({ url: '/archive-download/prepare-1?ticket=signed', transfer_id: 'wire-1', expires_at: '2026-10-08T12:10:00Z' })
    if (url === '/api/v1/download/archive/progress/prepare-1') return json(logical)
    if (url === '/api/v1/download/progress/wire-1') return json(wire)
    throw new Error(`Unexpected archive request: ${url}`)
  })
  const completion = browser.makeApi().downloadArchive([3], 'folder.zip')
  await browser.flush()
  logical = { ...logical, bytes_done: 600, files: [{ ...logical.files[0], done: 600 }] }
  wire = { ...wire, state: 'running', bytes_sent: 200, updated_at: new Date(initialNow + 1000).toISOString() }
  await browser.advance(1000)
  const group = browser.store.snapshot().find((item) => item.scope === 'group')
  const child = browser.store.snapshot().find((item) => item.scope === 'item')
  assert.equal(group.bytes_done, 600)
  assert.equal(child.bytes_done, 600)
  assert.equal(group.instant_bytes_per_second, 200, 'archive speed must not use the 600 logical source bytes')
  assert.equal(group.speed_source, 'server')
  assert.equal(child.instant_bytes_per_second, 0, 'no response-byte measurement exists for an individual ZIP entry')
  logical = { ...logical, state: 'completed', bytes_done: 1000, items_completed: 1, items_running: 0, files: [{ ...logical.files[0], done: 1000, state: 'completed' }] }
  wire = { ...wire, state: 'completed', bytes_sent: 1120, bytes_total: 1120, updated_at: new Date(initialNow + 2000).toISOString() }
  await browser.advance(1000)
  await completion
  const completed = browser.store.snapshot().find((item) => item.scope === 'group')
  assert.equal(completed.bytes_total, 1000, 'ZIP framing bytes belong to rate accounting, not logical folder totals')
  assert.equal(completed.state, 'completed')
  assert.equal(completed.instant_bytes_per_second, 0)
})

test('direct-to-disk downloads report received stream bytes independently of file completion', async () => {
  let stream
  let closed = false
  const browser = createBrowser(() => new Response(new ReadableStream({ start(controller) { stream = controller } }), { headers: { 'Content-Length': '1000' } }))
  browser.context.showSaveFilePicker = async () => ({ createWritable: async () => ({ write: async () => {}, close: async () => { closed = true }, abort: async () => {} }) })
  const completion = browser.makeApi().download({ id: 7, name: 'direct.bin', size: 1000 })
  await browser.flush()
  await browser.advance(1000)
  stream.enqueue(new Uint8Array(250))
  await browser.flush()
  const item = browser.store.snapshot()[0]
  assert.equal(item.speed_source, 'client')
  assert.equal(item.instant_bytes_per_second, 250)
  assert.equal(item.bytes_done, 250)
  stream.enqueue(new Uint8Array(750))
  stream.close()
  await completion
  assert.equal(closed, true)
  assert.equal(browser.store.snapshot()[0].state, 'completed')
})

test('clearing network history preserves active hierarchies and local task history', () => {
  const { store } = createBrowser()
  const completed = store.startGroup({ fileName: 'old-folder', kind: 'upload' })
  const child = store.startChild(completed, { fileName: 'a', relativePath: 'a' })
  store.finishLifecycle(child, { state: 'completed' })
  store.finishLifecycle(completed, { state: 'completed' })
  const active = store.create({ fileName: 'active', kind: 'download' })
  const local = store.startGroup({ fileName: 'release', kind: 'dehydration', direction: 'local' })
  store.finishLifecycle(local, { state: 'completed' })
  store.clearHistory('network')
  assert.deepEqual(Array.from(store.snapshot(), (item) => item.id).sort(), [active, local].sort())
  store.clearHistory('local')
  assert.deepEqual(Array.from(store.snapshot(), (item) => item.id), [active])
})

test('upload auth retry sends the raw chunk with the renewed token and counts both actual attempts', async () => {
  const browser = createBrowser((url, init) => {
    if (url === '/api/v1/uploads') {
      const input = JSON.parse(init.body)
      return json({ ...input, id: 'upload-1', status: 'uploading', chunk_count: 1, received_chunks: [] })
    }
    if (url === '/api/v1/auth/refresh') return json({ access_token: 'token-b', refresh_token: 'refresh-b', expires_in: 3600 })
    if (url.endsWith('/finalize')) return json({ status: 'finalized', result: { id: 9 } })
    throw new Error(`Unexpected request: ${url}`)
  })
  const api = browser.makeApi('token-a', 'refresh-a')
  api.setTransferSessionKey('server:alice')
  const file = new File([new Uint8Array(1000)], 'retry.bin')
  const completion = api.uploadWithConflictPolicy(1, file, 'fail')
  const first = await waitForUpload(browser)
  await browser.advance(1000)
  first.progress(1000)
  first.finish(401, JSON.stringify({ error: 'expired' }))
  const retried = await waitForUpload(browser, 2)
  assert.equal(retried.headers.Authorization, 'Bearer token-b')
  assert.equal(retried.body, first.body, 'auth retry must preserve the exact chunk body')
  await browser.advance(1000)
  retried.progress(1000)
  assert.equal(browser.store.snapshot()[0].average_bytes_per_second, 1000, 'retransmitted request bytes remain real network bytes')
  retried.finish()
  const result = await completion
  assert.equal(result.transferred_bytes, 1000, 'logical upload result keeps its successful-chunk semantics')
  assert.equal(browser.store.snapshot()[0].state, 'completed')
})

test('Blob upload hashes partial BYOB reads with one bounded scratch buffer and preserves fallback', async (t) => {
  for (const supportsBYOB of [true, false]) {
    await t.test(supportsBYOB ? 'partial reads and tail' : 'unsupported byte-reader fallback', async () => {
      let arrayReads = 0
      let cancels = 0
      let releases = 0
      const allocations = []
      const size = 8 * 1024 * 1024 + 17
      class StreamFile extends File {
        slice(...args) {
          const blob = super.slice(...args)
          const originalRead = blob.arrayBuffer.bind(blob)
          blob.arrayBuffer = async () => { arrayReads++; return originalRead() }
          blob.stream = () => {
            if (!supportsBYOB) return new ReadableStream()
            let offset = 0
            const stream = new ReadableStream({
              type: 'bytes',
              pull(controller) {
                const request = controller.byobRequest
                const count = Math.min(4093, request.view.byteLength, blob.size - offset)
                request.view.fill(7, 0, count)
                offset += count
                request.respond(count)
                if (offset === blob.size) controller.close()
              },
            })
            const originalReader = stream.getReader.bind(stream)
            stream.getReader = (options) => {
              const reader = originalReader(options)
              return {
                // Deliberately ignore min to model engines returning partial data.
                read: (view) => reader.read(view),
                async cancel() { cancels++; return reader.cancel() },
                releaseLock() { releases++; reader.releaseLock() },
              }
            }
            return stream
          }
          return blob
        }
      }
      const browser = createBrowser((url, init) => {
        if (url === '/api/v1/uploads') {
          const input = JSON.parse(init.body)
          return json({ ...input, id: 'upload-1', status: 'uploading', chunk_count: 2, received_chunks: [] })
        }
        if (url.endsWith('/finalize')) return json({ status: 'finalized', result: { id: 9 } })
        throw new Error(`Unexpected request: ${url}`)
      })
      browser.context.ArrayBuffer = class extends ArrayBuffer {
        constructor(length) { super(length); allocations.push(length) }
      }
      const completion = browser.makeApi().uploadWithConflictPolicy(1, new StreamFile([new Uint8Array(size).fill(7)], 'stream.bin'), 'fail')
      const first = await waitForUpload(browser)
      assert.ok(first.body instanceof Blob)
      first.finish()
      const second = await waitForUpload(browser, 2)
      assert.equal(second.body.size, 17)
      second.finish()
      assert.equal((await completion).transferred_bytes, size)
      if (supportsBYOB) {
        assert.equal(arrayReads, 0, 'byte-reader path must avoid repeated Blob.arrayBuffer payload allocation')
        assert.deepEqual(allocations, [8 * 1024 * 1024], 'one <=8 MiB scratch allocation is reused across both hash passes')
        assert.equal(cancels, 4)
        assert.equal(releases, 4)
      } else {
        assert.equal(arrayReads, 4, 'unsupported byte readers retain both legacy hash passes')
        assert.equal(allocations.length, 0)
      }
    })
  }
})

test('Blob upload preserves independently verified chunk hashes and varied payload bytes with native and partial BYOB readers', async (t) => {
  const chunkSize = 8 * 1024 * 1024
  const payload = Uint8Array.from({ length: chunkSize + 17 }, (_, index) => (index * 37 + (index >>> 13)) & 255)
  const expectedChunks = [payload.subarray(0, chunkSize), payload.subarray(chunkSize)]
  const expectedHashes = expectedChunks.map((bytes) => createHash('sha256').update(bytes).digest('hex'))
  for (const partial of [false, true]) {
    await t.test(partial ? 'forced partial reads and reused tail buffer' : 'native Blob byte reader and reused tail buffer', async () => {
      class VariedFile extends File {
        slice(start, end, contentType) {
          const blob = super.slice(start, end, contentType)
          if (!partial) return blob
          blob.stream = () => {
            let offset = 0
            const stream = new ReadableStream({
              type: 'bytes',
              pull(controller) {
                const request = controller.byobRequest
                const count = Math.min(4093, request.view.byteLength, blob.size - offset)
                request.view.set(payload.subarray(start + offset, start + offset + count))
                offset += count
                request.respond(count)
                if (offset === blob.size) controller.close()
              },
            })
            const getReader = stream.getReader.bind(stream)
            stream.getReader = (options) => {
              const reader = getReader(options)
              return {
                read: (view) => reader.read(view),
                cancel: () => reader.cancel(),
                releaseLock: () => reader.releaseLock(),
              }
            }
            return stream
          }
          return blob
        }
      }
      let initialized = false
      const browser = createBrowser((url, init) => {
        if (url === '/api/v1/uploads') {
          const input = JSON.parse(init.body)
          assert.deepEqual(input.chunk_sha256, expectedHashes, 'prehash must match independent Node SHA-256 for both chunks')
          initialized = true
          return json({ ...input, id: 'upload-1', status: 'uploading', chunk_count: 2, received_chunks: [] })
        }
        if (url.endsWith('/finalize')) return json({ status: 'finalized', result: { id: 9 } })
        throw new Error(`Unexpected request: ${url}`)
      })
      const completion = browser.makeApi().uploadWithConflictPolicy(1, new VariedFile([payload], 'varied.bin'), 'fail')
      for (let index = 0; index < expectedChunks.length; index++) {
        const request = await waitForUpload(browser, index + 1)
        assert.equal(initialized, true)
        assert.equal(request.headers['X-Chunk-SHA256'], expectedHashes[index], 'rehash header must match independent Node SHA-256')
        assert.ok(request.body instanceof Blob, 'transport must send the immutable chunk Blob')
        assert.deepEqual(new Uint8Array(await request.body.arrayBuffer()), expectedChunks[index], 'XHR payload must preserve every original byte, including the reused-buffer tail')
        request.finish()
      }
      assert.equal((await completion).transferred_bytes, payload.length)
    })
  }
})

test('Blob upload rejects short hash streams and changed bytes while releasing its reader', async (t) => {
  for (const mode of ['short stream', 'changed bytes']) {
    await t.test(mode, async () => {
      let reads = 0
      let cancels = 0
      let releases = 0
      class InvalidStreamFile extends File {
        slice(...args) {
          const blob = super.slice(...args)
          const sequence = ++reads
          blob.stream = () => {
            const stream = new ReadableStream({ type: 'bytes', start(controller) {
              controller.enqueue(new Uint8Array(blob.size - (mode === 'short stream' ? 1 : 0)).fill(sequence === 1 ? 7 : 8))
              controller.close()
            } })
            const getReader = stream.getReader.bind(stream)
            stream.getReader = (options) => {
              const reader = getReader(options)
              return {
                read: (view, options) => reader.read(view, options),
                async cancel() { cancels++; return reader.cancel() },
                releaseLock() { releases++; reader.releaseLock() },
              }
            }
            return stream
          }
          return blob
        }
      }
      const browser = createBrowser((url, init) => {
        if (url === '/api/v1/uploads') return json({ ...JSON.parse(init.body), id: 'upload-1', status: 'uploading', chunk_count: 1, received_chunks: [] })
        throw new Error(`Unexpected request: ${url}`)
      })
      await assert.rejects(browser.makeApi().uploadWithConflictPolicy(1, new InvalidStreamFile([new Uint8Array(17).fill(7)], 'invalid.bin'), 'fail'),
        mode === 'short stream' ? /ended at 16 of 17 bytes|ReadableStream closed/ : /File changed while uploading chunk 0/)
      assert.equal(browser.uploads.length, 0, 'unverified bytes must never reach the upload transport')
      assert.equal(cancels, reads)
      assert.equal(releases, reads)
    })
  }
})

test('identity disposal aborts an in-flight upload and suppresses its late response', async () => {
  const browser = createBrowser((url, init) => {
    if (url === '/api/v1/uploads') return json({ ...JSON.parse(init.body), id: 'upload-1', status: 'uploading', chunk_count: 1, received_chunks: [] })
    throw new Error(`Unexpected request after disposal: ${url}`)
  })
  const api = browser.makeApi()
  api.setTransferSessionKey('server:alice')
  const completion = api.uploadWithConflictPolicy(1, new File([new Uint8Array(1000)], 'private.bin'), 'fail')
  const request = await waitForUpload(browser)
  const rejected = assert.rejects(completion, (error) => error.name === 'AbortError')
  browser.makeApi('token-b').setTransferSessionKey('server:bob')
  await rejected
  assert.equal(request.aborted, true)
  request.finish()
  await browser.flush()
  assert.equal(browser.store.snapshot().length, 0)
  assert.equal(browser.requests.some((entry) => entry.url.endsWith('/finalize')), false)
})

test('native polling uses refreshed API credentials without restarting the transfer', async () => {
  const browser = createBrowser((url) => url.endsWith('/download-ticket')
    ? json({ url: '/file-download/7?ticket=signed', transfer_id: 'wire-1', expires_at: '2026-10-08T12:10:00Z' })
    : json({ transfer_id: 'wire-1', state: 'queued', bytes_sent: 0, bytes_total: 1000, updated_at: new Date(initialNow).toISOString() }))
  const first = browser.makeApi()
  first.setTransferSessionKey('server:alice')
  await first.download({ id: 7, name: 'native.bin', size: 1000 })
  await browser.flush()
  const id = browser.store.snapshot()[0].id
  const renewed = browser.makeApi('token-renewed')
  renewed.setTransferSessionKey('server:alice')
  await browser.advance(1000)
  const request = browser.requests.at(-1)
  assert.equal(request.init.headers.get('Authorization'), 'Bearer token-renewed')
  assert.equal(browser.store.snapshot()[0].id, id)
  renewed.disposeTransfers()
  assert.equal(browser.store.snapshot().length, 0)
  assert.equal(browser.timers.size, 0)
})

test('an API from a disposed identity cannot launch transfers after that account signs in again', async () => {
  const browser = createBrowser((url) => json({ url: '/file-download/7?ticket=signed', expires_at: '2026-10-08T12:10:00Z' }))
  const old = browser.makeApi()
  old.setTransferSessionKey('server:alice')
  old.disposeTransfers()
  browser.makeApi('new-login').setTransferSessionKey('server:alice')
  await assert.rejects(old.download({ id: 7, name: 'stale.bin', size: 1000 }), (error) => error.name === 'AbortError')
  assert.equal(browser.downloads.length, 0)
})

test('direct-to-disk archive measures the ZIP stream without adding a second root transfer', async () => {
  let stream
  let done = false
  const browser = createBrowser((url) => {
    if (url === '/api/v1/download/archive/prepare') return json({ transfer_id: 'prepare-1', state: 'completed', filename: 'folder.zip', total_bytes: 1000, files: [{ path: 'folder/a.bin', size: 1000 }] })
    if (url === '/api/v1/download/archive') return new Response(new ReadableStream({ start(controller) { stream = controller } }), { headers: { 'Content-Length': '1120' } })
    if (url === '/api/v1/download/archive/progress/prepare-1') return json({ transfer_id: 'prepare-1', state: done ? 'completed' : 'running', bytes_done: done ? 1000 : 600, bytes_total: 1000, items_total: 1, items_completed: done ? 1 : 0, items_failed: 0, items_running: done ? 0 : 1, items_queued: 0, files: [{ path: 'folder/a.bin', size: 1000, done: done ? 1000 : 600, state: done ? 'completed' : 'transferring' }] })
    throw new Error(`Unexpected request: ${url}`)
  })
  browser.context.showSaveFilePicker = async () => ({ createWritable: async () => ({ write: async () => {}, close: async () => {}, abort: async () => {} }) })
  const completion = browser.makeApi().downloadArchive([3], 'folder.zip')
  await browser.flush()
  await browser.advance(1000)
  stream.enqueue(new Uint8Array(250))
  await browser.flush()
  const group = browser.store.snapshot().find((item) => item.scope === 'group')
  assert.equal(browser.store.snapshot().length, 2)
  assert.equal(group.speed_source, 'client')
  assert.equal(group.instant_bytes_per_second, 250)
  assert.equal(group.bytes_done, 600)
  done = true
  stream.enqueue(new Uint8Array(870))
  stream.close()
  await browser.flush()
  await browser.advance(500)
  await completion
  const finished = browser.store.snapshot().find((item) => item.scope === 'group')
  assert.equal(finished.bytes_total, 1000)
  assert.equal(finished.average_bytes_per_second, 1120, 'final same-tick bytes must be included in the measured average')
  assert.equal(finished.instant_bytes_per_second, 0)
})

// Transfer Center cancellation tests exercise the real Web API, XHR/stream
// transport, Store, and session boundary, not a mock cancel button.
test('cancelling a direct Web upload aborts the in-flight XHR and cannot finalize it', async () => {
  const browser = createBrowser((url, init) => {
    if (url === '/api/v1/uploads') {
      return json({ ...JSON.parse(init.body), id: 'cancel-upload', status: 'uploading', chunk_count: 1, received_chunks: [] })
    }
    throw new Error('Aborted upload must never finalize: ' + url)
  })
  const api = browser.makeApi()
  api.setTransferSessionKey('server:cancel-web')
  const done = api.uploadWithConflictPolicy(11, new File([new Uint8Array(4096)], 'cancel.bin'), 'fail')
  const xhr = await waitForUpload(browser)
  const transfer = browser.store.snapshot()[0]
  assert.equal(api.canCancelTransfer(transfer.id), true)
  assert.equal(api.cancelTransfer(transfer.id), true)
  assert.equal(browser.store.snapshot()[0].state, 'cancelling')
  assert.equal(api.cancelTransfer(transfer.id), false, 'duplicate cancellation cannot execute twice')
  await assert.rejects(done, (error) => error.name === 'AbortError')
  assert.equal(xhr.aborted, true, 'the HTTP request must actually abort')
  assert.equal(browser.store.snapshot()[0].state, 'cancelled')
  assert.equal(browser.store.snapshot()[0].instant_bytes_per_second, 0)
  assert.equal(api.canCancelTransfer(transfer.id), false)
  assert.equal(browser.requests.some((request) => request.url.includes('finalize')), false)
})

test('cancelling direct-to-disk Web download aborts the source and settles its sink', async () => {
  let source
  let abortedOnNetwork = false
  let sinkAborts = 0
  const browser = createBrowser((url, init) => {
    assert.equal(url, '/api/v1/files/7/content')
    const response = new Response(new ReadableStream({
      start(controller) { source = controller },
    }), { headers: { 'Content-Length': '16384' } })
    init.signal.addEventListener('abort', () => {
      abortedOnNetwork = true
      source.error(new DOMException('Transfer canceled', 'AbortError'))
    }, { once: true })
    return response
  })
  browser.context.showSaveFilePicker = async () => ({ createWritable: async () => ({
    write: async () => {}, close: async () => {},
    abort: async () => { sinkAborts += 1 },
  }) })
  const api = browser.makeApi()
  api.setTransferSessionKey('server:cancel-download')
  const done = api.download({ id: 7, name: 'disk.bin', size: 16384 })
  await browser.flush()
  const transfer = browser.store.snapshot()[0]
  assert.ok(transfer && api.canCancelTransfer(transfer.id))
  assert.equal(api.cancelTransfer(transfer.id), true)
  await assert.rejects(done, (error) => error.name === 'AbortError')
  assert.equal(abortedOnNetwork, true)
  assert.equal(sinkAborts, 1)
  assert.equal(browser.store.snapshot()[0].state, 'cancelled')
})

test('browser handoff downloads stay explicitly non-cancellable in the popover', async () => {
  const browser = createBrowser((url) => {
    if (url.endsWith('/download-ticket')) return json({ url: '/signed/file' })
    throw new Error('Unexpected native handoff request: ' + url)
  })
  const api = browser.makeApi()
  api.setTransferSessionKey('server:native')
  await api.download({ id: 42, name: 'native.pdf', size: 1234 })
  const item = browser.store.snapshot()[0]
  assert.equal(item.state, 'handed_off')
  assert.equal(api.canCancelTransfer(item.id), false)
  assert.equal(api.cancelTransfer(item.id), false)
  assert.equal(browser.downloads.length, 1)
})

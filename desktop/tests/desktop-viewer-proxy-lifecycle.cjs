'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DesktopFilePreviewProxy } = require('../dist/main/file_preview_proxy.cjs')

const ticket = () => ({
  url: 'https://signed.example.test/media/7?token=never-expose-this',
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  kind: 'video',
  mime_type: 'video/mp4',
})

test('concurrent Desktop Viewer opens share one loopback listener and revoke all tickets', async (t) => {
  const proxy = new DesktopFilePreviewProxy(async () => ticket(), async () => {
    throw new Error('No upstream request is expected')
  })
  t.after(() => proxy.close())
  const urls = await Promise.all(Array.from({ length: 24 }, () =>
    proxy.createURLFromTicket(ticket())))
  assert.equal(new Set(urls).size, 24, 'each Viewer owns an independent 256-bit token')
  assert.equal(new Set(urls.map(value => new URL(value).origin)).size, 1,
    'parallel opens cannot create orphan proxy ports')
  assert.equal(urls.every(value => !value.includes('never-expose-this')), true)
  assert.equal(proxy.releaseAll(), 24)
  const removed = await fetch(urls[0])
  assert.equal(removed.status, 410)
  assert.equal(proxy.releaseAll(), 0)
  const fresh = await proxy.createURLFromTicket(ticket())
  assert.equal(new URL(fresh).origin, new URL(urls[0]).origin)
  await proxy.close()
  await assert.rejects(() => proxy.createURLFromTicket(ticket()), /closed/)
  await assert.rejects(() => fetch(fresh), /fetch failed/,
    'close must shut down the single listener rather than leave a reachable port')
})

test('Main proxy shutdown racing an in-progress listen cannot mint a post-quit URL', async (t) => {
  const proxy = new DesktopFilePreviewProxy(async () => ticket(), async () => {
    throw new Error('No upstream request is expected')
  })
  t.after(() => proxy.close())
  const opening = assert.rejects(proxy.createURLFromTicket(ticket()), /closed/)
  await proxy.close()
  await opening
})

test('Renderer destruction aborts pending signed upstream fetch and clears token', async (t) => {
  let entered
  const enteredPromise = new Promise(resolve => { entered = resolve })
  let upstreamAborted = 0
  const proxy = new DesktopFilePreviewProxy(async () => ticket(), (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        upstreamAborted++
        reject(new Error('upstream cancelled'))
      }, { once: true })
      entered()
    }))
  t.after(() => proxy.close())
  const url = await proxy.createURLFromTicket(ticket())
  const pending = fetch(url)
  await enteredPromise
  assert.equal(proxy.releaseAll(), 1)
  const result = await pending
  assert.equal(result.status, 502, 'cancelled response must never impersonate successful media')
  assert.equal(upstreamAborted, 1)
  assert.equal((await fetch(url)).status, 410)
})

test('Electron lifetime cleanup is main-frame scoped and interruption-safe', () => {
  const root = path.join(__dirname, '..')
  const main = fs.readFileSync(path.join(root, 'src/main/index.cts'), 'utf8')
  const proxy = fs.readFileSync(path.join(root, 'src/main/file_preview_proxy.cts'), 'utf8')
  assert.match(main, /if \(navigationInfo\.isMainFrame\) filePreviewProxy\?\.releaseAll\(\)/)
  assert.match(main, /win\.on\('closed', \(\) => \{[\s\S]*?filePreviewProxy\?\.releaseAll\(\)/)
  assert.match(main, /win\.webContents\.on\('render-process-gone', \(_event, details\) => \{\s*filePreviewProxy\?\.releaseAll\(\)/)
  assert.match(proxy, /await once\(res, 'drain', \{ signal: controller\.signal \}\)/)
  assert.match(proxy, /credentials: 'omit',[\s\S]*?referrerPolicy: 'no-referrer'/)
})

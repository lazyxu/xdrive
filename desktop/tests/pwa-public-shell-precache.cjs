'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '../..')
const buildScript = path.join(root, 'web/scripts/build-pwa-shell.mjs')
const template = path.join(root, 'assets/icon/web/sw.js')
let builder
async function makeFixture() {
  builder ||= (await import(pathToFileURL(buildScript).href)).buildXDrivePublicShell
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-public-shell-'))
  fs.mkdirSync(path.join(dist, '.vite'))
  fs.mkdirSync(path.join(dist, 'assets'))
  fs.writeFileSync(path.join(dist, 'index.html'), '<html><script type="module" src="/assets/index-abcd1234.js"></script></html>')
  fs.writeFileSync(path.join(dist, 'assets/index-abcd1234.js'), 'console.log("public entry")')
  fs.writeFileSync(path.join(dist, 'assets/vendor-abcd1234.css'), 'body { margin:0 }')
  fs.writeFileSync(path.join(dist, 'assets/lazy-abcd1234.js'), 'console.log("optional lazy")')
  fs.writeFileSync(path.join(dist, '.vite/manifest.json'), JSON.stringify({
    'index.html': { file: 'assets/index-abcd1234.js', css: ['assets/vendor-abcd1234.css'],
      isEntry: true, dynamicImports: ['src/lazy.ts'] },
    'src/lazy.ts': { file: 'assets/lazy-abcd1234.js', isDynamicEntry: true },
  }))
  return dist
}

test('P0A: build precaches the exact Vite startup graph, not lazy viewer or private resources', async t => {
  const dist = await makeFixture()
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }))
  const first = builder(dist, template)
  const sw = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8')
  assert.equal(first.fileCount, 3)
  assert(sw.includes('"/index.html"'))
  assert(sw.includes('"/assets/index-abcd1234.js"'))
  assert(sw.includes('"/assets/vendor-abcd1234.css"'))
  assert(!sw.includes('"/assets/lazy-abcd1234.js"'))
  assert(!sw.includes('"/api/'))
  assert(!sw.includes('self.skipWaiting('))
  const second = builder(dist, template)
  assert.equal(first.revision, second.revision)
  fs.writeFileSync(path.join(dist, 'assets/index-abcd1234.js'), 'console.log("next public release")')
  assert.notEqual(first.revision, builder(dist, template).revision)
})

test('P0A: disallow path traversal, API URLs and missing assets during public build', async t => {
  const dist = await makeFixture()
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }))
  const manifestPath = path.join(dist, '.vite/manifest.json')
  for (const asset of ['/api/v1/me', '../private/token.json', 'assets/bad.js',
    'assets/../../private-abcd1234.js', 'assets/foo/../bad-abcd1234.js']) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest['index.html'].file = asset
    fs.writeFileSync(manifestPath, JSON.stringify(manifest))
    assert.throws(() => builder(dist, template), /Unexpected public bundle path/)
  }
})

test('P0A: compiled worker strictly caches public startup, serves offline shell and bypasses private GET', async t => {
  const dist = await makeFixture()
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }))
  builder ||= (await import(pathToFileURL(buildScript).href)).buildXDrivePublicShell
  builder(dist, template)
  const js = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8')
  const handlers = new Map(), cachesByName = new Map()
  const mime = p => p === '/index.html' ? 'text/html' : p.endsWith('.css') ? 'text/css' : 'text/javascript'
  let serverReads = 0, claimCount = 0
  const caches = {
    async open(name) {
      if (!cachesByName.has(name)) cachesByName.set(name, new Map())
      const entries = cachesByName.get(name)
      return {
        async add(request) { entries.set(request.url, { tag: 'offline' }) },
        async put(pathname, response) { entries.set(pathname, response) },
        async match(pathname) { return entries.get(pathname) },
      }
    },
    async keys() { return [...cachesByName.keys()] },
    async delete(name) { return cachesByName.delete(name) },
  }
  const self = {
    location: { origin: 'https://drive.example' },
    addEventListener(type, handler) { handlers.set(type, handler) },
    clients: { async claim() { claimCount++ } },
  }
  class Request {
    constructor(url, options) { this.url = url; this.options = options }
  }
  const fetch = async request => {
    serverReads++
    const pathname = typeof request === 'string' ? request : request.url
    return { ok: true, redirected: false, type: 'basic', tag: 'shell-' + pathname,
      headers: { get: () => mime(pathname) } }
  }
  vm.runInNewContext(js, { self, Request, fetch, caches, URL, Response: { error() { return {tag:'offline-error'} } } })
  const dispatch = (type, request) => {
    let result
    handlers.get(type)({ request, waitUntil(value) { result = value }, respondWith(value) { result = value } })
    return result
  }
  await dispatch('install')
  await dispatch('activate')
  assert.equal(claimCount, 1)
  assert.equal(cachesByName.size, 2)
  const fetchedOnce = serverReads
  const doc = await dispatch('fetch', {method:'GET',mode:'navigate',url:'https://drive.example/#/app/files'})
  assert.equal(doc.tag, 'shell-/index.html')
  assert.equal(serverReads, fetchedOnce, 'offline App Shell navigation must require no network')
  assert.equal(dispatch('fetch', {method:'GET',mode:'navigate',url:'https://drive.example/api/v1/download-ticket'}), undefined)
  assert.equal(dispatch('fetch', {method:'GET',mode:'cors',url:'https://drive.example/api/v1/media/1'}), undefined)
  const jsCached = await dispatch('fetch', {method:'GET',mode:'cors',url:'https://drive.example/assets/index-abcd1234.js',headers:{get:()=>null}})
  assert.equal(jsCached.tag, 'shell-/assets/index-abcd1234.js')
  assert.equal(serverReads, fetchedOnce)
})

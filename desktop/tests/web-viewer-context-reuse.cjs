const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function loadViewerContext() {
  const filename = path.join(repo, 'web', 'src', 'webViewerContext.ts')
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  const mod = { exports: {} }
  const localRequire = (request) => {
    if (request === '../../ui/shared/src') {
      return {
        xDriveClassifyFilePreview: ({ name, kind }) => {
          if (kind !== 'file') return 'none'
          if (/\.(jpg|jpeg|png|heic|livp)$/i.test(name)) return name.endsWith('.livp') ? 'live_photo' : 'image'
          if (/\.(mp4|mov)$/i.test(name)) return 'video'
          return 'none'
        },
      }
    }
    return require(request)
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports
}

const {
  xDriveCreateWebViewerContextResolver,
  xDriveWebViewerAnyFile,
  xDriveWebViewerMediaFile,
} = loadViewerContext()

function node(index, name = `photo-${index}.jpg`) {
  return {
    id: index + 1,
    parent_id: 1,
    name,
    type: 'file',
    size: 1024,
    revision: 1,
    created_at: '2026-10-09T00:00:00Z',
    updated_at: '2026-10-09T00:00:00Z',
  }
}

function directoryContext() {
  return {
    kind: 'directory',
    directoryID: 1,
    activeIndex: 64,
    sort: { key: 'name', direction: 'asc' },
    grouping: 'none',
  }
}

test('same-page current and both neighbors share one directory range request', async () => {
  let rangeCalls = 0
  let nodeCalls = 0
  const items = Array.from({ length: 10000 }, (_, index) => node(index))
  const api = {
    async listRange(_directoryID, offset, limit) {
      rangeCalls += 1
      return { items: items.slice(offset, offset + limit), total_count: items.length }
    },
    async node(id) {
      nodeCalls += 1
      return items[id - 1]
    },
  }
  const resolver = xDriveCreateWebViewerContextResolver(api, {}, directoryContext())
  const [current, previous, next] = await Promise.all([
    resolver.resolveCandidateAt(64),
    resolver.findNeighbor(64, -1, xDriveWebViewerAnyFile),
    resolver.findNeighbor(64, 1, xDriveWebViewerAnyFile),
  ])

  assert.equal(rangeCalls, 1)
  assert.equal(nodeCalls, 0)
  assert.equal(current.node.id, 65)
  assert.equal(previous.node.id, 64)
  assert.equal(next.node.id, 66)
})

test('Gallery range reuses the current MediaItem and still coalesces same-page neighbors', async () => {
  let rangeCalls = 0
  const items = Array.from({ length: 10000 }, (_, index) => ({
    node: node(index, index % 7 === 0 ? `video-${index}.mp4` : `photo-${index}.jpg`),
    metadata: {
      media_kind: index % 7 === 0 ? 'video' : 'image',
      index_state: 'ready',
      has_thumbnail: true,
    },
  }))
  const source = {
    async listItemRange(limit, offset) {
      rangeCalls += 1
      return { items: items.slice(offset, offset + limit), total_count: items.length, offset, limit }
    },
  }
  const context = {
    kind: 'gallery',
    activeIndex: 64,
    totalCount: items.length,
    target: { kind: 'library', query: {} },
  }
  const resolver = xDriveCreateWebViewerContextResolver({}, source, context)
  const [current, previous, next] = await Promise.all([
    resolver.resolveCandidateAt(64),
    resolver.findNeighbor(64, -1, xDriveWebViewerMediaFile),
    resolver.findNeighbor(64, 1, xDriveWebViewerMediaFile),
  ])

  assert.equal(rangeCalls, 1)
  assert.equal(current.mediaItem, items[64])
  assert.equal(current.node.id, items[64].node.id)
  assert.ok(previous)
  assert.ok(next)
})

test('a failed coalesced page is evicted so the Viewer can retry', async () => {
  let calls = 0
  const items = Array.from({ length: 200 }, (_, index) => node(index))
  const api = {
    async listRange(_directoryID, offset, limit) {
      calls += 1
      if (calls === 1) throw new Error('temporary range failure')
      return { items: items.slice(offset, offset + limit), total_count: items.length }
    },
  }
  const resolver = xDriveCreateWebViewerContextResolver(api, {}, directoryContext())
  await assert.rejects(() => resolver.resolveCandidateAt(64), /temporary range failure/)
  const current = await resolver.resolveCandidateAt(64)
  assert.equal(calls, 2)
  assert.equal(current.node.id, 65)
})

test('Web Viewer hook consumes context Node/MediaItem before point-fetch fallback', async () => {
  const React = require('react')
  const { act, create } = require('react-test-renderer')
  const hookFile = path.join(repo, 'web/src/useWebViewerNode.ts')
  const output = ts.transpileModule(fs.readFileSync(hookFile, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const context = { kind: 'gallery', activeIndex: 64, totalCount: 10000, target: { kind: 'library', query: {} } }
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, (request) => {
    if (request === './webViewerContext') return loadViewerContext()
    if (request === './webAppRuntime') return { xDriveReadWebAppBrowseSession: (id) => id ? context : null, xDriveWriteWebAppBrowseSession() {} }
    return require(request)
  })
  let rangeCalls = 0, nodeCalls = 0, mediaCalls = 0
  const items = Array.from({ length: 128 }, (_, index) => ({ node: node(index), metadata: { media_kind: 'image' } }))
  const api = {
    async node(id) { nodeCalls++; return node(id - 1) },
    async mediaItem(id) { mediaCalls++; return { node: node(id - 1), metadata: { media_kind: 'image' } } },
  }
  const source = { async listItemRange() { rangeCalls++; return { total_count: 10000, items } } }
  let value, renderer
  function Probe(props) { value = mod.exports.useViewerNode(props); return null }
  const props = { api, gallerySource: source, nodeID: 65, contextID: 'gallery', predicate: xDriveWebViewerMediaFile, wantsMedia: true, onNavigate() {} }
  await act(async () => { renderer = create(React.createElement(Probe, props)) })
  try {
    assert.equal(value.node.id, 65)
    assert.equal(value.mediaItem, items[64])
    assert.equal(rangeCalls, 1)
    assert.equal(nodeCalls, 0)
    assert.equal(mediaCalls, 0)
    await act(async () => renderer.update(React.createElement(Probe, { ...props, nodeID: 900, contextID: undefined })))
    assert.equal(value.node.id, 900)
    assert.equal(value.mediaItem.node.id, 900)
    assert.equal(mediaCalls, 1)
    assert.equal(nodeCalls, 0, 'direct media uses its authoritative MediaItem Node')
    await act(async () => renderer.update(React.createElement(Probe, { ...props, nodeID: 901, contextID: undefined, wantsMedia: false })))
    assert.equal(value.node.id, 901)
    assert.equal(nodeCalls, 1, 'ordinary direct Preview still uses Node fallback')
  } finally { await act(async () => renderer.unmount()) }
  const app = fs.readFileSync(path.join(repo, 'web/src/WebFileViewerApps.tsx'), 'utf8')
  assert.ok(app.includes("import { useViewerNode } from './useWebViewerNode'"), 'Web app must consume the actual tested hook')
})

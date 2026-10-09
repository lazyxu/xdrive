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

test('Web Viewer consumes context Node/MediaItem before point-fetch fallback', () => {
  const source = fs.readFileSync(path.join(repo, 'web', 'src', 'WebFileViewerApps.tsx'), 'utf8')
  for (const token of [
    'xDriveCreateWebViewerContextResolver',
    'currentCandidateRef',
    'resolver.resolveCandidateAt(activeIndex)',
    'resolver.findNeighbor(activeIndex, -1, predicate)',
    'setContextMediaItem(candidate.mediaItem ?? null)',
    "viewer.contextKind === 'gallery'",
    'viewer.contextMediaItem?.node.id === route.params.node',
  ]) {
    assert.ok(source.includes(token), 'Viewer context reuse contract missing: ' + token)
  }
  assert.ok(source.includes('api.node(nodeID)'), 'mismatched/no-context Node fallback must remain')
  assert.ok(source.includes('api.mediaItem(route.params.node)'), 'non-Gallery metadata fallback must remain')
})

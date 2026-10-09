const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..', '..')
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8')
const filename = path.join(root, 'ui', 'shared', 'src', 'media-live-export.ts')
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const sandboxExports = {}
new Function('exports', 'require', output)(sandboxExports, require)
const { xDriveCompleteLivePhotoOriginalNodeIDs } = sandboxExports

const still = (id) => ({ kind: 'node', role: 'still', node_id: id, media_kind: 'image' })
const motion = (id) => ({ kind: 'node', role: 'motion', node_id: id, media_kind: 'video' })
const pair = (resources, name = 'photo.heic') => ({
  node: { id: 11, name },
  live_photo: true,
  asset_kind: 'live_photo',
  resources,
})

test('complete LIVP export uses original container only, never extracts redundant inner ranges', () => {
  const item = pair([
    { kind: 'node', role: 'container', node_id: 11, media_kind: 'image' },
    { kind: 'derived', role: 'still', node_id: 11, media_kind: 'image' },
    { kind: 'derived', role: 'motion', node_id: 11, media_kind: 'video' },
  ], 'clip.LIVP')
  assert.deepEqual(xDriveCompleteLivePhotoOriginalNodeIDs(item), [11])
})

test('paired Live Photo export includes exact canonical still and motion originals', () => {
  assert.deepEqual(xDriveCompleteLivePhotoOriginalNodeIDs(pair([
    still(11), motion(12),
  ])), [11, 12])
})

test('paired Live Photo export fails closed on missing, ambiguous or inferred relationships', () => {
  const invalid = [
    [],
    [still(11)],
    [motion(12)],
    [still(11), motion(11)],
    [still(22), motion(12)],
    [still(11), motion(12), motion(13)],
    [still(11), { kind: 'derived', role: 'motion', node_id: 12, media_kind: 'video' }],
    [{ kind: 'node', role: 'still', node_id: 11, media_kind: 'video' }, motion(12)],
  ]
  for (const resources of invalid) {
    assert.throws(
      () => xDriveCompleteLivePhotoOriginalNodeIDs(pair(resources)),
      /可靠|原始资源/,
      'Never guess a pair from basename, capture time, or a derived resource',
    )
  }
  assert.throws(
    () => xDriveCompleteLivePhotoOriginalNodeIDs({
      ...pair([still(11), motion(12)]),
      live_photo: false,
      asset_kind: 'image',
    }),
    /不是实况/,
  )
})

test('Web, Desktop and standalone Web Viewer expose explicit full Live export separate from ordinary download', () => {
  const web = read('web', 'src', 'mediaGalleryAdapter.ts')
  const desktop = read('desktop', 'src', 'renderer', 'mediaGalleryAdapter.ts')
  const gallery = read('ui', 'shared', 'src', 'mui', 'MediaGallery.tsx')
  const viewer = read('ui', 'shared', 'src', 'mui', 'MediaGalleryViewer.tsx')
  const webViewer = read('web', 'src', 'WebFileViewerApps.tsx')
  const port = read('ui', 'shared', 'src', 'mui', 'MediaGalleryAdapter.ts')
  for (const adapter of [web, desktop]) {
    assert.ok(adapter.includes('xDriveCompleteLivePhotoOriginalNodeIDs(item)'))
    assert.ok(adapter.includes('exportLivePhoto: (item) =>'))
    assert.ok(adapter.includes('downloadItems: (items) =>'), 'regular original download must be unchanged')
  }
  assert.ok(web.includes("api.downloadArchive(ids, 'xdrive-live-photo.zip')"))
  assert.ok(desktop.includes('agent.cloudDownloadArchive(ids)'))
  assert.ok(port.includes('exportLivePhoto: port.exportLivePhoto'))
  assert.ok(gallery.includes('onExportLivePhoto={source.exportLivePhoto ? exportLivePhoto : undefined}'))
  assert.ok(gallery.includes('导出完整实况'))
  assert.ok(viewer.includes('aria-label="导出完整实况"'))
  assert.ok(webViewer.includes('aria-label="导出完整实况"'))
})

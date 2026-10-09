const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')

test('G03 sort anchor uses the existing bounded media range contract', () => {
  const server = read('internal/api/media.go')
  const anchor = read('internal/api/media_anchor.go')
  const options = read('internal/api/media_filters.go')
  const shared = read('ui/shared/src/models.ts')
  assert.match(options, /anchor_node_id must be a positive integer/)
  assert.match(server, /anchorIndex, anchorErr = mediaItemAnchorIndex\(query, options\)/)
  assert.match(server, /AnchorIndex:\s+anchorIndex/)
  assert.match(shared, /anchor_index\?: number/)
  assert.match(anchor, /Distinct\("xd_media_metadata.node_id"\)/)
  assert.match(anchor, /WHERE|Where\(where, args\.\.\.\)/)
  assert.doesNotMatch(anchor, /Find\(&\[\]|Find\(&rows|Offset\(/)
})

test('G03 sort anchor survives Web/Desktop transport without new media renderer', () => {
  for (const p of ['web/src/api.ts', 'desktop/src/main/agent_client.cts']) {
    assert.match(read(p), /set\('anchor_node_id', String\(/, p)
  }
  assert.match(read('internal/client/media.go'), /values\.Set\("anchor_node_id",/)
  assert.match(read('cmd/xdrive-agent/desktop_ipc.go'), /out\.AnchorNodeID = id/)
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  for (const token of [
    'pendingSortAnchorRef',
    'anchor_node_id: anchorNodeID',
    'range.anchor_index',
    'sortAnchorRestoration',
    'requestGallerySort',
    'viewAnchorIndexRef.current = sortAnchorIndex',
  ]) {
    assert.ok(gallery.includes(token), 'Missing original-item sort anchor contract: ' + token)
  }
  assert.match(gallery, /const \{ anchor_node_id: _anchor, \.\.\.viewerQuery \}/)
})

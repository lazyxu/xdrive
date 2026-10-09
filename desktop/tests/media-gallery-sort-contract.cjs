const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')

test('G03 capture/added ordering is server-owned and deterministic', () => {
  const server = read('internal/api/media.go')
  const filters = read('internal/api/media_filters.go')
  assert.match(server, /func mediaGallerySortClauses\(options mediaQueryOptions\)/)
  assert.match(server, /n\.created_at " \+ direction/)
  assert.match(server, /n\.id " \+ direction/)
  assert.match(server, /CASE WHEN xd_media_metadata\.captured_at IS NULL THEN 1 ELSE 0 END ASC/)
  assert.match(server, /mediaAddedDayGroupExpression/)
  assert.match(server, /queryMediaTimelineGroupSets\(query, options\)/)
  assert.match(filters, /sort_by must be captured or added/)
  assert.match(filters, /sort_dir must be asc or desc/)
})

test('G03 query parameters propagate through Web and Desktop without local sorting', () => {
  for (const name of ['web/src/api.ts', 'desktop/src/main/agent_client.cts']) {
    const code = read(name)
    assert.match(code, /set\('sort_by', /, name)
    assert.match(code, /set\('sort_dir', /, name)
  }
  const agent = read('cmd/xdrive-agent/desktop_ipc.go')
  const client = read('internal/client/media.go')
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  assert.match(agent, /out\.SortBy = strings\.TrimSpace/)
  assert.match(client, /values\.Set\("sort_by", value\)/)
  assert.match(gallery, /data-xdrive-gallery-sort-by/)
  assert.match(gallery, /data-xdrive-gallery-sort-dir/)
  assert.match(gallery, /sort_by: gallerySortRef\.current\.by/)
  assert.match(gallery, /sort_dir: gallerySortRef\.current\.dir/)
  assert.match(gallery, /mediaTimelineGroups\(items, effectiveTimeScale, sortBy, sortDir\)/)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')

test('G06 folder scope is owner-scoped server-side SQL, not a client-side 100k full scan', () => {
  const server = read('internal/api/media_filters.go')
  assert.match(server, /include_descendants/)
  assert.match(server, /include_descendants requires folder_id/)
  assert.match(server, /WITH RECURSIVE folder_scope/)
  assert.match(server, /seed\.owner_id = \?/)
  assert.match(server, /child\.owner_id = \?/)
  assert.match(server, /child\.deleted_at IS NULL/)
  assert.match(server, /parent_scope\.depth < 256/)
  assert.match(server, /child\.id = ANY\(parent_scope\.visited\)/)
  assert.match(server, /n\.parent_id = \?/)
  assert.match(read('internal/api/media.go'), /applyMediaQueryFilters\(query, options, uid\)/)
  assert.match(read('internal/api/media_smart_albums.go'), /applyMediaQueryFilters\(base, query\.options\(\), ownerID\)/)
  const integration = read('internal/api/media_folders_integration_test.go')
  assert.match(integration, /descendants of child/)
  assert.match(integration, /other owner cannot scope source/)
  assert.match(integration, /recursive scoped facets/)
})

test('G06 recursive flag survives Web and Desktop transport with explicit old-agent refusal', () => {
  const files = {
    model: read('ui/shared/src/models.ts'),
    web: read('web/src/api.ts'),
    goClient: read('internal/client/media.go'),
    agent: read('cmd/xdrive-agent/desktop_ipc.go'),
    client: read('desktop/src/main/agent_client.cts'),
    main: read('desktop/src/main/index.cts'),
    preload: read('desktop/src/preload/index.cts'),
  }
  assert.match(files.model, /include_descendants\?: boolean/)
  assert.match(files.web, /query\.include_descendants/)
  assert.match(files.goClient, /q\.IncludeDescendants/)
  assert.match(files.agent, /"media-folder-recursive"/)
  assert.match(files.agent, /out\.IncludeDescendants = value/)
  assert.match(files.client, /filters\.include_descendants/)
  assert.match(files.main, /requireAgentCapability\(hello, 'media-folder-recursive'\)/)
  assert.match(files.main, /Media include-descendants scope requires a folder/)
  assert.match(files.preload, /include_descendants\?: boolean/)
})

test('G06 shared Gallery preserves scope on sort, timezone, filter and child navigation', () => {
  const ui = read('ui/shared/src/mui/MediaGallery.tsx')
  assert.match(ui, /data-xdrive-gallery-folder-browser/)
  assert.match(ui, /label="包含子目录"/)
  assert.match(ui, /onIncludeDescendantsChange=\{currentFolderView/)
  assert.match(ui, /include_descendants: enabled \|\| undefined/)
  assert.match(ui, /\(query\.include_descendants \? '（包含子目录）' : '（仅当前目录）'\)/)
  assert.match(ui, /\{ folder_id: currentFolderView\.current\.id, include_descendants: query\.include_descendants \}/)
  assert.match(ui, /folder_id: view\.current\.id/)
  assert.match(ui, /loadFirstPage\(null, nextQuery\)/)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = (pathWithinRoot) => fs.readFileSync(path.join(root, pathWithinRoot), 'utf8')

function loadTimezoneModule() {
  const filename = path.join(root, 'ui/shared/src/media-timezone.ts')
  const source = fs.readFileSync(filename, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const loaded = new Module(filename, module)
  loaded.filename = filename
  loaded.paths = Module._nodeModulePaths(path.dirname(filename))
  loaded._compile(compiled, filename)
  return loaded.exports
}

const zone = loadTimezoneModule()

test('Gallery IANA preference validates and local dates agree across midnight', () => {
  assert.equal(zone.xDriveValidMediaTimeZone('Asia/Singapore'), true)
  assert.equal(zone.xDriveValidMediaTimeZone('America/New_York'), true)
  assert.equal(zone.xDriveValidMediaTimeZone('Local'), false)
  assert.equal(zone.xDriveValidMediaTimeZone('Asia/Atlantis'), false)
  assert.equal(zone.xDriveValidMediaTimeZone("UTC' OR true--"), false)
  assert.equal(zone.xDriveMediaDayKey('2026-10-09T00:30:00Z', 'America/Los_Angeles'), '2026-10-08')
  assert.equal(zone.xDriveMediaDayKey('2026-10-09T00:30:00Z', 'Asia/Singapore'), '2026-10-09')
})

test('Gallery capture filter and Memories use true UTC day boundaries across DST', () => {
  const examples = [
    ['Asia/Singapore', '2026-10-09', '2026-10-08T16:00:00.000Z', '2026-10-09T16:00:00.000Z'],
    ['America/New_York', '2026-03-08', '2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z'],
    ['America/New_York', '2026-11-01', '2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z'],
    ['Pacific/Auckland', '2026-09-27', '2026-09-26T12:00:00.000Z', '2026-09-27T11:00:00.000Z'],
  ]
  for (const [timeZone, day, start, end] of examples) {
    assert.equal(zone.xDriveMediaDayStartISO(day, timeZone), start)
    assert.equal(zone.xDriveMediaDayStartISO(zone.xDriveMediaNextDayKey(day), timeZone), end)
  }
  assert.equal(zone.xDriveMediaDayStartISO('2026-02-30', 'UTC'), undefined)
})

test('Gallery timezone contract reaches the Server, Agent, Web, Desktop and Viewer', () => {
  const code = {
    filters: read('ui/shared/src/mui/MediaGalleryFilters.tsx'),
    gallery: read('ui/shared/src/mui/MediaGallery.tsx'),
    viewer: read('ui/shared/src/media-viewer.ts'),
    server: read('internal/api/media.go'),
    memories: read('internal/api/media_memories.go'),
    api: read('web/src/api.ts'),
    agent: read('cmd/xdrive-agent/desktop_ipc.go'),
    desktop: read('desktop/src/main/index.cts'),
  }
  assert.match(code.filters, /xDriveMediaDayStartISO/)
  assert.match(code.gallery, /data-xdrive-gallery-time-zone/)
  assert.match(code.gallery, /time_zone: mediaTimeZoneRef\.current/)
  assert.match(code.gallery, /xDriveMediaDayKey\(new Date\(\), mediaTimeZoneRef\.current\)/)
  assert.match(code.viewer, /xDriveMediaCaptureDisplay/)
  assert.match(code.server, /mediaIANAZoneExpression\(expression, options\.TimeZone\)/)
  assert.match(code.memories, /mediaMemoryLocalMidnight/)
  assert.match(code.api, /time_zone: timeZone/)
  assert.match(code.agent, /desktopIPCMediaTimeZone/)
  assert.match(code.desktop, /requireAgentCapability\(hello, 'media-timezone'\)/)
})

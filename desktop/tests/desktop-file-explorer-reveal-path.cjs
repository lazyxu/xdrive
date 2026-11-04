'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildSync } = require('esbuild')

const repoRoot = path.resolve(__dirname, '../..')
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8')

function loadPathResolver() {
  const built = buildSync({
    entryPoints: [path.join(repoRoot, 'desktop/src/renderer/desktopFileExplorerPath.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
  }).outputFiles[0].text
  const loaded = { exports: {} }
  new Function('exports', 'module', 'require', built)(loaded.exports, loaded, require)
  return loaded.exports.xDriveDesktopFileExplorerRelativePath
}

const resolveLocalPath = loadPathResolver()
const desktopExplorer = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')

test('Desktop local file paths follow the active tab instead of the outer initial route', () => {
  const initialRouteCrumbs = [{ id: 1, name: '我的文件' }]
  const activeTabCrumbs = [
    { id: 1, name: '我的文件' },
    { id: 20, name: 'Builds' },
    { id: 21, name: '2026-11-04' },
  ]
  const node = { name: 'xdrivenas-master-20261104.spk' }

  assert.equal(
    resolveLocalPath(node, undefined, activeTabCrumbs),
    'Builds/2026-11-04/xdrivenas-master-20261104.spk',
  )
  assert.equal(
    resolveLocalPath(node, undefined, initialRouteCrumbs),
    'xdrivenas-master-20261104.spk',
    'the outer route lacks the nested directory opened in the active tab',
  )
})

test('Server search path remains authoritative over the active tab breadcrumbs', () => {
  const activeTabCrumbs = [
    { id: 1, name: '我的文件' },
    { id: 20, name: 'Builds' },
  ]
  assert.equal(
    resolveLocalPath({ name: 'report.spk' }, 'Archives/2026/report.spk', activeTabCrumbs),
    'Archives/2026/report.spk',
  )
})

test('Desktop shell actions resolve ordinary rows from the active workspace tab', () => {
  const start = desktopExplorer.indexOf('const relativePathForNode = (node: AgentCloudNode) =>')
  assert.ok(start >= 0, 'Desktop relative-path adapter is missing')
  const end = desktopExplorer.indexOf('\n\n  const nativeDragOutSupported', start)
  assert.ok(end > start, 'Desktop relative-path adapter boundary is missing')
  const adapter = desktopExplorer.slice(start, end)
  assert.ok(adapter.includes('searchByID.get(node.id)?.path'), 'search path must retain precedence')
  assert.ok(adapter.includes('explorerCrumbs'), 'ordinary paths must use active tab breadcrumbs')
  assert.equal(adapter.includes('crumbs.slice(1)'), false, 'outer initial-route breadcrumbs must not be used')
  assert.ok(desktopExplorer.includes('await hostPort.write.openPath(relativePath, reveal)'))
  assert.ok(desktopExplorer.includes('nativePort.startNativeDragOut(relativePath)'))

  const availabilityStart = desktopExplorer.indexOf('const setNodeAvailability = useCallback(')
  const availabilityEnd = desktopExplorer.indexOf('\n\n  const openLocalNode', availabilityStart)
  assert.ok(availabilityStart >= 0 && availabilityEnd > availabilityStart)
  const availability = desktopExplorer.slice(availabilityStart, availabilityEnd)
  assert.ok(availability.includes('explorerCrumbs'), 'availability actions must capture the active tab path')
  assert.equal(availability.includes('    crumbs,'), false, 'availability actions must not retain outer route crumbs')
})

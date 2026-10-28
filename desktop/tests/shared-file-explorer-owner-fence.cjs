'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')

const root = path.resolve(__dirname, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const name = 'ui/shared/src/mui/FileExplorerOwnerFence.ts'
const transpiled = ts.transpileModule(read(name), {
  fileName: path.join(root, name),
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const moduleRef = { exports: {} }
new Function('exports', 'module', 'require', transpiled)(
  moduleRef.exports, moduleRef, require,
)
const { useXDriveFileExplorerOwnerFence } = moduleRef.exports

test('Desktop/DSM Files Owner fence retires stale Host, route, revision and unmount callbacks', async () => {
  const desktop = {}, dsm = {}
  let owner
  function Harness({ host, scopeKey, revision }) {
    owner = useXDriveFileExplorerOwnerFence(host, scopeKey, revision)
    return null
  }
  let renderer
  const render = async (host, scopeKey, revision) => {
    await Renderer.act(async () => {
      const element = React.createElement(Harness, { host, scopeKey, revision })
      if (renderer) renderer.update(element)
      else renderer = Renderer.create(element)
    })
    assert.equal(owner.isCurrent(), true, 'the current mounted Owner must be live')
    return owner
  }
  const first = await render(desktop, 'serverA/ownerA/files', 0)
  const second = await render(desktop, 'serverA/ownerB/files', 0)
  assert.equal(first.isCurrent(), false, 'same file IDs are not sufficient across Owner changes')
  const third = await render(desktop, 'serverA/ownerB/dir-42', 0)
  assert.equal(second.isCurrent(), false, 'folder navigation retires previous scope')
  const fourth = await render(dsm, 'serverA/ownerB/dir-42', 0)
  assert.equal(third.isCurrent(), false, 'Host transport replacement retires native callbacks')
  first.invalidate()
  assert.equal(fourth.isCurrent(), true, 'stale callbacks cannot invalidate a newer Host')
  const fifth = await render(dsm, 'serverA/ownerB/dir-42', 1)
  assert.equal(fourth.isCurrent(), false, 'root revalidation retires previous page results')
  fifth.invalidate()
  assert.equal(fifth.isCurrent(), false, 'manual reauthentication blocks late completion immediately')
  const sixth = await render(dsm, 'serverA/ownerB/dir-42', 2)
  assert.equal(sixth.isCurrent(), true)
  await Renderer.act(async () => renderer.unmount())
  assert.equal(sixth.isCurrent(), false, 'unmount prevents stale native/CGI UI feedback')
})

test('both Hosts consume the same typed-files Owner fence, not an unscoped Agent proxy', () => {
  const shared = read('ui/shared/src/mui/FileExplorerOwnerFence.ts')
  const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
  const dsm = read('ui/shared/src/mui/SynologyOwnerFilesPage.tsx')
  const index = read('ui/shared/src/mui/index.tsx')
  assert.ok(index.includes("export * from './FileExplorerOwnerFence'"))
  assert.ok(desktop.includes("useXDriveFileExplorerOwnerFence(\n    hostPort, navigationSessionStorageKey ?? ''"))
  assert.ok(desktop.includes('!isCurrentFilesOwner() || actionBusyRef.current'))
  assert.ok(desktop.includes('actionBusyRef.current === token &&\n    isCurrentFilesOwner()'))
  assert.ok(dsm.includes('useXDriveFileExplorerOwnerFence(client, currentScopeKey, rootRevision)'))
  assert.ok(dsm.includes('invalidateOwner()') && dsm.includes('client.ownerFilesRoot('))
  assert.equal(dsm.includes('mountedOwnerRef'), false, 'do not maintain duplicate DSM lifetime gates')
  assert.equal(shared.includes('xdriveDesktop') || shared.includes('fetch('), false,
    'the lifecycle fence cannot bypass real authenticated Host data ports')
})

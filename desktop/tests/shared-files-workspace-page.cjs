'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const source = read('ui/shared/src/mui/FilesWorkspacePage.tsx')
const desktop = read('desktop/src/renderer/DesktopFilesPage.tsx')
const synology = read('ui/shared/src/mui/SynologyOwnerFilesPage.tsx')

function compileFilesPage() {
  const output = ts.transpileModule(source, {
    fileName: 'FilesWorkspacePage.tsx', reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    },
  })
  const errors = (output.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors.map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])
  const fake = label => props => React.createElement(label, props, props.children)
  const imports = {
    '@mui/material': { Box: fake('shared-workspace-box') },
    './StatusAlert': { XDriveStatusAlert: fake('quota-warning') },
    './VersionHistoryDialog': { XDriveVersionHistoryDialog: fake('history-dialog') },
    './ShareDialog': { XDriveShareDialog: fake('share-dialog') },
  }
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', output.outputText)(
    mod, mod.exports, name => {
      if (name === 'react/jsx-runtime') return require('react/jsx-runtime')
      if (name in imports) return imports[name]
      throw Error('Unexpected Host dependency in common Files page: ' + name)
    },
  )
  return mod.exports.XDriveFilesWorkspacePage
}

test('both real Hosts use the exact same Files workspace surface, without native IPC in JSX', () => {
  assert.match(desktop, /<XDriveFilesWorkspacePage/)
  assert.match(synology, /<XDriveFilesWorkspacePage overQuota=\{verifiedOverQuota === true\}>/)
  assert.match(synology, /useXDriveFileExplorerOwnerQuota\(\s*client, rootRevision, authenticatedRootCurrent/)
  assert.match(desktop, /<DesktopFileExplorer/)
  assert.match(synology, /<XDriveFileExplorer/)
  assert.match(synology, /client\.ownerFilesRoot\(/)
  assert.equal(synology.includes('<XDriveWorkspaceSurface'), false,
    'DSM Files must use the canonical common page, not a NAS-specific wrapper')
  assert.match(synology, /disabled=\{loadingRoot\} onClick=\{refreshAuthenticatedOwner\}>重试/)
  assert.match(synology, /onRefresh=\{refreshAuthenticatedOwner\}/)
  assert.doesNotMatch(synology, /本页提供经 Server Owner 鉴权的文件列表/)
  assert.doesNotMatch(synology, /pageActions=\{<XDriveActionButton/)
  assert.doesNotMatch(source, /window\.xdriveDesktop|ipcRenderer|backup\.cgi|fetch\s*\(|ownerFilesRoot/)
  assert.doesNotMatch(desktop, /<XDriveShareDialog|<XDriveVersionHistoryDialog/)
  assert.doesNotMatch(synology, /desktopShareDialogAdapter|createDesktopFileExplorerHostPort/)
})

test('real shared Files surface keeps bounded virtual viewport and truthful optional overlays', () => {
  const Page = compileFilesPage()
  const element = (props = {}) => React.createElement(
    Page, props, React.createElement('auth-files-list', { owner: 'A' }),
  )
  let mounted = Renderer.create(element())
  let box = mounted.root.findByType('shared-workspace-box')
  assert.equal(box.props['data-xdrive-files-workspace'], true)
  assert.equal(box.props.sx.minHeight, 0)
  assert.equal(box.props.sx.height, '100%')
  assert.equal(box.props.sx.overflow, 'hidden')
  assert.equal(mounted.root.findAllByType('quota-warning').length, 0)
  assert.equal(mounted.root.findAllByType('history-dialog').length, 0)
  assert.equal(mounted.root.findAllByType('share-dialog').length, 0)
  Renderer.act(() => mounted.update(element({
    overQuota: true,
    historyDialog: { node: { id: 31 }, onClose() {} },
    shareDialog: { node: { id: 31 }, onClose() {} },
  })))
  assert.equal(mounted.root.findAllByType('quota-warning').length, 1)
  assert.equal(mounted.root.findAllByType('history-dialog').length, 1)
  assert.equal(mounted.root.findAllByType('share-dialog').length, 1)
  assert.equal(mounted.root.findByType('auth-files-list').props.owner, 'A')
  Renderer.act(() => mounted.update(element()))
  assert.equal(mounted.root.findAllByType('quota-warning').length, 0)
  assert.equal(mounted.root.findAllByType('history-dialog').length, 0)
  assert.equal(mounted.root.findAllByType('share-dialog').length, 0)
  Renderer.act(() => mounted.unmount())
})

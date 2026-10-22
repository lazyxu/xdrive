'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const fileName = path.join(root, 'ui/shared/src/file-explorer-capabilities.ts')
const source = fs.readFileSync(fileName, 'utf8')
const compiled = ts.transpileModule(source, {
  fileName,
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error), [])
const moduleLike = { exports: {} }
new Function('module', 'exports', compiled.outputText)(moduleLike, moduleLike.exports)
const { xDriveResolveFileExplorerCapabilities: resolve, xDriveShareReadOnlyDefaultCapabilities: defaults } =
  moduleLike.exports

test('one shared account/share capability shape fails closed, no readOnly boolean shortcut', () => {
  const missing = resolve('account', {})
  assert.deepEqual(Object.values(missing), [false, false, false, false, false, false, false])
  assert(Object.isFrozen(missing))
  assert.equal(source.includes('readOnly: boolean'), false)
  assert.equal(source.includes('JWT_TOKEN'), false)
  assert.equal(source.includes('share.Token'), false)
})

test('account read-only folder allows listing/preview/original+ZIP download but no writes', () => {
  const r = resolve('account', { list:true, preview:true, download:true, downloadZip:true,
    search:true, write:false, delete:true })
  assert.deepEqual(r, { list:true, preview:true, download:true, downloadZip:true,
    search:true, write:false, delete:false })
})

test('preview-only read-only capability does not implicitly permit download', () => {
  assert.deepEqual(resolve('share', { list:true, preview:true, download:false, downloadZip:true,
    search:false, write:false, delete:false }), {
    list:true, preview:true, download:false, downloadZip:false, search:false,
    write:false, delete:false,
  })
})

test('public Share never gets mutating operations or full-subtree search from its UI', () => {
  const e = resolve('share', { list:true, preview:true, download:true,
    downloadZip:true, search:false, write:true, delete:true })
  assert.deepEqual(e, defaults)
  assert.equal(e.write, false)
  assert.equal(e.delete, false)
  assert.equal(e.search, false)
  assert.equal(resolve('account', { search:true }).search, false,
    'search requires a granted list capability')
})


test('both views consume same shared neutral capability contract without cross-auth', () => {
  const owner = read('ui/shared/src/mui/FileExplorer.tsx')
  const facade = read('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx')
  const bridge = read('ui/shared/src/mui/PublicShareUnifiedDirectoryExplorer.tsx')
  const web = read('web/src/PublicShare.tsx')
  assert(owner.includes("xDriveResolveFileExplorerCapabilities('account'"))
  assert(bridge.includes("xDriveResolveFileExplorerCapabilities('share'"))
  assert(facade.includes('canBrowse?: boolean'))
  assert(facade.includes('canPreview?: boolean'))
  assert(facade.includes('canDownloadZip?: boolean'))
  assert(facade.includes('return <XDrivePublicShareUnifiedDirectoryExplorer {...props} />'))
  assert(bridge.includes('const canStartDownload = caps.download && !downloadPending'))
  assert(web.includes('const canStartDownload = canDownload && !downloading'))
  assert(web.includes('downloadPending={downloading}'))
  assert(!web.includes('!downloading && !exhausted'))
  assert(bridge.includes('caps.preview && loadThumbnail'))
  assert(bridge.includes('caps.preview && loadImagePreview'))
  assert(bridge.includes("search: false, write: false, delete: false"))
  assert(bridge.includes('items.slice(0, fileLink ? 1 : sharePageLimit)'))
  assert(bridge.includes('getItemMenuItems={contextActions}'))
  for(const forbidden of ['XDriveApi', 'OwnerJWT', 'onUpload=', 'onDeleteItems=',
    'onMoveItemsTo=', 'onPaste=', 'onRenameItem=', 'onDropItemsToFolder=']) {
    assert.equal(bridge.includes(forbidden), false, 'Share Core cannot call Owner mutation: ' + forbidden)
    assert.equal(facade.includes(forbidden), false, 'Share wrapper cannot call Owner mutation: ' + forbidden)
  }
  assert(web.includes('api.publicShareChildren('))
  assert(web.includes('createPublicShareFileExplorerAdapter('))
  assert(web.includes('await shareFileAdapter.list('))
  assert(web.includes("source: 'share'"))
  assert(web.includes('canDownload={canDownload}'))
})

test('owners derive mutability from callbacks, not from Share credentials', () => {
  const owner = read('ui/shared/src/mui/FileExplorer.tsx')
  assert(owner.includes('accountCapabilities.download && onDownloadItems'))
  assert(owner.includes('accountCapabilities.delete && onDeleteItems'))
  assert(owner.includes('write: Boolean(onCreateFolder || onUpload || onUploadFolder ||'))
  assert.equal(source.includes('publicShareChildren('), false)
})


test('real Web Account Columns and public Share use the same neutral data adapter type with independent HTTP authority', () => {
  const owner = read('web/src/WebFileExplorer.tsx')
  const shared = read('web/src/PublicShare.tsx')
  const columns = read('ui/shared/src/mui/FileExplorerColumnView.tsx')
  assert(owner.includes('XDriveFileExplorerDataAdapter<Node, number>'))
  assert(owner.includes("source: 'account'"))
  assert(owner.includes("xDriveResolveFileExplorerCapabilities('account', { list: true })"))
  assert(owner.includes('await api.listPageAbortable(parentID,'), 'Owner remains JWT/ACL-scoped')
  assert(owner.includes('await accountReadAdapter.list('), 'real Columns requests pass through Owner adapter')
  assert(owner.includes('signal.throwIfAborted()') && owner.includes('}, signal)'),
    'Owner read forwards the actual request AbortSignal')
  assert(shared.includes('XDriveFileExplorerDataAdapter<PublicShareChild, number>'))
  assert(shared.includes("source: 'share'"))
  assert(shared.includes('await api.publicShareChildren(token, password, parentID, pageCursor, signal)'))
  assert(shared.includes('await shareFileAdapter.list('))
  assert(!shared.includes('api.listPageAbortable('), 'a Share capability must not reach the Owner list API')
  assert(!owner.includes('api.publicShareChildren('), 'Owner must not use the Share token endpoint')
  assert(columns.includes('signal: AbortSignal'), 'actual Columns list contract remains abortable')
  assert(!source.includes('import '), 'the neutral model must not embed JWT or public tokens')
})

test('SH-P020 real 100k workflows accept stacked-parent and master PR without unscoped execution', () => {
  for (const file of [
    '.github/workflows/sh-p020-file-explorer-capability-100k.yml',
    '.github/workflows/sh-p020-owner-desktop-mixed-100k.yml',
    '.github/workflows/sh-p020-owner-mobile-mixed-100k.yml',
    '.github/workflows/sh-p020-owner-wide-mixed-100k.yml',
  ]) {
    const workflow = read(file)
    assert(workflow.includes('pull_request: {}'), file + ' should accept stacked base')
    assert(workflow.includes("github.head_ref == 'refactor/file-explorer-shared-capabilities-p020-20261021'"), file + ' must keep branch-only real workload gate')
  }
})

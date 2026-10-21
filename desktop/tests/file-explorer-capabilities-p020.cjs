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

test('both views consume the same shared neutral capability contract without cross-auth', () => {
  const owner = read('ui/shared/src/mui/FileExplorer.tsx')
  const shared = read('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx')
  const web = read('web/src/PublicShare.tsx')
  assert(owner.includes("xDriveResolveFileExplorerCapabilities('account'"))
  assert(shared.includes("xDriveResolveFileExplorerCapabilities('share'"))
  assert(shared.includes('canBrowse?: boolean'))
  assert(shared.includes('canPreview?: boolean'))
  assert(shared.includes('canDownloadZip?: boolean'))
  assert(shared.includes('showDownloadOption && ('))
  assert(shared.includes('disabled={!canStartDownload || pending}'))
  assert(shared.includes('const canStartDownload = capabilities.download && !downloadPending'))
  assert(web.includes('const canStartDownload = canDownload && !downloading'))
  assert(web.includes('downloadPending={downloading}'))
  assert(!web.includes('!downloading && !exhausted'), 'temporary download cannot revoke list and preview')
  assert(shared.includes('canPreview !== false && loadThumbnail'),
    'temporary download state must not evict already-loaded thumbnail consumers')
  assert(shared.includes('capabilities.preview &&'))
  assert(shared.includes("search: false"))
  assert(shared.includes('items.slice(0, 100)'),
    'current-page filter is not full-subtree search')
  for(const forbidden of [
    'XDriveApi', 'OwnerJWT', 'onUpload', 'onDeleteItems', 'onMoveItemsTo',
    'onPaste', 'onRenameItem', 'onDropItemsToFolder',
  ]) assert.equal(shared.includes(forbidden), false, 'public view cannot import owner mutation: '+forbidden)
  assert(web.includes("api.publicShareChildren("), 'Share data adapter remains Share-scoped')
  assert(web.includes('createPublicShareFileExplorerAdapter('), 'production Share must actually instantiate the neutral adapter')
  assert(web.includes('await shareFileAdapter.list('), 'navigation must consume adapter list, not a separate page fetch')
  assert(web.includes("source: 'share'"), 'Share adapter must never disguise itself as the Owner source')
  assert(web.includes('canDownload={canDownload}'),
    'existing default-allow-download Share recipient flow must not be broken')
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

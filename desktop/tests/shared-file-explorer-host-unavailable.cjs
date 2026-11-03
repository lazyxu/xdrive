'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const repo = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(repo, file), 'utf8')
const explorer = read('ui/shared/src/mui/FileExplorer.tsx')
const dsm = read('ui/shared/src/mui/SynologyOwnerFilesPage.tsx')
const outlet = read('ui/shared/src/mui/XDriveAppPageOutlet.tsx')
const host = read('web/src/synologyHost.ts')
const dsmEntry = read('web/src/synology.tsx')
const contract = read('ui/shared/src/mui/WorkspaceHostAdapter.ts')

function submitSearchFromActualExplorer({ value, unavailable, calls }) {
  const file = 'ui/shared/src/mui/FileExplorer.tsx'
  const ast = ts.createSourceFile(file, explorer, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let initializer = null
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'submitSearch') {
      initializer = node.initializer?.getText(ast) ?? null
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(initializer, 'the actual shared Search command is present')
  const code = ts.transpileModule('const submitSearch = ' + initializer + ';', {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function('onSearch', 'searchValue', 'searchUnavailableReason',
    code + '\nreturn submitSearch')(
      input => calls.push(input), value, unavailable,
    )
}

test('Host-disabled Search never dispatches even through direct command callback', () => {
  const calls = []
  submitSearchFromActualExplorer({ value: ' private ', unavailable: 'Server Owner search unsupported', calls })()
  assert.deepEqual(calls, [], 'DSM must not make a fabricated search request')
  submitSearchFromActualExplorer({ value: '  authorized  ', unavailable: '', calls })()
  assert.deepEqual(calls, ['authorized'], 'Desktop keeps its original authenticated search')
})

test('shared Files toolbar retains Host-disabled operations while admitting verified Owner upload and search', () => {
  for (const name of [
    'uploadFolder',
    'copy', 'cut', 'paste', 'copyTo', 'manageTags',
  ]) {
    assert.ok(explorer.includes("'" + name + "'"), name + ' missing from shared capability contract')
    assert.ok(host.includes(name + ": 'DSM"), name + ' missing genuine DSM Host explanation')
  }
  assert.equal(host.includes("search: 'DSM"), false,
    'verified Owner-wide search must not remain disabled by the DSM Host')
  assert.ok(dsm.includes('onSearch={search.start}') &&
    dsm.includes('searchEnabled'),
    'the shared search bar must dispatch only through the authenticated DSM search hook')
  // Only the verified browser-selected single-file upload is admitted.
  // Folder upload and unrelated mutations remain truly Host-disabled.
  assert.equal(host.includes("moveTo: 'DSM"), false,
    'exact Owner move capability must not remain falsely disabled')
  assert.ok(dsm.includes('onMoveItemsTo={selected => {') &&
    dsm.includes('client.ownerMoveNode('))
  assert.equal(host.includes("delete: 'DSM"), false,
    'one verified Owner item may be moved to Server trash')
  assert.ok(dsm.includes('onDeleteItems={selected => {') &&
    dsm.includes('client.ownerDeleteNode(') &&
    dsm.includes('<XDriveConfirmDialog'),
    'one Owner-scoped trash action requires current-row verification and confirmation')
  assert.ok(dsm.includes("count !== 1 || selected.length !== 1"),
    'bulk delete must remain disabled until its distinct authorized endpoint exists')
  assert.equal(host.includes("uploadFiles: 'DSM"), false,
    'Owner-scoped single-file upload must not be falsely disabled')
  assert.ok(dsm.includes('onUpload={() => {') &&
    dsm.includes('client.ownerUploadSmallFile(') &&
    dsm.includes('uploadInputRef.current?.click()'),
    'upload must use the typed current-Owner browser picker')
  assert.ok(host.includes("uploadFolder: 'DSM"),
    'unimplemented folder upload must remain unavailable')
  assert.equal(host.includes("createFolder: 'DSM"), false,
    'Owner-scoped new-folder action must not be falsely disabled by DSM Host')
  assert.equal(host.includes("rename: 'DSM"), false,
    'Owner-scoped revision-checked rename must not be disabled')
  assert.ok(dsm.includes('onRenameItem={async (item, name) => {'),
    'only verified DSM Owner cursor items may be renamed')
  assert.ok(dsm.includes('xDriveFindVerifiedOwnerSelection(item, itemsRef.current)'),
    'renaming must recheck selected item against authenticated current rows')
  assert.ok(dsm.includes('client.ownerRenameNode('),
    'the shared Files inline rename must use the typed DSM Owner API')
  assert.ok(dsm.includes('onCreateFolder={() =>'),
    'only the verified DSM Owner folder grants an actual create callback')
  assert.ok(dsm.includes('client.ownerCreateFolder('),
    'new folder must use the typed authenticated DSM Owner adapter')
  for (const field of ['createFolder', 'uploadFiles', 'uploadFolder', 'copy', 'cut', 'delete', 'rename', 'moveTo', 'copyTo', 'manageTags']) {
    assert.ok(explorer.includes('unavailableActions?.' + field), field + ' missing disabled reason')
    assert.ok(explorer.includes('!unavailableActions?.' + field), field + ' missing capability predicate')
  }
  assert.ok(explorer.includes("if (command === 'new-folder' && onCreateFolder && !unavailableActions?.createFolder)"), 'keyboard cannot bypass read-only Host')
  assert.ok(explorer.includes('disabled={Boolean(!onCreateFolder || unavailableActions?.createFolder)}'))
  assert.ok(explorer.includes('disabled={Boolean(!onUpload || unavailableActions?.uploadFiles)}'))
  assert.ok(explorer.includes('disabled={Boolean(!onUploadFolder || unavailableActions?.uploadFolder)}'))
  assert.ok(explorer.includes('hostSelectionUnavailable[action]'), 'selection actions must fail closed through the same Host policy')
  assert.ok(explorer.includes("!unavailableActions?.paste"), 'keyboard Paste must not bypass missing Host capability')
  assert.ok(explorer.includes('searchUnavailableReason ||'))
  assert.ok(explorer.includes('disabled={Boolean(searchUnavailableReason)}'))
})

test('one Host-owned capability declaration feeds shared Outlet and canonical Files, not DSM-only JSX', () => {
  assert.ok(dsmEntry.includes('const host = createXDriveSynologyHost()'))
  assert.equal(dsmEntry.includes('filesUnavailableActions:'), false,
    'only the authenticated DSM adapter may declare unavailable actions')
  assert.ok(contract.includes('readonly ownerFilesPage?: {'))
  assert.ok(contract.includes('readonly unavailableActions?: XDriveFileExplorerUnavailableActions'))
  assert.ok(host.includes('ownerFilesPage: {') && host.includes('client: local,'))
  assert.ok(outlet.includes('client={services.ownerFilesPage.client}'))
  assert.ok(outlet.includes('unavailableActions={services.ownerFilesPage.unavailableActions}'))
  assert.ok(dsm.includes('unavailableActions={search.current'))
  assert.ok(dsm.includes('searchEnabled'))
  assert.ok(dsm.includes('onSearch={search.start}'))
  assert.equal(dsm.includes('searchEnabled={false}'), false)
  assert.ok(dsm.includes('client.ownerFilesRoot(') && dsm.includes('client.ownerFilesPage('),
    'real Owner reads remain authenticated in the existing CGI')
  assert.equal(dsm.includes('window.xdriveDesktop'), false, 'DSM does not borrow Electron IPC')
  assert.equal(host.includes('window.xdriveDesktop'), false)
  assert.equal(/fetch\s*\(/.test(contract), false, 'capability typing is not a generic transport')
})

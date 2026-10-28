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

test('shared Files toolbar exposes unavailable operations in both layouts with real disabled predicates', () => {
  for (const name of [
    'search', 'createFolder', 'uploadFiles', 'uploadFolder',
    'copy', 'cut', 'paste', 'delete', 'rename', 'moveTo', 'copyTo', 'manageTags',
  ]) {
    assert.ok(explorer.includes("'" + name + "'"), name + ' missing from shared capability contract')
    assert.ok(host.includes(name + ": 'DSM"), name + ' missing genuine DSM Host explanation')
  }
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
  assert.ok(dsm.includes('unavailableActions={unavailableActions}'))
  assert.ok(dsm.includes('searchEnabled'))
  assert.equal(dsm.includes('searchEnabled={false}'), false)
  assert.ok(dsm.includes('client.ownerFilesRoot(') && dsm.includes('client.ownerFilesPage('),
    'real Owner reads remain authenticated in the existing CGI')
  assert.equal(dsm.includes('window.xdriveDesktop'), false, 'DSM does not borrow Electron IPC')
  assert.equal(host.includes('window.xdriveDesktop'), false)
  assert.equal(/fetch\s*\(/.test(contract), false, 'capability typing is not a generic transport')
})

'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.resolve(__dirname, '../..')
const filename = path.join(repo, 'ui/shared/src/mui/FileExplorer.tsx')
const source = fs.readFileSync(filename, 'utf8')
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function actualCallback(name, dependencies) {
  let initializer
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) {
      initializer = node.initializer.getText(ast)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(initializer, 'actual shared FileExplorer callback missing: ' + name)
  const output = ts.transpileModule('const ' + name + ' = ' + initializer + ';', {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  return new Function(...Object.keys(dependencies), output + '\nreturn ' + name)(
    ...Object.values(dependencies)
  )
}
const node = { id: 41, name: 'owner.txt', kind: 'file', revision: 7 }
const reasons = {
  cut: 'DSM Owner move unavailable',
  copy: 'DSM Owner copy unavailable',
  'move-to': 'DSM Owner destination move unavailable',
  'copy-to': 'DSM Owner destination copy unavailable',
  delete: 'DSM Owner deletion unavailable',
  'manage-tags': 'DSM Owner tag edits unavailable',
}
function selection(hostSelectionUnavailable) {
  return actualCallback('selectionActionDisabledReason', {
    hostSelectionUnavailable,
    selectedItems: [node],
    selectedCount: 1,
    getSelectionActionDisabledReason: () => null,
    folderDownloadSupported: false,
  })
}

test('shared selection action policy rejects every missing DSM mutation before dispatch', () => {
  const disabled = selection(reasons)
  const sent = []
  const run = actualCallback('runSelectionAction', {
    selectionActionDisabledReason: disabled,
    selectedItems: [node],
    selectedCount: 1,
  })
  for (const [action, reason] of Object.entries(reasons)) {
    assert.equal(disabled(action, [node], 1), reason, action)
    run(action, items => sent.push({ action, items }), [node], 1)
  }
  assert.deepEqual(sent, [], 'missing Host write methods must never execute user callbacks')
})

test('real Desktop selection still dispatches the original complete selection', () => {
  const allowed = selection({})
  const sent = []
  const run = actualCallback('runSelectionAction', {
    selectionActionDisabledReason: allowed,
    selectedItems: [node],
    selectedCount: 1,
  })
  assert.equal(allowed('copy', [node], 1), null)
  run('copy', items => sent.push(items), [node], 1)
  assert.deepEqual(sent, [[node]])
})

test('disabled native-like Host actions use the same menu and shortcut boundary', () => {
  const dsm = fs.readFileSync(path.join(repo, 'web/src/synologyHost.ts'), 'utf8')
  const dsmEntry = fs.readFileSync(path.join(repo, 'web/src/synology.tsx'), 'utf8')
  const outlet = fs.readFileSync(path.join(repo, 'ui/shared/src/mui/XDriveAppPageOutlet.tsx'), 'utf8')
  assert.ok(dsmEntry.includes('const host = createXDriveSynologyHost()') &&
    !dsmEntry.includes('filesUnavailableActions:'),
    'DSM entry must use the authenticated Host adapter instead of a page-local capability list')
  for (const key of ['copy','cut','paste','delete','rename','moveTo','copyTo','manageTags']) {
    assert.ok(dsm.includes(key + ": 'DSM"), key + ' must be declared only at authenticated DSM Host boundary')
  }
  assert.ok(dsm.includes('ownerFilesPage: {') && dsm.includes('client: local,'))
  assert.ok(outlet.includes('client={services.ownerFilesPage.client}'))
  assert.ok(outlet.includes('unavailableActions={services.ownerFilesPage.unavailableActions}'))
  assert.ok(source.includes("command === 'rename' && activeItem && onRenameItem && !renameDisabled && !unavailableActions?.rename"))
  assert.ok(source.includes('!unavailableActions?.paste'), 'shortcut Paste requires a real Host')
  assert.ok(source.includes('onPaste?.()'), 'normal Desktop Paste remains owned by its real callback')
  assert.ok(source.includes('disabled: renameDisabled || renameSubmitting || !onRenameItem || Boolean(unavailableActions?.rename)'))
  assert.ok(source.includes('disabledReason: selectionActionDisabledReason('), 'one disabled reason owns menus')
  assert.ok(source.includes('onClick={() => runSelectionAction('), 'one dispatcher owns toolbar actions')
  assert.equal(dsm.includes('window.xdriveDesktop'), false)
  assert.equal(source.includes('POST /v1/cloud/children'), false, 'no new privileged transport')
})

test('Host denies even custom menu actions that supply apparently live callbacks', () => {
  const unavailableActions = {
    rename: 'DSM Owner cannot rename',
    delete: 'DSM Owner cannot delete',
    cut: 'DSM Owner cannot cut',
    copy: 'DSM Owner cannot copy',
    moveTo: 'DSM Owner cannot move',
    copyTo: 'DSM Owner cannot copy to another folder',
    paste: 'DSM Owner cannot paste',
    createFolder: 'DSM Owner cannot create folders',
    uploadFiles: 'DSM Owner cannot upload files',
    uploadFolder: 'DSM Owner cannot upload folders',
    manageTags: 'DSM Owner cannot edit tags',
  }
  const reason = actualCallback('hostUnavailableMenuReason', { unavailableActions })
  const protect = actualCallback('protectHostMenuItems', {
    hostUnavailableMenuReason: reason,
  })
  const deniedIDs = [
    'rename', 'delete', 'delete-selected', 'cut', 'copy', 'move-to', 'copy-to',
    'paste', 'tags', 'new-folder', 'create-folder', 'upload', 'upload-folder',
  ]
  const readIDs = ['open', 'download', 'properties']
  const calls = []
  const supplied = [...deniedIDs, ...readIDs].map(id => ({
    id, label: id, onSelect: () => calls.push(id),
  }))
  const guarded = protect(supplied)
  for (const [index, action] of guarded.entries()) {
    if (index < deniedIDs.length) {
      assert.equal(action.disabled, true, action.id + ' must be Host-denied')
      assert.ok(action.disabledReason, 'disabled menu must explain its current Host restriction')
    } else {
      assert.equal(action.disabled, undefined, action.id + ' remains read-only')
    }
    action.onSelect()
  }
  assert.deepEqual(calls, readIDs,
    'custom callbacks cannot bypass denied writes, while authenticated reads remain available')
  assert.ok(source.includes('protectHostMenuItems([...backgroundMenuItems])'),
    'background menu must use the same Host deny boundary')
  assert.ok(source.includes('...protectHostMenuItems((getItemMenuItems?.(inspectorItem)'),
    'Inspector cannot bypass a denied Host action')
})

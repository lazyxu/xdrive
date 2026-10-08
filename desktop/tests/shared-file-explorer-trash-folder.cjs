const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')
const pane = read('ui', 'shared', 'src', 'mui', 'FileExplorerNavigationPane.tsx')
const controller = read('ui', 'shared', 'src', 'mui', 'FileExplorerTrashController.tsx')
const muiIndex = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const webExplorer = read('web', 'src', 'WebFileExplorer.tsx')
const desktopExplorer = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
const webApp = read('web', 'src', 'App.tsx')
const desktopPage = read('desktop', 'src', 'renderer', 'DesktopFilesPage.tsx')

test('Trash is a special FileExplorer destination above Quick Access', () => {
  const trashIndex = pane.indexOf('aria-label="回收站"')
  const quickIndex = pane.indexOf('aria-label="快速访问"')
  assert.ok(trashIndex >= 0)
  assert.ok(quickIndex > trashIndex)
  assert.ok(pane.includes('selected={trashActive}'))
})
test('shared Trash controller owns restore and permanent-delete menus', () => {
  assert.ok(muiIndex.includes("export * from './FileExplorerTrashController'"))
  for (const token of ["id: 'trash-restore'", "label: '恢复'", "id: 'trash-delete-forever'", "label: '永久删除'", 'XDriveFileExplorerTrashDeleteDialog']) {
    assert.ok(controller.includes(token), token)
  }
})
test('Web and Desktop render Trash through the normal FileExplorer surface', () => {
  for (const source of [webExplorer, desktopExplorer]) {
    assert.ok(source.includes('trashActive ? trash.items : explorerItems'))
    assert.ok(source.includes('trashActive ? trash.crumbs : explorerCrumbs'))
    assert.ok(source.includes('trashActive ? trash.getItemMenuItems : getItemMenuItems'))
    assert.ok(source.includes('searchEnabled={!trashActive}'))
    assert.ok(source.includes('onNavigateTrash={() => {\n              beginNavigationIntent()\n              onOpenTrash()\n            }}'))
    assert.equal(source.includes('XDriveFileExplorerTrashCommandButton'), false)
  }
  assert.equal(webApp.includes('<XDriveTrashDialog'), false)
  assert.equal(desktopPage.includes('<XDriveTrashDialog'), false)
  assert.ok(webApp.includes('trashActive={trashOpen}'))
  assert.ok(desktopPage.includes('trashActive={trashOpen}'))
})
test('Trash disables ordinary mutations', () => {
  for (const source of [webExplorer, desktopExplorer]) {
    assert.ok(source.includes('onCopyItems={trashActive ? undefined'))
    assert.ok(source.includes('onCutItems={trashActive ? undefined'))
    assert.ok(source.includes('onDeleteItems={trashActive ? undefined'))
    assert.ok(source.includes('backgroundMenuItems={trashActive ? []'))
  }
})


test('Trash controller keeps refresh identity stable across renderer callback rerenders', () => {
  for (const token of [
    'const onErrorRef = useRef(onError)',
    'const onFeedbackRef = useRef(onFeedback)',
    'const onChangedRef = useRef(onChanged)',
    'onErrorRef.current = onError',
    'onFeedbackRef.current = onFeedback',
    'onChangedRef.current = onChanged',
    'await onChangedRef.current?.()',
  ]) assert.ok(controller.includes(token), 'Trash callback stability guard missing: ' + token)
  assert.equal(
    controller.includes('}, [adapter, onError])'),
    false,
    'inline renderer error callbacks must not restart Trash refresh effect',
  )
})

test('Trash FileExplorer uses shared sparse ranges with server-global sorting', () => {
  for (const token of [
    'useXDriveVirtualCollection',
    'fileExplorerTrashPageSize = 200',
    'adapter.listTrashRange',
    'includeCount',
    'rangeCollection.primePage',
    'virtualCollection',
    'itemCount',
  ]) assert.ok(controller.includes(token), 'Trash range contract missing: ' + token)

  for (const source of [webExplorer, desktopExplorer]) {
    assert.ok(source.includes('sort: trashSort'))
    assert.ok(source.includes('trashActive ? trash.virtualCollection : explorerVirtualCollection'))
    assert.ok(source.includes('trashActive ? Boolean(trash.virtualCollection) : externallySorted'))
    assert.ok(source.includes('${trash.itemCount} 个回收站项目'))
  }
})


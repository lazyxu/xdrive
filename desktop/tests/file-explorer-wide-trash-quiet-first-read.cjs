const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const base = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(base, p), 'utf8')
const explorer = read('ui/shared/src/mui/FileExplorer.tsx')
const trash = read('ui/shared/src/mui/FileExplorerTrashController.tsx')
const web = read('web/src/WebFileExplorer.tsx')
const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')

test('both wide Web and Desktop use exactly the same verified shared Trash first-read receipt', () => {
  for (const [name, source] of [['Web',web],['Desktop',desktop]]) {
    assert.ok(source.includes("emptyReadState={trashActive ? trash.readState : 'ready'}"),
      name + ' must pass actual current Trash status only for the Trash view')
    assert.ok(source.includes('useXDriveFileExplorerTrash({'), name + ' must keep shared hook')
    assert.ok(source.includes("onRefresh={trashActive ? () => { void trash.refresh() } : refresh}"),
      name + ' must retain original retry action')
    assert.ok(source.includes("emptyMessage={trashActive ? '回收站为空'"), name)
  }
  for (const term of ["state: 'unverified' | 'ready' | 'error'",'readReceipt.queryKey === rangeQueryKey',
    'items: scopeVisible ? items : []','rangeCollection.reset(rangeQueryKey)']) {
    assert.ok(trash.includes(term),term)
  }
})

test('shared wide FileExplorer never claims empty on an unverified/failed first Trash read', () => {
  for (const term of [
    "emptyReadState = 'ready'", "emptyReadState?: 'unverified' | 'ready' | 'error'",
    "(emptyReadState === 'unverified' || (emptyReadState === 'error' && loading))",
    "data-xdrive-file-explorer-unverified-first-read",
    "aria-busy={loading || undefined}", "minHeight: 180, display: 'grid', placeItems: 'center'",
    "data-xdrive-file-explorer-empty-read-error", "role=\"alert\"",
    '回收站读取失败，请重试。', 'onClick={onRefresh}',
    'sx={{ minHeight: 44, minWidth: 44 }}>重试</Button>', '正在读取回收站…',
    'showDelayedLoading', 'logicalItemCount === 0', 
    '<XDriveStatePanel variant="plain" message={emptyMessage} />',
  ]) assert.ok(explorer.includes(term),term)
  const render = explorer.indexOf('data-xdrive-file-explorer-unverified-first-read')
  const firstNormalEmpty = explorer.indexOf('<XDriveStatePanel variant="plain" message={emptyMessage} />',render)
  assert.ok(render > 0 && firstNormalEmpty > render, 'truthful first read must precede old generic empty')
  assert.ok(explorer.includes('XDriveFileExplorerThumbnail'), 'network thumbnails remain unmodified')
})

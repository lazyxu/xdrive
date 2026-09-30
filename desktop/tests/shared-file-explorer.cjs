const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const explorer = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorer.tsx'), 'utf8')
const index = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'index.tsx'), 'utf8')

test('shared FileExplorer exports one reusable Web/Desktop shell', () => {
  assert.ok(index.includes("export * from './FileExplorer'"), 'shared MUI index does not export FileExplorer')
  assert.ok(explorer.includes('export function XDriveFileExplorer({'), 'shared explorer component is missing')
  assert.ok(explorer.includes("export type XDriveFileExplorerViewMode = 'details' | 'grid'"), 'view-mode contract is missing')
  assert.ok(explorer.includes('export type XDriveFileExplorerItem = {'), 'generic explorer item model is missing')
  assert.equal(explorer.includes('XDriveApi'), false, 'shared explorer must not depend on Web API implementation')
  assert.equal(explorer.includes('xdriveDesktop'), false, 'shared explorer must not depend on Desktop IPC implementation')
})

test('shared FileExplorer provides Explorer-style navigation chrome', () => {
  for (const label of ['后退', '前进', '上一级', '刷新', '文件路径', '搜索文件和文件夹']) {
    assert.ok(explorer.includes(label), `missing explorer navigation affordance: ${label}`)
  }
  assert.ok(explorer.includes('<Breadcrumbs'), 'Explorer address bar needs breadcrumb navigation')
  assert.ok(explorer.includes('onPathSubmit?.(next)'), 'Explorer address bar needs editable path submission')
  assert.ok(explorer.includes("event.key === 'Escape'"), 'editable path needs Escape cancellation')
  assert.ok(explorer.includes('onSearch?.(searchValue.trim())'), 'Explorer search box needs a submit contract')
})

test('shared FileExplorer provides command bar, details/grid views, and status bar', () => {
  for (const label of ['新建文件夹', '上传', '排序', '详细信息', '图标', '名称', '修改时间', '类型', '大小']) {
    assert.ok(explorer.includes(label), `missing explorer shell feature: ${label}`)
  }
  assert.ok(explorer.includes("viewMode === 'details'"), 'details view is missing')
  assert.ok(explorer.includes('role="list"'), 'grid/icon view is missing')
  assert.ok(explorer.includes('repeat(auto-fill, minmax(112px, 1fr))'), 'grid view should adapt to available width')
  assert.ok(explorer.includes('{items.length} 个项目'), 'Explorer status bar needs item count')
  assert.ok(explorer.includes('onDoubleClick={() => onOpenItem?.(item)}'), 'items need Explorer-style double-click opening')
  assert.ok(explorer.includes("event.key === 'Enter'"), 'items need keyboard open support')
})

test('shared FileExplorer keeps folders first and owns common client-side sorting', () => {
  assert.ok(explorer.includes("if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1"), 'folders should remain grouped ahead of files')
  for (const key of ["'name'", "'updated'", "'type'", "'size'"]) {
    assert.ok(explorer.includes(key), `missing explorer sort key: ${key}`)
  }
  assert.ok(explorer.includes("sort.direction === 'asc' ? 1 : -1"), 'sort direction handling is missing')
})

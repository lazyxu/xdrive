const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const explorer = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'FileExplorer.tsx'), 'utf8')

test('Details column order is backward-compatible and persisted in the shared layout', () => {
  for (const token of [
    'order: XDriveFileExplorerDetailsColumnKey[]',
    'order: [...detailsColumnKeys]',
    'const orderInput = Array.isArray(input.order) ? input.order : fallback.order',
    'detailsLayout.order.filter((key) => detailsLayout.visible.includes(key))',
    'detailsLayout.order.map((key) =>',
    'commitDetailsLayout({ ...detailsLayout, order: next })',
  ]) {
    assert.ok(explorer.includes(token), `details column ordering missing: ${token}`)
  }
})

test('Details headers support drag reordering without taking over the resize handle', () => {
  for (const token of [
    'const [draggedDetailsColumn, setDraggedDetailsColumn]',
    "event.dataTransfer.setData('application/x-xdrive-details-column', key)",
    'onDragOver={(event) => dragOverDetailsColumn(event, key)}',
    'onDrop={(event) => dropDetailsColumn(event, key)}',
    'draggable',
    'aria-grabbed={draggedDetailsColumn === key}',
    'onDragStart={(event) => startDetailsColumnDrag(event, key)}',
    'onDragEnd={endDetailsColumnDrag}',
  ]) {
    assert.ok(explorer.includes(token), `details column drag contract missing: ${token}`)
  }
})

test('Details columns support single and all-column auto fit', () => {
  for (const token of [
    'const autoFitDetailsColumnWidth =',
    'visibleItems.slice(0, 2000)',
    'detailsColumnText(item, key)',
    'estimatedTextWidth',
    'autoFitDetailsColumn(key)',
    'autoFitAllDetailsColumns',
    '自动调整列宽',
    'onDoubleClick={(event) =>',
    'meta.minWidth',
    'meta.maxWidth',
  ]) {
    assert.ok(explorer.includes(token), `details column auto-fit missing: ${token}`)
  }
})

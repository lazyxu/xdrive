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


test('Details adds optional created/status/availability columns without changing the default four-column layout', () => {
  for (const token of [
    "const defaultDetailsColumnKeys: XDriveFileExplorerDetailsColumnKey[] = [",
    "'created',",
    "'status',",
    "'availability',",
    'visible: [...defaultDetailsColumnKeys]',
    'order: [...detailsColumnKeys]',
    "created: { label: '创建时间'",
    "status: { label: '状态'",
    "availability: { label: '可用性'",
  ]) {
    assert.ok(explorer.includes(token), 'optional Details column contract missing: ' + token)
  }
  assert.ok(
    explorer.includes("name: { label: '名称'") &&
      explorer.includes("sortKey: 'name'") &&
      explorer.includes("sortKey: 'updated'") &&
      explorer.includes("sortKey: 'type'") &&
      explorer.includes("sortKey: 'size'"),
    'only the original four Details columns should expose Server sort keys',
  )
  assert.equal(
    explorer.includes("created: { label: '创建时间', defaultWidth: 190, minWidth: 130, maxWidth: 420, sortKey:"),
    false,
    'created time must stay a display-only column until Server sort contract explicitly supports it',
  )
  assert.equal(
    explorer.includes("status: { label: '状态', defaultWidth: 120, minWidth: 90, maxWidth: 260, sortKey:"),
    false,
    'device status must never masquerade as a Server sort key',
  )
  assert.equal(
    explorer.includes("availability: { label: '可用性', defaultWidth: 150, minWidth: 100, maxWidth: 320, sortKey:"),
    false,
    'device availability must never masquerade as a Server sort key',
  )
})

test('legacy Details layouts keep new columns hidden while normalization appends them to column order', () => {
  assert.ok(
    explorer.includes('const visibleInput = Array.isArray(input.visible) ? input.visible : fallback.visible'),
    'stored visible-column selection must remain authoritative during layout normalization',
  )
  assert.ok(
    explorer.includes('...detailsColumnKeys.filter((key) => !ordered.includes(key))'),
    'new columns must be appended to old saved order without being dropped',
  )
  assert.equal(
    explorer.includes('visible: [...detailsColumnKeys]'),
    false,
    'new optional columns must not become visible by default after upgrade',
  )
})

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')
const explorer = read('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
const dialog = read('ui', 'shared', 'src', 'mui', 'FilePropertiesDialog.tsx')

function between(text, start, end) {
  const from = text.indexOf(start)
  assert.notEqual(from, -1, 'missing source start: ' + start)
  const to = text.indexOf(end, from + start.length)
  assert.ok(to > from, 'missing source end: ' + end)
  return text.slice(from, to)
}

function verifyPriority(rows, label, revisionExpression) {
  const expected = ['位置', '大小', '修改时间', '创建时间', 'Revision']
  const offsets = expected.map(item => rows.indexOf("label: '" + item + "'"))
  assert.ok(offsets.every((index, i) => index >= 0 && (!i || index > offsets[i - 1])), label + ' must show canonical path, size, timestamps and revision first')
  assert.equal((rows.match(/label: 'Revision'/g) || []).length, 1, label + ' must not duplicate the revision in technical details')
  assert.ok(rows.includes(revisionExpression), label + ' must use the original Node revision, not a derived or inferred version')
}

test('U11 single-file Properties prioritizes actual path, size, timestamps, revision without changing media source', () => {
  const rows = between(explorer, '  const propertiesForItem = (', '  const inspectorItem =')
  verifyPriority(rows, 'single file', "value: item.revision ?? '—', section: 'general'")
  assert.match(rows, /label: 'SHA-256'.+section: 'technical'/)
  assert.match(rows, /label: '尺寸'/)
  assert.match(rows, /label: '时长'/)
  assert.match(rows, /item\.properties \?\? \[\]/)
  assert.match(explorer, /<XDriveMediaDetailsInspector/)
  assert.match(explorer, /extraFileRows=\{mediaFileRows\}/)
})

test('U11 folder Properties keeps real recursive bytes and content while presenting the current path and version first', () => {
  const rows = between(explorer, "    ? propertiesDialogItem.kind === 'dir'", '      : propertiesForItem(propertiesDialogItem')
  verifyPriority(rows, 'folder', "value: propertiesDialogItem.revision ?? '—', section: 'general'")
  assert.match(rows, /label: '大小', value: propertiesDialogRecursiveSize, section: 'general'/)
  assert.match(rows, /label: '内容', value: propertiesDialogRecursiveContent, section: 'content'/)
  assert.match(rows, /label: '来源', value: propertiesDialogSource, section: 'technical'/)
})

test('U11 shared Properties dialog has a dynamic accessible name and only populated, labelled landmark sections', () => {
  assert.match(dialog, /import \{ useId, type ReactNode \} from 'react'/)
  assert.match(dialog, /const titleId = useId\(\)/)
  assert.match(dialog, /aria-labelledby=\{titleId\}/)
  assert.match(dialog, /<XDriveDialogTitle title=\{title\} titleId=\{titleId\} onClose=\{onClose\} \/>/)
  assert.match(dialog, /filter\(\(section\) => section\.properties\.length > 0\)/)
  assert.match(dialog, /role="group" aria-labelledby=\{\x60\$\{titleId\}-\$\{section\.key\}\x60\}/)
  assert.match(dialog, /component="h3"/)
  assert.match(dialog, /<XDriveDescriptionGrid columns=\{2\}>/)
  assert.match(dialog, /<XDriveDescriptionItem key=\{property\.label\} label=\{property\.label\}>/)
  assert.match(dialog, /fullScreen=\{compactTouch\}/)
  assert.doesNotMatch(dialog, /aria-label="文件属性"/)
})

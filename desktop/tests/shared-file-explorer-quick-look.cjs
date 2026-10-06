const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const explorer = read('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
const quickLook = read('ui', 'shared', 'src', 'mui', 'FileQuickLookDialog.tsx')
const openPreview = read('ui', 'shared', 'src', 'mui', 'FileOpenPreviewDialog.tsx')
const preview = read('ui', 'shared', 'src', 'mui', 'FilePreviewSurface.tsx')
const index = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const docs = read('docs', 'preview-engine.md')

test('shared FileExplorer exposes Quick Look without creating another preview engine', () => {
  assert.ok(index.includes("export * from './FileQuickLookDialog'"), 'shared MUI index must export Quick Look')
  assert.ok(quickLook.includes('export function XDriveFileQuickLookDialog'), 'shared Quick Look dialog is missing')
  assert.ok(index.includes("export * from './FileOpenPreviewDialog'"), 'shared MUI index must export the canonical open-preview dialog')
  assert.ok(quickLook.includes('<XDriveOpenPreviewDialog'), 'Quick Look must reuse the shared open-preview shell')
  assert.ok(quickLook.includes('<XDriveFilePreviewSurface'), 'Quick Look must reuse the shared Preview Engine surface')
  assert.ok(preview.includes('xDriveClassifyFilePreview'), 'Quick Look must inherit the canonical preview classifier through FilePreviewSurface')
  assert.equal(quickLook.includes('fetch('), false, 'Quick Look must not create a second preview transport')
  assert.equal(quickLook.includes('xdriveDesktop'), false, 'Quick Look must remain platform-neutral')
})

test('Space opens Quick Look while Ctrl/Cmd+Space retains keyboard selection', () => {
  for (const token of [
    'const [quickLookItemID, setQuickLookItemID]',
    "if (item.kind !== 'file') return",
    "command === 'quick-look'",
    "if (item.kind === 'dir') toggleKeyboardSelection(item)",
    'xDriveFileExplorerPrimaryModifierActive(event, keyboardProfile)',
    'else openQuickLook(item)',
    'else openQuickLook(activeItem)',
    '<XDriveFileQuickLookDialog',
  ]) {
    assert.ok(explorer.includes(token), 'Quick Look keyboard contract missing: ' + token)
  }
})

test('Quick Look navigates the current file result set and reuses Inspector preview loaders', () => {
  for (const token of [
    'const quickLookFiles = interactionProjection.files',
    'const moveQuickLook = (delta: -1 | 1) =>',
    'setQuickLookItemID(target.id)',
    'canPrevious={quickLookIndex > 0}',
    'canNext={quickLookIndex >= 0 && quickLookIndex < quickLookFiles.length - 1}',
    'loadTextPreview={loadTextPreview}',
    'loadPreviewURL={loadPreviewURL}',
    'loadImagePreview={',
  ]) {
    assert.ok(explorer.includes(token), 'Quick Look navigation/loader contract missing: ' + token)
  }
  for (const token of [
    "event.key === 'Escape'",
    "event.key === 'ArrowLeft'",
    "event.key === 'ArrowRight'",
    'Space / Esc 关闭',
    'data-xdrive-open-preview-dialog',
  ]) {
    assert.ok(openPreview.includes(token), 'shared open-preview keyboard affordance missing: ' + token)
  }
  assert.ok(quickLook.includes('quickLook'), 'Quick Look must opt into Space-to-close behavior on the shared shell')
  assert.ok(docs.includes('### Quick Look'), 'Preview Engine design must document Quick Look')
  assert.ok(docs.includes('must reuse `FilePreviewSurface`'), 'Preview Engine design must prohibit a parallel Quick Look renderer')
})

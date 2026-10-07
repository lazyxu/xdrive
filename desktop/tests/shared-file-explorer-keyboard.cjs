const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const explorer = read('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
const actions = read('ui', 'shared', 'src', 'mui', 'FileExplorerActions.tsx')
const controller = read('ui', 'shared', 'src', 'file-explorer-controller.ts')
const keyboard = read('ui', 'shared', 'src', 'file-explorer-keyboard.ts')
const web = read('web', 'src', 'WebFileExplorer.tsx')
const webApp = read('web', 'src', 'App.tsx')
const desktop = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')

test('shared FileExplorer owns Windows-style keyboard navigation semantics', () => {
  for (const token of [
    'xDriveFileExplorerKeyboardTargetIndex',
    "'ArrowUp'",
    "'ArrowDown'",
    "'ArrowLeft'",
    "'ArrowRight'",
    "'Home'",
    "'End'",
    "'PageUp'",
    "'PageDown'",
    "viewMode === 'grid' ? columns : 1",
    "viewMode === 'grid' && currentIndex < columns",
    "viewMode === 'grid' && currentIndex + columns >= itemCount",
    'return currentIndex',
    'Math.max(0, Math.min(itemCount - 1, target))',
  ]) assert.ok(controller.includes(token), 'shared keyboard navigation helper missing: ' + token)
  for (const token of [
    'const [activeItemID, setActiveItemID]',
    'const itemElementRefs = useRef(new Map<string, HTMLElement>())',
    'tabIndex={active ? 0 : -1}',
    'moveKeyboardFocus(event, item)',
    'if (targetIndex === currentIndex) return true',
    'event.shiftKey',
    'const modifier = xDriveFileExplorerPrimaryModifierActive(event, keyboardProfile)',
    'focusItemAtIndex(targetIndex)',
    'navigationKeys.includes(event.key as XDriveFileExplorerKeyboardNavigationKey)',
  ]) assert.ok(explorer.includes(token), 'shared Explorer roving-focus behavior missing: ' + token)
  assert.equal(explorer.includes('tabIndex={0}\n                aria-selected={selected}'), false, 'every Explorer item must not remain a tab stop')
})

test('shared FileExplorer supports Windows-style type-to-select', () => {
  for (const token of [
    'XDRIVE_FILE_EXPLORER_TYPE_SELECT_TIMEOUT_MS = 900',
    'xDriveFileExplorerTypeSelectTargetIndex',
    "query.normalize('NFKC').toLocaleLowerCase()",
    'cycle ? (currentIndex + 1) % names.length : currentIndex',
    'normalizedName.startsWith(normalizedQuery)',
  ]) assert.ok(controller.includes(token), 'shared type-select controller missing: ' + token)

  for (const token of [
    "const typeSelectRef = useRef({ query: '', updatedAt: 0 })",
    'event.nativeEvent.isComposing',
    "event.key === ' '",
    'Array.from(event.key).length !== 1',
    'XDRIVE_FILE_EXPLORER_TYPE_SELECT_TIMEOUT_MS',
    'const repeatedSingleKey =',
    'names: visibleItemNames',
    'cycle: repeatedSingleKey',
    'commitSelection([target.id], [target])',
    'focusItemAtIndex(targetIndex)',
    'const intent = ++typeSelectIntentRef.current',
    'const range = await resolveLogicalRange(chunkStart, chunkEnd)',
    'if (typeSelectFromKeyboard(event)) return',
  ]) assert.ok(explorer.includes(token), 'shared Explorer type-select behavior missing: ' + token)
})

test('shared FileExplorer uses the keyboard command resolver without stealing text editing keys', () => {
  for (const token of [
    'xDriveFileExplorerKeyboardCommand',
    "command === 'back'",
    "command === 'forward'",
    "command === 'up'",
    "command === 'focus-path'",
    "command === 'focus-search'",
    "command === 'refresh'",
    "command === 'new-folder'",
    "command === 'toggle-inspector'",
    "command === 'rename'",
    "command === 'context-menu'",
    'isEditableTarget(event.target)',
    'inputRef={searchInputRef}',
    'onFocus={(event) => event.currentTarget.select()}',
  ]) assert.ok(explorer.includes(token), 'shared Explorer command dispatch missing: ' + token)

  for (const token of [
    "XDriveFileExplorerKeyboardProfile = 'windows' | 'macos' | 'web'",
    "if (key === 'f2') return 'rename'",
    "if (key === 'enter') return 'rename'",
    "if (key === 'arrowdown' || key === 'o') return 'open'",
    "if (key === 'backspace') return 'delete'",
  ]) assert.ok(keyboard.includes(token), 'shared keyboard profile binding missing: ' + token)
})

test('shared FileExplorer owns inline rename and extension-aware selection', () => {
  for (const token of [
    'xDriveFileExplorerRenameSelectionEnd',
    "kind === 'dir'",
    "name.lastIndexOf('.')",
    'dot > 0 ? dot : name.length',
  ]) assert.ok(controller.includes(token), 'rename selection helper missing: ' + token)
  for (const token of [
    'onRenameItem?: (item: XDriveFileExplorerItem, name: string)',
    'const beginRename = (item: XDriveFileExplorerItem) =>',
    'inputRef={renameInputRef}',
    'input.setSelectionRange(0, xDriveFileExplorerRenameSelectionEnd(item.name, item.kind))',
    "event.key === 'Enter'",
    "event.key === 'Escape'",
    'onBlur={() =>',
    "setRenameError('请填写名称')",
    "setRenameError('名称不能超过 255 个字符')",
    "id: 'rename'",
    'onSelect: () => beginRename(item)',
  ]) assert.ok(explorer.includes(token), 'shared inline rename missing: ' + token)
  assert.ok(actions.includes('onRename?: () => void'), 'standard item menu must permit shared inline rename ownership')
})

test('Web and Desktop keep only rename transport adapters and no rename dialogs', () => {
  assert.ok(web.includes('api.rename(node.id, node.revision, name)'), 'Web must keep REST rename execution local')
  assert.ok(web.includes('onRenameItem={renameItem}'), 'Web must provide the shared inline rename adapter')
  assert.equal(web.includes('onRename: (node: Node) => void'), false, 'Web adapter must not expose the old rename-dialog callback')
  assert.equal(webApp.includes('renameNode'), false, 'Web App must not retain rename dialog state')
  assert.equal(webApp.includes('mode="rename"'), false, 'Web App must not render the old rename dialog')
  assert.ok(desktop.includes('cloudRename(node.id, node.revision, name)'), 'Desktop must keep Agent rename execution local')
  assert.ok(desktop.includes('onRenameItem={renameItem}'), 'Desktop must provide the shared inline rename adapter')
  assert.equal(desktop.includes('renameNode'), false, 'Desktop adapter must not retain rename dialog state')
  assert.equal(desktop.includes('mode="rename"'), false, 'Desktop adapter must not render the old rename dialog')
})

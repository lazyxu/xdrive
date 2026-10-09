const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const renderer = require('react-test-renderer')
const { act } = renderer

const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const filename = path.join(root, 'ui/shared/src/mui/MediaGallerySelectionReviewDialog.tsx')
const transpiled = ts.transpileModule(read('ui/shared/src/mui/MediaGallerySelectionReviewDialog.tsx'), {
  fileName: filename,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
}).outputText
const tags = {
  Box: 'box', Button: 'button', Dialog: 'dialog', DialogActions: 'dialog-actions',
  DialogTitle: 'dialog-title', IconButton: 'iconbutton',
  Stack: 'stack', TextField: 'textfield', Typography: 'typography',
  useMediaQuery: () => false,
}
const deps = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': tags,
  '@mui/icons-material/CloseRounded': 'close',
  './useMobilePanelViewport': { useXDriveMobilePanelViewport: () => null },
}
const mod = { exports: {} }
new Function('exports', 'module', 'require', transpiled)(mod.exports, mod, (name) => {
  if (!Object.prototype.hasOwnProperty.call(deps, name)) throw new Error('Unexpected dependency: ' + name)
  return deps[name]
})
const Review = mod.exports.XDriveMediaGallerySelectionReviewDialog
const makeItem = (i) => ({
  node: { id: i, name: 'photo-' + String(i).padStart(4, '0') + '.jpg', size: 123, revision: 1 },
  metadata: { media_kind: 'image' },
})
const allItems = Array.from({ length: 230 }, (_unused, index) => makeItem(index + 1))
const visible = (view) => view.root.findAll((el) => el.props['data-xdrive-gallery-selected-item'] !== undefined)
const button = (view, value) => {
  const found = view.root.findAll((el) => el.type === 'button' && el.props.children === value)
  if (value === '移除') assert.ok(found.length > 0, 'expected at least one remove button')
  else assert.equal(found.length, 1, 'expected button: ' + value)
  return found[0]
}
const properties = (overrides = {}) => ({
  open: true, items: allItems, busy: false,
  onRemove: () => {}, onClear: () => {}, onClose: () => {}, ...overrides,
})

test('G07 bounded review shows 100 of 230 with truthful count and paginates', async () => {
  let view
  await act(async () => { view = renderer.create(React.createElement(Review, properties())) })
  assert.equal(visible(view).length, 100)
  assert.equal(visible(view)[0].props['data-xdrive-gallery-selected-item'], 1)
  const title = view.root.findByType('dialog-title')
  assert.equal(title.props.children.join(''), '已选择 230 项')
  const summaries = view.root.findAll((el) => el.type === 'typography' && el.props.role === 'status')
    .map((el) => el.props.children.join(''))
  assert.ok(summaries.some((value) => value.includes('每页最多显示 100 项')),
    'selected-items count and page-size summary must remain visible')
  await act(async () => { button(view, '下一页').props.onClick() })
  assert.equal(visible(view).length, 100)
  assert.equal(visible(view)[0].props['data-xdrive-gallery-selected-item'], 101)
  await act(async () => { button(view, '下一页').props.onClick() })
  assert.equal(visible(view).length, 30)
  assert.equal(visible(view)[0].props['data-xdrive-gallery-selected-item'], 201)
  await act(async () => { view.unmount() })
})

test('G07 selected review filters only selected IDs; removal never deletes a file', async () => {
  let removed = null
  let view
  await act(async () => { view = renderer.create(React.createElement(Review, properties({
    onRemove: (id) => { removed = id },
  }))) })
  const search = view.root.findAll((el) => el.type === 'textfield')[0]
  await act(async () => { search.props.onChange({ target: { value: 'photo-0221' } }) })
  assert.equal(visible(view).length, 1)
  assert.equal(visible(view)[0].props['data-xdrive-gallery-selected-item'], 221)
  await act(async () => { button(view, '移除').props.onClick() })
  assert.equal(removed, 221)
  // The owning Gallery Map is the source of truth; a child cannot delete or
  // mutate its props on behalf of the user.
  await act(async () => { view.update(React.createElement(Review, properties({
    items: allItems.filter((item) => item.node.id !== removed),
    onRemove: (id) => { removed = id },
  }))) })
  assert.equal(visible(view).length, 0)
  await act(async () => { view.update(React.createElement(Review, properties({ open: false }))) })
  await act(async () => { view.update(React.createElement(Review, properties())) })
  assert.equal(visible(view).length, 100, 'search must reset after closing')
  await act(async () => { view.unmount() })
})

test('G07 busy selection cannot change while a batch mutation is running', async () => {
  let removed = 0
  let view
  await act(async () => { view = renderer.create(React.createElement(Review, properties({
    busy: true, onRemove: () => { removed++ },
  }))) })
  assert.equal(button(view, '移除').props.disabled, true)
  assert.equal(button(view, '清空选择').props.disabled, true)
  assert.equal(button(view, '返回图库').props.disabled, true)
  await act(async () => { view.unmount() })
  assert.equal(removed, 0)
})

test('G07 review is wired to actual shared Gallery selected media without list materialization', () => {
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const toolbar = read('ui/shared/src/mui/MediaGallerySelectionToolbar.tsx')
  assert.match(gallery, /<XDriveMediaGallerySelectionReviewDialog/)
  assert.match(gallery, /items=\{selectedMedia\}/)
  assert.match(gallery, /setSelectedMediaItems\(\(current\) => \{/)
  assert.match(toolbar, /data-xdrive-gallery-review-selected/)
  assert.match(toolbar, /onReview\?: \(\) => void/)
  assert.doesNotMatch(read('ui/shared/src/mui/MediaGallerySelectionReviewDialog.tsx'), /listItemRange\(|mediaThumbnail\(|loadPreviewURL\(/)
})

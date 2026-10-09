const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const React = require('react')
const { act, create } = require('react-test-renderer')
const { buildSync } = require('esbuild')

// Run the real filter component and React state. MUI portals/layout are the
// boundary here; their geometry, keyboard focus and touch behavior belong to
// file-explorer-controls-browser.cjs with the real MUI components.
let compactViewport = true
const primitives = {
  Box: 'div', Button: 'button', IconButton: 'button',
  Stack: 'div', Typography: 'p',
  Chip: ({ label, onDelete, ...props }) => React.createElement('button', props,
    label, onDelete ? React.createElement('delete-icon', { onClick: onDelete }) : null),
  Badge: ({ badgeContent, children }) => React.createElement('span', {}, children, badgeContent),
  useMediaQuery: () => compactViewport,
  Popover: ({ open, children, ...props }) => open ? React.createElement('popover', props, children) : null,
  Drawer: ({ open, children, slotProps, ...props }) => open
    ? React.createElement('drawer', { ...props, ...slotProps?.paper }, children) : null,
  Menu: ({ open, children, ...props }) => open ? React.createElement('menu', props, children) : null,
  MenuItem: ({ children, ...props }) => React.createElement('li', { ...props, role: 'menuitem' }, children),
}
const bundle = buildSync({
  entryPoints: [path.join(__dirname, '../../ui/shared/src/mui/FileExplorerSearchFilters.tsx')],
  bundle: true, packages: 'external', platform: 'node', format: 'cjs', jsx: 'automatic', write: false,
})
const compiled = { exports: {} }
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(compiled, compiled.exports, (name) => {
  if (name === '@mui/material') return primitives
  if (name.startsWith('@mui/icons-material/')) return () => React.createElement('svg')
  return require(name)
})
const { XDriveFileExplorerSearchFilters } = compiled.exports

const text = (node) => typeof node === 'string' ? node : (node.children || []).map(text).join('')
function mount(initialFilters = {}, options = {}) {
  compactViewport = true
  const changes = []
  let saved = 0
  let renderer
  function Host() {
    const [filters, setFilters] = React.useState(initialFilters)
    return React.createElement(XDriveFileExplorerSearchFilters, {
      filters,
      sourceOptions: [{ id: 7, name: '项目同步' }],
      tagOptions: [{ id: 9, name: '旅行' }],
      canSaveSearch: true,
      onSaveSearch: () => { saved++ },
      ...options,
      onChange: (next) => { changes.push(next); setFilters(next) },
    })
  }
  act(() => { renderer = create(React.createElement(Host), {
    createNodeMock: () => ({ isConnected: true, focus() {} }),
  }) })
  const button = (label) => renderer.root.findAllByType('button').find((item) => (
    item.props['aria-label'] === label || text(item) === label
  ))
  const click = (label) => {
    const target = button(label)
    assert.ok(target, 'button must be reachable: ' + label)
    act(() => target.props.onClick({ currentTarget: { isConnected: true, focus() {} } }))
  }
  const dialog = () => renderer.root.findAll((node) => (
    node.props.role === 'dialog' && node.props['aria-label'] === '文件筛选'
  ))
  const choose = (label) => {
    const target = renderer.root.findAll((node) => node.props.role === 'menuitem')
      .find((node) => text(node) === label)
    assert.ok(target, 'menu option must be reachable: ' + label)
    act(() => target.props.onClick())
  }
  return {
    renderer, changes, button, click, dialog, choose,
    saved: () => saved,
    resize: (compact) => { compactViewport = compact; act(() => renderer.update(React.createElement(Host))) },
    unmount: () => act(() => renderer.unmount()),
  }
}

test('mobile filters expose a named dialog with current scope and disabled empty clear', () => {
  const view = mount({}, { canSaveSearch: false })
  try {
    view.click('筛选文件')
    assert.ok(view.dialog().length > 0, 'the mobile filter panel needs an accessible dialog name')
    assert.ok(view.renderer.root.findAllByType('p').some((node) => text(node).includes('全部文件')))
    assert.equal(view.button('清除全部').props.disabled, true)
    assert.equal(view.button('保存搜索').props.disabled, true)
    assert.ok(view.button('关闭筛选'))
  } finally { view.unmount() }
})

test('choosing and individually clearing a filter retains the other conditions and panel', () => {
  const view = mount({ tagID: 9 })
  try {
    view.click('筛选文件')
    view.click('类型')
    view.choose('图片')
    assert.deepEqual(view.changes.at(-1), { tagID: 9, kind: 'image' })
    assert.ok(view.button('类型：图片'))
    assert.equal(view.renderer.root.findAllByType('menu').length, 0)
    view.click('清除类型')
    assert.deepEqual(view.changes.at(-1), { tagID: 9, kind: undefined })
    assert.ok(view.dialog().length > 0)
  } finally { view.unmount() }
})

test('saved filters remain visible and clearable when their source or tag option disappears', () => {
  const view = mount({ sourceID: 71, tagID: 91, availability: 'cloud' }, {
    sourceOptions: [], tagOptions: [], availabilityOptions: [],
  })
  try {
    view.click('筛选文件')
    assert.ok(view.button('同步文件夹：71'))
    assert.ok(view.button('标签：91'))
    assert.ok(view.button('可用性：cloud'))
    view.click('清除同步文件夹')
    assert.equal(view.changes.at(-1).tagID, 91)
    view.click('清除标签')
    assert.equal(view.changes.at(-1).availability, 'cloud')
    view.click('清除可用性')
    assert.equal(view.button('清除全部').props.disabled, true)
  } finally { view.unmount() }
})

test('closing the parent panel also closes a nested filter menu', () => {
  const view = mount()
  try {
    view.click('筛选文件')
    view.click('类型')
    assert.equal(view.renderer.root.findAllByType('menu').length, 1)
    view.click('关闭筛选')
    assert.equal(view.renderer.root.findAllByType('menu').length, 0)
    assert.equal(view.dialog().length, 0)
    view.click('筛选文件')
    assert.equal(view.renderer.root.findAllByType('menu').length, 0, 'reopening must not restore a stale menu anchor')
  } finally { view.unmount() }
})

test('switching mobile and desktop presentation dismisses the panel and its nested menu', () => {
  const view = mount({ kind: 'image' })
  try {
    view.click('筛选文件')
    view.click('类型：图片')
    view.resize(false)
    assert.equal(view.renderer.root.findAllByType('menu').length, 0)
    assert.equal(view.dialog().length, 0)
    assert.equal(text(view.button('筛选文件')), '筛选 (1)')
    view.resize(true)
    view.click('筛选文件')
    assert.ok(view.button('类型：图片'), 'responsive dismissal must preserve applied filters')
  } finally { view.unmount() }
})

test('saving uses the supplied callback once and closes all filter surfaces', () => {
  const view = mount({ kind: 'image' })
  try {
    view.click('筛选文件')
    view.click('类型：图片')
    view.click('保存搜索')
    assert.equal(view.saved(), 1)
    assert.equal(view.renderer.root.findAllByType('menu').length, 0)
    assert.equal(view.dialog().length, 0)
    assert.deepEqual(view.changes, [], 'saving must not mutate the applied query')
  } finally { view.unmount() }
})

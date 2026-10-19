'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')

const repo = path.resolve(__dirname, '../..')
const filename = path.join(repo, 'ui/shared/src/mui/MediaGalleryInspector.tsx')
const original = fs.readFileSync(filename, 'utf8')
let wide = false
const host = (tag) => React.forwardRef(({ component, children, ...props }, ref) =>
  React.createElement(component || tag, { ...props, ref }, children))
const theme = { breakpoints: { up: () => '(min-width:1200px)' }, zIndex: { modal: 1300, appBar: 1100 } }
const mui = {
  Box: host('div'), Stack: host('div'), Typography: host('span'),
  Paper: host('aside'), IconButton: host('button'),
  Drawer: ({ open, children, ...props }) =>
    open ? React.createElement('drawer', props, children) : null,
  useMediaQuery: () => wide, useTheme: () => theme,
}
const details = (props) => React.createElement('media-details', props)
const output = ts.transpileModule(original, {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText
const moduleUnderTest = { exports: {} }
const load = (name) => {
  if (name === '@mui/material') return mui
  if (name === '@mui/icons-material/CloseRounded') return () => null
  if (name === './MediaGalleryDetails') return { XDriveMediaDetailsContent: details }
  return require(name)
}
new Function('exports', 'module', 'require', output)(
  moduleUnderTest.exports, moduleUnderTest, load)
const Inspector = moduleUnderTest.exports.XDriveMediaDetailsInspector
const element = (props) => React.createElement(Inspector, { onClose() {}, ...props })
const nodes = (renderer, key) => renderer.root.findAll((value) =>
  typeof value.type === 'string' && value.props[key] !== undefined)

test('P87 original Gallery inspector keeps silent first-read pane at narrow and wide viewport', async () => {
  for (const desktop of [false, true]) {
    wide = desktop
    let renderer
    try {
      await act(async () => {
        renderer = create(element({ item: null, open: true, fallbackName: '媒体属性' }))
      })
      const first = nodes(renderer, 'data-xdrive-media-inspector-quiet-first-read')
      assert.equal(first.length, 1, 'original component must reserve exactly one quiet pane')
      assert.equal(first[0].props.sx.minHeight, 160)
      assert.equal(first[0].props['aria-label'], '媒体属性尚未确认')
      const pane = nodes(renderer, 'data-xdrive-media-inspector-content')[0]
      assert.ok(pane)
      assert.equal(pane.props['aria-busy'], true)
      assert.equal(pane.props.sx.minHeight, 160)
      assert.equal(nodes(renderer, desktop ? 'data-xdrive-media-inspector' :
        'data-xdrive-media-details-drawer').length, 1, 'retain the original Inspector host')
      assert.equal(JSON.stringify(renderer.toJSON()).includes('正在加载媒体属性'), false)
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 370)) })
      assert.equal(nodes(renderer, 'data-xdrive-media-inspector-quiet-first-read').length, 1,
        'a genuine slow first read must not introduce a delayed spinner')
      const verified = { node: { id: 701, name: '已验证.jpg', type: 'file' } }
      await act(async () => {
        renderer.update(element({ item: verified, open: true }))
      })
      assert.equal(nodes(renderer, 'data-xdrive-media-inspector-quiet-first-read').length, 0)
      assert.equal(nodes(renderer, 'data-xdrive-media-inspector-content')[0], pane,
        'accepted media replaces only the content of the same Inspector pane')
      assert.equal(nodes(renderer, 'data-xdrive-media-inspector-content')[0].props['aria-busy'], undefined)
      const accepted = renderer.root.findAll(v => v.type === 'media-details')
      assert.equal(accepted.length, 1)
      assert.equal(accepted[0].props.item.node.id, 701)
      await act(async () => { renderer.update(element({ item: null, open: true })) })
      assert.equal(nodes(renderer, 'data-xdrive-media-inspector-quiet-first-read').length, 1)
      await act(async () => { renderer.update(element({ item: null, open: false })) })
      assert.equal(nodes(renderer, 'data-xdrive-media-inspector-content').length, 0)
    } finally {
      if (renderer) await act(async () => renderer.unmount())
    }
  }
})

test('P87 shared Inspector preserves real media details and never shows a decorative metadata loader', () => {
  assert.match(original, /XDriveMediaDetailsContent item=\{item\} \{\.\.\.contentProps\}/)
  assert.match(original, /aria-busy=\{!item \|\| undefined\}/)
  assert.match(original, /data-xdrive-media-inspector-quiet-first-read/)
  assert.doesNotMatch(original, /正在加载媒体属性…|CircularProgress|setTimeout\(/)
  assert.match(original, /anchor="right"/)
  assert.match(original, /anchor="bottom"/)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')
const relative = 'ui/shared/src/mui/SidebarStorageSummary.tsx'
const filename = path.join(repo, relative)
const source = fs.readFileSync(filename, 'utf8')
const transpiled = ts.transpileModule(source, {
  fileName: filename,
  reportDiagnostics: true,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
})
const errors = (transpiled.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error)
assert.equal(errors.length, 0, errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'))

const jsx = (type, props) => ({ type, props: props || {} })
const moduleShim = { exports: {} }
new Function('exports', 'module', 'require', transpiled.outputText)(
  moduleShim.exports, moduleShim, (request) => {
    if (request === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
    if (request === '@mui/material') return Object.fromEntries(
      ['Box', 'LinearProgress', 'Stack', 'Typography'].map((key) => [key, key]))
    if (request === '../format') return { formatBytes: (bytes) => bytes + ' B' }
    throw new Error('unexpected sidebar component dependency: ' + request)
  },
)
const Summary = moduleShim.exports.XDriveSidebarStorageSummary
assert.equal(typeof Summary, 'function')

function collect(tree) {
  if (tree == null || typeof tree === 'boolean') return []
  if (Array.isArray(tree)) return tree.flatMap(collect)
  if (typeof tree !== 'object') return []
  return [tree, ...collect(tree.props?.children)]
}

function textOf(tree) {
  if (tree == null || typeof tree === 'boolean') return ''
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(textOf).join('')
  return textOf(tree.props?.children)
}

function render(props) {
  const tree = Summary(props)
  return {
    tree,
    text: textOf(tree),
    progress: collect(tree).filter((x) => x.type === 'LinearProgress'),
  }
}

test('positive account quota renders only the current owner usage and quota fraction', () => {
  const rendered = render({ usedBytes: 2500, totalBytes: 10000 })
  assert.equal(rendered.tree.props['aria-label'], '我的云端存储')
  assert.match(rendered.text, /我的用量 2500 B \/ 10000 B/)
  assert.match(rendered.text, /25%/)
  assert.equal(rendered.progress.length, 1)
  assert.equal(rendered.progress[0].props.value, 25)
  assert.match(rendered.progress[0].props['aria-label'], /个人配额使用率 25%/)
  assert.equal(rendered.progress[0].props['data-xdrive-server-disk-usage'], undefined)
})

test('unlimited account quota displays personal bytes but host disk percent is explicitly separate', () => {
  const rendered = render({
    usedBytes: 2500, totalBytes: 0,
    diskTotalBytes: 10000, diskAvailableBytes: 3000,
  })
  assert.match(rendered.text, /无容量限制/)
  assert.match(rendered.text, /我的用量 2500 B/)
  assert.match(rendered.text, /服务器存储磁盘（非个人配额） · 占用 70% · 可用 3000 B/)
  assert.doesNotMatch(rendered.text, /其他占用/)
  assert.equal(rendered.progress.length, 1)
  assert.equal(rendered.progress[0].props['data-xdrive-server-disk-usage'], true)
  assert.equal(rendered.progress[0].props.value, 70)
  assert.match(rendered.progress[0].props['aria-label'], /服务器存储磁盘占用率 70%（非个人配额）/)
})

test('full server disk is correctly warned without turning unlimited quota into a quota violation', () => {
  const rendered = render({
    usedBytes: 4000, totalBytes: 0,
    diskTotalBytes: 10000, diskAvailableBytes: 0,
  })
  assert.match(rendered.text, /无容量限制/)
  assert.equal(rendered.progress[0].props.value, 100)
  assert.equal(rendered.progress[0].props.color, 'error')
  assert.doesNotMatch(rendered.text, /已超额|已用满/)
})

test('unknown server disk denominator never fabricates a disk percentage', () => {
  const onlyFree = render({ usedBytes: 4000, totalBytes: 0, diskAvailableBytes: 2500 })
  assert.match(onlyFree.text, /服务器存储磁盘可用 2500 B（非个人配额）/)
  assert.equal(onlyFree.progress.length, 0)
  const unknown = render({ usedBytes: 4000, totalBytes: 0 })
  assert.match(unknown.text, /无容量限制/)
  assert.equal(unknown.progress.length, 0)
  assert.doesNotMatch(unknown.text, /磁盘占用/)
})

test('personal account quota percent remains bounded even if accounting exceeds quota', () => {
  const rendered = render({ usedBytes: 11000, totalBytes: 10000 })
  assert.match(rendered.text, /已超额/)
  assert.equal(rendered.progress[0].props.value, 100)
  assert.equal(rendered.progress[0].props.color, 'error')
})

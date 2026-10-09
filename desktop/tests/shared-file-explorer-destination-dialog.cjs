const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { buildSync } = require('esbuild')
const React = require('react')
const TestRenderer = require('react-test-renderer')
const material = require('@mui/material')

const repo = path.resolve(process.env.XDRIVE_FILE_EXPLORER_SOURCE_ROOT || path.join(__dirname, '../..'))
const filename = path.join(repo, 'ui/shared/src/mui/FileExplorerDestinationDialog.tsx')

// Only the browser portal is represented by an in-memory host. The component's
// hooks, MUI controls, callbacks and shared business helpers run from real source.
// The owned browser runner verifies the actual Dialog portal, focus and geometry.
function DialogHost({ open, children, ...props }) {
  return open ? React.createElement('dialog-host', props, children) : null
}
function loadDialog() {
  if (!fs.existsSync(filename)) return undefined
  const output = buildSync({
    entryPoints: [filename], bundle: true, write: false, platform: 'node', format: 'cjs',
    packages: 'external', jsx: 'automatic', logLevel: 'silent',
  }).outputFiles[0].text
  const module = { exports: {} }
  const requireFromDesktop = createRequire(path.join(repo, 'desktop/package.json'))
  const requireForTest = (request) => request === '@mui/material'
    ? { ...material, Dialog: DialogHost }
    : request.startsWith('@mui/icons-material/') ? requireFromDesktop(request).default : requireFromDesktop(request)
  new Function('exports', 'module', 'require', output)(module.exports, module, requireForTest)
  return module.exports.XDriveFileExplorerDestinationDialog
}
const DestinationDialog = loadDialog()
const root = { id: 1, name: '全部文件' }
const home = { id: 2, name: '项目目录' }
const sources = Object.freeze([
  Object.freeze({ id: 20, revision: 3, name: 'source-folder', type: 'dir', parent_id: 2 }),
  Object.freeze({ id: 21, revision: 5, name: 'source-file.jpg', type: 'file', parent_id: 2 }),
])
const directory = (id, name = `目录-${id}`) => ({ id, name, type: 'dir' })
const page = (items = [], nextCursor = '') => ({ items, nextCursor, hasMore: Boolean(nextCursor) })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const text = (instance) => typeof instance === 'string' ? instance
  : instance.type === 'style' ? '' : instance.children.map(text).join('')
const host = (renderer, attribute) => renderer.root.findAll((entry) => typeof entry.type === 'string' && entry.props[attribute] !== undefined)
const buttons = (renderer) => renderer.root.findAll((entry) => entry.type === 'button')
const button = (renderer, label) => {
  const candidates = buttons(renderer).filter((entry) => text(entry) === label || entry.props['aria-label'] === label)
  assert.equal(candidates.length, 1, `expected one real MUI button: ${label}`)
  return candidates[0]
}
const click = async (target) => { await TestRenderer.act(async () => { await target.props.onClick?.({ preventDefault() {}, stopPropagation() {} }) }) }

async function mount(overrides = {}) {
  assert.equal(typeof DestinationDialog, 'function', 'export the shared paged destination dialog')
  const requests = [], submissions = [], closes = []
  let props = {
    open: true, lifecycleKey: 'account-a', operation: 'copy', sources, initialCrumbs: [root, home],
    loadDirectoryPage: async (parentID, cursor) => {
      requests.push({ parentID, cursor: cursor || '' })
      if (parentID === 2 && !cursor) return page([directory(30), directory(50)], 'opaque-next')
      if (parentID === 2) return page([directory(60), directory(61)])
      if (parentID === 30) return page([directory(300)])
      if (parentID === 1) return page([directory(2, home.name), directory(20, sources[0].name)])
      return page()
    },
    onSubmit: async (crumbs) => { submissions.push(crumbs) },
    onClose: () => closes.push(true),
    ...overrides,
  }
  let renderer
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(DestinationDialog, props)) })
  return {
    renderer, requests, submissions, closes,
    update: async (next) => { props = { ...props, ...next }; await TestRenderer.act(async () => renderer.update(React.createElement(DestinationDialog, props))) },
    unmount: async () => { await TestRenderer.act(async () => renderer.unmount()) },
  }
}

test('closed destination dialog does not load or expose controls; opening uses supplied root/path and immutable source count', async () => {
  const harness = await mount({ open: false })
  try {
    assert.deepEqual(harness.requests, [])
    assert.equal(harness.renderer.toJSON(), null)
    await harness.update({ open: true })
    assert.deepEqual(harness.requests, [{ parentID: 2, cursor: '' }])
    assert.match(text(harness.renderer.root), /2 个项目/)
    assert.match(text(harness.renderer.root), /全部文件.*项目目录/)
    assert.equal(Boolean(button(harness.renderer, '复制到这里').props.disabled), false)
  } finally { await harness.unmount() }
})

test('destination folder paging retains only the current page and returns through opaque cursors', async () => {
  const harness = await mount()
  try {
    const ids = () => host(harness.renderer, 'data-xdrive-file-explorer-destination-directory').map((row) => Number(row.props['data-xdrive-file-explorer-destination-directory']))
    assert.deepEqual(ids(), [30, 50])
    await click(button(harness.renderer, '下一页文件夹'))
    assert.deepEqual(ids(), [60, 61])
    assert.equal(button(harness.renderer, '下一页文件夹').props.disabled, true)
    await click(button(harness.renderer, '上一页文件夹'))
    assert.deepEqual(ids(), [30, 50])
    assert.deepEqual(harness.requests, [{ parentID: 2, cursor: '' }, { parentID: 2, cursor: 'opaque-next' }, { parentID: 2, cursor: '' }])
    assert.deepEqual(harness.submissions, [])
  } finally { await harness.unmount() }
})

test('deep and root browsing remains local and submits the complete chosen numeric crumb chain', async () => {
  const harness = await mount()
  try {
    await click(button(harness.renderer, '打开文件夹 目录-30'))
    await click(button(harness.renderer, '打开文件夹 目录-300'))
    assert.match(text(harness.renderer.root), /全部文件.*项目目录.*目录-30.*目录-300/)
    await click(button(harness.renderer, '复制到这里'))
    assert.deepEqual(harness.submissions, [[root, home, { id: 30, name: '目录-30' }, { id: 300, name: '目录-300' }]])
    assert.equal(harness.closes.length, 1)
    await harness.update({ open: false })
    await harness.update({ open: true })
    await click(button(harness.renderer, '前往 全部文件'))
    await click(button(harness.renderer, '复制到这里'))
    assert.deepEqual(harness.submissions[1], [root])
    assert.deepEqual(sources.map(({ id, revision, parent_id }) => ({ id, revision, parent_id })), [
      { id: 20, revision: 3, parent_id: 2 }, { id: 21, revision: 5, parent_id: 2 },
    ])
  } finally { await harness.unmount() }
})

test('move refuses any already-at-target source without silently shrinking the set; same-parent copy is allowed', async () => {
  const harness = await mount({ operation: 'move' })
  try {
    assert.equal(button(harness.renderer, '移动到这里').props.disabled, true)
    assert.match(text(harness.renderer.root), /已在|已经位于|当前.*位置/)
    await click(button(harness.renderer, '移动到这里'))
    assert.deepEqual(harness.submissions, [])
    await click(button(harness.renderer, '打开文件夹 目录-30'))
    assert.equal(Boolean(button(harness.renderer, '移动到这里').props.disabled), false)
    await harness.update({ operation: 'copy' })
    assert.equal(Boolean(button(harness.renderer, '复制到这里').props.disabled), false)
  } finally { await harness.unmount() }
})

test('a source directory and its known descendant are never accepted as copy or move targets', async () => {
  for (const operation of ['copy', 'move']) {
    for (const crumbs of [[root, { id: 20, name: 'source-folder' }], [root, { id: 20, name: 'source-folder' }, { id: 200, name: 'descendant' }]]) {
      const harness = await mount({ operation, initialCrumbs: crumbs })
      try {
        assert.equal(button(harness.renderer, operation === 'copy' ? '复制到这里' : '移动到这里').props.disabled, true)
        assert.match(text(harness.renderer.root), /自身|子文件夹|子目录/)
        assert.deepEqual(harness.submissions, [])
      } finally { await harness.unmount() }
    }
  }
})

test('initial loading and load failure block submission and Retry preserves the target', async () => {
  const held = deferred()
  let attempts = 0
  const harness = await mount({ loadDirectoryPage: async () => { attempts += 1; return attempts === 1 ? held.promise : page([directory(30)]) } })
  try {
    assert.equal(button(harness.renderer, '复制到这里').props.disabled, true)
    await TestRenderer.act(async () => { held.reject(new Error('目录服务暂不可用，完整错误保留')); await Promise.resolve() })
    assert.match(text(harness.renderer.root), /目录服务暂不可用，完整错误保留/)
    assert.equal(button(harness.renderer, '复制到这里').props.disabled, true)
    await click(button(harness.renderer, '重试加载'))
    assert.equal(Boolean(button(harness.renderer, '复制到这里').props.disabled), false)
    assert.match(text(harness.renderer.root), /全部文件.*项目目录/)
    assert.equal(attempts, 2)
  } finally { await harness.unmount() }
})

test('submission failure preserves chosen target and sources, and a deliberate retry submits exactly once', async () => {
  let attempts = 0
  const submitted = []
  const harness = await mount({ onSubmit: async (crumbs) => { submitted.push(crumbs); if (++attempts === 1) throw new Error('revision conflict: 刷新后重试') } })
  try {
    await click(button(harness.renderer, '打开文件夹 目录-30'))
    await click(button(harness.renderer, '复制到这里'))
    assert.match(text(harness.renderer.root), /revision conflict: 刷新后重试/)
    assert.match(text(harness.renderer.root), /全部文件.*项目目录.*目录-30/)
    assert.match(text(harness.renderer.root), /2 个项目/)
    assert.equal(harness.closes.length, 0)
    await click(button(harness.renderer, '复制到这里'))
    assert.deepEqual(submitted, [[root, home, { id: 30, name: '目录-30' }], [root, home, { id: 30, name: '目录-30' }]])
    assert.equal(harness.closes.length, 1)
  } finally { await harness.unmount() }
})

test('closing a loading picker prevents an older response from changing its reopened target', async () => {
  const old = deferred()
  const harness = await mount({ loadDirectoryPage: async (parentID) => parentID === 2 ? old.promise : page([directory(90, 'new-only')]) })
  try {
    await click(button(harness.renderer, '取消'))
    assert.equal(harness.closes.length, 1)
    await harness.update({ open: false })
    await harness.update({ open: true, initialCrumbs: [root, { id: 9, name: 'new-target' }] })
    await TestRenderer.act(async () => { old.resolve(page([directory(80, 'old-only')])); await old.promise })
    assert.match(text(harness.renderer.root), /new-target/)
    assert.match(text(harness.renderer.root), /new-only/)
    assert.doesNotMatch(text(harness.renderer.root), /old-only/)
    assert.deepEqual(harness.submissions, [])
  } finally { await harness.unmount() }
})

test('duplicate submit and dialog close are disabled while queue acceptance is pending', async () => {
  const pending = deferred()
  let calls = 0
  const harness = await mount({ onSubmit: async () => { calls += 1; await pending.promise } })
  try {
    const submit = button(harness.renderer, '复制到这里')
    let completion
    await TestRenderer.act(async () => { completion = submit.props.onClick(); submit.props.onClick() })
    assert.equal(calls, 1)
    assert.equal(button(harness.renderer, '取消').props.disabled, true)
    await click(button(harness.renderer, '取消'))
    assert.equal(harness.closes.length, 0)
    await TestRenderer.act(async () => { pending.resolve(); await completion })
    assert.equal(harness.closes.length, 1)
  } finally { await harness.unmount() }
})

test('lifecycle/source replacement ignores an older submit error and cannot close the replacement picker', async () => {
  const pending = deferred()
  const harness = await mount({ onSubmit: async () => pending.promise })
  try {
    let completion
    await TestRenderer.act(async () => { completion = button(harness.renderer, '复制到这里').props.onClick() })
    await harness.update({ lifecycleKey: 'account-b', sources: [{ id: 91, revision: 1, name: 'new-file', type: 'file', parent_id: 9 }], initialCrumbs: [root, { id: 9, name: 'new-target' }] })
    await TestRenderer.act(async () => { pending.reject(new Error('old-submit-failure')); await completion })
    assert.match(text(harness.renderer.root), /new-target/)
    assert.doesNotMatch(text(harness.renderer.root), /old-submit-failure/)
    assert.equal(harness.closes.length, 0)
    assert.equal(Boolean(button(harness.renderer, '取消').props.disabled), false)
  } finally { await harness.unmount() }
})

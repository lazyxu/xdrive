const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const repo = path.resolve(process.env.XDRIVE_FILE_EXPLORER_SOURCE_ROOT || path.join(__dirname, '../..'))
const projectRequire = createRequire(path.join(repo, 'desktop/package.json'))
const React = projectRequire('react')
const TestRenderer = projectRequire('react-test-renderer')
const material = projectRequire('@mui/material')
const { buildSync } = projectRequire('esbuild')
const output = buildSync({ entryPoints: [path.join(repo, 'ui/shared/src/mui/FileTagDialog.tsx')], bundle: true, packages: 'external', platform: 'node', format: 'cjs', jsx: 'automatic', write: false, logLevel: 'silent' }).outputFiles[0].text
const mod = { exports: {} }
const DialogHost = ({ open, children }) => open ? React.createElement('dialog-host', null, children) : null
new Function('module', 'exports', 'require', output)(mod, mod.exports, request => request === '@mui/material' ? { ...material, Dialog: DialogHost } : request.startsWith('@mui/icons-material/') ? projectRequire(request).default : projectRequire(request))
const { XDriveFileTagDialog } = mod.exports
const tag = { id: 9, name: '研究', color: '#115599', item_count: 900, created_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z' }
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : !node || node.type === 'style' ? '' : (node.children || []).map(text).join('')
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() }
async function mount(options = {}) {
  const calls = { query: [], set: [], create: [], update: [], delete: [], close: [] }
  let props = {
    open: true, nodeIDs: [1], tags: [tag], busy: false,
    queryNodeTags: async ids => { calls.query.push([...ids]); return options.query ? options.query(ids) : ids.map(node_id => ({ node_id, tags: [] })) },
    onSetTag: async (...args) => { calls.set.push(args); if (options.set) return options.set(...args) },
    onCreateTag: async (...args) => { calls.create.push(args); if (options.create) return options.create(...args); return { ...tag, id: 10, name: args[0], color: args[1] } },
    onUpdateTag: async (...args) => { calls.update.push(args); if (options.update) return options.update(...args); return { ...tag, ...args[1] } },
    onDeleteTag: async id => { calls.delete.push(id); if (options.delete) return options.delete(id) },
    onClose: () => calls.close.push(true), ...options.props,
  }
  let renderer
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(XDriveFileTagDialog, props)); await flush() })
  const h = {
    calls, get renderer() { return renderer }, get text() { return text(renderer.toJSON()) },
    get rows() { return renderer.root.findAllByType(material.ListItemButton) },
    get checkboxes() { return renderer.root.findAllByType(material.Checkbox) },
    button(pattern) { return renderer.root.findAllByType(material.Button).find(node => pattern.test(text(node))) },
    async press(node) { assert.ok(node, 'the required real MUI control is present'); assert.notEqual(node.props.disabled, true, 'the actual control is enabled'); await TestRenderer.act(async () => { node.props.onClick?.({}); await flush() }) },
    async name(value) { const field = renderer.root.findAllByType(material.TextField).find(node => ['新标签', '标签名称'].includes(node.props.label)); assert.ok(field); await TestRenderer.act(async () => field.props.onChange({ target: { value } })) },
    async update(next) { props = { ...props, ...next }; await TestRenderer.act(async () => { renderer.update(React.createElement(XDriveFileTagDialog, props)); await flush() }) },
    async settle(callback) { await TestRenderer.act(async () => { await callback?.(); await flush() }) },
    async dispose() { await TestRenderer.act(async () => renderer.unmount()) },
  }
  h.submit = () => h.press(h.button(/^(添加|创建标签|创建|添加并应用|保存)$/))
  return h
}

test('control: default assignment reads and toggles the complete selected node', async () => {
  const h = await mount({ query: async ids => ids.map(node_id => ({ node_id, tags: [tag] })) })
  try { assert.deepEqual(h.calls.query, [[1]]); assert.equal(h.checkboxes[0].props.checked, true); await h.press(h.rows[0]); assert.deepEqual(h.calls.set, [[9, [1], false]]) } finally { await h.dispose() }
})

test('management creation never assigns a newly defined tag to an empty selection', async () => {
  const h = await mount({ props: { mode: 'manage', nodeIDs: [] } })
  try { assert.deepEqual(h.calls.query, []); await h.name('新标签定义'); await h.submit(); assert.equal(h.calls.create.length, 1); assert.deepEqual(h.calls.set, [], 'definition management must not submit an empty node assignment') } finally { await h.dispose() }
})

test('explicit management mode does not query assignments even if old node IDs remain supplied', async () => {
  const h = await mount({ props: { mode: 'manage', nodeIDs: [1, 2] } })
  try { assert.deepEqual(h.calls.query, [], 'management has no assignment read'); assert.equal(h.checkboxes.length, 0, 'management must not advertise assignment checkboxes') } finally { await h.dispose() }
})

test('assignment deduplicates the selection without changing complete identity', async () => {
  const h = await mount({ props: { nodeIDs: [1, 1, 2] } })
  try { assert.deepEqual(h.calls.query, [[1, 2]], 'selected identity count is unique'); await h.press(h.rows[0]); assert.deepEqual(h.calls.set, [[9, [1, 2], true]]) } finally { await h.dispose() }
})

test('assignment describes current-selection membership separately from global tag count', async () => {
  const h = await mount({ props: { nodeIDs: [1, 2] }, query: async () => [{ node_id: 1, tags: [tag] }, { node_id: 2, tags: [] }] })
  try { assert.equal(h.checkboxes[0].props.indeterminate, true); assert.match(h.text, /当前选择\s*1\s*[/／]\s*2|1\s*[/／]\s*2\s*.*已标记/, 'the visible tag scope must say1/2, not only global900') } finally { await h.dispose() }
})

test('failed membership read stays unknown and refuses a blind toggle', async () => {
  const h = await mount({ query: async () => { throw new Error('读取标签失败') } })
  try { assert.match(h.text, /读取标签失败/); assert.ok(h.rows.length === 0 || h.rows.every(row => row.props.disabled), 'an unknown membership read must not become enabled unchecked rows'); assert.deepEqual(h.calls.set, []) } finally { await h.dispose() }
})

test('failed membership read can retry in the dialog and recover exact checks', async () => {
  let reads = 0
  const h = await mount({ query: async ids => { if (++reads === 1) throw new Error('读取标签失败'); return ids.map(node_id => ({ node_id, tags: [tag] })) } })
  try { const retry = h.button(/重试/); assert.ok(retry, 'read failure needs a retry control in the panel'); await h.press(retry); assert.equal(reads, 2); assert.equal(h.checkboxes[0].props.checked, true) } finally { await h.dispose() }
})

for (const nodeIDs of [Array.from({ length: 501 }, (_, i) => i + 1), [1, 0, 2]]) {
  test(`assignment rejects ${nodeIDs.length === 501 ? '501 selected nodes' : 'an invalid selection'} before any query or subset`, async () => {
    const h = await mount({ props: { nodeIDs } })
    try { assert.deepEqual(h.calls.query, [], 'invalid assignment scope must not be submitted or silently filtered'); assert.deepEqual(h.calls.set, []); assert.match(h.text, nodeIDs.length === 501 ? /500/ : /无效|重新选择|不可用/) } finally { await h.dispose() }
  })
}

test('control: tag creation accepts exactly64 UTF-8 bytes and trims surrounding spaces', async () => {
  const h = await mount()
  try { const name = '研'.repeat(21) + 'a'; await h.name(' ' + name + ' '); await h.submit(); assert.deepEqual(h.calls.create[0], [name, '#6B7280']); assert.deepEqual(h.calls.set, [[10, [1], true]]) } finally { await h.dispose() }
})

test('tag creation rejects more than64 UTF-8 bytes before transport', async () => {
  const h = await mount()
  try { await h.name('研'.repeat(22)); await h.submit(); assert.deepEqual(h.calls.create, [], '66-byte name must fail client validation'); assert.match(h.text, /64.*字节|字节.*64/) } finally { await h.dispose() }
})

test('tag editing uses the same64-byte limit without losing its draft', async () => {
  const h = await mount()
  try { const edit = h.renderer.root.findAllByType(material.IconButton).find(node => node.props['aria-label'] === '编辑标签 研究'); await h.press(edit); const name = '研'.repeat(22); await h.name(name); await h.submit(); assert.deepEqual(h.calls.update, []); assert.match(h.text, /64.*字节|字节.*64/); assert.equal(h.renderer.root.findAllByType(material.TextField).find(node => node.props.label === '标签名称').props.value, name) } finally { await h.dispose() }
})

test('control: a mutation error preserves the editable tag draft and local error', async () => {
  const h = await mount({ create: async () => { throw new Error('同名标签已存在，长错误末尾') } })
  try { await h.name('保留的草稿'); await h.submit(); assert.match(h.text, /长错误末尾/); assert.equal(h.renderer.root.findAllByType(material.TextField).find(node => node.props.label === '新标签').props.value, '保留的草稿') } finally { await h.dispose() }
})

test('a committed tag with a failed assignment clears the creation draft and retries through its existing row', async () => {
  const created = { ...tag, id: 10, name: '已创建的标签', item_count: 0 }
  let creates = 0
  let assignments = 0
  const h = await mount({
    props: { nodeIDs: [1, 2] },
    create: async () => {
      if (++creates > 1) throw new Error('同名标签已存在')
      return created
    },
    set: async () => { if (++assignments === 1) throw new Error('应用标签失败') },
  })
  try {
    await h.name(created.name)
    await h.submit()
    // The existing organization owner retains the actual successful definition
    // response even when the subsequent node assignment rejects.
    await h.update({ tags: [tag, created] })
    const failureDraft = h.renderer.root.findAllByType(material.TextField).find(node => node.props.label === '新标签').props.value
    const failureText = h.text
    const add = h.button(/^添加$/)
    if (!add.props.disabled) await h.press(add)
    const retryRow = h.rows.find(row => text(row).includes(created.name))
    await h.press(retryRow)

    assert.deepEqual({
      failureDraft,
      truthfulOutcome: /标签已创建，但未能应用到所选项目/.test(failureText),
      createCalls: h.calls.create,
      assignmentCalls: h.calls.set,
      selectedCount: /当前选择\s*2\/2\s*已标记/.test(text(h.rows.find(row => text(row).includes(created.name)))),
    }, {
      failureDraft: '',
      truthfulOutcome: true,
      createCalls: [[created.name, '#6B7280']],
      assignmentCalls: [[10, [1, 2], true], [10, [1, 2], true]],
      selectedCount: true,
    }, 'a failed second step must preserve the committed definition and make the existing assignment row its retry')
  } finally { await h.dispose() }
})

test('tag definition deletion is explicitly distinct from removing selected assignments', async () => {
  const h = await mount()
  try { assert.match(h.text, /删除标签.*(所有|关联)|删除.*定义/, 'deleting a definition affects associations beyond the selected files') } finally { await h.dispose() }
})

test('control: replacing selected nodes rejects a late old membership read', async () => {
  const old = deferred()
  const h = await mount({ query: ids => ids[0] === 1 ? old.promise : Promise.resolve([{ node_id: 2, tags: [] }]) })
  try { await h.update({ nodeIDs: [2] }); await h.settle(() => old.resolve([{ node_id: 1, tags: [tag] }])); assert.equal(h.checkboxes[0].props.checked, false); await h.press(h.rows[0]); assert.deepEqual(h.calls.set, [[9, [2], true]]) } finally { await h.dispose() }
})

test('management definition loading does not report a confirmed empty list', async () => {
  const h = await mount({ props: { mode: 'manage', nodeIDs: [], tags: [], tagsLoading: true } })
  try { assert.doesNotMatch(h.text, /还没有标签|暂无标签/, 'pending definitions are not an empty result'); assert.ok(h.renderer.root.findAllByType(material.CircularProgress).length || /加载/.test(h.text)); assert.deepEqual(h.calls.query, []) } finally { await h.dispose() }
})

test('management definition errors use the supplied authoritative retry without querying assignments', async () => {
  let retries = 0
  const h = await mount({ props: { mode: 'manage', nodeIDs: [], tags: [], tagsError: '标签列表读取失败', onRetryTags: () => { retries += 1 } } })
  try { assert.match(h.text, /标签列表读取失败/); assert.doesNotMatch(h.text, /还没有标签|暂无标签/); await h.press(h.button(/重试/)); assert.equal(retries, 1); assert.deepEqual(h.calls.query, []) } finally { await h.dispose() }
})

test('real Web API untagged-node JSON is a known empty assignment, not a render crash', async () => {
  const ts = projectRequire('typescript')
  const filename = path.join(repo, 'web/src/api.ts')
  const ast = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true)
  const methods = new Map()
  function visit(entry) { if (ts.isMethodDeclaration(entry)) methods.set(entry.name.getText(ast), entry.getText(ast)); ts.forEachChild(entry, visit) }
  visit(ast)
  assert.ok(methods.has('request') && methods.has('fileNodeTags'))
  const apiSource = ts.transpileModule(`class LiveQueryAPI { session = { accessToken: 'fixture-only' }; async ensureFresh() {} ${methods.get('request')} ${methods.get('fileNodeTags')} }`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const requests = []
  // queryFileNodeTags emits an entry for every selected node; its map lookup is
  // a nil []fileTagDTO for an untagged node, which encoding/json sends as null.
  const wire = '[{"node_id":1,"tags":null}]'
  const api = new Function('fetch', 'API_BASE', apiSource + '\nreturn new LiveQueryAPI();')(async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return new Response(wire, { status: 200, headers: { 'Content-Type': 'application/json' } }) }, '')
  const data = await api.fileNodeTags([1])
  assert.deepEqual(data, [{ node_id: 1, tags: null }], 'actual Web query currently passes through the Server JSON')
  const caught = []
  class ErrorBoundary extends React.Component {
    constructor(props) { super(props); this.state = { error: null } }
    static getDerivedStateFromError(error) { return { error } }
    componentDidCatch(error) { caught.push(String(error)) }
    render() { return this.state.error ? React.createElement('div', null, 'render failed') : this.props.children }
  }
  let renderer
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(ErrorBoundary, null, React.createElement(XDriveFileTagDialog, {
      open: true, nodeIDs: [1], tags: [tag], queryNodeTags: ids => api.fileNodeTags(ids),
      onSetTag: async () => {}, onCreateTag: async () => tag, onUpdateTag: async () => tag, onDeleteTag: async () => {}, onClose: () => {},
    })))
    await flush()
  })
  try {
    assert.deepEqual(requests.map(request => request.body), [{ node_ids: [1] }, { node_ids: [1] }])
    assert.deepEqual(caught, [], 'known empty Server tags must remain usable assignment state')
    assert.equal(renderer.root.findAllByType(material.Checkbox)[0].props.checked, false)
  } finally { await TestRenderer.act(async () => renderer.unmount()) }
})

test('a busy tag editor cannot bypass its disabled action by pressing Enter', async () => {
  const h = await mount()
  try {
    await h.name('等待中的草稿')
    await h.update({ busy: true })
    const field = h.renderer.root.findAllByType(material.TextField).find(node => node.props.label === '新标签')
    if (!field.props.disabled) await h.settle(() => field.props.onKeyDown?.({ key: 'Enter', preventDefault() {} }))
    assert.deepEqual(h.calls.create, [], 'the keyboard path must honor the same busy state as the button')
  } finally { await h.dispose() }
})

test('the tag editor exposes its own pending write when no parent busy prop is supplied', async () => {
  const pending = deferred()
  const h = await mount({ create: () => pending.promise })
  try {
    await h.name('等待创建的标签')
    await h.submit()
    const button = h.button(/^(添加|创建标签|创建|添加并应用|保存)$/)
    if (button && !button.props.disabled) await h.press(button)
    assert.equal(h.calls.create.length, 1, 'a second real click during the unresolved create must not submit again')
  } finally { await h.dispose(); pending.resolve({ ...tag, id: 10 }); await flush() }
})

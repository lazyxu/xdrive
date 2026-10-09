const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { Button } = require('@mui/material')
const { buildSync } = require('esbuild')

const sharedRoot = path.join(__dirname, '../../ui/shared/src')
function load(relativePath) {
  const filename = path.join(sharedRoot, relativePath)
  if (!fs.existsSync(filename)) return {}
  const bundled = buildSync({
    entryPoints: [filename], bundle: true, packages: 'external', platform: 'node',
    format: 'cjs', jsx: 'automatic', write: false,
  })
  const module = { exports: {} }
  new Function('module', 'exports', 'require', bundled.outputFiles[0].text)(module, module.exports, require)
  return module.exports
}

const model = load('file-operations.ts')
const { XDriveFileExplorerActionFeedback: Feedback } = load('mui/FileExplorerActionFeedback.tsx')
const operation = (patch = {}) => ({
  id: 'operation-7', type: 'copy', status: 'queued', total_items: 5, processed_items: 0,
  total_bytes: 8192, processed_bytes: 0, percent: 0, retryable: false,
  created_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z', ...patch,
})
const describe = (value) => {
  assert.equal(typeof model.xDriveFileExplorerActionFeedback, 'function',
    'export a shared truthful operation/download feedback formatter')
  return model.xDriveFileExplorerActionFeedback(value)
}
const describeOperation = (patch) => describe({ kind: 'operation', operation: operation(patch) })
const describeDownload = (patch) => describe({
  kind: 'download', result: { downloaded: 0, failed: 0, skippedFolders: 0, ...patch },
})
const messageText = (value) => [value.title, value.message, ...value.details.map((row) => `${row.label} ${row.value}`)].join(' ')
const render = (props) => {
  assert.equal(typeof Feedback, 'function', 'export the shared MUI action feedback presenter')
  return renderToStaticMarkup(React.createElement(Feedback, { onDismiss() {}, ...props }))
}
const visibleText = (html) => html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '')

test('queued feedback identifies the actual task and pending outcome', () => {
  const result = describeOperation()
  assert.equal(result.title, '复制 · 等待执行')
  assert.equal(result.tone, 'busy')
  assert.equal(result.operationID, 'operation-7')
  assert.match(result.message, /等待执行/)
  assert.match(result.message, /5 个项目/)
  assert.doesNotMatch(result.message, /成功|已完成|已复制/)
})

test('running feedback labels processed counters as progress, not committed successes', () => {
  const result = describeOperation({ status: 'running', processed_items: 3, percent: 60, current_item: '子目录/照片.jpg' })
  assert.equal(result.title, '复制 · 进行中')
  assert.match(result.message, /处理进度：3 \/ 5 个项目/)
  assert.match(result.message, /尚未完成/)
  assert.doesNotMatch(result.message, /成功|已复制|已完成/)
  assert.ok(result.details.some((row) => row.label === '当前项目' && row.value === '子目录/照片.jpg'))
})

test('cancellation request waits for the actual terminal outcome', () => {
  const result = describeOperation({ status: 'cancel_requested', processed_items: 3 })
  assert.equal(result.title, '复制 · 正在取消')
  assert.match(result.message, /等待任务确认/)
  assert.doesNotMatch(result.message, /未提交任何更改|已取消/)
})

for (const type of ['copy', 'move', 'delete']) {
  test(`${type} failure describes the atomic batch and ignores transient success-looking counters`, () => {
    const result = describeOperation({ type, status: 'failed', processed_items: 3,
      failed_item_id: 42, current_item: '冲突照片.jpg', failure_code: 'name_conflict', error: 'Server 原因：目标同名' })
    assert.equal(result.tone, 'bad')
    assert.match(result.message, /整批操作失败，未提交任何更改/)
    assert.doesNotMatch(result.message, /3|成功/)
    assert.ok(result.details.some((row) => row.label === '失败项目' && row.value === '冲突照片.jpg（#42）'))
    assert.ok(result.details.some((row) => row.value === 'name_conflict'))
    assert.ok(result.details.some((row) => row.value === '目标位置存在同名项目，请处理冲突后重新操作。'))
    assert.ok(result.details.some((row) => row.value === 'Server 原因：目标同名'))
  })
}

test('confirmed atomic cancellation is not a failure and does not claim partial mutation', () => {
  const result = describeOperation({ type: 'move', status: 'cancelled', processed_items: 3, error: 'cancelled' })
  assert.equal(result.tone, 'neutral')
  assert.equal(result.title, '移动 · 已取消')
  assert.match(result.message, /整批操作已取消，未提交任何更改/)
  assert.doesNotMatch(messageText(result), /成功|失败|3 \/ 5/)
})

test('completed skip policy keeps changed and skipped counts unknown', () => {
  const result = describeOperation({ status: 'completed', conflict_policy: 'skip', processed_items: 5 })
  assert.equal(result.title, '复制 · 已完成')
  assert.equal(result.tone, 'warning')
  assert.match(result.message, /跳过冲突/)
  assert.match(result.message, /5 个项目/)
  assert.match(result.message, /跳过数量未提供/)
  assert.doesNotMatch(messageText(result), /已复制|成功|全部|跳过 0|更改 5/)
})

test('ordinary completion reports the task total and preserves its conflict policy', () => {
  const result = describeOperation({ status: 'completed', conflict_policy: 'keep_both', processed_items: 5 })
  assert.equal(result.tone, 'good')
  assert.match(result.message, /任务已完成，共 5 个项目/)
  assert.ok(result.details.some((row) => row.label === '冲突策略' && row.value === '保留两者'))
})

test('unrelated undo and redo feedback does not infer copy/move/delete commit semantics', () => {
  for (const type of ['undo', 'redo']) {
    const result = describeOperation({ type, status: 'failed', failure_code: 'internal_error' })
    assert.match(result.message, /任务失败/)
    assert.doesNotMatch(result.message, /未提交任何更改/)
  }
})

test('Desktop partial download preserves every actual count and named failure', () => {
  const failures = Object.freeze([{ name: 'A/<照片>&.jpg', message: '网络中断；可以重新下载' }])
  const result = describe({ kind: 'download', result: Object.freeze({ downloaded: 2, failed: 1, skippedFolders: 3, failures }) })
  assert.equal(result.tone, 'warning')
  assert.equal(result.operationID, undefined)
  assert.equal(result.message, '已下载 2 个文件，1 个失败，跳过 3 个文件夹。')
  assert.deepEqual(result.details, [{ label: 'A/<照片>&.jpg', value: '网络中断；可以重新下载' }])
  assert.doesNotMatch(messageText(result), /未提交任何更改|全部成功/)
})

test('download aggregate without named details does not invent failure items', () => {
  const result = describeDownload({ downloaded: 0, failed: 2 })
  assert.equal(result.tone, 'bad')
  assert.equal(result.title, '下载失败')
  assert.equal(result.message, '已下载 0 个文件，2 个失败。')
  assert.deepEqual(result.details, [])
})

test('empty and cancelled downloads are honest about zero or already returned files', () => {
  const empty = describeDownload()
  assert.equal(empty.tone, 'neutral')
  assert.equal(empty.title, '没有下载文件')
  assert.equal(empty.message, '已下载 0 个文件。')
  const cancelled = describeDownload({ downloaded: 2, canceled: true })
  assert.equal(cancelled.title, '下载已取消')
  assert.equal(cancelled.tone, 'neutral')
  assert.equal(cancelled.message, '已下载 2 个文件。')
})

test('the presenter renders no placeholder or controls without an authoritative value', () => {
  assert.equal(render({ value: null }), '')
})

test('real MUI rendering includes the atomic failure, full escaped details, and task/dismiss buttons', () => {
  const longError = '无法处理 <目录>&照片；'.repeat(40)
  const html = render({ value: { kind: 'operation', operation: operation({ status: 'failed',
    current_item: '长目录/'.repeat(30) + '照片.jpg', failed_item_id: 42, error: longError }) }, onViewTask() {} })
  const text = visibleText(html)
  assert.match(html, /role="alert"/)
  assert.match(html, /data-xdrive-file-explorer-action-feedback/)
  assert.match(text, /整批操作失败，未提交任何更改/)
  assert.ok(text.includes('长目录/'.repeat(30) + '照片.jpg（#42）'))
  assert.ok(text.includes(longError.replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('&照片', '&amp;照片')))
  assert.match(html, /overflow-wrap:anywhere/)
  assert.match(html, /min-height:44px/)
  assert.equal((html.match(/<button\b/g) || []).length, 2)
  assert.match(text, /查看任务/)
  assert.match(text, /关闭提示/)
})

test('real MUI download rendering has truthful counts and only the dismiss action', () => {
  const html = render({ value: { kind: 'download', result: { downloaded: 2, failed: 1, skippedFolders: 1,
    failures: [{ name: '失败.jpg', message: '网络断开' }] } }, onViewTask() {} })
  const text = visibleText(html)
  assert.match(html, /role="status"/)
  assert.match(text, /已下载 2 个文件，1 个失败，跳过 1 个文件夹/)
  assert.match(text, /失败.jpg/)
  assert.match(text, /网络断开/)
  assert.equal((html.match(/<button\b/g) || []).length, 1)
  assert.doesNotMatch(text, /查看任务/)
})

test('stateless presenter actions forward the current operation identity and dismiss independently', () => {
  assert.equal(typeof Feedback, 'function', 'export the shared MUI action feedback presenter')
  const calls = []
  const element = Feedback({ value: { kind: 'operation', operation: operation({ id: 'actual-operation-91' }) },
    onViewTask: (id) => calls.push(['task', id]), onDismiss: () => calls.push(['dismiss']) })
  // The renderer test above executes real MUI. Inspect this stateless component's
  // actual React button elements to invoke only its callback boundary here.
  const buttons = []
  function visit(child) {
    if (!React.isValidElement(child)) return
    if (child.type === Button) buttons.push(child)
    React.Children.forEach(child.props.children, visit)
  }
  visit(element)
  assert.equal(buttons.length, 2)
  buttons.find((button) => button.props.children === '查看任务').props.onClick()
  assert.deepEqual(calls, [['task', 'actual-operation-91']])
  buttons.find((button) => button.props.children === '关闭提示').props.onClick()
  assert.deepEqual(calls, [['task', 'actual-operation-91'], ['dismiss']])
})

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

// Render our actual React/MUI components. Browser focus and Popover positioning
// belong to the app's browser checks; these assertions exercise visible content
// and the trigger's accessible contract without mocking the UI framework.
const shared = path.join(__dirname, '..', '..', 'ui', 'shared', 'src')
const cache = new Map()
function load(filename) {
  if (cache.has(filename)) return cache.get(filename).exports
  if (!fs.existsSync(filename)) return {}
  const result = { exports: {} }
  cache.set(filename, result)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
  const localRequire = (specifier) => {
    if (!specifier.startsWith('.')) return require(specifier)
    const base = path.resolve(path.dirname(filename), specifier)
    const resolved = [base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
      .find((candidate) => fs.existsSync(candidate))
    assert.ok(resolved, `Cannot resolve ${specifier} from ${filename}`)
    return load(resolved)
  }
  new Function('exports', 'require', 'module', output)(result.exports, localRequire, result)
  return result.exports
}
const { XDriveTransferPopover } = load(path.join(shared, 'mui', 'TransferPopover.tsx'))
const { XDriveTransferCenter, XDriveTransferTreeItem } = load(path.join(shared, 'mui', 'TransferCenter.tsx'))
const { xDriveTransferTree } = load(path.join(shared, 'transfers.ts'))

function task(id, overrides = {}) {
  return {
    id, file_name: `${id}.bin`, kind: 'download', direction: 'download',
    state: 'running', phase: 'transferring', bytes_done: 1024, bytes_total: 4096,
    percent: 25, instant_bytes_per_second: 2048, average_bytes_per_second: 1024,
    elapsed_ms: 1000, retry_count: 0, retryable: false,
    started_at: new Date(Date.now() - 1000).toISOString(), updated_at: new Date().toISOString(),
    ...overrides,
  }
}
function render(Component, props) {
  return Component ? renderToStaticMarkup(React.createElement(Component, props)) : ''
}
function visibleText(html) {
  return html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')
}

test('closed popover keeps both direction speeds visible and exposes an accessible dialog trigger', () => {
  const html = render(XDriveTransferPopover, { transfers: [task('upload', { kind: 'upload', direction: 'upload', instant_bytes_per_second: 1024 })] })
  assert.match(html, /aria-haspopup="dialog"/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /aria-label="[^"]*上传 1 KiB\/s[^"]*下载 0 B\/s[^"]*1 项进行中/)
  const text = visibleText(html)
  assert.match(text, /1 KiB\/s/)
  assert.match(text, /0 B\/s/)
})

test('server-reported download summary labels the rate source visibly and for screen readers', () => {
  const html = render(XDriveTransferPopover, { transfers: [task('native', { speed_source: 'server' })] })
  assert.match(html, /aria-label="[^"]*服务端发送/)
  assert.match(visibleText(html), /服务端/)
})

test('completed and local work cannot leave a live speed or an active badge on the trigger', () => {
  const html = render(XDriveTransferPopover, {
    transfers: [task('completed', { state: 'completed' }), task('dehydration', { direction: 'local', kind: 'dehydration' })],
  })
  assert.match(html, /aria-label="[^"]*上传 0 B\/s[^"]*下载 0 B\/s[^"]*0 项进行中/)
  assert.equal(visibleText(html).includes('2 KiB/s'), false)
})

test('shared detailed transfer cards identify server-send speed instead of implying browser receipt', () => {
  const html = render(XDriveTransferCenter, { transfers: [task('native', { speed_source: 'server' })] })
  assert.match(visibleText(html), /服务端发送速度/)
})

test('compact root cards preserve direction, progress and the existing failed retry action', () => {
  const node = xDriveTransferTree([task('failed-upload', { kind: 'upload', direction: 'upload', state: 'failed', retryable: true, error: '连接中断' })])[0]
  const html = render(XDriveTransferTreeItem, { node, compact: true, retryDisabled: false, retryingID: '', onRetry() {} })
  const text = visibleText(html)
  assert.match(text, /上传/)
  assert.match(text, /25\.0%/)
  assert.match(text, /重试/)
  assert.match(text, /连接中断/)
  assert.match(html, /role="progressbar"/)
})

test('a stalled compact card does not keep an ETA based on retained speed', () => {
  const node = xDriveTransferTree([task('stalled', { updated_at: new Date(Date.now() - 10000).toISOString() })])[0]
  const html = render(XDriveTransferTreeItem, { node, compact: true, retryDisabled: false, retryingID: '' })
  assert.equal(visibleText(html).includes('剩余约'), false)
})

test('a native download without live tracking appears as browser handoff history', () => {
  const html = render(XDriveTransferCenter, { transfers: [task('native-handoff', { state: 'handed_off' })] })
  assert.match(visibleText(html), /由浏览器下载/)
  assert.match(visibleText(html), /native-handoff\.bin/)
  assert.equal((html.match(/role="progressbar"/g) || []).length, 1, 'browser handoff has byte progress without a busy-state spinner')
})

test('detailed folder cards aggregate child averages while compact children retain their own current rates', () => {
  const items = [
    task('folder', { scope: 'group', instant_bytes_per_second: 999999, average_bytes_per_second: 999999 }),
    task('one', { parent_id: 'folder', root_id: 'folder', instant_bytes_per_second: 1024, average_bytes_per_second: 128 }),
    task('two', { parent_id: 'folder', root_id: 'folder', instant_bytes_per_second: 2048, average_bytes_per_second: 256 }),
  ]
  const text = visibleText(render(XDriveTransferCenter, { transfers: items }))
  assert.match(text, /平均速度\s+384 B\/s/)
  assert.match(text, /当前速度\s+3 KiB\/s/)
  assert.match(text, /当前速度\s+1 KiB\/s/)
  assert.match(text, /当前速度\s+2 KiB\/s/)
})

test('terminal compact items show stored average speed rather than a frozen current-speed label', () => {
  const item = task('historical-rate', {
    state: 'completed', phase: 'finalizing',
    average_bytes_per_second: 5120, instant_bytes_per_second: 9999,
  })
  const html = render(XDriveTransferTreeItem, {
    node: xDriveTransferTree([item])[0],
    compact: true,
    retryDisabled: false,
    retryingID: '',
  })
  const visible = visibleText(html)
  assert.match(visible, /平均速度\s+5 KiB\/s/)
  assert.doesNotMatch(visible, /当前速度\s+0 B\/s/)
})

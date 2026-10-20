const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')

const repo = path.resolve(__dirname, '../..')
const compiled = new Map()

// Keep real React state/effects, PublicShare handlers, and the shared AuthPanel
// and ActionButton implementations. MUI's visual boundary is reduced to host
// elements; these tests do not certify DOM layout, keyboard default actions,
// touch targets, or focus. The real-browser runner owns those assertions.
const host = (tag) => function Host({ component, children, ...props }) {
  return React.createElement(component || tag, props, children)
}
const mui = {
  Box: host('div'),
  Paper: host('div'),
  Stack: host('div'),
  Typography: host('span'),
  InputAdornment: host('span'),
  Button: host('button'),
  CircularProgress: host('span'),
  TextField: host('input'),
  Breadcrumbs: host('nav'),
  IconButton: host('button'),
  Menu: host('div'),
  MenuItem: host('div'),
  Dialog: ({ open, children, ...props }) => open ? React.createElement('dialog', { open, ...props }, children) : null,
  DialogTitle: host('h2'),
  DialogContent: host('section'),
  DialogActions: host('footer'),
  useMediaQuery: () => false,
}

class TestApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function compile(filename) {
  if (!compiled.has(filename)) {
    compiled.set(filename, ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText)
  }
  return compiled.get(filename)
}

function loadPublicShare(api) {
  const cache = new Map()
  const load = (relativePath) => {
    const filename = path.join(repo, relativePath)
    if (cache.has(filename)) return cache.get(filename).exports
    const module = { exports: {} }
    cache.set(filename, module)
    const localRequire = (name) => {
      if (name === '@mui/material') return mui
      if (name.startsWith('@mui/icons-material/')) return { __esModule: true, default: () => null }
      if (name.endsWith('.svg')) return { __esModule: true, default: 'test-brand.svg' }
      if (name === './api') return { ApiError: TestApiError, XDriveApi: api }
      if (name === '../../ui/shared/src') return load('ui/shared/src/format.ts')
      if (name === '../../ui/shared/src/mui/useDeferredLoading') return load('ui/shared/src/mui/useDeferredLoading.ts')
      if (name === './FileExplorerItemPresentation') return load('ui/shared/src/mui/FileExplorerItemPresentation.tsx')
      if (name === './ActionButton') return load('ui/shared/src/mui/ActionButton.tsx')
      if (name === '../format') return load('ui/shared/src/format.ts')
      if (name === '@xdrive/ui/mui') {
        return {
          ...load('ui/shared/src/mui/AuthSurface.tsx'),
          ...load('ui/shared/src/mui/ActionButton.tsx'),
          ...load('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx'),
          XDriveBrandLockup: () => null,
          XDriveStatePanel: ({ message }) => React.createElement('div', null, message),
          XDriveStatusAlert: ({ children, tone }) => React.createElement('div', { role: 'alert', 'data-tone': tone }, children),
        }
      }
      assert.ok(!name.startsWith('.'), `Unexpected local dependency ${name} in ${relativePath}`)
      return require(name)
    }
    new Function('exports', 'require', 'module', compile(filename))(module.exports, localRequire, module)
    return module.exports
  }
  return load('web/src/PublicShare.tsx').default
}

function textContent(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textContent).join('')
  return textContent(node.children)
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

async function mountShare(t, { share: overrides = {}, download = async () => {} } = {}) {
  const share = {
    name: 'shared-report.txt', size: 2048, requires_password: true,
    max_downloads: 3, download_count: 1, expires_at: null, ...overrides,
  }
  const downloads = []
  class Api {
    async publicShare(token) {
      assert.equal(token, 'test-share-token')
      return { ...share }
    }
    downloadPublicShare(token, password, filename) {
      downloads.push({ token, password, filename })
      return download()
    }
  }
  const PublicShare = loadPublicShare(Api)
  let renderer
  await act(async () => {
    renderer = create(React.createElement(PublicShare, { token: 'test-share-token' }))
  })
  t.after(() => act(() => renderer.unmount()))
  return {
    downloads,
    renderer,
    text: () => textContent(renderer.toJSON()),
    button: () => {
      const submitButtons = renderer.root.findAllByType('button')
        .filter(node => node.props.type === 'submit')
      assert.equal(submitButtons.length, 1, 'public share has exactly one native download submit action')
      return submitButtons[0]
    },
    async password(value) {
      await act(async () => {
        renderer.root.findByType('input').props.onChange({ target: { value } })
      })
    },
    async submit() {
      const event = {
        key: 'Enter', defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true },
      }
      await act(async () => {
        const forms = renderer.root.findAllByType('form')
        if (forms.length > 0) {
          assert.equal(forms.length, 1, 'Public Share must not nest forms')
          forms[0].props.onSubmit(event)
        } else {
          // Use the production legacy keyboard handler on the unfixed source,
          // so the same business assertions reproduce its bypass of disabled
          // buttons. Do not add eligibility checks in this harness.
          const passwordInput = renderer.root.findAllByType('input')[0]
          if (passwordInput?.props.onKeyDown) passwordInput.props.onKeyDown(event)
          else renderer.root.findByType('button').props.onClick(event)
        }
      })
      return event
    },
  }
}

test('Public Share uses the shared AuthPanel native form and submit button', async (t) => {
  const view = await mountShare(t)
  const forms = view.renderer.root.findAllByType('form')
  assert.equal(forms.length, 1, 'the real shared AuthPanel must render a native form')
  assert.equal(typeof forms[0].props.onSubmit, 'function')
  assert.equal(view.button().props.type, 'submit')
  const event = await view.submit()
  assert.equal(event.defaultPrevented, true, 'form submission must not navigate the page')
  assert.equal(view.downloads.length, 0)
})

test('Public Share submission rejects a missing required password', async (t) => {
  const view = await mountShare(t)
  assert.equal(view.button().props.disabled, true)
  await view.submit()
  assert.equal(view.downloads.length, 0, 'keyboard/form submission must obey the disabled password condition')
  assert.ok(view.text().includes('剩余 2 / 3 次下载'))
  assert.ok(!view.text().includes('已交给浏览器下载。'))
})

test('Public Share submission rejects an exhausted share even with a password', async (t) => {
  const view = await mountShare(t, { share: { max_downloads: 2, download_count: 2 } })
  await view.password('correct password')
  assert.equal(view.button().props.disabled, true)
  await view.submit()
  assert.equal(view.downloads.length, 0, 'exhaustion must gate the handler as well as the button')
  assert.ok(view.text().includes('剩余 0 / 2 次下载'))
})

test('Public Share submission cannot issue another ticket while a download is pending', async (t) => {
  const pending = deferred()
  const view = await mountShare(t, { download: () => pending.promise })
  await view.password('correct password')
  await view.submit()
  assert.equal(view.downloads.length, 1)
  assert.equal(view.button().props.disabled, true, 'the shared ActionButton must disable its loading state')
  try {
    await view.submit()
    assert.equal(view.downloads.length, 1, 'a pending native handoff must not consume another ticket')
  } finally {
    await act(async () => { pending.resolve() })
  }
  assert.ok(view.text().includes('剩余 1 / 3 次下载'))
  assert.ok(view.text().includes('已交给浏览器下载。'))
})

test('Public Share successful submission preserves the exact password and consumes one local count', async (t) => {
  const view = await mountShare(t)
  await view.password(' password with surrounding spaces ')
  assert.equal(view.button().props.disabled, false)
  await view.submit()
  assert.deepEqual(view.downloads, [{
    token: 'test-share-token', password: ' password with surrounding spaces ', filename: 'shared-report.txt',
  }])
  assert.ok(view.text().includes('剩余 1 / 3 次下载'))
  assert.ok(view.text().includes('已交给浏览器下载。'))
  assert.equal(view.button().props.disabled, false)
})

test('Public Share 401 preserves the local count and permits a corrected password retry', async (t) => {
  let attempts = 0
  const view = await mountShare(t, { download: async () => {
    if (++attempts === 1) throw new TestApiError(401, 'wrong password')
  } })
  await view.password('wrong')
  await view.submit()
  assert.equal(view.downloads.length, 1)
  assert.ok(view.text().includes('分享密码错误。'))
  assert.ok(view.text().includes('剩余 2 / 3 次下载'), 'a rejected ticket must not consume the local count')
  assert.ok(!view.text().includes('已交给浏览器下载。'))
  assert.equal(view.button().props.disabled, false)
  await view.password('correct')
  await view.submit()
  assert.deepEqual(view.downloads.map((call) => call.password), ['wrong', 'correct'])
  assert.ok(!view.text().includes('分享密码错误。'))
  assert.ok(view.text().includes('剩余 1 / 3 次下载'))
  assert.ok(view.text().includes('已交给浏览器下载。'))
})

test('Public Share without password protection accepts submission with no password field', async (t) => {
  const view = await mountShare(t, { share: { requires_password: false } })
  assert.equal(view.renderer.root.findAllByType('input').length, 0)
  assert.equal(view.button().props.disabled, false)
  await view.submit()
  assert.deepEqual(view.downloads.map((call) => call.password), [''])
  assert.ok(view.text().includes('剩余 1 / 3 次下载'))
  assert.ok(view.text().includes('已交给浏览器下载。'))
})


test('Public Share first read has stable geometry and no 40ms loading flash', async (t) => {
  const pending = deferred()
  class Api {
    publicShare(token) {
      assert.equal(token, 'test-share-token')
      return pending.promise
    }
  }
  const PublicShare = loadPublicShare(Api)
  let renderer
  await act(async () => { renderer = create(React.createElement(PublicShare, { token: 'test-share-token' })) })
  t.after(() => act(() => renderer.unmount()))
  const readSlot = () => renderer.root.findAll(
    node => typeof node.type === 'string' && node.props['data-xdrive-public-share-read-slot'] === true
  )[0]
  assert.ok(readSlot(), 'the first-read layout slot must be mounted from the first paint')
  assert.equal(readSlot().props.sx.minHeight, 180)
  assert.equal(readSlot().props['aria-busy'], true, 'active request is immediately accessible')
  assert.ok(!textContent(renderer.toJSON()).includes('正在加载分享'), 'first paint must be quiet')
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })
  assert.ok(!textContent(renderer.toJSON()).includes('正在加载分享'), 'quick reads must never show interim loading')
  assert.equal(readSlot().props['aria-busy'], true)
  await act(async () => {
    pending.resolve({
      name: 'shared-report.txt', size: 2048, requires_password: false,
      max_downloads: 0, download_count: 0, expires_at: null,
    })
    await pending.promise
  })
  assert.equal(readSlot().props['aria-busy'], false)
  assert.ok(textContent(renderer.toJSON()).includes('shared-report.txt'))
  assert.ok(!textContent(renderer.toJSON()).includes('正在加载分享'))
})

test('P90 sustained public-share first read retains a silent 180px slot and actionable error', async (t) => {
  // Keep the original resolve-only deferred() helper for existing download tests.
  let rejectPending
  const pending = { promise: new Promise((_resolve, reject) => { rejectPending = reject }) }
  class Api {
    publicShare(token) {
      assert.equal(token, 'test-share-token')
      return pending.promise
    }
  }
  const PublicShare = loadPublicShare(Api)
  let renderer
  await act(async () => { renderer = create(React.createElement(PublicShare, { token: 'test-share-token' })) })
  t.after(() => act(() => renderer.unmount()))
  const slot = renderer.root.findAll(node => typeof node.type === 'string' &&
    node.props['data-xdrive-public-share-read-slot'] === true)[0]
  assert.ok(slot)
  const height = slot.props.sx.minHeight
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 360)) })
  assert.equal(slot.props['aria-busy'], true)
  assert.equal(slot.props.sx.minHeight, height)
  assert.equal(renderer.root.findAll(node =>
    node.props?.['data-xdrive-public-share-delayed-feedback']).length, 0)
  assert.ok(!textContent(renderer.toJSON()).includes('正在加载分享'))
  await act(async () => {
    rejectPending(new TestApiError(404, 'not found'))
    await Promise.resolve()
  })
  assert.ok(textContent(renderer.toJSON()).includes('此分享链接不存在。'))
  assert.ok(!textContent(renderer.toJSON()).includes('正在加载分享'))
  assert.equal(slot.props['aria-busy'], false)
  assert.equal(slot.props.sx.minHeight, height)
  assert.equal(renderer.root.findAll(node =>
    node.props?.['data-xdrive-public-share-delayed-feedback']).length, 0)
})


test('Shared folder browser keeps at most one 100-item mounted page and downloads one descendant', async (t) => {
  const calls = []
  const downloads = []
  const rows = (start) => Array.from({ length: 100 }, (_, i) => ({
    id: start + i, name: `item-${start + i}.txt`, type: 'file', size: 12,
  }))
  class Api {
    async publicShare(token) {
      assert.equal(token, 'test-share-token')
      return {
        type: 'dir', name: 'Shared Album', size: 0, requires_password: false,
        max_downloads: 0, download_count: 0, expires_at: null,
      }
    }
    async publicShareChildren(token, password, parentID, cursor, signal) {
      calls.push({ token, password, parentID, cursor, signal })
      return { parent_id: 42, items: cursor === 0 ? rows(1) : rows(101),
        next_cursor: cursor === 0 ? 100 : 0 }
    }
    async downloadPublicShare(token, password, name, nodeID) {
      downloads.push({ token, password, name, nodeID })
    }
  }
  const PublicShare = loadPublicShare(Api)
  let renderer
  await act(async () => { renderer = create(React.createElement(PublicShare, { token: 'test-share-token' })) })
  t.after(() => act(() => renderer.unmount()))

  async function click(label) {
    const button = renderer.root.findAllByType('button')
      .find((item) => textContent(item.children).trim() === label)
    assert.ok(button, `missing ${label} button`)
    await act(async () => { button.props.onClick() })
  }
  const visibleRows = () => renderer.root.findAll(
    (node) => typeof node.type === 'string' && node.props.role === 'listitem')

  await click('浏览文件夹')
  assert.equal(visibleRows().length, 100, 'first page must be bounded')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].cursor, 0)
  assert.ok(textContent(renderer.toJSON()).includes('item-1.txt'))
  assert.ok(!textContent(renderer.toJSON()).includes('item-101.txt'))

  await click('下一页')
  assert.equal(visibleRows().length, 100, 'second page must replace rather than append old rows')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].cursor, 100)
  assert.ok(!textContent(renderer.toJSON()).includes('item-1.txt'))
  assert.ok(textContent(renderer.toJSON()).includes('item-101.txt'))

  await click('下载')
  assert.deepEqual(downloads, [{
    token: 'test-share-token', password: '', name: 'item-101.txt', nodeID: 101,
  }])

  await click('上一页')
  assert.equal(visibleRows().length, 100, 'Back must not grow retained rows')
  assert.equal(calls.length, 3)
  assert.equal(calls[2].cursor, 0)
})

test('Unmounting an unconsumed public-folder page aborts its actual signal', async () => {
  let signal
  let resolvePage
  class Api {
    async publicShare() {
      return {
        type: 'dir', name: 'Shared Album', size: 0, requires_password: false,
        max_downloads: 0, download_count: 0, expires_at: null,
      }
    }
    publicShareChildren(_token, _password, _parentID, _cursor, inFlightSignal) {
      signal = inFlightSignal
      return new Promise((resolve) => { resolvePage = resolve })
    }
  }
  const PublicShare = loadPublicShare(Api)
  let renderer
  await act(async () => { renderer = create(React.createElement(PublicShare, { token: 'test-share-token' })) })
  const button = renderer.root.findAllByType('button')
    .find(item => textContent(item.children).trim() === '浏览文件夹')
  assert.ok(button)
  await act(async () => { button.props.onClick() })
  assert.ok(signal && !signal.aborted, 'real in-flight directory read must have AbortSignal')
  await act(async () => { renderer.unmount() })
  assert.equal(signal.aborted, true, 'leaving the public share must stop its unused network request')
  await act(async () => {
    resolvePage({ parent_id: 1, items: [], next_cursor: 0 })
    await Promise.resolve()
  })
})


test('SH-P002 original public metadata request unmount cancellation n3', async () => {
  const samples = []
  for (let n = 1; n <= 3; n++) {
    let metadataSignal, resolveRead, abortedAt
    class Api {
      publicShare(token, signal) {
        assert.equal(token, 'test-share-token')
        metadataSignal = signal
        signal?.addEventListener('abort', () => { abortedAt = process.hrtime.bigint() }, { once: true })
        return new Promise(resolve => { resolveRead = resolve })
      }
    }
    const PublicShare = loadPublicShare(Api)
    let renderer
    await act(async () => { renderer = create(React.createElement(PublicShare, { token: 'test-share-token' })) })
    assert.equal(typeof resolveRead, 'function', 'real production first effect must start metadata read')
    const slot = renderer.root.findAll(x => typeof x.type === 'string' &&
      x.props['data-xdrive-public-share-read-slot'] === true)
    assert.equal(slot.length, 1)
    assert.equal(slot[0].props['aria-busy'], true)
    const start = process.hrtime.bigint()
    await act(async () => { renderer.unmount() })
    const hasSignal = metadataSignal instanceof AbortSignal
    const didAbort = hasSignal && metadataSignal.aborted
    const abortMs = abortedAt === undefined ? null : Number(abortedAt - start) / 1e6
    samples.push({ n, has_signal: hasSignal, aborted: didAbort, abort_ms: abortMs })
    await act(async () => {
      resolveRead({ type: 'dir', name: 'Shared Album', size: 0, requires_password: false,
        max_downloads: 0, download_count: 0, expires_at: null })
      await Promise.resolve()
    })
  }
  const cancelled = samples.filter(x => x.aborted).length
  const result = { workload: 'SH-P002/mounted-React-public-share-initial-metadata-unmount',
    n: 3, cancelled, samples, actual_http: false, physically_allocated_CAS: 0,
    original_or_candidate: process.env.XD_SH_P002_REQUIRE_CANCEL === '0' ? 'original-CURRENT' : 'candidate-AFTER' }
  console.log('SH_P002_METADATA_CANCEL ' + JSON.stringify(result))
  if (process.env.XD_SH_P002_REQUIRE_CANCEL !== '0') {
    assert.equal(cancelled, 3, 'first GET must receive a per-mount abortable request')
    for (const x of samples) {
      assert.ok(x.abort_ms !== null && x.abort_ms >= 0 && x.abort_ms <= 16,
        'unmount to AbortSignal must be synchronous within 16ms')
    }
  }
})

test('P90 actual React public folder browse and nested folder retain geometry and rows through >350ms GET, failure and retry', async (t) => {
  let resolveRoot, rejectChild, resolveRetry
  const rootRead = new Promise(resolve => { resolveRoot = resolve })
  const childRead = new Promise((_resolve, reject) => { rejectChild = reject })
  const retryRead = new Promise(resolve => { resolveRetry = resolve })
  const calls = []
  let childAttempts = 0
  class Api {
    async publicShare(token) {
      assert.equal(token, 'test-share-token')
      return { type: 'dir', name: '公开相册', size: 0, requires_password: false,
        max_downloads: 0, download_count: 0, expires_at: null }
    }
    publicShareChildren(_token, _password, parentID, cursor, signal) {
      calls.push({ parentID, cursor, signal })
      if (parentID === 0) return rootRead
      if (parentID === 42) return ++childAttempts === 1 ? childRead : retryRead
      throw Error('unexpected folder ' + parentID)
    }
  }
  const PublicShare = loadPublicShare(Api)
  let renderer
  await act(async () => { renderer = create(React.createElement(PublicShare, { token: 'test-share-token' })) })
  t.after(() => act(() => renderer.unmount()))
  const text = () => textContent(renderer.toJSON())
  const rows = () => renderer.root.findAll(node => node.type === 'div' && node.props.role === 'listitem')
  const browser = () => renderer.root.findAll(node => node.type === 'div' &&
    node.props['data-xdrive-public-share-folder-browser'] === true)[0]
  const region = () => renderer.root.findAll(node => node.type === 'div' &&
    node.props['aria-label'] === '分享文件夹内容')[0]
  const button = label => renderer.root.findAllByType('button')
    .find(n => textContent(n.children).trim() === label)
  const click = async label => {
    const b = button(label)
    assert.ok(b, 'missing original Public Share button ' + label)
    await act(async () => { b.props.onClick() })
  }
  await click('浏览文件夹')
  assert.equal(calls.length, 1)
  assert.equal(button('浏览文件夹').props.disabled, true)
  assert.equal(browser().props['aria-busy'], true)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 370)) })
  assert.ok(button('浏览文件夹'), 'a sustained first folder read must keep the original button')
  assert.equal(text().includes('正在读取文件夹'), false)
  await act(async () => {
    resolveRoot({ parent_id: 0, next_cursor: 0, items: [
      { id: 42, name: '下一级', type: 'dir', size: 0 },
      { id: 7, name: '旧文件.txt', type: 'file', size: 12 },
    ] })
    await rootRead
  })
  assert.equal(rows().length, 2)
  assert.equal(region().props.sx.minHeight, 180)
  assert.equal(region().props['aria-busy'], false)
  await click('打开')
  assert.equal(calls.length, 2)
  assert.equal(region().props['aria-busy'], true)
  assert.equal(rows().length, 2)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 370)) })
  assert.equal(region().props.sx.minHeight, 180)
  assert.equal(rows().length, 2, 'accepted old rows remain mounted throughout slow folder navigation')
  assert.ok(text().includes('旧文件.txt'))
  assert.equal(text().includes('正在读取文件夹'), false)
  await act(async () => { rejectChild(new TestApiError(503, '临时网络错误')); await Promise.resolve() })
  assert.equal(region().props['aria-busy'], false)
  assert.equal(rows().length, 2, 'a failed navigation must retain accepted rows and crumbs')
  assert.ok(text().includes('临时网络错误'), 'real terminal errors remain visible')
  await click('打开')
  assert.equal(region().props['aria-busy'], true)
  await act(async () => {
    resolveRetry({ parent_id: 42, next_cursor: 0, items: [
      { id: 100, name: '新文件.txt', type: 'file', size: 99 },
    ] })
    await retryRead
  })
  assert.equal(region().props['aria-busy'], false)
  assert.equal(rows().length, 1)
  assert.ok(text().includes('新文件.txt'))
  assert.ok(!text().includes('旧文件.txt'))
  assert.ok(!text().includes('临时网络错误'))
  assert.equal(calls.length, 3, 'no decorative request or extra page read may be dispatched')
})


test('File capability shows shared read-only Explorer item and keeps sole native download action', async (t) => {
  const view = await mountShare(t, {
    share: { name: 'camera.jpg', type: 'file', size: 8192, requires_password: false },
  })
  const fileBrowser = view.renderer.root.findAll(node =>
    typeof node.type === 'string' && node.props['data-xdrive-public-share-file-browser'] === true)
  assert.equal(fileBrowser.length, 1, 'single-file share must mount the same read-only Explorer presentation')
  const items = view.renderer.root.findAll(node =>
    typeof node.type === 'string' && node.props.role === 'listitem')
  assert.equal(items.length, 1)
  assert.equal(items[0].props['data-xdrive-public-share-item-id'], 0)
  assert.ok(view.text().includes('camera.jpg'))
  assert.ok(view.text().includes('JPG 图像'))
  assert.equal(view.button().props.type, 'submit')
  for (const forbidden of ['上传', '删除', '重命名', '移动', '粘贴']) {
    assert.equal(view.renderer.root.findAllByType('button')
      .filter(button => textContent(button.children).trim() === forbidden).length, 0,
      'a public file capability cannot expose Owner operation ' + forbidden)
  }
  await view.submit()
  assert.deepEqual(view.downloads.map(d => d.filename), ['camera.jpg'])
})

test('Folder capability switches real shared Explorer Details/Grid without changing page or granting writes', async (t) => {
  const downloads = []
  const entries = [
    { id: 31, name: 'Pictures', type: 'dir', size: 0 },
    { id: 32, name: 'frame.heic', type: 'file', size: 64 },
  ]
  class Api {
    async publicShare() {
      return { name: 'Shared Photos', type: 'dir', size: 0, requires_password: false,
        max_downloads: 0, download_count: 0, expires_at: null }
    }
    async publicShareChildren(_token, _password, parentID) {
      return { parent_id: parentID, next_cursor: 0,
        items: parentID === 0 ? entries : [{ id: 33, name: 'child.txt', type: 'file', size: 4 }] }
    }
    async downloadPublicShare(_token, _password, name, id) {
      downloads.push({ name, id })
    }
  }
  const PublicShare = loadPublicShare(Api)
  let renderer
  await act(async () => {
    renderer = create(React.createElement(PublicShare, { token: 'test-share-token' }))
  })
  t.after(() => act(() => renderer.unmount()))
  const click = async label => {
    const button = renderer.root.findAllByType('button')
      .find(item => textContent(item.children).trim() === label)
    assert.ok(button, 'missing shared Explorer action: ' + label)
    await act(async () => { button.props.onClick() })
  }
  const rows = () => renderer.root.findAll(node =>
    typeof node.type === 'string' && node.props.role === 'listitem')
  const view = () => renderer.root.findAll(node =>
    typeof node.type === 'string' && node.props['data-xdrive-public-share-explorer-view'])[0]
  await click('浏览文件夹')
  assert.equal(rows().length, 2)
  assert.equal(view().props['data-xdrive-public-share-explorer-view'], 'details')
  assert.ok(textContent(renderer.toJSON()).includes('HEIC 图像'))
  await click('网格')
  assert.equal(view().props['data-xdrive-public-share-explorer-view'], 'grid')
  assert.equal(rows().length, 2, 'view switching must not re-fetch or materialize extra pages')
  await click('列表')
  assert.equal(view().props['data-xdrive-public-share-explorer-view'], 'details')
  const fileRow = rows().find(row => row.props['data-xdrive-public-share-item-id'] === 32)
  assert.ok(fileRow)
  let prevented = false
  await act(async () => {
    fileRow.props.onKeyDown({ target: fileRow, currentTarget: fileRow,
      key: 'Enter', preventDefault() { prevented = true } })
    await Promise.resolve()
  })
  assert.equal(prevented, true)
  assert.deepEqual(downloads, [{ name: 'frame.heic', id: 32 }])
  await click('打开')
  assert.equal(rows().length, 1)
  assert.ok(textContent(renderer.toJSON()).includes('child.txt'))
  for (const forbidden of ['上传', '删除', '重命名', '移动', '粘贴', '新建文件夹']) {
    assert.equal(renderer.root.findAllByType('button')
      .filter(button => textContent(button.children).trim() === forbidden).length, 0,
      'shared folder must not expose Owner command ' + forbidden)
  }
})


test('Public folder ZIP prepares durable job and uses ONE anonymous signed archive ticket, no Owner API', async (t) => {
  const calls = []
  class Api {
    async publicShare() {
      return { name: 'family photos', type: 'dir', size: 0, requires_password: true,
        max_downloads: 2, download_count: 0, expires_at: null }
    }
    async preparePublicShareArchive(token, password, signal) {
      calls.push(['prepare',token,password,Boolean(signal)])
      return { prepare_id: 'prepared-zip-uuid', state: 'completed', filename: 'family photos.zip', total_bytes: 1024 }
    }
    async downloadPublicShareArchive(token, password, id, filename, signal) {
      calls.push(['download',token,password,id,filename,Boolean(signal)])
    }
  }
  const PublicShare = loadPublicShare(Api)
  let renderer
  await act(async () => { renderer = create(React.createElement(PublicShare, { token: 'test-share-token' })) })
  t.after(() => act(() => renderer.unmount()))
  const click = async (label) => {
    const button = renderer.root.findAllByType('button').find(x => textContent(x.children).trim() === label)
    assert.ok(button, 'missing public-only ZIP control ' + label)
    await act(async () => { button.props.onClick() })
  }
  let zipButton = renderer.root.findAllByType('button')
    .find(x => textContent(x.children).trim() === '下载整个文件夹 ZIP')
  assert.equal(zipButton.props.disabled, true, 'missing share password disables ZIP')
  const passwordInput = renderer.root.findAllByType('input')[0]
  await act(async () => { passwordInput.props.onChange({ target: { value: ' exact-password ' } }) })
  await click('下载整个文件夹 ZIP')
  assert.deepEqual(calls, [
    ['prepare','test-share-token',' exact-password ',true],
    ['download','test-share-token',' exact-password ','prepared-zip-uuid','family photos.zip',true],
  ])
  assert.ok(textContent(renderer.toJSON()).includes('剩余 1 / 2 次下载'))
  assert.ok(textContent(renderer.toJSON()).includes('ZIP 已交给浏览器下载'))
  for(const forbidden of ['上传','删除','移动','重命名','粘贴']) {
    assert.equal(renderer.root.findAllByType('button').filter(x => textContent(x.children).trim() === forbidden).length,0)
  }
})

test('Public ZIP explicit cancel is independent from tab-unmount polling, leaves durable task to Server', async (t) => {
  const actions = []
  class Api {
    async publicShare() {
      return { name: 'shared', type: 'dir', size: 0, requires_password: false,
        max_downloads: 0, download_count: 0, expires_at: null }
    }
    async preparePublicShareArchive() { return { prepare_id:'one-queued-id',state:'running' } }
    async publicShareArchiveStatus() { return { prepare_id:'one-queued-id',state:'running' } }
    async cancelPublicShareArchive(token,password,id) {
      actions.push([token,password,id])
      return { prepare_id:id,state:'cancel_requested' }
    }
  }
  const PublicShare = loadPublicShare(Api)
  let renderer
  await act(async () => { renderer = create(React.createElement(PublicShare,{token:'test-share-token'})) })
  t.after(() => act(() => renderer.unmount()))
  const click = async (label) => {
    const node = renderer.root.findAllByType('button').find(x=>textContent(x.children).trim()===label)
    assert.ok(node,'missing explicit action '+label)
    await act(async () => {node.props.onClick(); await Promise.resolve()})
  }
  await click('下载整个文件夹 ZIP')
  await click('取消准备')
  assert.deepEqual(actions,[['test-share-token','','one-queued-id']])
  assert.ok(textContent(renderer.toJSON()).includes('已请求取消 ZIP 准备'))
})


test('Public Share mounts a full-width read-only FileExplorer workspace, not a narrow login card', async (t) => {
  const view = await mountShare(t, {
    share: { name: 'photo.heic', type: 'file', requires_password: false, size: 8192 },
  })
  const named = key => view.renderer.root.findAll(node =>
    typeof node.type === 'string' && node.props[key] === true)
  assert.equal(named('data-xdrive-public-share-titlebar').length, 1,
    'shared link must have its own lightweight xDrive title bar')
  assert.equal(named('data-xdrive-public-share-workspace').length, 1,
    'shared link must use a full-page workspace')
  assert.equal(named('data-xdrive-public-share-explorer-workspace').length, 1,
    'file capability must mount Explorer-style toolbar, list and status')
  assert.ok(view.text().includes('只读访问'))
  assert.ok(view.text().includes('photo.heic'))
  assert.ok(view.text().includes('HEIC 图像'))
  assert.equal(view.renderer.root.findAllByType('form').length, 1)
  assert.equal(view.button().props.type, 'submit', 'native download form remains functional')
  assert.equal(named('data-xdrive-public-share-details-header').length, 1)
  const source = fs.readFileSync(path.join(repo, 'ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx'), 'utf8')
  for (const forbidden of ['XDriveApi', 'ownerToken', 'onUpload', 'onDelete', 'onMove', 'onPaste']) {
    assert.equal(source.includes(forbidden), false, 'public presentation must not import Owner capability ' + forbidden)
  }
})

test('Public folder workspace supports bounded local page filtering, refresh and read-only context menu', async (t) => {
  const calls = []
  const downloads = []
  class Api {
    async publicShare() {
      return { name: 'Photos', type: 'dir', requires_password: false,
        size: 0, max_downloads: 0, download_count: 0, expires_at: null }
    }
    async publicShareChildren(token, password, folder, cursor, signal) {
      calls.push({ token, password, folder, cursor, signal })
      return { parent_id: folder, next_cursor: 0, items: [
        { id: 10, name: 'Album', type: 'dir', size: 0 },
        { id: 11, name: 'Frame.jpeg', type: 'file', size: 512 },
      ] }
    }
    async downloadPublicShare(_token, _password, filename, id) {
      downloads.push({ filename, id })
    }
  }
  const PublicShare = loadPublicShare(Api)
  let renderer
  await act(async () => { renderer = create(React.createElement(PublicShare, { token: 'test-share-token' })) })
  t.after(() => act(() => renderer.unmount()))
  const button = label => renderer.root.findAllByType('button')
    .find(node => textContent(node.children).trim() === label)
  const rows = () => renderer.root.findAll(node => typeof node.type === 'string' && node.props.role === 'listitem')
  assert.ok(button('浏览文件夹'))
  await act(async () => { button('浏览文件夹').props.onClick() })
  assert.equal(calls.length, 1)
  assert.equal(rows().length, 2)
  const filter = renderer.root.findAllByType('input')
    .find(node => node.props.placeholder === '筛选当前页')
  assert.ok(filter, 'local filter must be explicitly limited to the current keyset page')
  await act(async () => { filter.props.onChange({ target: { value: 'Frame' } }) })
  assert.equal(rows().length, 1)
  assert.equal(rows()[0].props['data-xdrive-public-share-item-id'], 11)
  assert.equal(calls.length, 1, 'local page filter must never query private/search APIs')
  await act(async () => { filter.props.onChange({ target: { value: '' } }) })
  assert.equal(rows().length, 2)
  const refresh = renderer.root.findAllByType('button').find(x => x.props['aria-label'] === '刷新文件夹')
  assert.ok(refresh)
  await act(async () => { refresh.props.onClick() })
  assert.equal(calls.length, 2, 'refresh reuses only the public scoped folder endpoint')
  const row = rows().find(node => node.props['data-xdrive-public-share-item-id'] === 11)
  const prevented = { called: false }
  await act(async () => {
    row.props.onContextMenu({
      preventDefault() { prevented.called = true },
      clientX: 60, clientY: 70,
    })
  })
  assert.equal(prevented.called, true)
  const menus = renderer.root.findAll(node =>
    typeof node.type === 'string' && node.props.anchorReference === 'anchorPosition')
  assert.equal(menus.length, 1)
  assert.equal(menus[0].props.open, true)
  const downloadEntry = renderer.root.findAll(node =>
    typeof node.type === 'string' && textContent(node.children).trim() === '下载文件')
    .find(node => typeof node.props.onClick === 'function')
  assert.ok(downloadEntry, 'read-only menu should offer the existing signed file download')
  await act(async () => { downloadEntry.props.onClick() })
  assert.deepEqual(downloads, [{ filename: 'Frame.jpeg', id: 11 }])
  // The same public DTO powers read-only properties; no Owner/extra HTTP read.
  const propertiesMenu = () => renderer.root.findAll(node =>
    typeof node.type === 'string' && textContent(node.children).trim() === '属性'
    && typeof node.props.onClick === 'function')[0]
  const dialogs = () => renderer.root.findAll(node => node.type === 'dialog' && node.props.open)
  const openProperties = async id => {
    const target = rows().find(node => node.props['data-xdrive-public-share-item-id'] === id)
    await act(async () => { target.props.onContextMenu({ preventDefault() {}, clientX: 80, clientY: 90 }) })
    assert.ok(propertiesMenu(), 'share-only context should expose read-only metadata')
    await act(async () => { propertiesMenu().props.onClick() })
    assert.equal(dialogs().length, 1)
    const details = textContent(dialogs()[0].children)
    const close = renderer.root.findAllByType('button').find(node => textContent(node.children).trim() === '关闭')
    assert.ok(close)
    await act(async () => { close.props.onClick() })
    assert.equal(dialogs().length, 0)
    return details
  }
  const fileProperties = await openProperties(11)
  assert.match(fileProperties, /名称：Frame.jpeg/)
  assert.match(fileProperties, /类型：JPEG 图像/)
  assert.match(fileProperties, /大小：/)
  const folderProperties = await openProperties(10)
  assert.match(folderProperties, /名称：Album/)
  assert.match(folderProperties, /类型：文件夹/)
  assert.equal(calls.length, 2, 'read-only properties require zero extra Server requests')
  assert.equal(rows().length, 2)
  for (const forbidden of ['上传', '删除', '重命名', '移动', '粘贴', '复制', '剪切']) {
    assert.equal(renderer.root.findAllByType('button')
      .some(b => textContent(b.children).trim() === forbidden), false)
  }
})


test('Public shared single-file selection is stable across render without losing the native download form', async (t) => {
  const view = await mountShare(t, {
    share: { name: 'keep-selection.jpg', type: 'file', requires_password: false, size: 2048 },
  })
  const item = () => view.renderer.root.findAll(node =>
    typeof node.type === 'string' && node.props.role === 'listitem')[0]
  assert.equal(item().props['aria-selected'], false)
  await act(async () => { item().props.onClick() })
  assert.equal(item().props['aria-selected'], true, 'new shared workspace must not reset file selection every render')
  assert.equal(view.button().props.type, 'submit')
  await view.submit()
  assert.equal(view.downloads.length, 1)
})

test('Refreshing a later public keyset page does not add a spurious Back cursor', async (t) => {
  const cursors = []
  class Api {
    async publicShare() {
      return { name: 'Folder', type: 'dir', requires_password: false,
        size: 0, max_downloads: 0, download_count: 0, expires_at: null }
    }
    async publicShareChildren(_token, _password, _parentID, cursor) {
      cursors.push(cursor)
      return { parent_id: 42, next_cursor: cursor === 0 ? 100 : 0, items: [
        { id: cursor + 1, name: 'file-' + (cursor + 1) + '.jpg', type: 'file', size: 1024 },
      ] }
    }
  }
  const PublicShare = loadPublicShare(Api)
  let renderer
  await act(async () => { renderer = create(React.createElement(PublicShare, { token: 'test-share-token' })) })
  t.after(() => act(() => renderer.unmount()))
  const click = async label => {
    const btn = renderer.root.findAllByType('button')
      .find(node => textContent(node.children).trim() === label)
    assert.ok(btn, 'expected public-only navigation action ' + label)
    await act(async () => { btn.props.onClick() })
  }
  await click('浏览文件夹')
  await click('下一页')
  assert.deepEqual(cursors, [0, 100])
  const refresh = renderer.root.findAllByType('button')
    .find(x => x.props['aria-label'] === '刷新文件夹')
  assert.ok(refresh)
  await act(async () => { refresh.props.onClick() })
  assert.deepEqual(cursors, [0, 100, 100], 'refresh must not request previous page')
  await click('上一页')
  assert.deepEqual(cursors, [0, 100, 100, 0],
    'Back after refresh must return to actual previous keyset cursor')
  assert.ok(textContent(renderer.toJSON()).includes('file-1.jpg'))
})


test('P115: same accepted public page refresh retains filter and selected row, new folder resets before paint', async (t) => {
  let reads = 0
  class Api {
    async publicShare() {
      return { name: 'Shared Photos', type: 'dir', size: 0, requires_password: false,
        max_downloads: 0, download_count: 0, expires_at: null }
    }
    async publicShareChildren(_token, _password, parentID) {
      reads++
      return { parent_id: parentID, next_cursor: 0,
        items: parentID === 0
          ? [{ id: 12, name: 'Nested', type: 'dir', size: 0 },
             { id: 20, name: 'Frame.jpeg', type: 'file', size: 10 }]
          : [{ id: 21, name: 'Nested.jpeg', type: 'file', size: 11 }] }
    }
  }
  const PublicShare = loadPublicShare(Api)
  let view
  await act(async () => { view = create(React.createElement(PublicShare, { token: 'test-share-token' })) })
  t.after(() => act(() => view.unmount()))
  const button = label => view.root.findAllByType('button')
    .find(x => textContent(x.children).trim() === label)
  const rows = () => view.root.findAll(x => x.type === 'div' && x.props.role === 'listitem')
  const filter = () => view.root.findAllByType('input')
    .find(x => x.props.placeholder === '筛选当前页')
  await act(async () => { button('浏览文件夹').props.onClick() })
  assert.equal(reads, 1)
  await act(async () => { filter().props.onChange({ target: { value: 'Frame' } }) })
  assert.equal(rows().length, 1)
  const original = rows()[0]
  assert.equal(original.props['data-xdrive-public-share-item-id'], 20)
  await act(async () => { original.props.onClick() })
  assert.equal(rows()[0].props['aria-selected'], true)
  const refresh = view.root.findAllByType('button')
    .find(x => x.props['aria-label'] === '刷新文件夹')
  assert.ok(refresh, 'the existing icon-only Refresh action is still present')
  await act(async () => { refresh.props.onClick() })
  assert.equal(reads, 2)
  assert.equal(filter().props.value, 'Frame',
    'a new array containing the SAME accepted page must not clear user filtering')
  assert.equal(rows().length, 1)
  assert.equal(rows()[0].props['aria-selected'], true)
  await act(async () => { filter().props.onChange({ target: { value: '' } }) })
  const directory = rows().find(x => x.props['data-xdrive-public-share-item-id'] === 12)
  assert.ok(directory)
  await act(async () => { directory.props.onDoubleClick() })
  assert.equal(reads, 3)
  assert.equal(filter().props.value, '', 'new accepted nested scope starts with an empty local filter')
  assert.equal(rows().length, 1)
  assert.equal(rows()[0].props['data-xdrive-public-share-item-id'], 21)
})

test('P115: original public folder failure and ZIP notices never resize Explorer Stack', async (t) => {
  let attempts = 0
  class Api {
    async publicShare() {
      return { name: 'Shared Photos', type: 'dir', size: 0, requires_password: false,
        max_downloads: 0, download_count: 0, expires_at: null }
    }
    async publicShareChildren() {
      attempts++
      if (attempts > 1) throw new Error('GET was rejected')
      return { parent_id: 0, next_cursor: 0,
        items: [{ id: 20, name: 'Frame.jpeg', type: 'file', size: 10 }] }
    }
    async preparePublicShareArchive() {
      throw new Error('ZIP remote failed')
    }
  }
  const PublicShare = loadPublicShare(Api)
  let view
  await act(async () => { view = create(React.createElement(PublicShare, { token: 'test-share-token' })) })
  t.after(() => act(() => view.unmount()))
  const button = label => view.root.findAllByType('button')
    .find(x => textContent(x.children).trim() === label)
  const find = marker => view.root.findAll(x => x.type === 'div' && x.props[marker] === true)
  await act(async () => { button('浏览文件夹').props.onClick() })
  assert.equal(find('data-xdrive-public-share-folder-browser').length, 1)
  const browser = find('data-xdrive-public-share-folder-browser')[0]
  const owner = find('data-xdrive-public-share-floating-feedback')[0]
  assert.ok(owner)
  assert.equal(owner.props.sx.position, 'fixed')
  assert.equal(owner.props.sx.pointerEvents, 'none')
  const ancestors = []
  for (let parent = owner.parent; parent; parent = parent.parent) ancestors.push(parent.props || {})
  assert.ok(ancestors.some(props => props['data-xdrive-public-share-read-slot'] === true),
    'feedback owner remains inside the original read slot')
  assert.ok(!ancestors.some(props => props.spacing === 2.25),
    'feedback owner is OUTSIDE the spaced share Stack')
  const refreshAction = view.root.findAllByType('button')
    .find(node => node.props['aria-label'] === '刷新文件夹')
  assert.ok(refreshAction, 'original Refresh icon button is reachable by its accessible label')
  await act(async () => { refreshAction.props.onClick() })
  assert.equal(find('data-xdrive-public-share-folder-browser')[0], browser)
  assert.equal(find('data-xdrive-public-share-floating-feedback')[0], owner)
  assert.ok(textContent(owner.children).includes('GET was rejected'), 'real failure remains readable')
  await act(async () => { button('下载整个文件夹 ZIP').props.onClick() })
  assert.equal(find('data-xdrive-public-share-folder-browser')[0], browser)
  assert.ok(textContent(owner.children).includes('ZIP remote failed'))
  const slot=find('data-xdrive-public-share-zip-status-slot')[0]
  assert.equal(slot.props.sx.height, 24)
  assert.equal(slot.props.sx.minHeight, 24)
})

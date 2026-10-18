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
      if (name === '@xdrive/ui/mui') {
        return {
          ...load('ui/shared/src/mui/AuthSurface.tsx'),
          ...load('ui/shared/src/mui/ActionButton.tsx'),
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
    button: () => renderer.root.findByType('button'),
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

test('Public Share sustained first read reveals only overlay progress and preserves error', async (t) => {
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
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)) })
  const overlay = renderer.root.findAll(
    node => typeof node.type === 'string' && node.props['data-xdrive-public-share-delayed-feedback'] === true
  )
  assert.equal(overlay.length, 1, 'sustained progress must occupy one permanent, non-flow position')
  assert.equal(overlay[0].props.sx.position, 'absolute')
  assert.equal(overlay[0].props.sx.pointerEvents, 'none')
  assert.ok(textContent(renderer.toJSON()).includes('正在加载分享'))
  await act(async () => {
    rejectPending(new TestApiError(404, 'not found'))
    await Promise.resolve()
  })
  assert.ok(textContent(renderer.toJSON()).includes('此分享链接不存在。'))
  assert.ok(!textContent(renderer.toJSON()).includes('正在加载分享'))
  assert.equal(renderer.root.findAll(node => typeof node.type === 'string' && node.props['data-xdrive-public-share-delayed-feedback'] === true).length, 0)
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

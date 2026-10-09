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

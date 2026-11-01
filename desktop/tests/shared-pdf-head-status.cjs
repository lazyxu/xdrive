const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')

function loadShared(filename, bindings = {}, cache = new Map()) {
  if (cache.has(filename)) return cache.get(filename).exports
  const mod = { exports: {} }
  cache.set(filename, mod)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
  const localRequire = (request) => {
    if (Object.hasOwn(bindings, request)) return bindings[request]
    if (!request.startsWith('.')) return require(request)
    const base = path.resolve(path.dirname(filename), request)
    const resolved = [base + '.ts', base + '.tsx'].find(fs.existsSync)
    return resolved ? loadShared(resolved, bindings, cache) : require(base)
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports
}

const repo = path.join(__dirname, '..', '..')
const { XDriveFilePreviewSurface } = loadShared(path.join(repo, 'ui/shared/src/mui/FilePreviewSurface.tsx'))
const node = (id = 901) => ({ id, revision: 1, name: 'document.pdf', kind: 'file' })
const pdf = (id, ticket) => `https://xdrive.invalid/api/v1/file-preview/${id}?ticket=${ticket}`
const response = (status, type = 'application/pdf') => ({
  status, headers: { get: (name) => name.toLowerCase() === 'content-type' ? type : null },
})
const findRetry = (renderer) => renderer.root.findAll((e) =>
  e.type === 'button' && e.props['aria-label'] === '重试预览')
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('P1 signed PDF HEAD 404 is never shown as a successful iframe; retry issues fresh ticket', async () => {
  const saved = global.fetch, calls = [], reads = []
  let renderer
  global.fetch = async (url, options) => {
    calls.push({ url, options })
    return response(calls.length === 1 ? 404 : 200)
  }
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: node(),
        loadPreviewURL: async (_node, kind, signal) => {
          reads.push({ kind, signal })
          return pdf(901, `ticket-${reads.length}`)
        },
        fallback: React.createElement('div', { role: 'alert' }, 'PDF unavailable'),
      }))
    })
    assert.equal(reads.length, 1)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, pdf(901, 'ticket-1'))
    assert.equal(calls[0].options.method, 'HEAD')
    assert.equal(calls[0].options.credentials, 'omit')
    assert.equal(calls[0].options.redirect, 'error')
    assert.equal(calls[0].options.cache, 'no-store')
    assert.equal(calls[0].options.referrerPolicy, 'no-referrer')
    assert.equal(calls[0].options.signal, reads[0].signal)
    assert.equal(renderer.root.findAllByType('iframe').length, 0,
      'browser iframe onLoad cannot turn an HTTP 404 HTML page into PDF-ready')
    assert.equal(renderer.root.findByProps({ role: 'alert' }).children.join(''), 'PDF unavailable')
    const retry = findRetry(renderer)[0].props.onClick
    await act(async () => { retry(); retry(); await Promise.resolve() })
    assert.equal(reads.length, 2, 'repeat click is single-flight')
    assert.equal(calls.length, 2)
    assert.equal(reads[0].signal.aborted, true)
    assert.equal(renderer.root.findByType('iframe').props.src, pdf(901, 'ticket-2'))
    assert.equal(findRetry(renderer).length, 0)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    global.fetch = saved
  }
})

test('P1 signed PDF HEAD 200 with HTML MIME fails closed instead of loading a fake document', async () => {
  const saved = global.fetch
  let renderer
  global.fetch = async () => response(200, 'text/html; charset=utf-8')
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: node(902), loadPreviewURL: async () => pdf(902, 'not-a-pdf'),
      }))
    })
    assert.equal(renderer.root.findAllByType('iframe').length, 0)
    assert.equal(findRetry(renderer).length, 1)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    global.fetch = saved
  }
})

test('P0 old signed PDF HEAD result cannot mount after switching Node, and its request aborts', async () => {
  const saved = global.fetch, pending = deferred(), calls = []
  let renderer
  global.fetch = (url, options) => {
    calls.push({ url, options })
    return calls.length === 1 ? pending.promise : Promise.resolve(response(200))
  }
  const props = (id) => ({
    target: node(id), loadPreviewURL: async () => pdf(id, 'current-token'),
  })
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, props(903)))
    })
    assert.equal(calls.length, 1)
    assert.equal(renderer.root.findAllByType('iframe').length, 0)
    await act(async () => renderer.update(React.createElement(XDriveFilePreviewSurface, props(904))))
    assert.equal(calls[0].options.signal.aborted, true, 'discarded PDF HEAD must cancel')
    assert.equal(calls.length, 2)
    assert.equal(renderer.root.findByType('iframe').props.src, pdf(904, 'current-token'))
    await act(async () => { pending.resolve(response(200)); await Promise.resolve() })
    assert.equal(renderer.root.findByType('iframe').props.src, pdf(904, 'current-token'),
      'old HTTP success may not overwrite a new Node')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    global.fetch = saved
  }
})

test('P0 Desktop private loopback proxy is never fetched through disallowed Electron connect-src', async () => {
  const saved = global.fetch, calls = []
  let renderer
  const url = `http://127.0.0.1:49573/preview/${'a'.repeat(64)}`
  global.fetch = async (...args) => {
    calls.push(args)
    throw new Error('Renderer must not HEAD-fetch Desktop private loopback')
  }
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: node(905), loadPreviewURL: async () => url,
      }))
    })
    assert.deepEqual(calls, [])
    assert.equal(renderer.root.findByType('iframe').props.src, url)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    global.fetch = saved
  }
})

test('P1 unrelated PDF URLs and Blob previews keep the old renderer contract without extra fetch', async () => {
  const saved = global.fetch, fetched = []
  let renderer
  global.fetch = async (...args) => { fetched.push(args); throw new Error('Unexpected HEAD') }
  try {
    for (const url of [
      'blob:locally-decoded-pdf',
      'https://example.invalid/unrelated-document.pdf',
      'https://untrusted.example/api/v1/file-preview/906?ticket=lookalike',
    ]) {
      await act(async () => {
        renderer = create(React.createElement(XDriveFilePreviewSurface, {
          target: node(906), loadPreviewURL: async () => url,
        }))
      })
      assert.equal(renderer.root.findByType('iframe').props.src, url)
      await act(async () => renderer.unmount())
      renderer = null
    }
    assert.deepEqual(fetched, [], 'foreign lookalike hosts must never receive preflight traffic')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    global.fetch = saved
  }
})

function dsmPDF(id = 42, total = (32 << 20) + 1) {
  const url = new URL('https://xdrive.invalid/webman/3rdparty/xdrivenas/backup.cgi')
  for (const [key, value] of Object.entries({
    op: 'cloud-media-stream', node_id: String(id), revision: '7',
    total: String(total), sha256: 'a'.repeat(64), mime: 'application/pdf',
  })) url.searchParams.set(key, value)
  return url.href
}

test('DSM PDF Owner Range HEAD 403 never mounts an HTML iframe; retry rechecks current Owner', async () => {
  const saved = global.fetch, calls = []
  let renderer
  global.fetch = async (url, options) => {
    calls.push({ url, options })
    return response(calls.length === 1 ? 403 : 200)
  }
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: node(42), loadPreviewURL: async () => dsmPDF(),
      }))
    })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, dsmPDF())
    assert.equal(calls[0].options.method, 'HEAD')
    assert.equal(calls[0].options.credentials, 'same-origin')
    assert.equal(calls[0].options.redirect, 'error')
    assert.equal(calls[0].options.cache, 'no-store')
    assert.equal(calls[0].options.referrerPolicy, 'no-referrer')
    assert.equal(renderer.root.findAllByType('iframe').length, 0)
    const retry = findRetry(renderer)[0].props.onClick
    await act(async () => { retry(); retry(); await Promise.resolve() })
    assert.equal(calls.length, 2)
    assert.equal(renderer.root.findByType('iframe').props.src, dsmPDF())
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    global.fetch = saved
  }
})

test('DSM Owner PDF valid status with HTML MIME fails without embedding an error page', async () => {
  const saved = global.fetch
  let renderer
  global.fetch = async () => response(200, 'text/html; charset=utf-8')
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: node(43), loadPreviewURL: async () => dsmPDF(43),
      }))
    })
    assert.equal(renderer.root.findAllByType('iframe').length, 0)
    assert.equal(findRetry(renderer).length, 1)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    global.fetch = saved
  }
})

test('DSM PDF HEAD is abortable on Viewer source change and uses new Owner URL only', async () => {
  const saved = global.fetch, pending = deferred(), calls = []
  let renderer
  global.fetch = async (url, options) => {
    calls.push({ url, options })
    return calls.length === 1 ? pending.promise : response(200)
  }
  const props = (id) => ({
    target: node(id), loadPreviewURL: async () => dsmPDF(id),
  })
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, props(44)))
    })
    assert.equal(renderer.root.findAllByType('iframe').length, 0)
    await act(async () => renderer.update(React.createElement(XDriveFilePreviewSurface, props(45))))
    assert.equal(calls[0].options.signal.aborted, true)
    assert.equal(renderer.root.findByType('iframe').props.src, dsmPDF(45))
    await act(async () => { pending.resolve(response(200)); await Promise.resolve() })
    assert.equal(renderer.root.findByType('iframe').props.src, dsmPDF(45))
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    global.fetch = saved
  }
})

test('foreign lookalike CGI PDF must never receive authenticated HEAD', async () => {
  const saved = global.fetch, calls = []
  let renderer
  global.fetch = async (...args) => { calls.push(args); throw Error('Unexpected credentialed HEAD') }
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: node(46),
        loadPreviewURL: async () => dsmPDF(46).replace('xdrive.invalid', 'foreign.invalid'),
      }))
    })
    assert.deepEqual(calls, [])
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    global.fetch = saved
  }
})

test('malformed same-origin DSM CGI PDF selector fails closed before iframe or HEAD', async () => {
  const saved = global.fetch, calls = []
  let renderer
  global.fetch = async (...args) => { calls.push(args); throw Error('Invalid selector must not reach Agent') }
  try {
    for (const url of [
      dsmPDF(47) + '&unexpected=1',
      dsmPDF(47).replace('application%2Fpdf', 'text%2Fhtml'),
      dsmPDF(47).replace('sha256=' + 'a'.repeat(64), 'sha256=invalid'),
    ]) {
      await act(async () => {
        renderer = create(React.createElement(XDriveFilePreviewSurface, {
          target: node(47), loadPreviewURL: async () => url,
        }))
      })
      assert.equal(renderer.root.findAllByType('iframe').length, 0)
      assert.equal(findRetry(renderer).length, 1)
      await act(async () => renderer.unmount())
      renderer = null
    }
    assert.deepEqual(calls, [])
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    global.fetch = saved
  }
})

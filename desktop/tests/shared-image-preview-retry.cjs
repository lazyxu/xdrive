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
const photo = (id = 700, revision = 1, name = 'photo.jpg') => ({ id, revision, name, kind: 'file' })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const retryButtons = (renderer) => renderer.root.findAll((node) =>
  node.type === 'button' && node.props['aria-label'] === '重试预览')
const previewImages = (renderer) => renderer.root.findAllByType('img')
const imageWithURL = (renderer, url) => previewImages(renderer).find((node) => node.props.src === url)
async function decodeImage(renderer, url, decode = Promise.resolve()) {
  const image = imageWithURL(renderer, url)
  assert.ok(image, 'expected the loaded original/thumbnail image element')
  await act(async () => image.props.onLoad({
    currentTarget: {
      src: url, naturalWidth: 640, naturalHeight: 480, decode: () => decode,
    },
  }))
}

test('P1 failed original and thumbnail retry in place, single-flight, and cancel prior requests', async () => {
  const originalReads = []
  const thumbnailReads = []
  const revoked = []
  const previousRevoke = URL.revokeObjectURL
  URL.revokeObjectURL = (url) => revoked.push(url)
  let renderer
  const loadOriginal = (_node, _kind, signal) => {
    const pending = deferred()
    originalReads.push({ pending, signal })
    return pending.promise
  }
  const loadThumbnail = (_node, signal) => {
    const pending = deferred()
    thumbnailReads.push({ pending, signal })
    return pending.promise
  }
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: photo(), loadPreviewURL: loadOriginal, loadImagePreview: loadThumbnail,
        fallback: React.createElement('div', { role: 'alert' }, 'Preview unavailable'),
      }))
    })
    assert.equal(originalReads.length, 1)
    assert.equal(thumbnailReads.length, 1)
    await act(async () => {
      originalReads[0].pending.reject(new Error('original unreachable'))
      thumbnailReads[0].pending.reject(new Error('thumbnail unreachable'))
      await Promise.resolve()
    })
    assert.equal(retryButtons(renderer).length, 1, 'both failed layers expose a single retry')
    assert.equal(renderer.root.findByProps({ role: 'alert' }).children.join(''), 'Preview unavailable')
    const oldRetry = retryButtons(renderer)[0].props.onClick
    await act(async () => { oldRetry(); oldRetry(); await Promise.resolve() })
    assert.equal(originalReads.length, 2, 'rapid clicks cannot start duplicate originals')
    assert.equal(thumbnailReads.length, 2, 'rapid clicks cannot start duplicate thumbnails')
    assert.equal(originalReads[0].signal.aborted, true)
    assert.equal(thumbnailReads[0].signal.aborted, true)
    assert.equal(originalReads[1].signal.aborted, false)
    await act(async () => {
      originalReads[1].pending.resolve('blob:restored-original')
      thumbnailReads[1].pending.resolve(null)
      await Promise.resolve()
    })
    await decodeImage(renderer, 'blob:restored-original')
    assert.deepEqual(previewImages(renderer).filter((img) => img.props.style?.visibility === 'visible')
      .map((img) => img.props.src), ['blob:restored-original'])
    assert.equal(retryButtons(renderer).length, 0)
    await act(async () => { oldRetry(); await Promise.resolve() })
    assert.equal(originalReads.length, 2, 'a stale retry closure cannot re-fetch after success')
    await act(async () => renderer.unmount())
    renderer = null
    assert.deepEqual(revoked, ['blob:restored-original'], 'restored image Blob is freed on close')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    URL.revokeObjectURL = previousRevoke
  }
})

test('P0 retired image onError/decode cannot spoil same-URL retry', async () => {
  const firstDecode = deferred()
  const secondDecode = deferred()
  let renderer, calls = 0
  const src = 'https://example.invalid/unchanged-image.jpg'
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: photo(), loadPreviewURL: async () => { calls += 1; return src },
      }))
    })
    const oldElement = imageWithURL(renderer, src)
    const staleOnError = oldElement.props.onError
    await decodeImage(renderer, src, firstDecode.promise)
    await act(async () => staleOnError())
    assert.equal(retryButtons(renderer).length, 1)
    await act(async () => { retryButtons(renderer)[0].props.onClick(); await Promise.resolve() })
    assert.equal(calls, 2)
    // Even when the signed URL string is identical, retired event handlers must
    // not update the new generation or make its undecoded pixels visible.
    await act(async () => staleOnError())
    assert.equal(retryButtons(renderer).length, 0)
    await decodeImage(renderer, src, secondDecode.promise)
    await act(async () => { firstDecode.resolve(); await Promise.resolve() })
    assert.equal(previewImages(renderer).filter((img) => img.props.style?.visibility === 'visible').length, 0)
    await act(async () => { secondDecode.resolve(); await Promise.resolve() })
    assert.equal(previewImages(renderer).filter((img) => img.props.style?.visibility === 'visible').length, 1)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('P1 image retry revokes obsolete blob URL before the new image is decoded', async () => {
  let renderer, count = 0
  const revoked = []
  const priorRevoke = URL.revokeObjectURL
  URL.revokeObjectURL = (url) => revoked.push(url)
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: photo(), loadPreviewURL: async () => `blob:attempt-${++count}`,
      }))
    })
    await act(async () => imageWithURL(renderer, 'blob:attempt-1').props.onError())
    assert.equal(retryButtons(renderer).length, 1)
    await act(async () => { retryButtons(renderer)[0].props.onClick(); await Promise.resolve() })
    assert.equal(count, 2)
    assert.deepEqual(revoked, ['blob:attempt-1'])
    await decodeImage(renderer, 'blob:attempt-2')
    assert.equal(retryButtons(renderer).length, 0)
    await act(async () => renderer.unmount())
    renderer = null
    assert.deepEqual(revoked, ['blob:attempt-1', 'blob:attempt-2'])
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    URL.revokeObjectURL = priorRevoke
  }
})

test('P0 retry callback captured on another image identity cannot fetch old media', async () => {
  const calls = []
  const { XDriveDecodedImagePreview } = loadShared(path.join(
    repo, 'ui/shared/src/mui/FilePreviewImage.tsx',
  ))
  const props = (id) => ({
    target: photo(id), kind: 'image', minHeight: 176, imageFit: 'contain', fallback: null,
    loadPreviewURL: async (target) => {
      calls.push(target.id)
      return ''
    },
  })
  let renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveDecodedImagePreview, props(701)))
    })
    assert.deepEqual(calls, [701])
    const oldRetry = retryButtons(renderer)[0].props.onClick
    await act(async () => { renderer.update(React.createElement(XDriveDecodedImagePreview, props(702))) })
    assert.deepEqual(calls, [701, 702])
    await act(async () => { oldRetry(); await Promise.resolve() })
    assert.deepEqual(calls, [701, 702])
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('LIVP still retry remains motion-gated until successful image decode', async () => {
  const Chip = React.forwardRef(({ icon, label }, ref) =>
    React.createElement('span', { ref }, icon, label))
  const { XDriveFilePreviewSurface: LivePreview } = loadShared(path.join(
    repo, 'ui/shared/src/mui/FilePreviewSurface.tsx',
  ), { '@mui/material': { ...require('@mui/material'), Chip } }, new Map())
  let stillReads = 0, motionReads = 0, renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(LivePreview, {
        target: photo(710, 1, 'picture.livp'),
        loadPreviewURL: async () => (++stillReads === 1 ? null : 'https://example.invalid/still.jpg'),
        loadLivePhotoMotion: async () => { motionReads += 1; return null },
      }))
    })
    assert.equal(retryButtons(renderer).length, 1)
    assert.equal(renderer.root.findAllByProps({ 'data-xdrive-live-photo-glyph': 'sf-livephoto' }).length, 0)
    await act(async () => { retryButtons(renderer)[0].props.onClick(); await Promise.resolve() })
    assert.equal(stillReads, 2)
    assert.equal(motionReads, 0, 'retrying a still never starts the motion request')
    await decodeImage(renderer, 'https://example.invalid/still.jpg')
    assert.equal(renderer.root.findAllByProps({ 'data-xdrive-live-photo-glyph': 'sf-livephoto' }).length, 1)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('image preview with no configured source stays fallback-only, not an inert retry loop', async () => {
  let renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: photo(), fallback: React.createElement('div', { role: 'alert' }, 'Not available'),
      }))
    })
    assert.equal(renderer.root.findByProps({ role: 'alert' }).children.join(''), 'Not available')
    assert.equal(retryButtons(renderer).length, 0)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

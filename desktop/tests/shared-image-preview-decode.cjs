const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')

const moduleCache = new Map()
function loadShared(filename, bindings = {}, cache = moduleCache) {
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

const { XDriveFilePreviewSurface } = loadShared(path.join(
  __dirname, '../../ui/shared/src/mui/FilePreviewSurface.tsx',
))
const target = { id: 7, revision: 1, name: 'photo.jpg', kind: 'file' }

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function images(renderer) {
  return renderer.root.findAllByType('img')
}

function visibleImages(renderer) {
  return images(renderer).filter((image) => image.props.style?.visibility !== 'hidden')
}

async function loadImage(renderer, src, decode = Promise.resolve()) {
  const image = images(renderer).find((image) => image.props.src === src)
  assert.ok(image, 'the requested image must be mounted')
  await act(async () => {
    image.props.onLoad?.({ currentTarget: {
      src, naturalWidth: 640, naturalHeight: 480, decode: () => decode,
    } })
  })
}

test('original URL readiness does not expose an image before its decode completes', async () => {
  let renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target,
        loadPreviewURL: async () => 'https://example.invalid/original.jpg',
      }))
    })
    assert.equal(visibleImages(renderer).length, 0,
      'a URL alone must not replace loading with an undecoded image')
    const decode = deferred()
    await loadImage(renderer, 'https://example.invalid/original.jpg', decode.promise)
    assert.equal(visibleImages(renderer).length, 0, 'load must still wait for decode')
    await act(async () => { decode.resolve() })
    assert.deepEqual(visibleImages(renderer).map((image) => image.props.src),
      ['https://example.invalid/original.jpg'])
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('a decoded thumbnail stays mounted while the original loads and decodes', async () => {
  const source = deferred()
  const decode = deferred()
  let renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target,
        loadPreviewURL: () => source.promise,
        loadImagePreview: async () => 'https://example.invalid/thumbnail.jpg',
      }))
    })
    await loadImage(renderer, 'https://example.invalid/thumbnail.jpg')
    const thumbnail = visibleImages(renderer)[0]
    assert.equal(thumbnail.props.src, 'https://example.invalid/thumbnail.jpg')
    await act(async () => { source.resolve('https://example.invalid/original.jpg') })
    await loadImage(renderer, 'https://example.invalid/original.jpg', decode.promise)
    assert.equal(visibleImages(renderer)[0], thumbnail,
      'the same thumbnail element must remain visible until original decode completes')
    await act(async () => { decode.resolve() })
    assert.deepEqual(visibleImages(renderer).map((image) => image.props.src),
      ['https://example.invalid/original.jpg'])
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('original decode failure keeps the decoded thumbnail without another thumbnail request', async () => {
  let renderer
  let thumbnailCalls = 0
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target,
        loadPreviewURL: async () => 'https://example.invalid/original.jpg',
        loadImagePreview: async () => {
          thumbnailCalls += 1
          return 'https://example.invalid/thumbnail.jpg'
        },
      }))
    })
    await loadImage(renderer, 'https://example.invalid/thumbnail.jpg')
    const decode = deferred()
    await loadImage(renderer, 'https://example.invalid/original.jpg', decode.promise)
    await act(async () => { decode.reject(new Error('Unsupported original codec')) })
    assert.deepEqual(visibleImages(renderer).map((image) => image.props.src),
      ['https://example.invalid/thumbnail.jpg'])
    assert.equal(thumbnailCalls, 1)
    assert.equal(renderer.root.findAllByProps({ role: 'progressbar' }).length, 0)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('thumbnail failure cannot hide a valid original, and two failures keep the failure state', async () => {
  let renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target,
        loadPreviewURL: async () => 'https://example.invalid/original.jpg',
        loadImagePreview: async () => 'https://example.invalid/broken-thumbnail.jpg',
        fallback: React.createElement('div', { role: 'alert' }, 'Preview unavailable'),
      }))
    })
    await act(async () => {
      images(renderer).find((image) => image.props.src.endsWith('broken-thumbnail.jpg')).props.onError()
    })
    await loadImage(renderer, 'https://example.invalid/original.jpg')
    assert.deepEqual(visibleImages(renderer).map((image) => image.props.src),
      ['https://example.invalid/original.jpg'])
    await act(async () => { visibleImages(renderer)[0].props.onError() })
    assert.equal(visibleImages(renderer).length, 0)
    assert.equal(renderer.root.findByProps({ role: 'alert' }).children.join(''), 'Preview unavailable')
    assert.equal(renderer.root.findAllByProps({ role: 'progressbar' }).length, 0)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('equivalent parent rerenders preserve the displayed element and do not reacquire either source', async () => {
  let renderer
  const calls = []
  const props = () => ({
    target: { ...target },
    loadPreviewURL: async () => { calls.push('original'); return 'https://example.invalid/original.jpg' },
    loadImagePreview: async () => { calls.push('thumbnail'); return 'https://example.invalid/thumbnail.jpg' },
  })
  try {
    await act(async () => { renderer = create(React.createElement(XDriveFilePreviewSurface, props())) })
    await loadImage(renderer, 'https://example.invalid/original.jpg')
    const original = visibleImages(renderer)[0]
    await act(async () => { renderer.update(React.createElement(XDriveFilePreviewSurface, props())) })
    await loadImage(renderer, 'https://example.invalid/thumbnail.jpg')
    assert.equal(visibleImages(renderer)[0], original, 'late thumbnail must not downgrade a ready original')
    assert.deepEqual(calls, ['original', 'thumbnail'])
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('a new revision rejects the old decode completion and releases each owned blob on close', async () => {
  let renderer
  const revoked = []
  const revoke = URL.revokeObjectURL
  URL.revokeObjectURL = (url) => revoked.push(url)
  const decode = deferred()
  const props = (revision) => ({
    target: { ...target, revision },
    loadPreviewURL: async () => `blob:original-${revision}`,
    loadImagePreview: async () => `blob:thumbnail-${revision}`,
  })
  try {
    await act(async () => { renderer = create(React.createElement(XDriveFilePreviewSurface, props(1))) })
    await loadImage(renderer, 'blob:original-1', decode.promise)
    await act(async () => { renderer.update(React.createElement(XDriveFilePreviewSurface, props(2))) })
    await loadImage(renderer, 'blob:original-2')
    await act(async () => { decode.resolve() })
    assert.deepEqual(visibleImages(renderer).map((image) => image.props.src), ['blob:original-2'])
    assert.deepEqual(revoked.sort(), ['blob:original-1', 'blob:thumbnail-1'])
    await act(async () => renderer.unmount())
    assert.deepEqual(revoked.sort(),
      ['blob:original-1', 'blob:original-2', 'blob:thumbnail-1', 'blob:thumbnail-2'])
    renderer = null
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    URL.revokeObjectURL = revoke
  }
})

test('late original and thumbnail URLs are released after the surface closes', async () => {
  const source = deferred()
  const thumbnail = deferred()
  const revoked = []
  const revoke = URL.revokeObjectURL
  URL.revokeObjectURL = (url) => revoked.push(url)
  let renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target, loadPreviewURL: () => source.promise, loadImagePreview: () => thumbnail.promise,
      }))
    })
    await act(async () => renderer.unmount())
    await act(async () => {
      source.resolve('blob:late-original')
      thumbnail.resolve('blob:late-thumbnail')
    })
    assert.equal(renderer.toJSON(), null)
    assert.deepEqual(revoked.sort(), ['blob:late-original', 'blob:late-thumbnail'])
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    URL.revokeObjectURL = revoke
  }
})

test('LIVP reveals its glyph and enables motion only after a still has decoded', async () => {
  // Emotion's server-side Chip wrapper cannot accept refs in react-test-renderer.
  // Keep the actual LivePhoto state/glyph; the browser regression uses the real MUI Chip.
  const Chip = React.forwardRef(({ icon, label }, ref) =>
    React.createElement('span', { ref }, icon, label))
  const { XDriveFilePreviewSurface: LivePreview } = loadShared(path.join(
    __dirname, '../../ui/shared/src/mui/FilePreviewSurface.tsx',
  ), { '@mui/material': { ...require('@mui/material'), Chip } }, new Map())
  let renderer
  let motionCalls = 0
  const press = () => {
    renderer.root.findAllByType('div').find((node) => node.props.role === 'button').props.onKeyDown({
      key: ' ', repeat: false, preventDefault() {}, stopPropagation() {},
    })
  }
  try {
    await act(async () => {
      renderer = create(React.createElement(LivePreview, {
        target: { ...target, name: 'photo.livp' },
        loadPreviewURL: async () => 'https://example.invalid/still.jpg',
        loadLivePhotoMotion: async () => { motionCalls += 1; return null },
      }))
    })
    assert.equal(renderer.root.findAllByProps({ 'data-xdrive-live-photo-glyph': 'sf-livephoto' }).length, 0)
    await act(async () => press())
    assert.equal(motionCalls, 0)
    await loadImage(renderer, 'https://example.invalid/still.jpg')
    assert.equal(renderer.root.findAllByProps({ 'data-xdrive-live-photo-glyph': 'sf-livephoto' }).length, 1)
    await act(async () => press())
    assert.equal(motionCalls, 1)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('edited preview reuses its canvas pixels for viewport-only and equivalent parent rerenders', async () => {
  // This test replaces only MUI's host styling adapter, so the canvas ref is available
  // in the non-DOM renderer. Image acquisition, React hooks and canvas drawing stay real.
  const Box = React.forwardRef(({ component = 'div', sx, ...props }, ref) =>
    React.createElement(component, { ...props, ref }))
  const { XDriveDecodedImagePreview } = loadShared(path.join(
    __dirname, '../../ui/shared/src/mui/FilePreviewImage.tsx',
  ), { '@mui/material': { ...require('@mui/material'), Box } }, new Map())
  const transform = { rotationDegrees: 90 }
  let draws = 0
  const context = {
    save() {}, clearRect() {}, translate() {}, rotate() {}, scale() {}, restore() {},
    drawImage() { draws += 1 },
  }
  const props = (viewportTransform) => ({
    target, kind: 'image', minHeight: 176, imageFit: 'contain', fallback: null,
    loadPreviewURL: async () => 'https://example.invalid/original.jpg',
    mediaTransform: transform, viewportTransform,
  })
  let renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveDecodedImagePreview, props('scale(1)')), {
        createNodeMock: (element) => element.type === 'canvas'
          ? { setAttribute() {}, getContext: () => context } : null,
      })
    })
    await loadImage(renderer, 'https://example.invalid/original.jpg')
    assert.equal(draws, 1)
    await act(async () => {
      renderer.update(React.createElement(XDriveDecodedImagePreview, props('scale(2)')))
    })
    assert.equal(draws, 1, 'zoom/pan must transform the existing canvas without repainting its pixels')
    await act(async () => {
      renderer.update(React.createElement(XDriveDecodedImagePreview, props('scale(2)')))
    })
    assert.equal(draws, 1, 'equivalent parent props must not repaint the edited image')
    await act(async () => {
      renderer.update(React.createElement(XDriveDecodedImagePreview, {
        ...props('scale(2)'), mediaTransform: { rotationDegrees: 180 },
      }))
    })
    assert.equal(draws, 2, 'an actual edit recipe change must repaint')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('a thumbnail loader supplied later for the same identity shows the first frame without restarting the pending original', async () => {
  const original = deferred()
  let originalCalls = 0
  let thumbnailCalls = 0
  let renderer
  const props = (loadImagePreview) => ({
    target: { ...target },
    loadPreviewURL: () => { originalCalls += 1; return original.promise },
    loadImagePreview,
  })
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, props(undefined)))
    })
    assert.equal(originalCalls, 1)
    assert.equal(visibleImages(renderer).length, 0)
    await act(async () => {
      renderer.update(React.createElement(XDriveFilePreviewSurface, props(async () => {
        thumbnailCalls += 1
        return 'https://example.invalid/late-available-thumbnail.jpg'
      })))
    })
    assert.equal(originalCalls, 1, 'loader availability must not restart the same pending original')
    assert.equal(thumbnailCalls, 1, 'a newly available thumbnail loader must run for the current identity')
    await loadImage(renderer, 'https://example.invalid/late-available-thumbnail.jpg')
    assert.deepEqual(visibleImages(renderer).map((image) => image.props.src),
      ['https://example.invalid/late-available-thumbnail.jpg'],
      'the decoded thumbnail must appear while the original source is still pending')
    assert.equal(originalCalls, 1)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

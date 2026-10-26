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


const originalRetryButtons = (renderer) => renderer.root.findAll((node) =>
  node.type === 'button' && node.props['aria-label'] === '重试原图')

test('P1 failed original renews only its ticket while preserving the decoded thumbnail element', async () => {
  const originalReads = [], thumbnailReads = []
  const revoked = []
  const priorRevoke = URL.revokeObjectURL
  URL.revokeObjectURL = (url) => revoked.push(url)
  let renderer
  const original = (_node, _kind, signal) => {
    const pending = deferred()
    originalReads.push({ pending, signal })
    return pending.promise
  }
  const thumbnail = (_node, signal) => {
    thumbnailReads.push(signal)
    return Promise.resolve('blob:live-thumbnail')
  }
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: photo(777), loadPreviewURL: original, loadImagePreview: thumbnail,
      }))
    })
    await decodeImage(renderer, 'blob:live-thumbnail')
    const savedThumbnail = imageWithURL(renderer, 'blob:live-thumbnail')
    assert.equal(savedThumbnail.props.style.visibility, 'visible')
    await act(async () => {
      originalReads[0].pending.reject(new Error('signed original unavailable'))
      await Promise.resolve()
    })
    assert.equal(originalRetryButtons(renderer).length, 1)
    assert.equal(retryButtons(renderer).length, 0, 'keep thumbnail; never expose full-surface retry')
    const savedRetry = originalRetryButtons(renderer)[0].props.onClick
    await act(async () => { savedRetry(); savedRetry(); await Promise.resolve() })
    assert.equal(originalReads.length, 2)
    assert.equal(thumbnailReads.length, 1, 'do not reissue the valid thumbnail')
    assert.equal(originalReads[0].signal.aborted, true, 'retire the old original request')
    assert.equal(thumbnailReads[0].aborted, false, 'the thumbnail lifetime survives original retry')
    assert.equal(imageWithURL(renderer, 'blob:live-thumbnail'), savedThumbnail,
      'do not remount or flicker the decoded thumbnail')
    assert.equal(savedThumbnail.props.style.visibility, 'visible')
    const originalDecode = deferred()
    await act(async () => originalReads[1].pending.resolve('blob:new-original'))
    await decodeImage(renderer, 'blob:new-original', originalDecode.promise)
    assert.equal(savedThumbnail.props.style.visibility, 'visible', 'original must decode before replacing thumbnail')
    await act(async () => { originalDecode.resolve(); await Promise.resolve() })
    assert.equal(imageWithURL(renderer, 'blob:new-original').props.style.visibility, 'visible')
    assert.equal(originalRetryButtons(renderer).length, 0)
    await act(async () => { savedRetry(); await Promise.resolve() })
    assert.equal(originalReads.length, 2, 'retained attempt callback cannot renew a new ticket')
    await act(async () => renderer.unmount())
    renderer = null
    assert.deepEqual(revoked.sort(), ['blob:live-thumbnail', 'blob:new-original'].sort())
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    URL.revokeObjectURL = priorRevoke
  }
})

test('P0 original-only retry rejects retired same-URL renderer events', async () => {
  const thumb = 'https://example.invalid/thumb.jpg'
  const original = 'https://example.invalid/same-original.jpg'
  let calls = 0, renderer
  const firstDecode = deferred(), nextDecode = deferred()
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: photo(778), loadImagePreview: async () => thumb,
        loadPreviewURL: async () => { calls += 1; return original },
      }))
    })
    await decodeImage(renderer, thumb)
    const previousOriginal = imageWithURL(renderer, original)
    const staleOnError = previousOriginal.props.onError
    await decodeImage(renderer, original, firstDecode.promise)
    await act(async () => staleOnError())
    assert.equal(originalRetryButtons(renderer).length, 1)
    await act(async () => {
      originalRetryButtons(renderer)[0].props.onClick()
      await Promise.resolve()
    })
    assert.equal(calls, 2)
    assert.equal(originalRetryButtons(renderer).length, 0)
    assert.notEqual(imageWithURL(renderer, original), previousOriginal,
      'identical renewed signed URLs still need a new native image element')
    await act(async () => staleOnError())
    assert.equal(originalRetryButtons(renderer).length, 0,
      'old image error must not fail same URL on second attempt')
    await decodeImage(renderer, original, nextDecode.promise)
    await act(async () => { firstDecode.resolve(); await Promise.resolve() })
    assert.equal(imageWithURL(renderer, thumb).props.style.visibility, 'visible')
    await act(async () => { nextDecode.resolve(); await Promise.resolve() })
    assert.equal(imageWithURL(renderer, original).props.style.visibility, 'visible')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('P1 a repeated original failure can retry once more without restarting a good thumbnail', async () => {
  let originalReads = 0, thumbnailReads = 0, renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: photo(779),
        loadPreviewURL: async () => {
          originalReads += 1
          return originalReads <= 2 ? null : 'https://example.invalid/recovered.jpg'
        },
        loadImagePreview: async () => {
          thumbnailReads += 1
          return 'https://example.invalid/still-valid.jpg'
        },
      }))
    })
    await decodeImage(renderer, 'https://example.invalid/still-valid.jpg')
    assert.equal(originalRetryButtons(renderer).length, 1)
    const attempt1 = originalRetryButtons(renderer)[0].props.onClick
    await act(async () => { attempt1(); await Promise.resolve() })
    assert.equal(originalReads, 2)
    assert.equal(originalRetryButtons(renderer).length, 1)
    await act(async () => { attempt1(); await Promise.resolve() })
    assert.equal(originalReads, 2)
    const attempt2 = originalRetryButtons(renderer)[0].props.onClick
    await act(async () => { attempt2(); attempt2(); await Promise.resolve() })
    assert.equal(originalReads, 3)
    assert.equal(thumbnailReads, 1)
    assert.equal(imageWithURL(renderer, 'https://example.invalid/still-valid.jpg').props.style.visibility, 'visible')
    await decodeImage(renderer, 'https://example.invalid/recovered.jpg')
    assert.equal(originalRetryButtons(renderer).length, 0)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('P1 original-only retry revokes failed original Blob, not the still-displayed thumbnail', async () => {
  const revoked = []
  const previous = URL.revokeObjectURL
  URL.revokeObjectURL = (url) => revoked.push(url)
  let renderer, originalCalls = 0
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: photo(780),
        loadPreviewURL: async () => `blob:original-retry-${++originalCalls}`,
        loadImagePreview: async () => 'blob:thumbnail-survives',
      }))
    })
    await decodeImage(renderer, 'blob:thumbnail-survives')
    await act(async () => imageWithURL(renderer, 'blob:original-retry-1').props.onError())
    const retainedThumbnail = imageWithURL(renderer, 'blob:thumbnail-survives')
    assert.equal(originalRetryButtons(renderer).length, 1)
    await act(async () => {
      originalRetryButtons(renderer)[0].props.onClick()
      await Promise.resolve()
    })
    assert.equal(originalCalls, 2)
    assert.deepEqual(revoked, ['blob:original-retry-1'],
      'failed original Blob is disposed immediately, not delayed until close')
    assert.equal(imageWithURL(renderer, 'blob:thumbnail-survives'), retainedThumbnail)
    await decodeImage(renderer, 'blob:original-retry-2')
    await act(async () => renderer.unmount())
    renderer = null
    assert.deepEqual(revoked.sort(), [
      'blob:original-retry-1', 'blob:original-retry-2', 'blob:thumbnail-survives',
    ].sort(), 'every Blob is released exactly once')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    URL.revokeObjectURL = previous
  }
})


test('P0 an old original-only retry callback cannot acquire a replaced image Node', async () => {
  const calls = []
  const { XDriveDecodedImagePreview } = loadShared(path.join(
    repo, 'ui/shared/src/mui/FilePreviewImage.tsx',
  ))
  const props = (id) => ({
    target: photo(id), kind: 'image', minHeight: 176, imageFit: 'contain', fallback: null,
    loadPreviewURL: async (node) => {
      calls.push(node.id)
      return null
    },
    loadImagePreview: async (node) => `https://example.invalid/thumbnail-${node.id}.jpg`,
  })
  let renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveDecodedImagePreview, props(781)))
    })
    await decodeImage(renderer, 'https://example.invalid/thumbnail-781.jpg')
    const oldRetry = originalRetryButtons(renderer)[0].props.onClick
    await act(async () => {
      renderer.update(React.createElement(XDriveDecodedImagePreview, props(782)))
    })
    assert.deepEqual(calls, [781, 782])
    await act(async () => { oldRetry(); await Promise.resolve() })
    assert.deepEqual(calls, [781, 782], 'former Node cannot reacquire an original')
    await decodeImage(renderer, 'https://example.invalid/thumbnail-782.jpg')
    assert.equal(originalRetryButtons(renderer).length, 1,
      'new Node still owns its own independent retry action')
    await act(async () => {
      originalRetryButtons(renderer)[0].props.onClick()
      await Promise.resolve()
    })
    assert.deepEqual(calls, [781, 782, 782])
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})


test('P0 failed original decode immediately releases its Blob while decoded thumbnail stays visible', async () => {
  const previousRevoke = URL.revokeObjectURL
  const revoked = []
  URL.revokeObjectURL = (url) => revoked.push(url)
  let renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: photo(790),
        loadPreviewURL: async () => 'blob:bad-decoded-original',
        loadImagePreview: async () => 'blob:valid-decoded-thumbnail',
      }))
    })
    await decodeImage(renderer, 'blob:valid-decoded-thumbnail')
    const still = imageWithURL(renderer, 'blob:valid-decoded-thumbnail')
    await act(async () => imageWithURL(renderer, 'blob:bad-decoded-original').props.onError())
    assert.deepEqual(revoked, ['blob:bad-decoded-original'],
      'decode failure must free the unusable original immediately')
    assert.equal(imageWithURL(renderer, 'blob:valid-decoded-thumbnail'), still)
    assert.equal(still.props.style.visibility, 'visible',
      'releasing failed original must not blank the decoded thumbnail')
    await act(async () => renderer.unmount())
    renderer = null
    assert.deepEqual(revoked, ['blob:bad-decoded-original', 'blob:valid-decoded-thumbnail'],
      'each owned Blob is released once')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    URL.revokeObjectURL = previousRevoke
  }
})

test('P0 same Blob shared by original and thumbnail is not revoked on one role failure', async () => {
  const previousRevoke = URL.revokeObjectURL
  const revoked = []
  URL.revokeObjectURL = (url) => revoked.push(url)
  const shared = 'blob:shared-original-thumbnail'
  let renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: photo(791),
        loadPreviewURL: async () => shared,
        loadImagePreview: async () => shared,
      }))
    })
    await decodeImage(renderer, shared)
    const layers = previewImages(renderer).filter(node => node.props.src === shared)
    assert.equal(layers.length, 2, 'the Preview Engine retains two independently decoded roles')
    assert.equal(layers[0].props.style.visibility, 'visible')
    await act(async () => layers[1].props.onError())
    assert.deepEqual(revoked, [],
      'failed original must not revoke the shared URL still used by the decoded thumbnail')
    assert.equal(previewImages(renderer).filter(node => node.props.src === shared).length, 1)
    await act(async () => renderer.unmount())
    renderer = null
    assert.deepEqual(revoked, [shared], 'shared Blob URL is revoked exactly once on final disposal')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    URL.revokeObjectURL = previousRevoke
  }
})

test('P0 late cancelled original cannot revoke shared Blob now shown by a replacement thumbnail', async () => {
  const previousRevoke = URL.revokeObjectURL
  const revoked = []
  URL.revokeObjectURL = url => revoked.push(url)
  const stale = deferred()
  const shared = 'blob:new-owner-visible-thumbnail'
  const calls = []
  const props = id => ({
    target: photo(id), loadPreviewURL: node => {
      calls.push(node.id)
      return node.id === 792 ? stale.promise : Promise.resolve(null)
    },
    loadImagePreview: node => Promise.resolve(node.id === 792 ? null : shared),
  })
  let renderer
  try {
    await act(async () => { renderer = create(React.createElement(XDriveFilePreviewSurface, props(792))) })
    assert.equal(previewImages(renderer).length, 0)
    await act(async () => renderer.update(React.createElement(XDriveFilePreviewSurface, props(793))))
    await decodeImage(renderer, shared)
    const visible = imageWithURL(renderer, shared)
    assert.equal(visible.props.style.visibility, 'visible')
    await act(async () => { stale.resolve(shared); await Promise.resolve() })
    assert.deepEqual(revoked, [], 'stale cancelled response must not revoke a live thumbnail')
    assert.equal(imageWithURL(renderer, shared), visible)
    assert.equal(visible.props.style.visibility, 'visible')
    assert.deepEqual(calls, [792, 793])
    await act(async () => { renderer.unmount(); renderer = null })
    assert.deepEqual(revoked, [shared], 'the final Owner must release the shared Blob exactly once')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    URL.revokeObjectURL = previousRevoke
  }
})


test('P0 pending thumbnail may adopt a Blob URL after original decode fails', async () => {
  const priorRevoke = URL.revokeObjectURL
  const revoked = []
  URL.revokeObjectURL = url => revoked.push(url)
  const shared = 'blob:original-first-thumbnail-later'
  const pendingThumbnail = deferred()
  let renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: photo(794),
        loadPreviewURL: async () => shared,
        loadImagePreview: () => pendingThumbnail.promise,
      }))
    })
    const original = imageWithURL(renderer, shared)
    assert.ok(original, 'original resolves while thumbnail request remains outstanding')
    await act(async () => original.props.onError())
    assert.deepEqual(revoked, [],
      'do not revoke a Blob that an in-flight thumbnail may still share')
    await act(async () => {
      pendingThumbnail.resolve(shared)
      await Promise.resolve()
    })
    await decodeImage(renderer, shared)
    assert.equal(imageWithURL(renderer, shared).props.style.visibility, 'visible')
    assert.deepEqual(revoked, [], 'thumbnail must decode the original Blob without premature revocation')
    await act(async () => { renderer.unmount(); renderer = null })
    assert.deepEqual(revoked, [shared], 'final Viewer owner releases the shared Blob once')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    URL.revokeObjectURL = priorRevoke
  }
})

test('P0 original failed Blob retires when pending thumbnail reports no usable resource', async () => {
  const priorRevoke = URL.revokeObjectURL
  const revoked = []
  URL.revokeObjectURL = url => revoked.push(url)
  const failed = 'blob:unusable-original-pending-thumbnail'
  const pendingThumbnail = deferred()
  let renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: photo(795),
        loadPreviewURL: async () => failed,
        loadImagePreview: () => pendingThumbnail.promise,
      }))
    })
    await act(async () => imageWithURL(renderer, failed).props.onError())
    assert.deepEqual(revoked, [], 'only the possible same-URL thumbnail delays release')
    await act(async () => {
      pendingThumbnail.resolve(null)
      await Promise.resolve()
    })
    assert.deepEqual(revoked, [failed],
      'failed original Blob must retire as soon as both candidate readers settle')
    await act(async () => { renderer.unmount(); renderer = null })
    assert.deepEqual(revoked, [failed], 'Close must not revoke an already retired Blob twice')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    URL.revokeObjectURL = priorRevoke
  }
})

'use strict'

// Browser-injected, source-free probe. The functions are stringified by the
// existing actual Electron + authenticated Owner/Gin/PG17/CAS Gallery runner.
// No fake video events, no ticket URLs, no second media fetch.
function xDriveStartViewerFirstFrameProbe() {
  if (window.__xdriveFirstFrameProbe?.dispose) window.__xdriveFirstFrameProbe.dispose()
  const startedAt = performance.now()
  const p = {
    startedAt, mountedAt: null, urlAt: null, metadataAt: null,
    loadedDataAt: null, firstFrameAt: null, frameMediaTime: null,
    width: 0, height: 0, presentedFrames: 0,
    video: null, frameID: null, placeholderRect: null, playerRect: null,
    signedStream: false, observer: null, disposed: false,
  }
  const rect = element => {
    if (!element) return null
    const box = element.getBoundingClientRect()
    if (!(box.width > 0 && box.height > 0)) return null
    return { width: Math.round(box.width * 10) / 10,
      height: Math.round(box.height * 10) / 10,
      top: Math.round(box.top * 10) / 10 }
  }
  const signedStream = video => {
    try {
      const url = new URL(video.currentSrc, location.href)
      return url.origin === location.origin &&
        /^\/api\/v1\/file-preview\/[1-9][0-9]*$/.test(url.pathname) &&
        url.searchParams.has('ticket')
    } catch {
      return false
    }
  }
  const onVideo = video => {
    if (p.video === video) return
    if (p.video && p.frameID !== null &&
        typeof p.video.cancelVideoFrameCallback === 'function') {
      p.video.cancelVideoFrameCallback(p.frameID)
    }
    p.video = video
    p.frameID = null
    p.mountedAt = performance.now()
    const onUrl = () => {
      if (p.disposed || p.video !== video || p.urlAt !== null || !video.currentSrc) return
      p.signedStream = signedStream(video)
      if (p.signedStream) p.urlAt = performance.now()
    }
    video.addEventListener('loadstart', onUrl, { once: true })
    video.addEventListener('loadedmetadata', () => {
      if (p.video !== video || p.disposed) return
      onUrl()
      if (p.metadataAt === null) p.metadataAt = performance.now()
    }, { once: true })
    video.addEventListener('loadeddata', () => {
      if (p.video !== video || p.disposed) return
      if (p.loadedDataAt === null) p.loadedDataAt = performance.now()
    }, { once: true })
    onUrl()
    if (typeof video.requestVideoFrameCallback === 'function') {
      const frame = (now, metadata) => {
        p.frameID = null
        if (p.disposed || p.video !== video || !video.isConnected) return
        if (metadata.presentedFrames > 0 && metadata.width > 0 &&
            metadata.height > 0 && Number.isFinite(metadata.mediaTime)) {
          const box = rect(video)
          const computed = getComputedStyle(video)
          if (box && computed.display !== 'none' && computed.visibility === 'visible') {
            p.firstFrameAt = performance.now()
            p.frameMediaTime = metadata.mediaTime
            p.presentedFrames = metadata.presentedFrames
            p.width = metadata.width
            p.height = metadata.height
            p.playerRect = rect(video.closest('[data-xdrive-preview-media-state="video"]'))
            return
          }
        }
        p.frameID = video.requestVideoFrameCallback(frame)
      }
      p.frameID = video.requestVideoFrameCallback(frame)
    }
  }
  const inspect = () => {
    if (p.disposed) return
    const surface = document.querySelector('[data-xdrive-web-viewer] [data-xdrive-file-preview-kind="video"]')
    if (!surface) return
    const video = surface.querySelector('video')
    if (!video && !p.placeholderRect) {
      p.placeholderRect = rect(surface.firstElementChild)
    }
    if (video instanceof HTMLVideoElement) onVideo(video)
  }
  p.observer = new MutationObserver(inspect)
  p.observer.observe(document.documentElement, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['src'],
  })
  p.dispose = () => {
    p.disposed = true
    p.observer?.disconnect()
    if (p.video && p.frameID !== null &&
        typeof p.video.cancelVideoFrameCallback === 'function') {
      p.video.cancelVideoFrameCallback(p.frameID)
    }
  }
  window.__xdriveFirstFrameProbe = p
  inspect()
  return true
}

function xDriveReadViewerFirstFrameProbe() {
  const p = window.__xdriveFirstFrameProbe
  if (!p || p.disposed) return null
  const delta = value => value === null ? null :
    Math.round((value - p.startedAt) * 1000) / 1000
  // Resource timing is only optional diagnostic evidence. Browsers may omit
  // Range responseStart; never invent first-byte timing if unavailable.
  const resources = performance.getEntriesByType('resource').filter(entry => {
    try {
      const url = new URL(entry.name)
      return url.origin === location.origin &&
        /^\/api\/v1\/file-preview\/[1-9][0-9]*$/.test(url.pathname) &&
        url.searchParams.has('ticket') &&
        entry.startTime >= p.startedAt
    } catch { return false }
  }).sort((a, b) => a.startTime - b.startTime)
  const first = resources[0] || null
  const ttfb = first && first.responseStart > first.startTime ?
    Math.round((first.responseStart - first.startTime) * 1000) / 1000 : null
  const viewer = document.querySelector('[data-xdrive-web-viewer]')
  const next = viewer?.querySelector('[aria-label="预览下一个项目"]') ||
    viewer?.querySelector('[aria-label="下一张"]') || null
  const nextStyle = next ? getComputedStyle(next) : null
  const navigationVisible = next ? Boolean(next.getBoundingClientRect().width > 0 &&
    nextStyle?.display !== 'none' && nextStyle?.visibility === 'visible' &&
    Number(nextStyle?.opacity) > 0 && !next.disabled) : null
  const snapshot = {
    ready: p.firstFrameAt !== null,
    actualSignedVideo: p.signedStream,
    mountMs: delta(p.mountedAt),
    urlMs: delta(p.urlAt),
    metadataMs: delta(p.metadataAt),
    loadedDataMs: delta(p.loadedDataAt),
    firstFrameMs: delta(p.firstFrameAt),
    requestStartMs: first ? Math.round((first.startTime - p.startedAt) * 1000) / 1000 : null,
    rangeTTFBMs: ttfb,
    videoWidth: p.width, videoHeight: p.height,
    presentedFrames: p.presentedFrames, frameMediaTime: p.frameMediaTime,
    placeholderRect: p.placeholderRect, playerRect: p.playerRect,
    navigationVisible,
    source: 'real video requestVideoFrameCallback; Owner signed H264 source',
  }
  return snapshot
}

function xDriveStopViewerFirstFrameProbe() {
  window.__xdriveFirstFrameProbe?.dispose?.()
  delete window.__xdriveFirstFrameProbe
  return true
}

module.exports = {
  xDriveStartViewerFirstFrameProbe,
  xDriveReadViewerFirstFrameProbe,
  xDriveStopViewerFirstFrameProbe,
}

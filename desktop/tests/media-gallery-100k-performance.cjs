const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')
const logicalItems = 100_000
const retainedWindow = 90
const visibleWindow = 54
const batches = Math.ceil(logicalItems / retainedWindow)
const samples = 5

function transpile(filename, source = fs.readFileSync(filename, 'utf8'), customRequire = require) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filename,
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, customRequire)
  return mod.exports
}

const thumbnailSchedulerPath = path.join(
  repo, 'ui', 'shared', 'src', 'mui', 'MediaGalleryThumbnailScheduler.ts',
)
const thumbnailScheduler = transpile(thumbnailSchedulerPath)
const { XDriveMediaThumbnailScheduler } = thumbnailScheduler

const virtualGridPath = path.join(
  repo, 'ui', 'shared', 'src', 'mui', 'MediaGalleryVirtualGrid.ts',
)
const virtualGrid = transpile(virtualGridPath)
const virtualTimelinePath = path.join(
  repo, 'ui', 'shared', 'src', 'mui', 'MediaGalleryVirtualTimeline.ts',
)
const virtualTimeline = transpile(
  virtualTimelinePath,
  fs.readFileSync(virtualTimelinePath, 'utf8'),
  (id) => id === './MediaGalleryVirtualGrid' ? virtualGrid : require(id),
)
const {
  xDriveMediaGalleryTimelineLayout,
  xDriveMediaGalleryTimelineWindow,
} = virtualTimeline

const galleryPagePath = path.join(
  repo, 'ui', 'shared', 'src', 'mui', 'MediaGallery.tsx',
)
const galleryPageSource = fs.readFileSync(galleryPagePath, 'utf8')

const firstOpenMix = {
  photos: 70_000,
  videos: 15_000,
  livePhotos: 15_000,
}
const firstOpenPageSize = 100
const firstOpenTimelineDays = 3_650
const firstOpenSamples = 10

const previewPath = path.join(
  repo, 'ui', 'shared', 'src', 'mui', 'MediaGalleryPreviewMedia.tsx',
)
const previewSource = fs.readFileSync(previewPath, 'utf8') + `
export const __xdrivePerfScheduleMediaPoster = scheduleMediaPoster
export const __xdrivePerfMediaPosterStats = () => ({
  active: mediaPosterActive,
  queued: mediaPosterQueue.length,
})
`
const preview = transpile(previewPath, previewSource, (id) => {
  if (id === 'react') {
    return {
      useEffect: () => {},
      useRef: (value) => ({ current: value }),
      useState: (value) => [value, () => {}],
    }
  }
  if (id === 'react/jsx-runtime') {
    return { jsx: () => null, jsxs: () => null, Fragment: Symbol('Fragment') }
  }
  if (id === '@mui/icons-material') return { Image: function Image() {}, Movie: function Movie() {} }
  if (id === '@mui/material') return { Box: function Box() {}, Skeleton: function Skeleton() {} }
  if (id === './MediaGalleryVideoPoster') {
    return { xDriveCaptureVideoPosterBlob: async () => null }
  }
  return require(id)
})

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function never() {
  return new Promise(() => {})
}

function thumbnailStats(scheduler) {
  return {
    active: scheduler.active,
    queued: scheduler.queue.length,
    inFlight: scheduler.inFlight.size,
    cache: scheduler.cache.size,
  }
}

async function runImageLikeSample() {
  const scheduler = new XDriveMediaThumbnailScheduler(() => never(), {
    concurrency: 6,
    maxCacheEntries: 512,
    revokeURL: () => {},
  })
  let peakQueued = 0
  let peakActive = 0
  let peakInFlight = 0
  const started = performance.now()
  for (let batch = 0; batch < batches; batch += 1) {
    const start = batch * retainedWindow
    const end = Math.min(logicalItems, start + retainedWindow)
    const retained = []
    for (let index = start; index < end; index += 1) {
      retained.push(index + 1)
      const priority = index - start < visibleWindow ? 0 : 1
      void scheduler.load(index + 1, priority)
    }
    let stats = thumbnailStats(scheduler)
    peakQueued = Math.max(peakQueued, stats.queued)
    peakActive = Math.max(peakActive, stats.active)
    peakInFlight = Math.max(peakInFlight, stats.inFlight)
    scheduler.setRetention(retained)
    // Let the scheduler's queued microtask pump run once per synthetic scroll frame.
    await Promise.resolve()
    stats = thumbnailStats(scheduler)
    peakQueued = Math.max(peakQueued, stats.queued)
    peakActive = Math.max(peakActive, stats.active)
    peakInFlight = Math.max(peakInFlight, stats.inFlight)
  }
  const elapsedMs = performance.now() - started
  const final = thumbnailStats(scheduler)
  scheduler.dispose()
  return { elapsedMs, peakQueued, peakActive, peakInFlight, finalQueued: final.queued }
}

function normalizePosterHandle(value) {
  if (value && typeof value === 'object' && typeof value.cancel === 'function') {
    return value
  }
  return { promise: value, cancel: null }
}

function runVideoPosterSample() {
  let previous = []
  let peakQueued = 0
  let peakActive = 0
  let cancelSupported = false
  const started = performance.now()
  for (let batch = 0; batch < batches; batch += 1) {
    for (const handle of previous) handle.cancel?.()
    previous = []
    const start = batch * retainedWindow
    const end = Math.min(logicalItems, start + retainedWindow)
    for (let index = start; index < end; index += 1) {
      const handle = normalizePosterHandle(
        preview.__xdrivePerfScheduleMediaPoster(() => never()),
      )
      if (handle.cancel) cancelSupported = true
      previous.push(handle)
    }
    const stats = preview.__xdrivePerfMediaPosterStats()
    peakQueued = Math.max(peakQueued, stats.queued)
    peakActive = Math.max(peakActive, stats.active)
  }
  const elapsedMs = performance.now() - started
  const final = preview.__xdrivePerfMediaPosterStats()
  return {
    elapsedMs,
    peakQueued,
    peakActive,
    finalQueued: final.queued,
    cancelSupported,
  }
}

test('Gallery 100k media thumbnail baseline', async () => {
  const imageSamples = []
  for (let index = 0; index < samples; index += 1) {
    imageSamples.push(await runImageLikeSample())
  }
  // Poster scheduler globals intentionally model one app-wide queue, so run one 100k
  // traversal; the structural queue counters are deterministic and are the acceptance gate.
  const video = runVideoPosterSample()
  const imageElapsed = imageSamples.map((sample) => sample.elapsedMs)
  const image = {
    medianMs: median(imageElapsed),
    minMs: Math.min(...imageElapsed),
    maxMs: Math.max(...imageElapsed),
    peakQueued: Math.max(...imageSamples.map((sample) => sample.peakQueued)),
    peakActive: Math.max(...imageSamples.map((sample) => sample.peakActive)),
    peakInFlight: Math.max(...imageSamples.map((sample) => sample.peakInFlight)),
    finalQueued: Math.max(...imageSamples.map((sample) => sample.finalQueued)),
  }

  console.log('GALLERY_100K_PERF ' + JSON.stringify({
    logicalItems,
    retainedWindow,
    visibleWindow,
    batches,
    samples,
    imageAndLivePhoto: image,
    videoPoster: video,
    budgets: {
      imagePeakQueued: retainedWindow * 2,
      videoPeakQueued: retainedWindow * 2,
      activeImageLoads: 6,
      activeVideoPosters: 3,
    },
  }))

  assert.equal(image.peakActive <= 6, true)
  assert.equal(image.peakInFlight <= 6, true)
  assert.equal(image.peakQueued <= retainedWindow * 2, true)
  assert.equal(video.peakActive <= 3, true)
  assert.equal(video.cancelSupported, true, 'video poster scheduling must expose viewport cleanup cancellation')
  assert.equal(
    video.peakQueued <= retainedWindow * 2,
    true,
    'stale video poster work must stay bounded to at most two retained windows',
  )
})

function buildFirstOpenTimelineGroups() {
  const groups = []
  const base = Math.floor(logicalItems / firstOpenTimelineDays)
  let remainder = logicalItems % firstOpenTimelineDays
  let startIndex = 0
  const anchor = new Date(Date.UTC(2026, 9, 8))
  for (let index = 0; index < firstOpenTimelineDays; index += 1) {
    const date = new Date(anchor)
    date.setUTCDate(anchor.getUTCDate() - index)
    const itemCount = base + (remainder-- > 0 ? 1 : 0)
    groups.push({
      key: date.toISOString().slice(0, 10),
      item_count: itemCount,
      start_index: startIndex,
    })
    startIndex += itemCount
  }
  assert.equal(startIndex, logicalItems)
  return groups
}

function runFirstOpenTimelineSample(groups) {
  const started = performance.now()
  const layout = xDriveMediaGalleryTimelineLayout({
    width: 1440,
    groups,
  })
  const window = xDriveMediaGalleryTimelineWindow({
    layout,
    visibleTop: 0,
    visibleBottom: 900,
  })
  return {
    elapsedMs: performance.now() - started,
    layoutGroups: layout.groups.length,
    retainedItems: window.endIndex - window.startIndex,
    totalHeight: layout.totalHeight,
  }
}

test('Gallery 100k first-open UI baseline', () => {
  const loadFirstPageStart = galleryPageSource.indexOf('const loadFirstPage = useCallback(async (')
  const loadFirstPageEnd = galleryPageSource.indexOf('const loadMemories = useCallback', loadFirstPageStart)
  assert.ok(loadFirstPageStart >= 0 && loadFirstPageEnd > loadFirstPageStart)
  const loadFirstPageSource = galleryPageSource.slice(loadFirstPageStart, loadFirstPageEnd)
  const facetsStartIndex = loadFirstPageSource.indexOf('const facetsPromise = Promise.all([')
  const rangeAwaitIndex = loadFirstPageSource.indexOf('const range = await rangePromise')
  const firstItemsCommitIndex = loadFirstPageSource.indexOf('setItems([...range.items])')
  const facetsCommitIndex = loadFirstPageSource.indexOf('void facetsPromise.then')
  assert.ok(facetsStartIndex >= 0, 'library bootstrap should start secondary facets concurrently')
  assert.ok(rangeAwaitIndex > facetsStartIndex, 'first range should run concurrently with secondary facets')
  assert.ok(firstItemsCommitIndex > rangeAwaitIndex, 'first item commit should follow only the first range')
  assert.ok(facetsCommitIndex > firstItemsCommitIndex, 'secondary facets must not gate the first item commit')
  for (const dependency of [
    'rangePromise',
    'source.listAlbums()',
    'source.listPlaces',
    'source.listPets',
    'source.listSuggestedPeople',
    'listAllPeople()',
  ]) {
    assert.ok(loadFirstPageSource.includes(dependency), 'missing first-open dependency: ' + dependency)
  }

  const groups = buildFirstOpenTimelineGroups()
  const timelineSamples = []
  for (let index = 0; index < firstOpenSamples; index += 1) {
    timelineSamples.push(runFirstOpenTimelineSample(groups))
  }
  const elapsed = timelineSamples.map((sample) => sample.elapsedMs)
  const result = {
    medianMs: median(elapsed),
    minMs: Math.min(...elapsed),
    maxMs: Math.max(...elapsed),
    layoutGroups: timelineSamples[0].layoutGroups,
    retainedItems: timelineSamples[0].retainedItems,
    totalHeight: timelineSamples[0].totalHeight,
  }

  console.log('GALLERY_FIRST_OPEN_UI_100K ' + JSON.stringify({
    logicalItems,
    physicalMediaNodes: firstOpenMix.photos + firstOpenMix.videos + firstOpenMix.livePhotos * 2,
    mix: firstOpenMix,
    firstPageItems: firstOpenPageSize,
    timelineDays: firstOpenTimelineDays,
    samples: firstOpenSamples,
    timelineLayout: result,
    bootstrapGate: 'first range commits before albums/places/pets/suggested-people/all-people',
  }))

  assert.equal(firstOpenMix.photos + firstOpenMix.videos + firstOpenMix.livePhotos, logicalItems)
  assert.equal(result.layoutGroups, firstOpenTimelineDays)
  assert.equal(result.retainedItems > 0 && result.retainedItems < firstOpenPageSize, true)
})

test('Gallery renderer first-paint benchmark isolates transport from renderer mount latency', () => {
  const harness = fs.readFileSync(
    path.join(repo, 'ui', 'shared', 'src', 'mui', 'GalleryPerformanceHarness.tsx'),
    'utf8',
  )
  const traceMain = fs.readFileSync(
    path.join(repo, 'desktop', 'scripts', 'gallery-renderer-first-paint-trace-main.cjs'),
    'utf8',
  )
  const githubCI = fs.readFileSync(path.join(repo, '.github', 'workflows', 'ci.yml'), 'utf8')
  const gitlabCI = fs.readFileSync(path.join(repo, '.gitlab-ci.yml'), 'utf8')

  for (const token of [
    'gridCommitToThumbnailRequestMs',
    'thumbnailResolvedToImageMountMs',
    'thumbnailResolvedToDecodeMs',
    'decodedToPaintMs',
  ]) {
    assert.ok(harness.includes(token), 'renderer timing slice missing: ' + token)
  }
  assert.ok(traceMain.includes("sampleArg = process.argv.find((value) => /^sample-\\d+$/.test(value))"))
  assert.ok(traceMain.includes('sampleSuffix = `sample${sample}`'))
  assert.ok(githubCI.includes('for sample in 1 2 3; do'))
  assert.ok(gitlabCI.includes('for sample in 1 2 3; do'))
  assert.ok(githubCI.includes("find gallery-perf-results -maxdepth 1 -type f -name '*.json'"))
  assert.ok(githubCI.includes("-name '*-trace.json'"))
  assert.ok(gitlabCI.includes("find gallery-perf-results -maxdepth 1 -type f -name '*.json'"))
  assert.ok(gitlabCI.includes("-name '*-trace.json'"))
})

'use strict'
const fs = require('node:fs')
const path = require('node:path')

// The V8 CPUProfile and Vite sourcemaps can contain script URLs, source code,
// file paths and arbitrary function names. NEVER serialize either input.
// Export only fixed region labels, numeric counters and guarded JS identifiers
// mapped to source files owned by this repository.
const b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const b64Digits = new Map([...b64].map((char, index) => [char, index]))
const publicIdentifier = /^[$A-Za-z_][$A-Za-z_0-9]{2,63}$/
const forbiddenSymbol = /secret|password|token|cookie|credential|authorization|privatekey/i
const reactNames = new Set([
  'renderWithHooks', 'beginWork', 'completeWork', 'performUnitOfWork',
  'workLoopSync', 'workLoopConcurrent', 'commitRoot', 'commitRootImpl',
  'commitMutationEffects', 'commitMutationEffectsOnFiber',
  'commitLayoutEffects', 'commitLayoutEffectOnFiber',
  'commitPassiveMountEffects', 'commitPassiveMountOnFiber',
  'flushPassiveEffects', 'flushSyncCallbacks', 'scheduleUpdateOnFiber',
  'performConcurrentWorkOnRoot', 'performSyncWorkOnRoot',
  'updateFunctionComponent', 'updateMemoComponent', 'reconcileChildren',
])
const round = value => Math.round(value * 10) / 10

function decodeVLQ(text) {
  const values = []
  let value = 0
  let shift = 0
  for (const c of text) {
    const digit = b64Digits.get(c)
    if (digit === undefined) throw new Error('invalid sourcemap VLQ character')
    value += (digit & 31) * 2 ** shift
    if (digit & 32) {
      shift += 5
      if (shift > 50) throw new Error('sourcemap VLQ too long')
      continue
    }
    values.push(value & 1 ? -Math.floor(value / 2) : value / 2)
    value = 0
    shift = 0
  }
  if (shift !== 0) throw new Error('unterminated sourcemap VLQ')
  return values
}

// Parse all VLQ state transitions, storing only the generated lines actually
// referenced in the sampled CPU call frames. Source maps stay in CI memory.
function lookupMappings(map, requestedLines) {
  if (map.version !== 3 || !Array.isArray(map.sources) ||
      typeof map.mappings !== 'string') throw new Error('invalid Vite sourcemap')
  const result = new Map()
  let sourceIndex = 0
  let originalLine = 0
  let originalColumn = 0
  let nameIndex = 0
  const lines = map.mappings.split(';')
  for (let line = 0; line < lines.length; line++) {
    let generatedColumn = 0
    const wanted = requestedLines.has(line)
    const selected = wanted ? [] : null
    for (const part of lines[line].split(',')) {
      if (!part) continue
      const values = decodeVLQ(part)
      if (values.length !== 1 && values.length !== 4 && values.length !== 5)
        throw new Error('invalid sourcemap segment')
      generatedColumn += values[0]
      if (values.length < 4) continue
      sourceIndex += values[1]
      originalLine += values[2]
      originalColumn += values[3]
      if (values.length === 5) nameIndex += values[4]
      if (wanted && sourceIndex >= 0 && sourceIndex < map.sources.length) {
        selected.push({
          generatedColumn, sourceIndex, originalLine,
          nameIndex: values.length === 5 ? nameIndex : -1,
        })
      }
    }
    if (wanted) result.set(line, selected)
  }
  return result
}
function sourceFamily(sourceName) {
  const s = String(sourceName).replaceAll('\\', '/')
  if (s.includes('node_modules/react-dom/') || s.includes('node_modules/react/')) return 'react-runtime'
  if (s.includes('node_modules/@mui/')) return 'mui-runtime'
  if (s.includes('node_modules/@emotion/')) return 'emotion-runtime'
  if (s.includes('node_modules/')) return 'third-party'
  if (s.includes('ui/shared/src/mui/MediaGallery.tsx')) return 'shared-gallery-page'
  if (s.includes('ui/shared/src/') && /gallery|virtual|media|photo/i.test(s)) return 'shared-gallery-support'
  if (s.includes('ui/shared/src/')) return 'shared-ui-other'
  if (s.includes('desktop/src/renderer/') || s.includes('/src/renderer/')) return 'desktop-shell'
  return 'unresolved-source'
}
function safeSymbol(name, family) {
  if (!publicIdentifier.test(String(name)) || forbiddenSymbol.test(name)) return null
  if (family === 'react-runtime') return reactNames.has(name) ? name : null
  if (!family.startsWith('shared-') && family !== 'desktop-shell') return null
  return name
}
function bundleName(url) {
  const raw = String(url || '').split(/[?#]/)[0]
  if (!raw.includes('/dist/renderer/assets/')) return null
  return raw.match(/\/([a-zA-Z0-9._-]+\.js)$/)?.[1] || null
}
function classifyFrame(frame, mapped) {
  const fn = String(frame?.functionName || '')
  if (fn === '(idle)' || fn === '(program)') return {family:'browser-idle',symbol:null,line:null,mapped:false}
  if (fn === '(garbage collector)') return {family:'garbage-collection',symbol:null,line:null,mapped:false}
  if (mapped) {
    const family = sourceFamily(mapped.source)
    const symbol = safeSymbol(mapped.name || fn, family)
    return {family,symbol,line:Number.isInteger(mapped.originalLine) ? mapped.originalLine+1 : null,mapped:true}
  }
  return {family:bundleName(frame?.url) ? 'bundled-unmapped' : 'browser-or-preload',symbol:null,line:null,mapped:false}
}
function mapFrameLocations(frames, sourceMapRoot) {
  const requests = new Map()
  for (const frame of frames) {
    const file = bundleName(frame?.url)
    if (!file || !Number.isInteger(frame.lineNumber) || frame.lineNumber < 0) continue
    if (!requests.has(file)) requests.set(file, new Set())
    requests.get(file).add(frame.lineNumber)
  }
  const resolved = new Map()
  for (const [file, requestedLines] of requests) {
    const mapFile = path.join(sourceMapRoot, file + '.map')
    if (!fs.existsSync(mapFile)) continue
    let map
    try { map = JSON.parse(fs.readFileSync(mapFile, 'utf8')) }
    catch { throw new Error('invalid local Vite sourcemap JSON') }
    const lines = lookupMappings(map, requestedLines)
    resolved.set(file, {map,lines})
  }
  return frame => {
    const file = bundleName(frame?.url)
    const source = resolved.get(file)
    const segments = source?.lines.get(frame?.lineNumber)
    if (!segments?.length || !Number.isInteger(frame?.columnNumber)) return null
    // SourceMap mappings are nearest-preceding; never choose a future column.
    let picked = null
    for (const seg of segments) {
      if (seg.generatedColumn > frame.columnNumber) break
      picked = seg
    }
    if (!picked) return null
    return {
      source: source.map.sources[picked.sourceIndex],
      name: picked.nameIndex >= 0 ? source.map.names?.[picked.nameIndex] : null,
      originalLine: picked.originalLine,
    }
  }
}
function summariseCPUProfile(profile, sourceMapRoot) {
  if (!profile || !Array.isArray(profile.nodes) ||
      !Array.isArray(profile.samples) || !Array.isArray(profile.timeDeltas) ||
      profile.samples.length !== profile.timeDeltas.length ||
      profile.samples.length < 100) throw new Error('actual sampled V8 CPUProfile missing')
  if (!Number.isFinite(profile.startTime) || !Number.isFinite(profile.endTime) ||
      profile.endTime <= profile.startTime) throw new Error('invalid V8 CPUProfile duration')
  const nodeByID = new Map()
  const parents = new Map()
  for (const node of profile.nodes) {
    if (!Number.isSafeInteger(node.id) || !node.callFrame ||
        nodeByID.has(node.id)) throw new Error('invalid V8 CPUProfile call tree')
    nodeByID.set(node.id, node)
    for (const child of node.children || []) parents.set(child, node.id)
  }
  const cpuUS = new Map()
  const sampleCount = new Map()
  let weightedUS = 0
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i], delta = profile.timeDeltas[i]
    if (!nodeByID.has(id) || !Number.isFinite(delta) || delta < 0 || delta > 3000000)
      throw new Error('invalid actual V8 CPU sample')
    cpuUS.set(id,(cpuUS.get(id)||0)+delta)
    sampleCount.set(id,(sampleCount.get(id)||0)+1)
    weightedUS += delta
  }
  if (weightedUS <= 0) throw new Error('empty sampled V8 CPU time')
  const sampledNodes = [...cpuUS.keys()].map(id=>nodeByID.get(id))
  const locate = mapFrameLocations(sampledNodes.map(x=>x.callFrame), sourceMapRoot)
  const classified = new Map()
  let mappedFrames = 0
  let firstPartySamples = 0
  const totals = new Map()
  const top = []
  for (const node of sampledNodes) {
    const mapped = locate(node.callFrame)
    const entry = classifyFrame(node.callFrame, mapped)
    classified.set(node.id,entry)
    if (entry.mapped) mappedFrames++
    const ms = cpuUS.get(node.id)/1000
    if (entry.family.startsWith('shared-') || entry.family==='desktop-shell')
      firstPartySamples += sampleCount.get(node.id)
    const total = totals.get(entry.family) || {samples:0,weightedSampleMs:0,frames:0}
    total.samples += sampleCount.get(node.id)
    total.weightedSampleMs += ms
    total.frames++
    totals.set(entry.family,total)
    top.push({family:entry.family, mappedSymbol:entry.symbol,sourceLine:entry.line,
      weightedSampleMs:round(ms),samples:sampleCount.get(node.id)})
  }
  top.sort((a,b)=>b.weightedSampleMs-a.weightedSampleMs)
  const group = new Map()
  for (const item of top) {
    // Only safe mapped identifiers from known first-party/react modules can
    // be named. Function names in arbitrary browser scripts never leave CI.
    if (!item.mappedSymbol) continue
    const key = item.family+'::'+item.mappedSymbol+'::'+(item.sourceLine||0)
    const old = group.get(key) || {...item,weightedSampleMs:0,samples:0}
    old.weightedSampleMs+=item.weightedSampleMs
    old.samples+=item.samples
    group.set(key,old)
  }
  const named = [...group.values()].sort((a,b)=>b.weightedSampleMs-a.weightedSampleMs).slice(0,20)
    .map(x=>({...x,weightedSampleMs:round(x.weightedSampleMs)}))
  const familyTotals = [...totals.entries()].map(([family,value])=>({family,...value,weightedSampleMs:round(value.weightedSampleMs)}))
    .sort((a,b)=>b.weightedSampleMs-a.weightedSampleMs)
  return {
    kind:'actual-production-electron-renderer-V8-CPU-sampling',
    sampleCount:profile.samples.length,
    uniqueSampledFrames:sampledNodes.length,
    profileWallMs:round((profile.endTime-profile.startTime)/1000),
    totalWeightedSampleMs:round(weightedUS/1000),
    sourceMappedSampleFrames:mappedFrames,
    firstPartySampleCount:firstPartySamples,
    topSampledCallFrames:top.slice(0,15),
    topMappedSymbols:named,
    sourceFamilyTotals:familyTotals,
    samplingQualification:'Sample timeDeltas estimate wall-time attribution, not exact CPU or inclusive JS stack time. Bundled sourcemap symbol may describe an expression rather than a function.',
    rawProfileArgsPathsOrURLsIncluded:false,
    rawSourceMapsIncluded:false,
    productionLogicModified:false,
  }
}
module.exports = {decodeVLQ,lookupMappings,sourceFamily, safeSymbol,bundleName,
  classifyFrame, summariseCPUProfile}

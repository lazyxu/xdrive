'use strict'
const fs = require('node:fs')

// Never surface raw TraceEvent args, URLs, stack files, resource names,
// network headers, tokens, user paths or file contents. All output fields
// are numeric, booleans or values selected from this fixed taxonomy.
function eventKind(name) {
  if (/(?:RunTask|ProcessTaskFromWorkQueue|DoWork)/.test(name)) return 'task'
  if (/(?:RecalculateStyle|UpdateLayoutTree|Layout|StyleRecalc)/.test(name)) return 'style-layout'
  if (/(?:DecodeImage|ImageDecode|Decode Image|DrawImage)/.test(name)) return 'image-decode'
  if (/(?:Paint|PrePaint|Composite|Raster|LayerTree)/.test(name)) return 'paint-composite'
  if (/(?:FunctionCall|EvaluateScript|V8|v8\.|RunMicrotasks|CompileScript|ParseScript|TimerFire|FireAnimationFrame|EventDispatch|JSFrame)/.test(name)) return 'javascript'
  if (/(?:GC|GarbageCollect|MajorGC|MinorGC)/.test(name)) return 'garbage-collection'
  return 'other'
}
function summariseTrace(trace, rendererPid, reportedLongTasks = []) {
  if (!Number.isSafeInteger(rendererPid) || rendererPid <= 0)
    throw new Error('actual Electron renderer operating-system PID required')
  if (!Array.isArray(trace?.traceEvents) || trace.traceEvents.length === 0)
    throw new Error('real Chromium TraceEvent array missing')
  const all = trace.traceEvents
  const metaThreads = new Map()
  const target = []
  for (const e of all) {
    if (e?.pid !== rendererPid) continue
    if (e.ph === 'M' && e.name === 'thread_name' &&
        Number.isSafeInteger(e.tid) && typeof e.args?.name === 'string') {
      metaThreads.set(e.tid, e.args.name)
    }
    if (e.ph === 'X' && Number.isFinite(e.ts) && Number.isFinite(e.dur) &&
        e.dur >= 0 && Number.isSafeInteger(e.tid)) target.push(e)
  }
  if (!target.length) throw new Error('trace contains no events from actual target renderer')
  const mainNames = Array.from(metaThreads).filter(([, name]) =>
    /^(?:CrRendererMain|RendererMain|MainThread|CrMainThread)$/i.test(name))
  let chosenTID
  let threadSelection
  if (mainNames.length) {
    chosenTID = mainNames[0][0]
    threadSelection = 'renderer-main-metadata'
  } else {
    // Some Electron/Chromium builds omit trace metadata. Fall back to the
    // thread with the most verified task/JS/layout time in the target PID.
    const scores = new Map()
    for (const e of target) {
      if (!['task', 'javascript', 'style-layout'].includes(eventKind(e.name))) continue
      scores.set(e.tid, (scores.get(e.tid) || 0) + Math.min(e.dur, 500000))
    }
    const byScore = [...scores].sort((a, b) => b[1] - a[1])
    if (!byScore.length) throw new Error('could not locate renderer main thread events')
    chosenTID = byScore[0][0]
    threadSelection = 'event-based-fallback'
  }
  const events = target.filter(e => e.tid === chosenTID)
  let startUS = Infinity
  let endUS = -Infinity
  for (const e of events) {
    startUS = Math.min(startUS, e.ts)
    endUS = Math.max(endUS, e.ts + e.dur)
  }
  const rawTasks = events.filter(e => eventKind(e.name) === 'task' && e.dur >= 50000)
    .sort((a, b) => (a.ts - b.ts) || (b.dur - a.dur))
  // Tracing can include nested Task events; a single main-thread long task
  // must only be reported once, using its outer envelope.
  const tasks = []
  for (const t of rawTasks) {
    if (tasks.some(p => t.ts >= p.ts && t.ts + t.dur <= p.ts + p.dur)) continue
    tasks.push(t)
  }
  const aggregate = {}
  for (const e of events) {
    if (e.dur < 1000) continue
    const kind = eventKind(e.name)
    const row = aggregate[kind] || {count:0,inclusiveMs:0,maxEventMs:0}
    row.count++
    row.inclusiveMs += e.dur / 1000
    row.maxEventMs = Math.max(row.maxEventMs, e.dur / 1000)
    aggregate[kind] = row
  }
  const top = tasks.sort((a, b) => b.dur - a.dur).slice(0, 12).map(t => {
    const counts = {}
    for (const e of events) {
      if (e === t || e.dur < 1000 || e.ts >= t.ts+t.dur || e.ts+e.dur <= t.ts) continue
      const kind = eventKind(e.name)
      if (kind === 'task' || kind === 'other') continue
      const overlap = Math.min(e.ts+e.dur, t.ts+t.dur) - Math.max(e.ts, t.ts)
      const row = counts[kind] || {events:0,inclusiveMs:0}
      row.events++
      row.inclusiveMs += overlap / 1000
      counts[kind] = row
    }
    return {
      fromTraceStartMs: Math.round((t.ts-startUS)/1000*10)/10,
      durationMs: Math.round(t.dur/1000*10)/10,
      childKinds: counts,
    }
  })
  const observed = reportedLongTasks.map(row => ({
    startMs: Number.isFinite(row.startMs) ? Math.round(row.startMs*10)/10 : null,
    durationMs: Number.isFinite(row.durationMs) ? Math.round(row.durationMs*10)/10 : null,
  })).filter(x => x.startMs !== null && x.durationMs !== null)
  return {
    kind: 'real-electron-renderer-chromium-long-task-trace',
    rendererPIDMatched: true,
    rendererThreadSelected: threadSelection,
    tracedEvents: all.length,
    rendererEvents: events.length,
    recordingWindowMs: Math.round((endUS-startUS)/1000),
    longTaskTraceCount: tasks.length,
    topTaskEnvelopes: top,
    rendererEventKindTotals: aggregate,
    browserObservedLongTasks: observed,
    classification: 'fixed-event-names-only; nested inclusive event durations can overlap',
    rawTraceArgsOrURLsIncluded: false,
    productionCodeModified: false,
  }
}
function readAndSummariseTrace(file, rendererPid, reportedLongTasks = []) {
  const trace = JSON.parse(fs.readFileSync(file, 'utf8'))
  return summariseTrace(trace, rendererPid, reportedLongTasks)
}
module.exports = {eventKind, summariseTrace, readAndSummariseTrace}

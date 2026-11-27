'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {summariseTrace,readAndSummariseTrace} = require('../scripts/gallery-desktop-chromium-trace-analyze.cjs')

function fixture({metadata=true,pid=123}={}) {
  const events = [
    {pid,tid:11,ts:99000,ph:'X',dur:75000,name:'RunTask',args:{data:{token:'never-print-this-token'}}},
    {pid,tid:42,ts:100000,ph:'X',dur:125000,name:'ThreadControllerImpl::RunTask',args:{url:'https://private.invalid/secret?token=never-print-this-token'}},
    {pid,tid:42,ts:111000,ph:'X',dur:85000,name:'FunctionCall',args:{data:{scriptName:'private-photos/secret.ts',url:'https://private.invalid/path'}}},
    {pid,tid:42,ts:205000,ph:'X',dur:11000,name:'Layout',args:{data:{nodeName:'private-photo.jpg'}}},
    {pid,tid:42,ts:250000,ph:'X',dur:65000,name:'RunTask'},
    {pid,tid:42,ts:255000,ph:'X',dur:57000,name:'EvaluateScript'},
    {pid,tid:42,ts:260000,ph:'X',dur:39000,name:'RunTask'}, // nested duplicate must not count twice
    {pid,tid:42,ts:330000,ph:'X',dur:14000,name:'Paint'},
    {pid:999,tid:42,ts:102000,ph:'X',dur:900000,name:'RunTask',args:{url:'https://foreign.example/private'}},
  ]
  if (metadata) events.unshift({pid,tid:42,ph:'M',name:'thread_name',args:{name:'CrRendererMain'}})
  return {traceEvents:events,displayTimeUnit:'ms'}
}
test('real renderer PID and Main thread selection remove foreign tasks and raw secrets', () => {
  const summary = summariseTrace(fixture(),123,[{startMs:15.8,durationMs:114.3}])
  assert.equal(summary.rendererPIDMatched,true)
  assert.equal(summary.rendererThreadSelected,'renderer-main-metadata')
  assert.equal(summary.longTaskTraceCount,2)
  assert.equal(summary.topTaskEnvelopes[0].durationMs,125)
  assert.equal(summary.topTaskEnvelopes[0].childKinds.javascript.events,1)
  assert.equal(summary.topTaskEnvelopes[0].childKinds['style-layout'].events,1)
  assert.equal(summary.topTaskEnvelopes[1].durationMs,65)
  assert.equal(summary.topTaskEnvelopes[1].childKinds.javascript.events,1)
  assert.equal(summary.browserObservedLongTasks[0].durationMs,114.3)
  const serialized = JSON.stringify(summary)
  for (const secret of ['never-print-this-token','private.invalid','private-photos','private-photo.jpg']) {
    assert.equal(serialized.includes(secret),false, 'privacy leak in trace summary')
  }
  assert.equal(summary.rawTraceArgsOrURLsIncluded,false)
  assert.equal(summary.productionCodeModified,false)
})
test('missing thread metadata falls back to actual target renderer task events', () => {
  const summary = summariseTrace(fixture({metadata:false}),123)
  assert.equal(summary.rendererThreadSelected,'event-based-fallback')
  assert.equal(summary.longTaskTraceCount,2)
})
test('fail closed on absent/invalid renderer trace and pid', () => {
  assert.throws(()=>summariseTrace({},123),/trace/i)
  assert.throws(()=>summariseTrace(fixture(),-1),/PID/)
  assert.throws(()=>summariseTrace(fixture(),555),/actual target renderer/)
  assert.throws(()=>summariseTrace({traceEvents:[{pid:123,tid:42,ph:'M',name:'thread_name',args:{name:'CrRendererMain'}}]},123),/no events/)
})
test('reads JSON trace and never returns its private content', (t) => {
  const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(),'gallery-trace-unit-'))
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}))
  const file = path.join(temp,'trace.json')
  fs.writeFileSync(file,JSON.stringify(fixture()))
  const summary = readAndSummariseTrace(file,123)
  assert.equal(summary.longTaskTraceCount,2)
  assert.equal(JSON.stringify(summary).includes('never-print-this-token'),false)
})
test('production-unchanged gated source and raw trace deletion are explicit', () => {
  const source = fs.readFileSync(path.join(__dirname,'../scripts/gallery-desktop-real-cold-electron-main.cjs'),'utf8')
  const runner = fs.readFileSync(path.join(__dirname,'../scripts/gallery-desktop-real-cold-runner.cjs'),'utf8')
  assert.match(source,/XD_GALLERY_DESKTOP_COLD_CHROME_TRACE === '1'/)
  assert.match(source,/contentTracing\.startRecording/)
  assert.match(source,/contentTracing\.stopRecording/)
  assert.match(source,/fs\.rmSync\(chromiumTracePath, \{ force: true \}\)/)
  assert.match(source,/rendererPIDMatched/)
  assert.match(runner,/rawTraceArgsOrURLsIncluded === false/)
  assert.match(runner,/raw trace must be deleted/)
})

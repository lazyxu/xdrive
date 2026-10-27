#!/usr/bin/env node
'use strict'
// P1M measurement-only overlay. Apply identically to pinned A/B BEFORE build.
// Correlate the original video element's signed ticket by SHA-256, not by
// filename, full URL, or all visible Gallery video posters.
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const crypto=require('node:crypto')
const names=[
  'internal/api/pwa_p1_viewer_video_range_cancel_fixture_test.go',
  'internal/api/gallery_real_web_cold_performance_integration_test.go',
  'desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs',
]
function one(s,old,change,where) {
  const count=s.split(old).length-1
  assert.equal(count,1,'ambiguous test instrumentation '+where+': '+count)
  return s.replace(old,change)
}
function goProbe(s) {
  s=one(s,'\t"sync/atomic"', '\t"sync"\n\t"sync/atomic"','sync import')
  s=one(s,'\twatched         map[string]struct{}',
    '\twatched         map[string]struct{}\n\ttickets         sync.Map // SHA256(ticket) -> per-ticket counters\n\ttargetHash      atomic.Value // 64 lowercase hex, never raw ticket',
    'per-ticket fields')
  const methods=[
    '// P1M records only the actual Viewer signed-ticket request. Gallery',
    '// H264 poster requests have their own independently minted ticket.',
    'type pwaP1ViewerVideoRangeTicket struct {',
    '\tstarted, signedRange, partialContent, firstChunks atomic.Int64',
    '\tactive, contextDone, cancelled atomic.Int64',
    '\temittedBytes, markBytes, markNano, maxCancelMicros atomic.Int64',
    '}',
    'func (t *pwaP1ViewerVideoRangeTicket) snapshot() map[string]int64 {',
    '\treturn map[string]int64{',
    '\t\t"started":t.started.Load(), "signed_range":t.signedRange.Load(),',
    '\t\t"partial_content":t.partialContent.Load(), "first_chunks":t.firstChunks.Load(),',
    '\t\t"active":t.active.Load(), "context_done":t.contextDone.Load(),',
    '\t\t"cancelled":t.cancelled.Load(), "emitted_bytes":t.emittedBytes.Load(),',
    '\t\t"mark_emitted_bytes":t.markBytes.Load(), "max_cancel_us":t.maxCancelMicros.Load(),',
    '\t}',
    '}',
    '',
  ].join('\n')
  s=one(s,'func newPwaP1ViewerVideoRangeProbe(ids []uint64) *pwaP1ViewerVideoRangeProbe {',
    methods+'func newPwaP1ViewerVideoRangeProbe(ids []uint64) *pwaP1ViewerVideoRangeProbe {',
    'new per-ticket type')
  const mark='p.markNano.Store(time.Now().UnixNano())'
  const markMore=[
    mark,
    '\tif hash, ok := p.targetHash.Load().(string); ok {',
    '\t\tif raw, found := p.tickets.Load(hash); found {',
    '\t\t\trecord := raw.(*pwaP1ViewerVideoRangeTicket)',
    '\t\t\trecord.markBytes.Store(record.emittedBytes.Load())',
    '\t\t\trecord.maxCancelMicros.Store(0)',
    '\t\t\trecord.markNano.Store(time.Now().UnixNano())',
    '\t\t}',
    '\t}',
  ].join('\n')
  s=one(s,mark,markMore,'ticket-scoped mark')
  const start='p.started.Add(1)\n\tp.active.Add(1)\n\tdefer p.active.Add(-1)'
  const startMore=[
    'hash := fmt.Sprintf("%x", sha256.Sum256([]byte(r.URL.Query().Get("ticket"))))',
    '\traw, _ := p.tickets.LoadOrStore(hash, &pwaP1ViewerVideoRangeTicket{})',
    '\tticket := raw.(*pwaP1ViewerVideoRangeTicket)',
    '\tif rangeRequest { ticket.signedRange.Add(1) }',
    '\tticket.started.Add(1)',
    '\tticket.active.Add(1)',
    '\tdefer ticket.active.Add(-1)',
    '\t'+start,
  ].join('\n')
  s=one(s,start,startMore,'hash ticket on genuine signed request')
  s=one(s,'p.contextDone.Add(1)',
    [
      'p.contextDone.Add(1)',
      '\t\tticket.contextDone.Add(1)',
      '\t\tif when := ticket.markNano.Load(); when > 0 {',
      '\t\t\tdelay := time.Since(time.Unix(0,when)).Microseconds()',
      '\t\t\tfor {',
      '\t\t\t\told := ticket.maxCancelMicros.Load()',
      '\t\t\t\tif delay<=old || ticket.maxCancelMicros.CompareAndSwap(old,delay) { break }',
      '\t\t\t}',
      '\t\t}',
    ].join('\n'),
    'Owner exact ticket context cancellation')
  s=one(s,'ResponseWriter: w, ctx: ctx, probe: p, delayRange: rangeRequest,',
    'ResponseWriter: w, ctx: ctx, probe: p, ticket: ticket, delayRange: rangeRequest,',
    'ticket Writer')
  s=one(s,'p.cancelled.Add(1)','p.cancelled.Add(1)\n\t\tticket.cancelled.Add(1)',
    'ticket cancelled handler')
  s=one(s,'probe      *pwaP1ViewerVideoRangeProbe',
    'probe      *pwaP1ViewerVideoRangeProbe\n\tticket     *pwaP1ViewerVideoRangeTicket',
    'Writer ticket')
  s=one(s,'w.probe.partialContent.Add(1)',
    'w.probe.partialContent.Add(1)\n\t\tw.ticket.partialContent.Add(1)',
    'ticket actual HTTP 206')
  s=one(s,'w.probe.firstChunks.Add(1)',
    'w.probe.firstChunks.Add(1)\n\t\t\tw.ticket.firstChunks.Add(1)',
    'ticket real first chunk')
  const bytes='w.probe.emittedBytes.Add(int64(n))'
  assert.equal(s.split(bytes).length-1,3,'three recorded Go Write sites required')
  s=s.split(bytes).join(bytes+'\n\t\tw.ticket.emittedBytes.Add(int64(n))')
  const bytes2='w.probe.emittedBytes.Add(int64(m))'
  s=one(s,bytes2,bytes2+'\n\t\tw.ticket.emittedBytes.Add(int64(m))',
    'third chunk emission')
  return s
}
function goFixture(s) {
  s=one(s,'\t"encoding/json"','\t"encoding/hex"\n\t"encoding/json"',
    'test-only hash validation import')
  const route=[
    'case "/__perf/viewer-video-range-target":',
    '\t\t\tif p1ViewerVideoRangeProbe == nil || r.Method != http.MethodPost {',
    '\t\t\t\thttp.Error(w,"test-only signed Viewer Range target",http.StatusMethodNotAllowed); return',
    '\t\t\t}',
    '\t\t\tvar request map[string]string',
    '\t\t\tif err := json.NewDecoder(http.MaxBytesReader(w,r.Body,256)).Decode(&request); err != nil {',
    '\t\t\t\thttp.Error(w,"invalid scoped Range digest",http.StatusBadRequest); return',
    '\t\t\t}',
    '\t\t\thash := request["ticket_hash"]',
    '\t\t\tdecoded, err := hex.DecodeString(hash)',
    '\t\t\tif err != nil || len(decoded)!=32 || hash != strings.ToLower(hash) {',
    '\t\t\t\thttp.Error(w,"invalid digest",http.StatusBadRequest); return',
    '\t\t\t}',
    '\t\t\tif _, ok := p1ViewerVideoRangeProbe.tickets.Load(hash); !ok {',
    '\t\t\t\thttp.Error(w,"viewer signed Range not yet observed",http.StatusConflict); return',
    '\t\t\t}',
    '\t\t\tp1ViewerVideoRangeProbe.targetHash.Store(hash)',
    '\t\t\tw.WriteHeader(http.StatusNoContent)',
    '\t\tcase "/__perf/viewer-video-range-target-stats":',
    '\t\t\tif p1ViewerVideoRangeProbe == nil || r.Method != http.MethodGet {',
    '\t\t\t\thttp.NotFound(w,r); return',
    '\t\t\t}',
    '\t\t\thash, ok := p1ViewerVideoRangeProbe.targetHash.Load().(string)',
    '\t\t\tif !ok { http.NotFound(w,r); return }',
    '\t\t\traw, found := p1ViewerVideoRangeProbe.tickets.Load(hash)',
    '\t\t\tif !found { http.NotFound(w,r); return }',
    '\t\t\tw.Header().Set("Content-Type","application/json")',
    '\t\t\tw.Header().Set("Cache-Control","no-store")',
    '\t\t\t_ = json.NewEncoder(w).Encode(raw.(*pwaP1ViewerVideoRangeTicket).snapshot())',
    '\t\t',
  ].join('\n')
  s=one(s,'case "/__perf/viewer-video-range-enable":',
    route+'case "/__perf/viewer-video-range-enable":',
    'synthetic endpoint for Viewer signed-ticket digest')
  return s
}
function driver(s) {
  const helper=[
    '// P1M: never send a raw signed ticket to the Electron process or logs.',
    '// Bind only the current mounted Viewer media URL SHA256 to the Go',
    '// test-only accounting. Background Gallery poster tickets stay separate.',
    'async function p1BindSignedViewerRangeTicket(win,base) {',
    "  const sha=await win.webContents.executeJavaScript(",
    "    '(async()=>{'+",
    "    'const video=document.querySelector(\\'[data-xdrive-web-viewer] [data-xdrive-preview-media-state=\"video\"] video\\');'+",
    "    'const ticket=video&&video.currentSrc?new URL(video.currentSrc,location.href).searchParams.get(\\'ticket\\'):null;'+",
    "    'if(!ticket)return null;'+",
    "    'const raw=await crypto.subtle.digest(\\'SHA-256\\',new TextEncoder().encode(ticket));'+",
    "    'return Array.from(new Uint8Array(raw)).map(b=>b.toString(16).padStart(2,\\'0\\')).join(\\'\\');'+",
    "    '})()', true)",
    "  assert(/^[a-f0-9]{64}$/.test(sha),'authenticated Viewer signed ticket digest missing')",
    "  await until(async()=>{",
    "    const response=await fetch(base+'/__perf/viewer-video-range-target',{",
    "      method:'POST',headers:{'Content-Type':'application/json'},",
    "      body:JSON.stringify({ticket_hash:sha}),",
    "    })",
    "    if(response.status===409)return null",
    "    assert.equal(response.status,204,'Viewer ticket scoped Go bind failed')",
    "    return true",
    "  },12000,'real Owner Viewer signed Range ticket observed by Go')",
    "}",
    "async function p1ViewerVideoTicketStats(base) {",
    "  const response=await fetch(base+'/__perf/viewer-video-range-target-stats',{cache:'no-store'})",
    "  assert.equal(response.status,200,'Viewer ticket scoped range probe missing')",
    "  return response.json()",
    "}",
    '',
  ].join('\n')
  const start='async function p1MeasureRealViewerRangeAbort(win,base){'
  s=one(s,start,helper+start,'JS token scope helper')
  const next='  let inFlight\n'
  if(s.split(next).length!==2)throw Error('missing exact one Viewer in-flight transition')
  const parts=s.split(next)
  parts[0]=one(parts[0],
    ",12000,'real Owner signed original Video element before Range completes')",
    ",12000,'real Owner signed original Video element before Range completes')\n  await p1BindSignedViewerRangeTicket(win,base)",
    'bind signed exact ticket before mark')
  const end='async function sampleOnce(sample, ready) {'
  if(parts[1].split(end).length!==2)throw Error('P1D function boundary ambiguous')
  const [measureRest,tail]=parts[1].split(end)
  const replacement=measureRest.replaceAll('p1ViewerVideoProbeStats(base)',
    'p1ViewerVideoTicketStats(base)')
  assert.equal(measureRest.split('p1ViewerVideoProbeStats(base)').length-1,5,
    'expected 4 old unscoped signed range reads after zero')
  const withGlobal=one(replacement,
    '  const after=await p1ViewerVideoTicketStats(base)',
    '  const after=await p1ViewerVideoTicketStats(base)\n'+
    '  const globalVideo=await p1ViewerVideoProbeStats(base)',
    'ticket and global comparison')
  const withDiagnostic=one(withGlobal,
    '    watchedOriginals:after.watched_paths,rangeStarted:after.started,',
    '    watchedOriginals:globalVideo.watched_paths,rangeStarted:after.started,\n'+
    '    otherVideoActiveAfterBack:Math.max(0,globalVideo.active-after.active),\n'+
    '    globalSignedVideoRanges:globalVideo.signed_range,',
    'other poster request remains reportable, not ignored')
  return parts[0]+next+withDiagnostic+end+tail
}
function instrument(root) {
  for(const rel of names) {
    const file=path.join(root,rel)
    const before=fs.readFileSync(file,'utf8')
    const after=rel.startsWith('internal/api/pwa_p1_viewer')?goProbe(before):
      rel.startsWith('internal/api/gallery_real')?goFixture(before):driver(before)
    assert.notEqual(before,after,'missing instrument '+rel)
    fs.writeFileSync(file,after)
  }
}
function main() {
  assert.equal(process.argv.length,4,'usage: instrument.cjs before-dir after-dir')
  instrument(process.argv[2]);instrument(process.argv[3])
  for(const rel of names) {
    const a=fs.readFileSync(path.join(process.argv[2],rel))
    const b=fs.readFileSync(path.join(process.argv[3],rel))
    assert.equal(crypto.createHash('sha256').update(a).digest('hex'),
      crypto.createHash('sha256').update(b).digest('hex'),
      'A/B instrumentation source must be identical: '+rel)
  }
  console.log('P1M signed Viewer ticket-digest Go probe overlay identical across frozen A/B; no raw tickets logged')
}
main()

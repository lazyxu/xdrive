'use strict'
// Source-exact original vs candidate: real Chromium/Gin/PostgreSQL17/physical CAS.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = process.env.XD_SH_P018_PAIRED_RESULTS || path.resolve(__dirname, '../sh-p018-paired-results')
const med = values => [...values].sort((a,b) => a-b)[Math.floor(values.length/2)]
const hash = variant => fs.readFileSync(path.join(root, variant+'.sha256'),'utf8').trim()
const sources = { original:hash('original'), candidate:hash('candidate') }
assert.match(sources.original,/^[a-f0-9]{64}$/)
assert.match(sources.candidate,/^[a-f0-9]{64}$/)
assert.notEqual(sources.original,sources.candidate,'two genuinely different Web source revisions required')
const out = { workload:'SH-P018 genuine physical 100k next-page matched A-B/B-A/A-B',
  variants:sources, per_width_per_arm:9, populations_per_variant:3, widths:{}, accepted:false }
let consistentCorpus = null
const pop = {}
for(const variant of ['original','candidate']) {
  pop[variant]=[]
  for(let i=1;i<=3;i++) {
    const base=path.join(root,variant+'-'+i)
    const d=JSON.parse(fs.readFileSync(path.join(base,'summary.json'),'utf8'))
    assert(d.all_passed,'source fixture failed correctness: '+base)
    assert.equal(d.variant,variant)
    assert.equal(d.variant_web_sha256,sources[variant])
    assert.equal(d.paired_next_page,true)
    assert.equal(d.original_jpeg_cas,100000)
    assert.equal(d.browser_sessions,6)
    assert.equal(d.sessions.length,6)
    assert(d.original_bytes>50000000)
    assert(d.allocated_cas_bytes>=100001*4096)
    assert.equal(d.http_counts.thumbnail_held_starts,6)
    assert.equal(d.http_counts.thumbnail_cancelled_go,6)
    assert.equal(d.http_counts.thumbnail_active_held,0)
    assert.equal(d.http_counts.thumbnail_stale_body_bytes,0)
    assert.equal(d.http_counts.original_download_calls,0)
    if(consistentCorpus!==null)assert.equal(d.source_aggregate_sha256,consistentCorpus,
      'paired original/candidate must use identical deterministic 100k payloads')
    consistentCorpus=d.source_aggregate_sha256
    const resource=fs.readFileSync(path.join(base,'resources.txt'),'utf8')
    const rss=Number(resource.match(/maxrss_kib=(\d+)/)?.[1])
    const cpu=Number(resource.match(/user_cpu_seconds=([\d.]+)/)?.[1])+
              Number(resource.match(/system_cpu_seconds=([\d.]+)/)?.[1])
    assert(rss>0 && Number.isFinite(cpu), 'missing real CPU/RSS resource sample')
    pop[variant].push({data:d,rss,cpu})
  }
}
for (const width of [1440,390]) {
  const timings={}, stats={}
  for(const variant of ['original','candidate']) {
    const samples=pop[variant].flatMap(population=>population.data.sessions.filter(s=>s.width===width))
    assert.equal(samples.length,9)
    for(const x of samples) {
      assert.equal(x.cause,'bounded-next-page')
      assert.equal(x.first_rows,100)
      assert(x.decoded_cached_jpegs>=2 && x.first_page_ms>0 && x.first_page_ms<=2000)
      assert(x.go_cancel_event_ms>0 && Number.isFinite(x.go_cancel_event_ms))
      assert.equal(x.abandoned_body_bytes,0)
      assert.equal(x.cancelled_active_handlers_at_observation,0)
      assert.equal(x.horizontal_overflow,false)
      if(variant==='candidate') {
        assert(x.go_cancel_max_ms>0 && x.go_cancel_max_ms<=160,
          'candidate cumulative Go cancellation violates original 160ms gate')
        assert(x.go_cancel_event_ms<=160,
          'candidate per-event Go cancellation violates original 160ms gate')
      }
    }
    timings[variant]=samples.map(s=>s.go_cancel_event_ms)
    stats[variant]={median_ms:med(timings[variant]),
      median_rss_kib:med(pop[variant].map(p=>p.rss)),
      median_cpu_seconds:med(pop[variant].map(p=>p.cpu))}
  }
  const gain=(stats.original.median_ms-stats.candidate.median_ms)/stats.original.median_ms
  out.widths[width]={original_events_ms:timings.original,
    candidate_events_ms:timings.candidate, before:stats.original, after:stats.candidate,
    median_gain_fraction:gain}
  assert(gain>=0.20,
    'candidate does not improve same-runner genuine next-page P50 at least 20%: '+width)
  assert(stats.candidate.median_rss_kib<=stats.original.median_rss_kib*1.25,
    'candidate RSS regression >25%: '+width)
  assert(stats.candidate.median_cpu_seconds<=stats.original.median_cpu_seconds*1.25,
    'candidate CPU regression >25%: '+width)
}
out.accepted=true
fs.writeFileSync(path.join(root,'matched-summary.json'),JSON.stringify(out,null,2)+'\n')
console.log('SH_P018_MATCHED_REAL_100K_ACCEPTED '+JSON.stringify(out))

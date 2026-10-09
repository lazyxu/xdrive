#!/usr/bin/env node
// Fail closed on mismatched workloads, incorrect range counts or insufficient
// native improvement; do not silently accept a fast but wrong fold.
import fs from 'node:fs'
const [beforePath, afterPath, outputPath] = process.argv.slice(2)
if (!beforePath || !afterPath || !outputPath) throw new Error('before.jsonl after.jsonl acceptance.json required')
const load = (filename) => fs.readFileSync(filename, 'utf8').trim().split(/\r?\n/)
  .filter(Boolean).map(line => JSON.parse(line))
const before=load(beforePath), after=load(afterPath)
const errors=[]
if (before.length!==2 || after.length!==2) errors.push('expected exact two workloads on each side')
const summaries=[]
for (const logical of [10000,100000]) {
 const a=before.find(x=>x.logical_assets===logical),b=after.find(x=>x.logical_assets===logical)
 if (!a||!b){errors.push('missing scale '+logical);continue}
 for (const prop of ['workload','physical_media_nodes','identical_groups','identical_assets','expected_visible']) if(a[prop]!==b[prop]) errors.push(logical+' changed '+prop)
 if(a.workload!=='gallery-fold-mixed-v1'||a.samples_per_phase!==3||b.samples_per_phase!==3)errors.push('invalid workload or sample count '+logical)
 const x=Object.fromEntries(a.phases.map(p=>[p.name,p]))
 const y=Object.fromEntries(b.phases.map(p=>[p.name,p]))
 const rows={}
 for(const key of ['fold_off_first','fold_index','fold_on_first','fold_on_mid','fold_album','fold_favorite']){
  const old=x[key],fresh=y[key]
  if(!old||!fresh||old.samples_ms.length!==3||fresh.samples_ms.length!==3||old.has_error||fresh.has_error){errors.push(logical+' missing/invalid '+key);continue}
  if(old.rows!==fresh.rows||old.visible_count!==fresh.visible_count){errors.push(logical+' cardinality mismatch '+key)}
  const saving=old.median_ms-fresh.median_ms, reduction=old.median_ms>0?saving/old.median_ms:0
  rows[key]={before_ms:old.median_ms,after_ms:fresh.median_ms,saving_ms:Number(saving.toFixed(3)),reduction_pct:Number((reduction*100).toFixed(2)),before_samples_ms:old.samples_ms,after_samples_ms:fresh.samples_ms}
  if(fresh.median_ms>old.median_ms*1.25 && fresh.median_ms-old.median_ms>150)errors.push(logical+' material regression '+key)
 }
 // Frozen optimisation target: 100k representative first-page fold, the
 // reproduced 4.92x incident. Both an absolute and a relative gain required.
 if(logical===100000 && rows.fold_on_first &&
    !(rows.fold_on_first.saving_ms>=100 && rows.fold_on_first.reduction_pct>=30))errors.push('100k folded first-page improvement < 30%/100ms')
 summaries.push({logical_assets:logical,physical_media_nodes:a.physical_media_nodes,expected_visible:a.expected_visible,phases:rows})
}
const result={workload:'gallery-fold-mixed-v1',status:errors.length?'rejected':'accepted',errors,summaries,scope:'paired same-host PostgreSQL 17 native Go queries; not renderer or client latency'}
fs.writeFileSync(outputPath,JSON.stringify(result,null,2)+'\n')
if(errors.length){console.error(JSON.stringify(result));process.exitCode=1}else console.log('Paired Gallery fold correctness and performance accepted')

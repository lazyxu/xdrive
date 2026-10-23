#!/usr/bin/env node
'use strict'
// Two real normal Vite builds on the SAME runner; bundle bytes are not FCP/100k AFTER.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {gzipSync}=require('node:zlib')
const [beforeDir,afterDir,out]=process.argv.slice(2)
assert(beforeDir&&afterDir&&out)
function measure(dir){
 const dist=path.resolve(dir)
 const m=JSON.parse(fs.readFileSync(path.join(dist,'.vite/manifest.json'),'utf8'))
 const entry=Object.keys(m).filter(k=>m[k]?.isEntry)
 assert.equal(entry.length,1)
 const visited=new Set(),files=new Set()
 function visit(k){
  if(visited.has(k))return
  assert(m[k], 'complete Vite graph required')
  visited.add(k)
  for(const f of [m[k].file,...(m[k].css||[]),...(m[k].assets||[])])if(f)files.add(f)
  for(const dep of m[k].imports||[])visit(dep)
 }
 visit(entry[0])
 let raw=0,gzip=0
 for(const file of files){
  assert(/^assets\/[A-Za-z0-9_.\/-]+\.(?:js|css|svg|png|webp|woff2?)$/.test(file))
  const target=path.resolve(dist,file)
  assert(target.startsWith(dist+path.sep))
  const st=fs.lstatSync(target);assert(st.isFile()&&!st.isSymbolicLink())
  const bytes=fs.readFileSync(target)
  raw+=bytes.length;gzip+=gzipSync(bytes).length
 }
 return {raw,gzip,files:files.size,keys:visited.size}
}
const before=measure(beforeDir),after=measure(afterDir)
const gain=before.gzip-after.gzip
const ratio=gain/before.gzip
const result={schema:'pwa-p102-paired-normal-vite-graph-v1',sha:process.env.XD_PR_HEAD||null,
 before,after,bytesSaved:gain,percentSaved:Number((ratio*100).toFixed(3)),
 sameRunner:true,normalProductionEntry:true,physicalIOS:false,
 genuine100kAfter:false,actualChromeAfter:false,benefitUnproven:ratio<=0.05}
fs.mkdirSync(path.dirname(out),{recursive:true})
fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{mode:0o600})
console.log('PWA_P102_MATCHED_BUNDLE_GRAPH '+JSON.stringify(result))
assert(result.sameRunner&&before.gzip>0&&after.gzip>0)

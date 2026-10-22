'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const {execFileSync,spawnSync}=require('node:child_process')
const root=path.resolve(__dirname,'../..')
const script=path.join(root,'scripts/pwa-archive-reference-audit.mjs')
const publisher=path.join(root,'deploy/pwa-archive-assets.sh')
function fixture(t){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'xdrive-pwa-refs-'))
  t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}))
  const archive=path.join(tmp,'archive')
  fs.mkdirSync(archive)
  function release(name,entries){
    const dir=path.join(tmp,name,'.vite')
    fs.mkdirSync(dir,{recursive:true})
    const manifest=path.join(dir,'manifest.json')
    fs.writeFileSync(manifest,JSON.stringify(entries))
    return manifest
  }
  return {tmp,archive,release}
}
function audit(archive,manifests,opt){
  const args=[script,archive,...manifests]
  if(opt!==undefined)args.push('--soft-limit-bytes='+opt)
  return JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8'}))
}
function failure(archive,manifests){
  const p=spawnSync(process.execPath,[script,archive,...manifests],{encoding:'utf8'})
  assert.equal(p.status,1)
  assert.equal(p.stdout,'','unsafe input must not emit partial stats')
  assert.match(p.stderr,/invalid or incomplete public evidence/)
  assert(!p.stderr.includes(archive))
}

test('two explicit Vite release manifests classify only read-only public archived bytes',t=>{
  const v=fixture(t)
  const a='main-AbCdEf12.js',b='lazy-ZyXwVu34.js',extra='older-AaBbCc99.js'
  fs.writeFileSync(path.join(v.archive,a),'AAAA')
  fs.writeFileSync(path.join(v.archive,b),'BBBBBB')
  fs.writeFileSync(path.join(v.archive,extra),'CCCCCCCC')
  const manifestA=v.release('old',{main:{file:'assets/'+a,imports:['lazy']},
    lazy:{file:'assets/'+b}})
  const manifestB=v.release('new',{main:{file:'assets/'+a},
    other:{file:'assets/'+b}})
  const before=fs.statSync(path.join(v.archive,a)).mtimeMs
  const result=audit(v.archive,[manifestA,manifestB],5)
  assert.equal(result.read_only,true)
  assert.equal(result.known_manifest_count,2)
  assert.equal(result.unique_manifest_references,2)
  assert.equal(result.referenced_archive_files,2)
  assert.equal(result.referenced_archive_logical_bytes,10)
  assert.equal(result.not_referenced_by_supplied_manifests,1)
  assert.equal(result.not_referenced_logical_bytes,8)
  assert.equal(result.missing_referenced_files,0)
  assert.equal(result.archive_logical_bytes,18)
  assert.equal(result.soft_limit_exceeded,true)
  assert.equal(result.safe_to_auto_delete,false)
  assert.equal(result.delete_candidates_established,false)
  assert.equal(result.live_client_versions_proven,false)
  assert.equal(result.rollback_reference_coverage_proven,false)
  assert.equal(fs.statSync(path.join(v.archive,a)).mtimeMs,before)
  const serialized=JSON.stringify(result)
  for(const secret of [v.tmp,a,b,extra,manifestA,manifestB]) assert(!serialized.includes(secret))
})

test('missing historical chunk is a red audit observation, not deletion permission',t=>{
  const v=fixture(t)
  fs.writeFileSync(path.join(v.archive,'safe-AaBbCc11.js'),'GOOD')
  const mf=v.release('releaseA',{app:{
    file:'assets/safe-AaBbCc11.js',
    css:['assets/absent-QwErTy33.css']
  }})
  const r=audit(v.archive,[mf])
  assert.equal(r.missing_referenced_files,1)
  assert.equal(r.not_referenced_by_supplied_manifests,0)
  assert.equal(r.safe_to_auto_delete,false)
})

test('hardlinked release files are counted once by inode bytes, not falsely reclaimed',t=>{
  const v=fixture(t)
  fs.writeFileSync(path.join(v.archive,'a-AbCdEf12.js'),'12345')
  fs.linkSync(path.join(v.archive,'a-AbCdEf12.js'),path.join(v.archive,'b-AbCdEf13.js'))
  const manifest=v.release('both',{
    a:{file:'assets/a-AbCdEf12.js'},
    b:{file:'assets/b-AbCdEf13.js'}
  })
  const r=audit(v.archive,[manifest])
  assert.equal(r.archive_logical_bytes,10)
  assert.equal(r.archive_inode_unique_bytes,5)
  assert.equal(r.referenced_archive_files,2)
  assert.equal(r.safe_to_auto_delete,false)
})

test('manifest traversal, symlinks, unhashed assets and private archive bytes fail closed',t=>{
  const v=fixture(t)
  fs.writeFileSync(path.join(v.archive,'safe-AbCdEf12.js'),'public')
  const bad=v.release('broken',{app:{file:'assets/../secret.js'}})
  failure(v.archive,[bad])
  const good=v.release('good',{app:{file:'assets/safe-AbCdEf12.js'}})
  fs.writeFileSync(path.join(v.archive,'token.jwt'),'private')
  failure(v.archive,[good])
  fs.rmSync(path.join(v.archive,'token.jwt'))
  if(process.platform!=='win32'){
    fs.symlinkSync(good,path.join(v.tmp,'alias.json'))
    failure(v.archive,[path.join(v.tmp,'alias.json')])
  }
  // Script never imports a DELETE/mutate helper or generates a GC plan.
  const code=fs.readFileSync(script,'utf8')
  assert(!code.includes('fs.rmSync('))
  assert(!code.includes('fs.unlinkSync('))
  assert(!code.includes('fs.renameSync('))
})

test('actual publisher archive can be audited with external old-release manifests', {skip:process.platform==='win32'},t=>{
  const v=fixture(t)
  const input=path.join(v.tmp,'build-assets')
  fs.mkdirSync(input)
  fs.writeFileSync(path.join(input,'index-AbCdEf12.js'),'oldJS')
  fs.writeFileSync(path.join(input,'chunk-ZyXwVu34.css'),'oldCSS')
  execFileSync('sh',[publisher,input,v.archive])
  const manifest=v.release('release',{main:{file:'assets/index-AbCdEf12.js',
    css:['assets/chunk-ZyXwVu34.css']}})
  const first=audit(v.archive,[manifest])
  execFileSync('sh',[publisher,input,v.archive])
  assert.deepEqual(audit(v.archive,[manifest]),first)
  assert.equal(first.missing_referenced_files,0)
  assert.equal(first.referenced_archive_files,2)
})

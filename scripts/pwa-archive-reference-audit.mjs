#!/usr/bin/env node
// PWA B2c2 read-only: correlate explicitly supplied historical Vite manifests
// with the existing public hash archive. Never infer live clients or safe GC.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditPublicAssetArchive } from './pwa-archive-audit.mjs'

const HASHED = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{6,}\.(js|css|svg|png|webp|woff|woff2|jpg|jpeg|gif|avif|wasm)$/
const SAFE_DIR = /^[A-Za-z0-9_-]+$/
const MAX_MANIFESTS = 64
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024
const MAX_ENTRIES = 100000
const MAX_DEPTH = 32

function checked(a,b){
  const n=a+b
  if(!Number.isSafeInteger(n)) throw Error('reference audit size overflow')
  return n
}
function requireNoSymlinkAncestors(file) {
  let p=path.resolve(file)
  while(true){
    const st=fs.lstatSync(p)
    if(st.isSymbolicLink()) throw Error('reference audit symbolic link prohibited')
    const parent=path.dirname(p)
    if(parent===p) break
    p=parent
  }
}
function parseManifest(file) {
  if(path.basename(file)!=='manifest.json' || path.basename(path.dirname(file))!=='.vite')
    throw Error('only explicit Vite .vite/manifest.json inputs accepted')
  requireNoSymlinkAncestors(file)
  const st=fs.lstatSync(file)
  if(!st.isFile() || st.size<=0 || st.size>MAX_MANIFEST_BYTES)
    throw Error('invalid Vite manifest size or file type')
  const raw=fs.readFileSync(file,'utf8')
  let obj
  try {obj=JSON.parse(raw)}catch{throw Error('invalid Vite manifest JSON')}
  if(!obj || Array.isArray(obj) || typeof obj!=='object' ||
     !Object.keys(obj).length || Object.keys(obj).length>MAX_ENTRIES)
    throw Error('invalid Vite manifest structure')
  const assets=new Set()
  const keys=new Set(Object.keys(obj))
  let ignoredPublicRoots=0
  function reference(value) {
    if(typeof value!=='string' || !value || value.includes('\0') ||
       value.includes('\\') || value.startsWith('/') || value.includes('..'))
      throw Error('invalid manifest asset reference')
    if(!value.startsWith('assets/')){
      ignoredPublicRoots=checked(ignoredPublicRoots,1)
      return
    }
    if(!HASHED.test(value)) throw Error('unhashed or unsafe archive reference')
    assets.add(value.slice(7))
  }
  for(const entry of Object.values(obj)){
    if(!entry || Array.isArray(entry) || typeof entry!=='object')
      throw Error('malformed manifest entry')
    if(entry.file!==undefined) reference(entry.file)
    for(const field of ['css','assets']){
      if(entry[field]!==undefined){
        if(!Array.isArray(entry[field])||entry[field].length>MAX_ENTRIES)
          throw Error('malformed manifest dependencies')
        for(const value of entry[field])reference(value)
      }
    }
    for(const field of ['imports','dynamicImports']){
      if(entry[field]!==undefined){
        if(!Array.isArray(entry[field])||entry[field].length>MAX_ENTRIES)
          throw Error('malformed Vite import references')
        for(const value of entry[field]){
          if(typeof value!=='string'||!keys.has(value))
            throw Error('manifest reference graph incomplete')
        }
      }
    }
  }
  if(!assets.size) throw Error('manifest contains no hashed public assets')
  return {assets,ignoredPublicRoots}
}
function inspectArchive(root,refs){
  const full=path.resolve(root)
  const stack=[{full,relative:'',depth:0}]
  const present=new Set()
  let matchedCount=0,matchedBytes=0,unmatchedCount=0,unmatchedBytes=0
  while(stack.length){
    const cur=stack.pop()
    for(const entry of fs.readdirSync(cur.full,{withFileTypes:true})){
      const complete=path.join(cur.full,entry.name)
      const st=fs.lstatSync(complete)
      if(st.isSymbolicLink())throw Error('archive symbolic link prohibited')
      const rel=cur.relative?cur.relative+'/'+entry.name:entry.name
      if(st.isDirectory()){
        if(!SAFE_DIR.test(entry.name)||cur.depth>=MAX_DEPTH)
          throw Error('unsafe archive directory')
        stack.push({full:complete,relative:rel,depth:cur.depth+1})
        continue
      }
      if(!st.isFile()||!HASHED.test(rel))throw Error('nonpublic archive entry')
      if(present.has(rel))throw Error('duplicate public asset path')
      present.add(rel)
      if(refs.has(rel)){
        matchedCount=checked(matchedCount,1)
        matchedBytes=checked(matchedBytes,st.size)
      }else{
        unmatchedCount=checked(unmatchedCount,1)
        unmatchedBytes=checked(unmatchedBytes,st.size)
      }
    }
  }
  const missing=[...refs].filter(f=>!present.has(f)).length
  return {matchedCount,matchedBytes,unmatchedCount,unmatchedBytes,missing}
}
export function auditExplicitManifestReferences(archiveRoot,manifestPaths,softLimitBytes=null){
  if(!Array.isArray(manifestPaths)||manifestPaths.length<1 ||
      manifestPaths.length>MAX_MANIFESTS ||
      new Set(manifestPaths.map(p=>path.resolve(p))).size!==manifestPaths.length)
    throw Error('explicit unique historical manifests required')
  if(softLimitBytes!==null && (!Number.isSafeInteger(softLimitBytes)||softLimitBytes<1))
    throw Error('positive safe-integer soft threshold required')
  // Existing audit independently rejects nonpublic paths, special files,
  // symlinks and forged private assets before any derived statistics.
  const inventory=auditPublicAssetArchive(archiveRoot)
  const refs=new Set()
  let omitted=0
  for(const file of manifestPaths) {
    const m=parseManifest(file)
    for(const r of m.assets)refs.add(r)
    omitted=checked(omitted,m.ignoredPublicRoots)
  }
  const result=inspectArchive(archiveRoot,refs)
  if(result.matchedCount+result.unmatchedCount!==inventory.files ||
      result.matchedBytes+result.unmatchedBytes!==inventory.logical_bytes)
    throw Error('archive changed during audit; retry read-only snapshot')
  return {
    schema:'xdrive-pwa-explicit-manifest-reference-audit-v1',
    read_only:true, safe_to_auto_delete:false, delete_candidates_established:false,
    live_client_versions_proven:false, all_historical_releases_proven:false,
    rollback_reference_coverage_proven:false,
    manifest_scope:'operator_supplied_release_manifests_only',
    known_manifest_count:manifestPaths.length,
    unique_manifest_references:refs.size,
    referenced_archive_files:result.matchedCount,
    referenced_archive_logical_bytes:result.matchedBytes,
    missing_referenced_files:result.missing,
    not_referenced_by_supplied_manifests:result.unmatchedCount,
    not_referenced_logical_bytes:result.unmatchedBytes,
    ignored_nonarchive_manifest_entries:omitted,
    archive_files:inventory.files,archive_logical_bytes:inventory.logical_bytes,
    archive_inode_unique_bytes:inventory.inode_unique_bytes,
    archive_allocated_bytes:inventory.allocated_bytes,
    soft_limit_bytes:softLimitBytes,
    soft_limit_exceeded:softLimitBytes===null?null:
      inventory.inode_unique_bytes>softLimitBytes,
    soft_limit_metric:'inode_unique_bytes_not_true_disk_usage',
    action:'retain_all; investigate capacity manually; no automatic removal'
  }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2)
    const opt=args.find(v=>v.startsWith('--soft-limit-bytes='))
    if(args.filter(v=>v.startsWith('--soft-limit-bytes=')).length>1)
      throw Error('duplicate soft limit')
    const raw=opt?opt.split('=')[1]:null
    const soft=raw===null?null:(
      /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw)>0
      ? Number(raw) : NaN
    )
    const plain=opt?args.filter(v=>v!==opt):args
    if(plain.length<2)throw Error('usage: archive root and explicit manifests')
    const result=auditExplicitManifestReferences(plain[0],plain.slice(1),soft)
    console.log(JSON.stringify(result))
  }catch{
    // No input paths, filenames, manifest contents or private data in errors.
    console.error('xDrive reference audit: invalid or incomplete public evidence; no statistics emitted')
    process.exitCode=1
  }
}

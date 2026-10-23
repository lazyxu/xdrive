'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const policy=read('docs/pwa-public-hash-retention-operations.md')
const audit=read('scripts/pwa-archive-reference-audit.mjs')
const publish=read('deploy/pwa-archive-assets.sh')
const sw=read('assets/icon/web/sw.js')
test('P1-04 P2-03 no speculative client lifetime or automatic hashed asset deletion',()=>{
 for(const k of ['APPEND-ONLY','safe_to_auto_delete=false',
  'delete_candidates_established=false','indefinitely inactive','Unknown',
  'manifest','--soft-limit-bytes=536870912','soft_limit_exceeded',
  'missing_referenced_files','operator capacity','NO old public hash'])
  assert(policy.includes(k),k)
 assert(audit.includes('safe_to_auto_delete:false'))
 assert(audit.includes('delete_candidates_established:false'))
 assert(audit.includes('live_client_versions_proven:false'))
 assert(!audit.includes('fs.unlinkSync('))
 assert(!audit.includes('fs.rmSync('))
})
test('publisher retains immutable prior bytes and refuses hash collision',()=>{
 for(const k of ['ln "$temp" "$target"', 'immutable asset collision',
  'concurrent hash collision','cmp -s "$origin" "$target"'])
  assert(publish.includes(k),k)
 assert(!publish.includes('rm -rf "$archive_root"'))
 assert(!sw.includes('self.skipWaiting('))
})

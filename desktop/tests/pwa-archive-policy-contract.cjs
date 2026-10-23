'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const publisher=read('deploy/pwa-archive-assets.sh')
const inventory=read('scripts/pwa-archive-audit.mjs')
const refs=read('scripts/pwa-archive-reference-audit.mjs')
const policy=read('docs/pwa-public-archive-reference-policy.md')
const s5=read('docs/pwa-s5-acceptance.md')
const summary=read('docs/pwa-five-stage-execution-20261022.md')

test('immutable hash publication and history no destructive GC contract',()=>{
 for(const token of ['immutable asset collision','cmp -s','$archive_root','ln "$temp" "$target"'])
  assert(publisher.includes(token),token)
 assert(!publisher.includes('rm -rf "$archive_root"'))
 assert(!publisher.includes('find "$archive_root" -type f -delete'))
 assert(!publisher.includes('rsync --delete'))
 for(const token of ['read_only: true','inode_unique_bytes','allocated_bytes',
   'public_hashed_assets_only: true'])assert(inventory.includes(token),token)
})
test('reference evidence is never certified live-client proof or deletion authority',()=>{
 for(const token of ['safe_to_auto_delete:false','delete_candidates_established:false',
  'live_client_versions_proven:false','all_historical_releases_proven:false',
  'rollback_reference_coverage_proven:false','not_referenced_by_supplied_manifests',
  'soft_limit_metric:'])assert(refs.includes(token),token)
 assert(!refs.includes('unlinkSync('))
 assert(!refs.includes('rmSync('))
 assert(!refs.includes('rmdirSync('))
})
test('P1-04/P2-03 policy indefinite retention and capacity warning not GC',()=>{
 for(const token of ['indefinite retention','safe_to_auto_delete=false',
  'inode_unique_bytes','delete_candidates_established=false',
  'live_client_versions_proven=false','all_historical_releases_proven=false',
  'rollback_reference_coverage_proven=false','P2-03','--soft-limit-bytes=536870912'])
  assert(policy.includes(token),token)
 assert(policy.includes('无限期'))
 assert(policy.includes('不能标记为通过'))
})
test('no physical or production acceptance invented in S5 matrix',()=>{
 assert(s5.includes('NOT RUN'))
 assert(s5.includes('按用户决定跳过（未验收）'))
 assert(summary.includes('100k/115k'))
 assert(summary.includes('safe_to_auto_delete=false'))
 assert(!s5.includes('| iOS 27 Home Screen (Installed Web App) | PASS'))
})

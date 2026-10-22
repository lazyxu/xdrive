'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const read=p=>fs.readFileSync(path.join(__dirname,'../..',p),'utf8')
const browser=read('desktop/scripts/pwa-cr01b3-two-active-upload-waiting.cjs')
const shell=read('scripts/pwa-cr01b3-two-active-upload-waiting.sh')
const go=read('internal/api/pwa_cr01b5_cross_owner_postflight_linux_test.go')
const flow=read('.github/workflows/pwa-cr01b5-cross-owner-sw-waiting.yml')
test('two separate normal/admin Go Owners cannot share localStorage when simultaneously uploading',()=>{
for(const x of [
 "crossOwner = env.XD_PWA_CR01B5_CROSS_OWNER === '1'",
 "fetch('/api/v1/admin/users',{method:'POST'",
 "role:'user',must_change_password:false",
 "const peerContext=crossOwner?await browser.newContext({",
 "summary.crossOwnerDifferentUser=true;summary.crossOwnerTwoPartitions=true",
 "if(crossOwner)await waitWaiting(peer)",
 "await waitStableTwoWindowSWWaiting(page, peer)",
 "await waitTwoDistinctGoPartials()",
 "summary.crossOwnerACL404=true",
 "a.status===404&&b.status===404",
 "await waitNewActive(reopened)"
])assert(browser.includes(x),'missing browser proof '+x)
assert(browser.includes('finishNativeStreamedChunk(page),finishPeerStreamingChunk(peer)'))
assert(!/context\.route\(|route\.fulfill\(/.test(browser))
})
test('second normal user has separate PG/CAS owner identity and complete byte verification',()=>{
for(const x of ['TestPWACR01B5CrossOwnerPhysicalPostflight',
 'XD_PWA_CR01B5_CROSS_OWNER_PHYSICAL',
 'pwa-cr01b5-user','pwa-b2b2b1-owner',
 'owner.ID == originalOwner.ID',
 'owner.Role != meta.UserRoleUser',
 'original[0].OwnerID == session.OwnerID',
 'storage.NewLocal(root)','io.Copy(actual, physical)',
 'blob.RefCount < 1'])
 assert(go.includes(x),'missing independent Go physical proof '+x)
assert(!go.includes('db.Create('))
assert(shell.includes('XD_PWA_CR01B5_CROSS_OWNER_PHYSICAL=1 go test'))
assert(shell.includes('XD_PWA_CR01B3_DUAL_PHYSICAL=1 go test'))
assert(shell.includes('result.crossOwnerDifferentUser &&') &&
  shell.includes('result.crossOwnerACL404 && result.crossOwnerTwoPartitions'))
})
test('source-exact Chromium TLS-H2 Go A→B/Caddy PG17 CI stays private and fail closed',()=>{
for(const x of ['test/pwa-cr01b5-cross-owner-upload-20261022',
 'postgres:17-alpine','caddy:2.10.2-alpine','playwright-core@1.56.1',
 "XD_PWA_CR01B5_CROSS_OWNER: '1'",
 'node --test release-b/desktop/tests/pwa-cr01b3-two-active-upload-waiting.cjs release-b/desktop/tests/pwa-cr01b5-cross-owner-sw-waiting.cjs',
 'github.event.pull_request.head.sha',
 'release-b/desktop/pwa-cr01b5-results/summary.json'])
 assert(flow.includes(x),'missing CI '+x)
assert(!flow.includes('continue-on-error:'))
const artifact=(flow.split('actions/upload-artifact@v4')[1]||'')
assert(!/path:\s*[^\n]*(?:\.har\b|browser-profile|private-go)/i.test(artifact))
})
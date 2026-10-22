'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const run=read('desktop/scripts/pwa-cr02b3-real-go-owner-acl.cjs')
const flow=read('.github/workflows/pwa-cr02b3-real-go-owner-acl.yml')
const gin=read('internal/api/pwa_s2b3_real_gin_auth_integration_test.go')
const view=read('web/src/PwaOfflineDirectoryBrowser.tsx')
const store=read('web/src/pwaOfflineDirectory.ts')
const sw=read('assets/icon/web/sw.js')
test('CR02b3 never mocks Go auth: true PG17 two users and server UUID',()=>{
 for(const token of ['TestPWAS2B3RealGinAuthFixture','storage.NewLocal(t.TempDir())',
  'router := srv.Router()', 'XD_PWA_CR02B3_TRANSIENT',
  'meta.EnsurePWAOfflineInstanceID(db)', 'srv.PWAOfflineInstanceID = instanceID',
  'createTestUser(t, db, router, ownerName',
  'createTestUser(t, db, router, foreignName', 'foreignToken, nil, http.StatusNotFound'])
  assert.ok(gin.includes(token),token)
 assert.ok(gin.includes('http.ServeContent(w, request, "index.html"'),
   'test-only Gin public index must not redirect PWA SW precache')
 assert.ok(run.includes("fetch('/index.html',{"),
   'native browser must reject redirected public index before SW-ready')
 for(const token of ['/api/v1/me','/api/v1/nodes/root','/api/v1/media/albums',
  '/children?offset=0&limit=1','xDrivePwaSetOfflineConsent(owner,true)',
  'xDrivePwaCaptureVisitedDirectory(owner','xDrivePwaCaptureAlbumSummaries(owner',
  'summary.foreignOwner404=true'])assert.ok(run.includes(token),token)
 assert.doesNotMatch(run,/context\.route\(|route\.fulfill\(|self\.skipWaiting\s*\(/)
})
test('Actual production Offline React rechecks Go /me → node → 1-row Range, purges on revocation',()=>{
 for(const token of ['await api.me(controller.signal)','xDrivePwaVerifiedIdentityMatches(owner, me)',
  'await api.node(selected.id, controller.signal)','await api.listRange(selected.id, 0, 1',
  'xDrivePwaClearOfflineMetadata','error.status === 403','error.status === 404'])
  assert.ok(view.includes(token),token)
 for(const token of ['chromium.launchPersistentContext(profile','await ctx.setOffline(true)',
  'summary.realOfflineColdRelaunch=true','summary.postReconnectGoACL=true',
  'summary.stillHistoricalAfterAuthorization=true','await waitNode404(hist',
  "await hist.locator('[data-xdrive-pwa-offline-verify]').click()",
  'summary.realGoNodeRevoked=true','summary.revocationPurgedBothSnapshots=true',
  'summary.revokedHistoryCannotResurrect=true'])
  assert.ok(run.includes(token),token)
 assert.ok(sw.includes('SHELL_PREFIX'))
 assert.ok(!store.includes('caches.open('))
})
test('One source-exact CI, private ready/JWT excluded from artifacts; iOS NOT RUN',()=>{
 for(const token of ['postgres:17-alpine','go test -c -o',
  'XD_PWA_S2B3_REAL_GIN=1','XD_PWA_CR02B3_TRANSIENT=1','playwright-core@1.56.1',
  'node desktop/scripts/pwa-cr02b3-real-go-owner-acl.cjs',
  'node --test desktop/tests/pwa-cr02b3-real-go-owner-source.cjs',
  'github.event.pull_request.head.sha','actions/upload-artifact@v4'])
  assert.ok(flow.includes(token),token)
 assert.doesNotMatch(flow,/continue-on-error:|workflow_dispatch:/)
 assert.ok(flow.includes('desktop/pwa-cr02b3-results/summary.json'))
 assert.ok(!flow.includes('path: $RUNNER_TEMP/pwa-cr02b3-private-gin.log'))
 assert.ok(run.includes('PWA_CR02B3_SAFE_FAILURE'))
 assert.ok(run.includes('ownerJWTInArtifact:false'))
 assert.ok(run.includes('physicalIOS:false'))
 assert.ok(run.includes('PWA_CR02B3_SAFE_WATCHDOG'))
 assert.ok(run.includes('navigator.serviceWorker.ready.then(reg=>'))
})

test('CR02b3 real Gin fault responses precede live ACL, not fabricated browser mocks',()=>{
  for(const t of ['XD_PWA_CR02B3_TRANSIENT','/api/v1/me','http.StatusServiceUnavailable',
    'http.StatusTooManyRequests','Retry-After','cr02b3Armed.Load()'])
    assert.ok(gin.includes(t),t)
  for(const t of ["/__test/pwa-cr02b3/arm?node_id=","x.kind==='me'&&x.status===503",
    "x.kind==='node'&&x.status===429","x.kind==='range'&&x.status===503",
    'summary.realGo503ThenRecovered=true','summary.realGo429OnceRetried=true',
    'summary.realGo503RangeRetried=true'])
    assert.ok(run.includes(t),t)
  assert.doesNotMatch(run,/route\.fulfill\(|context\.route\(/)
})

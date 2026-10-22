'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const runner=read('desktop/scripts/pwa-p2a2-real-chromium-restart.cjs');
const flow=read('.github/workflows/pwa-p2a2-real-chromium-restart.yml');
const original=read('internal/api/gallery_real_web_cold_performance_integration_test.go');
test('P2-A2 has TWO real Chrome OS processes with exact persisted profile, not reload',()=>{
 for(const phrase of ['launchPersistentContext(profile','browserPid(profile)','await exited(pidA)','await exited(pidB)',
 'assert.notEqual(pidA,pidB',"fs.mkdtempSync(path.join(os.tmpdir(),'xdrive-p2a2-'))",
 'position(open.page,fractions[i],first[i].ids)','profilePersisted:true','privatePersistentCache:false',
 "physicalIOS:false","process.kill(pid,0)"])assert(runner.includes(phrase),'missing OS/browser evidence '+phrase);
 assert(!runner.includes('window.location.reload'),'must actually close process');
 assert(!runner.includes('indexedDB.open'),'no private IDB cache');
 assert(!runner.includes('new BrowserWindow'),'must not emulate process restart with Electron windows');
 assert(!runner.includes('skipWaiting('),'no SW promotion');
});
test('100k real Go/PostgreSQL17/LocalCAS exact Owner/HTTP byte probe preserved',()=>{
 for(const phrase of ['TestGalleryRealWebColdFixture100K','XD_GALLERY_REAL_WEB_COLD_PERF',
 'XD_GALLERY_WEB_PHYSICAL_MIXED_VIEWPORT_100K_PERF','physical-thumbnail-stats',
 'logical_assets,100000','physical_nodes,115000','physical_sources,115000',
 "afterB.failed,0",'afterB.max_active<=6',"startsWith('blob:')",
 'ids.length,4','i.decode()','requestAnimationFrame','firstBodyBytes','restartBodyBytes',
 'restartedP95','P2-A2'])
 assert(runner.includes(phrase),'missing Go/Chrome real-before safeguard '+phrase);
 for(const phrase of ['gallerySeedRealPhysicalMixed100K','physicalProbe.serve(w, r, router)',
 '"physical_sources"','"physical_bytes"','"physical_verified"'])
 assert(original.includes(phrase),'fixture drift '+phrase);
});
test('P2-A2 exact-head CI refuses simulated Chrome, absent PG17, or unproven output',()=>{
 for(const phrase of ['postgres:17-alpine','go test -c -o desktop/gallery-physical-web-go/api.test',
 'VITE_XDRIVE_GALLERY_REAL_COLD_PERF=1','playwright-core@1.56.1','node --check',
 'test "$XD_PR_HEAD"','pwa-p2a2-real-chromium-restart.cjs',
 'pwa-p2a-before-contract.cjs','x.n!==3','x.pairs!==9',
 'x.after!==null','actions/upload-artifact@v4'])
 assert(flow.includes(phrase),'missing hard CI gate '+phrase);
 assert(!flow.includes('continue-on-error:'),'never swallow real Go/Chrome failure');
});

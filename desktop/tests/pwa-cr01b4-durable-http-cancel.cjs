'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const go=read('internal/api/pwa_s2b3_real_gin_auth_integration_test.go')
const probe=read('internal/api/pwa_cr01b4_request_cancel_fixture_linux_test.go')
const run=read('desktop/scripts/pwa-cr01b4-durable-http-cancel.cjs')
const flow=read('.github/workflows/pwa-cr01b4-durable-http-cancel.yml')
test('CR01b4 native Browser cancels actual Go HTTP read while worker is not cancelled',()=>{
 for(const x of ['XD_PWA_CR01B4_CANCEL_DURABLE',
 'router.ServeHTTP(writer, request)','cr01b4Probe.handlerExited.Store(true)',
 'durableFixture.verify(t, srv, db, router, ownerToken, foreignToken)'])
   assert(go.includes(x),x)
 for(const x of ['request.Context().Done()','w.probe.cancelled.Store(true)',
    'w.ResponseWriter.Write(body[:length])','w.Flush()'])assert(probe.includes(x),x)
 for(const x of ['browser.newContext','held.controller.abort()',
    "'X-PWA-CR01B4-Slow-Read':'real-go-context'",
    'response.body.getReader()','/api/v1/file-operations/',
    'read_context_cancelled','read_handler_exited',
    '/__test/pwa-s4d3/start-worker','/api/v1/nodes/','serverWorkerCompleted=true',
    'durableWorkerStartedBeforeReadAbort=true'])
   assert(run.includes(x),x)
 assert.doesNotMatch(run,/route\.fulfill\(|context\.route\(|self\.skipWaiting\(/)
})
test('CR01b4 CI has a real Chromium/PG17/Gin/CAS specialty and exact-head gate',()=>{
 for(const x of ['postgres:17-alpine','playwright-core@1.56.1',
    'XD_PWA_CR01B4_CANCEL_DURABLE=1','XD_PWA_S4D3_DURABLE=1',
    'node desktop/scripts/pwa-cr01b4-durable-http-cancel.cjs',
    'github.event.pull_request.head.sha','node --test desktop/tests/pwa-cr01b4-durable-http-cancel.cjs'])
 assert(flow.includes(x),x)
 assert(!flow.includes('continue-on-error:'))
})

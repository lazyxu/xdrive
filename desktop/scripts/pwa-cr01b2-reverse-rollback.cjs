#!/usr/bin/env node
'use strict'
// CR-01b2: real 17MiB Go A/B multipart upload WITH two waiting old SW windows.
// P0-B2b2b-2a: Browser sends REAL 17 MiB chunks to production cmd/server A,
// first chunk physically committed; independently SIGKILL A and use true Caddy
// reload to B; SAME JWT/upload ID/resume key continue on B and finalize.
// This validates actual HTTP protocol, not the production Files picker UI.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')

const env = process.env
const fields = [
  'XD_PWA_HOT_UPLOAD_OUTPUT', 'XD_PWA_HOT_UPLOAD_CADDY_COMMON',
  'XD_PWA_HOT_UPLOAD_CADDY_NAME', 'XD_PWA_HOT_UPLOAD_CADDY_PORT',
  'XD_PWA_HOT_UPLOAD_GO_A_PORT', 'XD_PWA_HOT_UPLOAD_GO_B_PORT',
  'XD_PWA_HOT_UPLOAD_GO_A_PID', 'XD_PWA_HOT_UPLOAD_PUBLIC', 'XD_PWA_HOT_UPLOAD_A_SHA',
  'XD_PWA_HOT_UPLOAD_B_SHA', 'XD_PWA_HOT_UPLOAD_A_DIST',
  'XD_PWA_HOT_UPLOAD_B_DIST', 'XD_PWA_HOT_UPLOAD_CAS_ROOT',
  'XD_PWA_HOT_UPLOAD_A_SERVER', 'XD_PWA_HOT_UPLOAD_PRIVATE_ROOT', 'XDRIVE_BROWSER_EXECUTABLE'
]
for (const field of fields) assert(env[field], field + ' is required')
const port = env.XD_PWA_HOT_UPLOAD_CADDY_PORT
const origin = 'https://localhost:' + port
const goAPort = env.XD_PWA_HOT_UPLOAD_GO_A_PORT
const goBPort = env.XD_PWA_HOT_UPLOAD_GO_B_PORT
const goBackPort = Number(env.XD_PWA_HOT_UPLOAD_GO_ROLLBACK_PORT)
assert(Number.isInteger(goBackPort)&&goBackPort>1024&&goBackPort<65536)
const container = env.XD_PWA_HOT_UPLOAD_CADDY_NAME
const commonFile = env.XD_PWA_HOT_UPLOAD_CADDY_COMMON
const pidA = Number(env.XD_PWA_HOT_UPLOAD_GO_A_PID)
assert(Number.isSafeInteger(pidA) && pidA > 1)
const output = path.resolve(env.XD_PWA_HOT_UPLOAD_OUTPUT)
fs.mkdirSync(output, { recursive: true })
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

const casRoot = fs.realpathSync(env.XD_PWA_HOT_UPLOAD_CAS_ROOT)
// Independent real Go LocalCAS temp-file readback on a PRIVATE fixture root.
// Never treat Chromium queued bytes as Go Request.Body consumption evidence.
function partialGoChunkBytes() {
  const dirs=[casRoot]
  let maximum=0,seen=0
  while(dirs.length) {
    const current=dirs.pop()
    for(const ent of fs.readdirSync(current,{withFileTypes:true})) {
      if(++seen>10000)throw Error('unexpected fixture CAS cardinality')
      const absolute=path.join(current,ent.name)
      if(ent.isSymbolicLink())throw Error('CAS fixture symlink')
      if(ent.isDirectory())dirs.push(absolute)
      else if(ent.isFile() && ent.name.startsWith('.xdrive-upload-')) {
        maximum=Math.max(maximum,fs.statSync(absolute).size)
      }
    }
  }
  return maximum
}
async function awaitPartialGoChunk() {
  const deadline=Date.now()+30000
  while(Date.now()<deadline) {
    const count=partialGoChunkBytes()
    if(count>=256*1024 && count<8*1024*1024)return count
    await sleep(100)
  }
  throw Error('original Go LocalCAS did not consume in-flight HTTP chunk')
}

const summary = {
  schema: 'xdrive-pwa-cr01b2-real-17m-old-sw-waiting-v1',
  sourceA: env.XD_PWA_HOT_UPLOAD_A_SHA,
  sourceB: env.XD_PWA_HOT_UPLOAD_B_SHA,
  browser: 'genuine-Chromium-390px-emulation',
  actualGoASigkill: false, realCaddyReload: false,
  originalJWTReused: false, originalUploadSessionReused: false,
  first8MiBCommittedBeforeGoDeath: false, originalChunk0NeverReuploaded: false,
  chunkCount: 3, fileBytes: 17 * 1024 * 1024,
  actualHttpFileChunks: false, productionFilePicker: false,
  oldSWWaitingVerified: false, twoOldWindowsStayedControlled: false,
  oldDocumentStayedMounted: false, newSWActivatedOnlyAfterBothClosed: false,
  realUploadSessionActiveWhileWaiting: false, physicalGoCASPostflight: false,
  nativeInFlightPut: false, goReadPartialBytes: false, realBrowserH2: false,
  waitingOverlappedInFlight: false, streamedChunkCommitted: false,
  bToARollbackProven: false, physicalOldGoReentered: false,
  nativeOldGoCanReadCommittedFile: false, rollbackHistoricalChunkBytesMatch: false,
  reverseSWWaitingStable: false, oldBWindowsNotReplaced: false,
  oldSWReactivatedOnlyAfterClientsClose: false,
  twoIndependentWindowUploadsProven: false,
  durableTaskCoactivityProven: false,
  physicalIOS: false, passed: false
}
let safePhase = 'initialize' // only a fixed phase label; no URL, account or secret
// Native E2E must never pin a runner for 95 minutes on a missing SW/HTTP body.

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
function realCaddyB() {
  const original = fs.readFileSync(commonFile, 'utf8')
  assert(original.includes('reverse_proxy 127.0.0.1:' + goAPort),
    'original Caddy upstream A missing')
  const updated = original.replaceAll('reverse_proxy 127.0.0.1:' + goAPort,
    'reverse_proxy 127.0.0.1:' + goBPort)
  assert.notEqual(updated, original)
  // Rewrite only the private host-mounted Caddyfile; run genuine Caddy reload.
  fs.writeFileSync(commonFile, updated)
  const result = spawnSync('docker', ['exec', container, 'caddy', 'reload',
    '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'],
  { encoding: 'utf8', timeout: 20000 })
  assert.equal(result.status, 0, 'authentic Caddy reload A->B failed')
}

function realCaddyBack() {
  const previous=fs.readFileSync(commonFile,'utf8')
  assert(previous.includes('reverse_proxy 127.0.0.1:'+goBPort),
    'real live Go B upstream missing before rollback')
  const candidate=previous.replaceAll('reverse_proxy 127.0.0.1:'+goBPort,
    'reverse_proxy 127.0.0.1:'+goBackPort)
  assert.notEqual(previous,candidate)
  fs.writeFileSync(commonFile,candidate)
  const result=spawnSync('docker',['exec',container,'caddy','reload',
    '--config','/etc/caddy/Caddyfile','--adapter','caddyfile'],
    {encoding:'utf8',timeout:20000})
  assert.equal(result.status,0,'genuine Caddy B->A2 reload failed')
}
async function startNativeOldGoA2() {
  const privateDir=fs.realpathSync(env.XD_PWA_HOT_UPLOAD_PRIVATE_ROOT)
  const outputFile=path.join(privateDir,'private-old-go-restart.log')
  const fd=fs.openSync(outputFile,'a',0o600)
  let child
  try{
    child=spawn(env.XD_PWA_HOT_UPLOAD_A_SERVER,[],{
      env:{...env,XD_LISTEN_ADDR:'127.0.0.1:'+goBackPort},
      stdio:['ignore',fd,fd]
    })
  }finally{fs.closeSync(fd)}
  const deadline=Date.now()+30000
  while(Date.now()<deadline){
    if(child.exitCode!==null||child.signalCode!==null)
      throw Error('native immutable old Go binary rejected current migrated DB')
    try{
      const res=await fetch('http://127.0.0.1:'+goBackPort+'/api/v1/readyz',
        {signal:AbortSignal.timeout(1200)})
      if(res.ok)return child
    }catch{}
    await sleep(150)
  }
  child.kill('SIGTERM')
  throw Error('rolled-back production Go A failed readiness on B schema')
}
function publishWebA() {
  const publicDir=env.XD_PWA_HOT_UPLOAD_PUBLIC
  for(const name of ['index.html','sw.js']){
    const old=fs.readFileSync(path.join(env.XD_PWA_HOT_UPLOAD_A_DIST,name))
    const newBytes=fs.readFileSync(path.join(env.XD_PWA_HOT_UPLOAD_B_DIST,name))
    const target=path.join(publicDir,name)
    assert.notEqual(digest(old),digest(newBytes),'real independent releases required')
    assert.equal(digest(fs.readFileSync(target)),digest(newBytes),
      'public B bytes changed before immutable archive rollback')
    const tmp=target+'.cr01b2-reverse.tmp'
    fs.writeFileSync(tmp,old,{flag:'wx',mode:0o644})
    fs.renameSync(tmp,target)
    assert.equal(digest(fs.readFileSync(target)),digest(old))
  }
}
async function verifyRolledBackOwner(page,proof) {
  return page.evaluate(async({nodeID,uploadID})=>{
    const jwt=localStorage.getItem('xdrive.access_token')
    if(!jwt || jwt.length<16)throw Error('original owner login lost across A->B->A')
    const headers={Authorization:'Bearer '+jwt}
    const node=await fetch('/api/v1/nodes/'+nodeID,{headers,cache:'no-store'})
    const session=await fetch('/api/v1/uploads/'+uploadID,{headers,cache:'no-store'})
    if(node.status!==200 || session.status!==200)
      throw Error('historical production Go cannot read B committed Node/upload')
    const result=await session.json()
    if(result.status!=='finalized'||!result.result || result.result.id!==nodeID)
      throw Error('old Go rollback cannot resolve original finalized file')
    return true
  },{nodeID:proof.nodeID,uploadID:proof.uploadID})
}

async function version(context, wanted) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const response = await context.request.get(origin + '/api/v1/version',
      { timeout: 3000 }).catch(() => null)
    if (response?.status() === 200) {
      const body = await response.json()
      if (body.version === wanted) return
    }
    await sleep(150)
  }
  throw new Error('genuine Caddy never served the expected Go build')
}
async function verifyDeadOldGo() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + goAPort + '/api/v1/version',
        { signal: AbortSignal.timeout(1200) })
      if (r.ok) {
        await sleep(100)
        continue
      }
    } catch {
      return
    }
    await sleep(100)
  }
  throw new Error('real Go A still serving HTTP after SIGKILL')
}
function parseLazy(dir) {
  const entries = JSON.parse(fs.readFileSync(path.join(dir, '.vite/manifest.json'), 'utf8'))
  const dynamic = Object.values(entries).filter(v => v.isDynamicEntry &&
    /^assets\/[A-Za-z0-9_./-]+-[A-Za-z0-9_-]{6,}\.js$/.test(v.file || ''))
  assert(dynamic.length > 0)
  const file = dynamic[0].file
  const bytes = fs.readFileSync(path.join(dir, file))
  return { path: '/' + file, sha: digest(bytes), bytes: bytes.length }
}

// Publish exact independent production Web B HTML/SW atomically into the real
// Caddy host-mounted static directory; historical A/B hashed chunks were
// already staged by the original official archive publisher in the shell.
function publishWebB() {
  const publicDir = env.XD_PWA_HOT_UPLOAD_PUBLIC
  for (const file of ['index.html', 'sw.js']) {
    const a = fs.readFileSync(path.join(env.XD_PWA_HOT_UPLOAD_A_DIST, file))
    const b = fs.readFileSync(path.join(env.XD_PWA_HOT_UPLOAD_B_DIST, file))
    assert.notEqual(digest(a), digest(b), 'distinct real Web releases required: ' + file)
    const dest = path.join(publicDir, file)
    assert.equal(digest(fs.readFileSync(dest)), digest(a),
      'old published A asset changed prematurely')
    const temp = dest + '.cr01a.tmp'
    fs.writeFileSync(temp, b, { flag: 'wx', mode: 0o644 })
    fs.renameSync(temp, dest)
    assert.equal(digest(fs.readFileSync(dest)), digest(b))
  }
}
async function rememberOldController(page) {
  return page.evaluate(() => {
    if (!navigator.serviceWorker.controller) return false
    window.__cr01OldDoc = document
    window.__cr01OldController = navigator.serviceWorker.controller
    window.__cr01Changes = 0
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.__cr01Changes++
    })
    return true
  })
}
async function oldWorkerStayed(page, expectWaiting) {
  return page.evaluate(async waiting => {
    const reg = await navigator.serviceWorker.getRegistration()
    return Boolean(reg?.active && navigator.serviceWorker.controller === reg.active &&
      navigator.serviceWorker.controller === window.__cr01OldController &&
      document === window.__cr01OldDoc && window.__cr01Changes === 0 &&
      Boolean(reg.waiting && reg.waiting.state === 'installed') === waiting)
  }, expectWaiting)
}
// Diagnostic-only projection: all output is fixed booleans and client label.
// Never log controller URLs, access tokens, Owner/Node/Upload IDs or paths.
// One false bit is NOT an excuse to remove or loosen the original assertion.
async function recordWorkerMismatch(page, client) {
  if (await oldWorkerStayed(page, true)) return
  const flags = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    const controller = navigator.serviceWorker.controller
    return {
      hasController: Boolean(controller),
      hasActive: Boolean(registration?.active),
      activeMatchesController: Boolean(registration?.active && controller === registration.active),
      originalControllerMatches: Boolean(controller && controller === window.__cr01OldController),
      documentMatches: Boolean(document === window.__cr01OldDoc),
      zeroControllerChanges: window.__cr01Changes === 0,
      waitingInstalled: Boolean(registration?.waiting && registration.waiting.state === 'installed'),
    }
  })
  console.error('PWA_CR01B2_SAFE_CONTROLLER_BITS ' + JSON.stringify({ client, ...flags }))
}

// The first notification of waiting=installed may race with other Chrome
// automatic update checks while two windows stay open. Observe both native
// clients until waiting is stable, but NEVER relax old controller/DOM/change
// invariants or trigger registration.update()/skipWaiting a second time.
async function waitStableTwoWindowSWWaiting(first, second) {
  const deadline = Date.now() + 20000
  let stableSince = 0
  while (Date.now() < deadline) {
    const check = async page => page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      const controller = navigator.serviceWorker.controller
      return {
        oldClientIntact: Boolean(reg?.active && controller === reg.active &&
          controller === window.__cr01OldController &&
          document === window.__cr01OldDoc && window.__cr01Changes === 0),
        waitingInstalled: Boolean(reg?.waiting && reg.waiting.state === 'installed'),
        updating: Boolean(reg?.installing),
      }
    })
    const [a, b] = await Promise.all([check(first), check(second)])
    if (!a.oldClientIntact || !b.oldClientIntact) {
      await recordWorkerMismatch(first, 'first')
      await recordWorkerMismatch(second, 'second')
      throw Error('native old SW controller or document changed during update')
    }
    if (a.waitingInstalled && b.waitingInstalled) {
      if (!stableSince) stableSince = Date.now()
      if (Date.now() - stableSince >= 600) return
    } else stableSince = 0
    await sleep(100)
  }
  await recordWorkerMismatch(first, 'first')
  await recordWorkerMismatch(second, 'second')
  throw Error('new production SW never maintained stable waiting in two old controlled windows')
}

async function waitWaiting(page) {
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    return Boolean(reg?.active && reg.waiting &&
      reg.waiting.state === 'installed' &&
      navigator.serviceWorker.controller === reg.active)
  }, null, { timeout: 60000 })
}
async function waitNewActive(page) {
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    return Boolean(reg?.active && !reg.waiting &&
      navigator.serviceWorker.controller === reg.active)
  }, null, { timeout: 60000 })
}

async function phaseA(page) {
  return page.evaluate(async () => {
    const size = 17 * 1024 * 1024
    const chunk = 8 * 1024 * 1024
    const data = new Uint8Array(size)
    for (let i = 0; i < size; i++) data[i] = (i * 31 + (i >> 7)) % 251
    const toHash = async input => Array.from(new Uint8Array(
      await crypto.subtle.digest('SHA-256', input)
    )).map(x => x.toString(16).padStart(2, '0')).join('')
    const entire = await toHash(data)
    const token = localStorage.getItem('xdrive.access_token')
    if (!token || token.length < 16) throw new Error('actual owner login required')
    const rootResponse = await fetch('/api/v1/nodes/root',
      { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' })
    if (!rootResponse.ok) throw new Error('owner root unavailable on Go A')
    const root = await rootResponse.json()
    const key = 'pwa-b2b2b2-17m-hot'
    const descriptor = {
      parent_id: root.id, name: 'pwa-b2b2b2-hot-upload.bin',
      size, chunk_size: chunk, sha256: entire, resume_key: key,
      conflict_policy: 'fail'
    }
    const init = await fetch('/api/v1/uploads', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json' },
      body: JSON.stringify(descriptor), cache: 'no-store'
    })
    if (init.status !== 201) throw new Error('new real upload session not created on Go A')
    const session = await init.json()
    if (!session.id || session.status !== 'active' || session.chunk_count !== 3)
      throw new Error('real initial upload session contract invalid')
    const first = data.subarray(0, chunk)
    const firstHash = await toHash(first)
    const response = await fetch('/api/v1/uploads/' + session.id + '/chunks/0', {
      method: 'PUT', headers: { Authorization: 'Bearer ' + token,
        'X-Chunk-SHA256': firstHash, 'Content-Type': 'application/octet-stream' },
      body: first, cache: 'no-store'
    })
    if (response.status !== 201) throw new Error('real first 8MiB chunk not committed')
    const part = await response.json()
    if (part.index !== 0 || part.size !== chunk || part.sha256 !== firstHash)
      throw new Error('first physical chunk response invalid')
    const status = await fetch('/api/v1/uploads/' + session.id, {
      headers: { Authorization: 'Bearer ' + token }, cache: 'no-store'
    })
    if (!status.ok) throw new Error('original Go A upload status missing')
    const snapshot = await status.json()
    if (snapshot.received_chunks?.length !== 1 ||
      snapshot.received_chunks[0].index !== 0 ||
      snapshot.received_chunks[0].sha256 !== firstHash)
      throw new Error('first upload chunk metadata not durably recorded on Go A')
    window.__pwaHotUpload = { bytes: data, token, descriptor,
      sessionId: session.id, entire, firstHash, rootId: root.id }
    return { firstCommitted: true, chunkCount: session.chunk_count }
  })
}

// Hold the SECOND real 8MiB PUT in-flight at the actual Chrome request-body
// producer after sending 512KiB. Release only after two-window SW waiting.
async function beginNativeStreamedChunk(page) {
  return page.evaluate(async()=>{
    const state=window.__pwaHotUpload
    if(!state || localStorage.getItem('xdrive.access_token')!==state.token)
      throw Error('original Owner session lost')
    if(window.__pwaLiveChunk)throw Error('duplicate pending PUT')
    const chunk=8*1024*1024,prefix=512*1024
    const bytes=state.bytes.subarray(chunk,2*chunk)
    if(bytes.length!==chunk)throw Error('source bytes missing')
    const hash=Array.from(new Uint8Array(
      await crypto.subtle.digest('SHA-256',bytes)
    )).map(v=>v.toString(16).padStart(2,'0')).join('')
    state.chunk1Hash=hash
    let release
    const locked=new Promise(resolve=>{release=resolve})
    const body=new ReadableStream({
      start(controller){controller.enqueue(bytes.slice(0,prefix))},
      async pull(controller){
        await locked
        controller.enqueue(bytes.slice(prefix))
        controller.close()
      }
    })
    const pending={done:false,release,completion:null}
    window.__pwaLiveChunk=pending
    pending.completion=fetch('/api/v1/uploads/'+state.sessionId+'/chunks/1',{
      method:'PUT',duplex:'half',cache:'no-store',
      headers:{Authorization:'Bearer '+state.token,
        'Content-Type':'application/octet-stream','X-Chunk-SHA256':hash},
      body
    }).then(async response=>{
      pending.done=true
      if(response.status!==201)throw Error('real streamed chunk commit rejected')
      const part=await response.json()
      if(part.index!==1 || part.sha256!==hash || part.size!==chunk)
        throw Error('streamed chunk failed Go SHA/size proof')
      return true
    },error=>{pending.done=true;throw error})
    pending.completion.catch(()=>{})
    return {prefixSentToStream:true,pending:!pending.done}
  })
}
async function requireInFlight(page) {
  assert(await page.evaluate(()=>window.__pwaLiveChunk?.done===false),
    'streaming upload unexpectedly completed before candidate waiting')
}
async function finishNativeStreamedChunk(page) {
  return page.evaluate(async()=>{
    const p=window.__pwaLiveChunk
    if(!p || p.done)throw Error('real Go PUT no longer pending')
    p.release()
    return p.completion
  })
}

async function phaseB(page) {
  return page.evaluate(async () => {
    const state = window.__pwaHotUpload
    if (!state || state.bytes.length !== 17 * 1024 * 1024 ||
      localStorage.getItem('xdrive.access_token') !== state.token)
      throw new Error('original browser page, buffer or JWT changed')
    const auth = { Authorization: 'Bearer ' + state.token }
    const id = state.sessionId
    const existing = await fetch('/api/v1/uploads/' + id,
      { headers: auth, cache: 'no-store' })
    if (existing.status !== 200) throw new Error('Go B cannot read Go A original session')
    const snapshot = await existing.json()
    if (snapshot.status !== 'active' || snapshot.received_chunks?.length !== 2 ||
      snapshot.received_chunks[0].index !== 0 ||
      snapshot.received_chunks[0].sha256 !== state.firstHash ||
      snapshot.received_chunks[1].index !== 1 ||
      snapshot.received_chunks[1].sha256 !== state.chunk1Hash)
      throw new Error('Go B did not preserve original committed first chunk')
    const resume = await fetch('/api/v1/uploads', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(state.descriptor), cache: 'no-store'
    })
    if (resume.status !== 200) throw new Error('real upload resume lookup failed')
    const reused = await resume.json()
    if (reused.id !== id || reused.received_chunks?.length !== 2 ||
      reused.received_chunks[0].index !== 0 || reused.received_chunks[1].index !== 1)
      throw new Error('real resumed upload session ID/chunk0 changed')
    const chunk = 8 * 1024 * 1024
    for (let i = 2; i < 3; i++) {
      const bytes = state.bytes.subarray(i * chunk, Math.min((i + 1) * chunk, state.bytes.length))
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
        .map(x => x.toString(16).padStart(2, '0')).join('')
      const response = await fetch('/api/v1/uploads/' + id + '/chunks/' + i, {
        method: 'PUT',
        headers: { ...auth, 'X-Chunk-SHA256': hash,
          'Content-Type': 'application/octet-stream' },
        body: bytes, cache: 'no-store'
      })
      if (response.status !== 201) throw new Error('Go B real chunk upload failed')
      const part = await response.json()
      if (part.index !== i || part.sha256 !== hash || part.size !== bytes.length)
        throw new Error('Go B confirmed incorrect physical chunk hash/length')
    }
    const final = await fetch('/api/v1/uploads/' + id + '/finalize',
      { method: 'POST', headers: auth, cache: 'no-store' })
    if (final.status !== 200) throw new Error('Go B durable upload finalize failed')
    const answer = await final.json()
    if (answer.status !== 'finalized' || !answer.result?.id ||
      answer.sha256 !== state.entire)
      throw new Error('Go B finalized mismatched upload or absent Node')
    const query = await fetch('/api/v1/nodes/' + answer.result.id,
      { headers: auth, cache: 'no-store' })
    if (query.status !== 200) throw new Error('Go B new physical Node unreadable')
    const repeated = await fetch('/api/v1/uploads/' + id + '/finalize',
      { method: 'POST', headers: auth, cache: 'no-store' })
    if (repeated.status !== 200) throw new Error('idempotent finalize must be safe')
    const second = await repeated.json()
    if (second.result?.id !== answer.result.id || second.sha256 !== state.entire)
      throw new Error('duplicate finalize unexpectedly changed File/Node')
    const again = await fetch('/api/v1/uploads', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(state.descriptor), cache: 'no-store'
    })
    if (again.status !== 200 || (await again.json()).id !== id)
      throw new Error('post-finalize resume key must not create duplicate upload')
    return { sameOriginalID: true, onlyNewChunksOnB: true,
      idempotentFinalize: true, byteCount: state.bytes.length,
      // Kept only in Node process memory, never summary.json or CI logs.
      nodeID: answer.result.id, uploadID: id }
  })
}
async function checkPublicCache(page) {
  const paths = await page.evaluate(async () => {
    const paths = []
    for (const name of await caches.keys()) {
      const c = await caches.open(name)
      for (const r of await c.keys()) paths.push(new URL(r.url).pathname)
    }
    return paths
  })
  assert(paths.includes('/index.html'))
  assert(!paths.some(p => p.startsWith('/api/') ||
    /upload|download|token|media\/items/.test(p)), 'SW leaked private files')
}
async function main() {
  let oldGoA2=null
  let browser
  const watchdog=setTimeout(()=>{
    // Fixed, anonymous phase label only. No JWT, URL, username, or file path.
    console.error('PWA_CR01B2_SAFE_WATCHDOG phase='+safePhase)
    process.exit(1)
  },8*60*1000)
  watchdog.unref()
  try {
    assert(/^[a-f0-9]{40}$/.test(summary.sourceA))
    assert(/^[a-f0-9]{40}$/.test(summary.sourceB))
    assert.notEqual(summary.sourceA, summary.sourceB)
    const a = parseLazy(env.XD_PWA_HOT_UPLOAD_A_DIST)
    const b = parseLazy(env.XD_PWA_HOT_UPLOAD_B_DIST)
    browser = await chromium.launch({ executablePath: env.XDRIVE_BROWSER_EXECUTABLE,
      headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'] })
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true,
      hasTouch: true, serviceWorkers: 'allow', ignoreHTTPSErrors: true
    })
    const page = await context.newPage()
    page.setDefaultTimeout(30000)
    await version(context, 'pwa-b2b2b2-A')
    for (const asset of [a, b]) {
      const response = await context.request.get(origin + asset.path)
      assert.equal(response.status(), 200)
      assert.match(response.headers()['cache-control'] || '', /immutable/)
      assert.match(response.headers()['content-type'] || '', /javascript|ecmascript/)
      const data = await response.body()
      assert.equal(data.length, asset.bytes)
      assert.equal(digest(data), asset.sha)
    }
    const initial = await page.goto(origin + '/#/app/files', { waitUntil: 'commit' })
    assert.equal(initial?.status(), 200)
    const negotiated=await page.evaluate(()=>performance.getEntriesByType('navigation')[0]?.nextHopProtocol || '')
    assert.equal(negotiated,'h2','real browser streaming PUT requires TLS HTTP/2')
    summary.realBrowserH2=true
    await page.locator('#web-login-username').waitFor({ state: 'visible', timeout: 30000 })
    await page.locator('#web-login-username').fill('pwa-b2b2b1-owner')
    await page.locator('#web-login-password').fill('Pwa-B2b2b1-Synthetic-Only_2026!')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.waitForFunction(() =>
      (localStorage.getItem('xdrive.access_token') || '').length > 16)
    safePhase='wait-primary-native-public-SW'
    await page.waitForLoadState('load',{timeout:30000})
    await page.waitForFunction(async()=>{
      const reg=await navigator.serviceWorker.getRegistration()
      return Boolean(reg?.active)
    },null,{timeout:30000,polling:200})
    const controlledReload = await page.reload({ waitUntil: 'commit' })
    assert.equal(controlledReload?.status(), 200)
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null,
      { timeout: 30000 })
    const initialControl = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || '')
    assert(initialControl.endsWith('/sw.js'), 'original Service Worker must control the old Web tab')
    // Two actual controlled tabs must remain alive throughout the active
    // 17 MiB Owner upload session and candidate SW waiting period.
    safePhase = 'open-second-controlled-window'
    const peer = await context.newPage()
    peer.setDefaultTimeout(30000)
    const peerResponse = await peer.goto(origin + '/#/app/files', { waitUntil: 'commit' })
    assert.equal(peerResponse?.status(), 200)
    safePhase='wait-peer-native-public-SW'
    await peer.waitForLoadState('load',{timeout:30000})
    await peer.waitForFunction(async()=>{
      const reg=await navigator.serviceWorker.getRegistration()
      return Boolean(reg?.active)
    },null,{timeout:30000,polling:200})
    await peer.reload({ waitUntil: 'commit' })
    await peer.waitForFunction(() => Boolean(navigator.serviceWorker.controller),
      null, { timeout: 30000 })
    assert(await rememberOldController(page))
    assert(await rememberOldController(peer))
    assert(await oldWorkerStayed(page, false))
    assert(await oldWorkerStayed(peer, false))
    safePhase = 'real-Go-A-first-8MiB-upload'
    const sentA = await phaseA(page)
    assert(sentA.firstCommitted && sentA.chunkCount === 3)
    summary.first8MiBCommittedBeforeGoDeath = true
    // Independent Node controller terminates the actual native Go A process.
    safePhase = 'kill-native-Go-A'
    process.kill(pidA, 'SIGKILL')
    await verifyDeadOldGo()
    summary.actualGoASigkill = true
    // Before native Caddy reload this upstream cannot fake an API success.
    const interrupted = await context.request.get(origin + '/api/v1/version',
      { timeout: 5000 })
    assert.equal(interrupted.status(), 502, 'dead Go A must be surfaced as proxy failure')
    safePhase = 'real-Caddy-reload-Go-B'
    realCaddyB()
    summary.realCaddyReload = true
    await version(context, 'pwa-b2b2b2-B')
    safePhase='open-authentic-Go-B-streaming-PUT'
    const streaming=await beginNativeStreamedChunk(page)
    assert(streaming.prefixSentToStream&&streaming.pending)
    const physicalPrefix=await awaitPartialGoChunk()
    assert(physicalPrefix>=256*1024 && physicalPrefix<8*1024*1024)
    await requireInFlight(page)
    summary.nativeInFlightPut=true
    summary.goReadPartialBytes=true
    // Go B is now running, original browser upload session remains active
    // with chunk 0 committed. Publish genuine new Vite/SW B while two old
    // windows are still open. No force activation, no page reload.
    safePhase = 'publish-two-real-Web-B-assets'
    publishWebB()
    safePhase = 'register-and-wait-new-SW'
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      if (!reg) throw Error('Old production SW registration missing')
      await reg.update()
    })
    await waitWaiting(page)
    await waitStableTwoWindowSWWaiting(page, peer)
    await requireInFlight(page)
    const duringWaiting=partialGoChunkBytes()
    assert(duringWaiting>=256*1024 && duringWaiting<8*1024*1024)
    summary.waitingOverlappedInFlight=true
    await recordWorkerMismatch(page, 'first')
    await recordWorkerMismatch(peer, 'second')
    assert(await oldWorkerStayed(page, true), 'first window controller replaced')
    assert(await oldWorkerStayed(peer, true), 'second window controller replaced')
    summary.realUploadSessionActiveWhileWaiting = true
    summary.oldSWWaitingVerified = true
    summary.twoOldWindowsStayedControlled = true
    const privateResponse = await page.evaluate(async () =>
      (await fetch('/api/v1/nodes/root', { cache: 'no-store' })).status)
    assert.equal(privateResponse, 401, 'private API cannot leak past public SW')
    safePhase='release-original-8MiB-HTTP-PUT'
    assert(await finishNativeStreamedChunk(page))
    summary.streamedChunkCommitted=true
    assert(await oldWorkerStayed(page,true))
    assert(await oldWorkerStayed(peer,true))
    safePhase = 'resume-finish-Go-B-17MiB'
    const sentB = await phaseB(page)
    assert.equal(sentB.byteCount, 17 * 1024 * 1024)
    summary.originalUploadSessionReused = sentB.sameOriginalID
    summary.originalChunk0NeverReuploaded = sentB.onlyNewChunksOnB
    summary.originalJWTReused = true
    summary.actualHttpFileChunks = sentB.idempotentFinalize
    assert.equal(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || ''),
      initialControl)
    assert(await oldWorkerStayed(page, true))
    assert(await oldWorkerStayed(peer, true))
    summary.oldDocumentStayedMounted = true
    await checkPublicCache(page)
    safePhase = 'close-two-old-windows-and-activate'
    await peer.close()
    await page.close()
    // Only after both old-controlled clients close can the actual candidate
    // worker promote. Reopen same Origin, without skipWaiting/reload tricks.
    const fresh = await context.newPage()
    const opened = await fresh.goto(origin + '/#/app/files', { waitUntil: 'commit' })
    assert.equal(opened?.status(), 200)
    await waitNewActive(fresh)
    await checkPublicCache(fresh)
    await fresh.close()
    summary.newSWActivatedOnlyAfterBothClosed = true

    // After B actually finalized the same 17MiB file, re-enter a genuinely
    // independent OLD production Go A binary against B's same SQL/CAS schema.
    // A schema regression must fail rather than pass with a mocked B server.
    safePhase='start-immutable-old-production-Go-on-B-schema'
    oldGoA2=await startNativeOldGoA2()
    summary.physicalOldGoReentered=true
    safePhase='real-B-to-A-Caddy-upstream-reload'
    realCaddyBack()
    await version(context,'pwa-b2b2b2-A')
    summary.bToARollbackProven=true
    // Public release A hashed chunks must survive B publishing and rollback.
    safePhase='verify-old-hashed-lazy-js-survives-upgrade'
    const oldChunk=await context.request.get(origin+a.path)
    assert.equal(oldChunk.status(),200)
    assert.match(oldChunk.headers()['cache-control']||'',/immutable/)
    assert.equal(digest(await oldChunk.body()),a.sha)
    summary.rollbackHistoricalChunkBytesMatch=true
    safePhase='publish-original-public-Web-A'
    publishWebA()
    const returnedSW=await context.request.get(origin+'/sw.js')
    assert.equal(returnedSW.status(),200)
    assert.equal(digest(await returnedSW.body()),
      digest(fs.readFileSync(path.join(env.XD_PWA_HOT_UPLOAD_A_DIST,'sw.js'))))
    // Two B-controlled windows must not be displaced while A returns waiting.
    safePhase='watch-two-B-windows-during-reverse-worker-waiting'
    const backB=await context.newPage()
    backB.setDefaultTimeout(30000)
    await backB.goto(origin+'/#/app/files',{waitUntil:'domcontentloaded',timeout:30000})
    await backB.waitForFunction(()=>Boolean(navigator.serviceWorker.controller),
      null,{timeout:30000})
    const backPeer=await context.newPage()
    backPeer.setDefaultTimeout(30000)
    await backPeer.goto(origin+'/#/app/files',{waitUntil:'domcontentloaded',timeout:30000})
    await backPeer.waitForFunction(()=>Boolean(navigator.serviceWorker.controller),
      null,{timeout:30000})
    assert(await rememberOldController(backB))
    assert(await rememberOldController(backPeer))
    assert(await oldWorkerStayed(backB,false))
    assert(await oldWorkerStayed(backPeer,false))
    await backB.evaluate(async()=>{
      const registration=await navigator.serviceWorker.getRegistration()
      if(!registration)throw Error('original production registration missing')
      await registration.update()
    })
    await waitWaiting(backB)
    await waitStableTwoWindowSWWaiting(backB,backPeer)
    assert(await oldWorkerStayed(backB,true))
    assert(await oldWorkerStayed(backPeer,true))
    summary.reverseSWWaitingStable=true
    summary.oldBWindowsNotReplaced=true
    await backPeer.close()
    await backB.close()
    const backA=await context.newPage()
    const accepted=await backA.goto(origin+'/#/app/files',{waitUntil:'domcontentloaded'})
    assert.equal(accepted?.status(),200)
    await waitNewActive(backA)
    assert(await verifyRolledBackOwner(backA,{
      nodeID:sentB.nodeID,uploadID:sentB.uploadID
    }))
    summary.nativeOldGoCanReadCommittedFile=true
    await checkPublicCache(backA)
    await backA.close()
    summary.oldSWReactivatedOnlyAfterClientsClose=true
    safePhase = 'complete'
    summary.passed = true
    console.log('PWA_CR01B2_REAL_UPLOAD_TWO_WINDOW_WAITING_AND_GO_SWITCH_PASSED')
    await context.close()
  } catch (error) {
    summary.errorClass = (error?.name || 'Error').replace(/[^A-Za-z0-9]/g, '').slice(0, 50)
    // Don't serialize JWT, session IDs, owner names or browser URLs.
    const frame = String(error?.stack || '').match(/pwa-cr01b2-reverse-rollback\.cjs:(\d+):(\d+)/)
    summary.failurePhase = safePhase
    summary.failureSourceLine = frame ? Number(frame[1]) : null
    // Fixed source line/phase only, NEVER emit arbitrary error.message,
    // JWT, file name, private URL, CAS key, Profile path or Go logs.
    console.error('PWA_CR01B2_SAFE_FAILURE ' + summary.errorClass +
      ' phase=' + safePhase + ' line=' + String(summary.failureSourceLine))
    process.exitCode = 1
  } finally {
    clearTimeout(watchdog)
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
    await browser?.close()
    if(oldGoA2)oldGoA2.kill('SIGTERM')
  }
}
void main()

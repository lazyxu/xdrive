'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const https = require('node:https')
const {
  startViewerFirstFrameHTTPSProxy,
  installPinnedViewerFixtureCertificate,
} = require('../scripts/viewer-first-frame-https-proxy.cjs')

test('ephemeral HTTPS forwards real Owner proof and partial signed H264 Range', async () => {
  const requests = []
  const upstream = http.createServer((req, res) => {
    requests.push({ method:req.method, range:req.headers.range, auth:req.headers.authorization })
    if (req.url === '/api/v1/me' && req.headers.authorization === 'Bearer fixture-owner') {
      res.writeHead(200, { 'Content-Type':'application/json' })
      res.end('{"username":"fixture-owner"}')
    } else if (req.url === '/api/v1/file-preview/8?ticket=fixture-token' &&
               req.headers.range === 'bytes=0-3') {
      res.writeHead(206, { 'Content-Type':'video/mp4', 'Content-Range':'bytes 0-3/8',
        'Content-Length':'4', 'Accept-Ranges':'bytes' })
      res.end(Buffer.from([0,1,2,3]))
    } else {
      res.writeHead(404).end()
    }
  })
  await new Promise(resolve => upstream.listen(0,'127.0.0.1',resolve))
  let fixture
  try {
    fixture = await startViewerFirstFrameHTTPSProxy('http://127.0.0.1:' + upstream.address().port)
    let verifier
    installPinnedViewerFixtureCertificate({ setCertificateVerifyProc(fn) { verifier=fn } },fixture)
    const verdict=(hostname,certificatePEM,displayFingerprint)=>{
      let code
      verifier({hostname,certificate:{data:certificatePEM,fingerprint:displayFingerprint}},v=>{code=v})
      return code
    }
    assert.match(fixture.fingerprint,/^(?:[0-9a-f]{2}:){31}[0-9a-f]{2}$/)
    assert.equal(verdict('127.0.0.1',fixture.certificatePEM,'wrong-electron-display-hash'),0)
    assert.equal(verdict('untrusted.example',fixture.certificatePEM),-3)
    assert.equal(verdict('127.0.0.1','invalid PEM',fixture.fingerprint),-2,
      'a forged display fingerprint must never substitute for pinned certificate data')
    const alternate = await startViewerFirstFrameHTTPSProxy(
      'http://127.0.0.1:' + upstream.address().port)
    try {
      assert.notEqual(alternate.fingerprint,fixture.fingerprint)
      assert.equal(verdict('127.0.0.1',alternate.certificatePEM),-2,
        'another self-signed loopback leaf must be rejected, not globally trusted')
    } finally { await alternate.close() }
    const read=(endpoint,headers)=>new Promise((resolve,reject)=>{
      // The independent Node test client alone permits this one self-signed
      // fixture certificate; the product Electron session must PIN its hash.
      const request=https.get(fixture.origin+endpoint,
        {rejectUnauthorized:false,headers},response=>{
          const chunks=[]
          response.on('data',chunk=>chunks.push(chunk))
          response.on('end',()=>resolve({status:response.statusCode,
            headers:response.headers, body:Buffer.concat(chunks)}))
        })
      request.once('error',reject)
    })
    const owner=await read('/api/v1/me',{Authorization:'Bearer fixture-owner'})
    assert.equal(owner.status,200)
    const video=await read('/api/v1/file-preview/8?ticket=fixture-token',{Range:'bytes=0-3'})
    assert.equal(video.status,206)
    assert.equal(video.headers['content-range'],'bytes 0-3/8')
    assert.deepEqual([...video.body],[0,1,2,3])
    assert.deepEqual(requests.map(r=>r.range||''),['','bytes=0-3'])
    assert.equal(requests[0].auth,'Bearer fixture-owner')
  } finally {
    if (fixture) await fixture.close()
    await new Promise(resolve=>upstream.close(resolve))
  }
})
test('HTTPS test proxy rejects non-loopback and nested upstream origins',async()=>{
  await assert.rejects(()=>startViewerFirstFrameHTTPSProxy('http://example.com:8090'),/non-loopback/)
  await assert.rejects(()=>startViewerFirstFrameHTTPSProxy('https://127.0.0.1:8090'),/Go HTTP/)
  await assert.rejects(()=>startViewerFirstFrameHTTPSProxy('http://127.0.0.1:8090/not-root'),/exact fresh Go/)
})

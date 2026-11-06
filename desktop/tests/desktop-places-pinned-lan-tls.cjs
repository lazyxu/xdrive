'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const os=require('node:os')
const tls=require('node:tls')
const {createHash,X509Certificate}=require('node:crypto')
const {spawnSync}=require('node:child_process')
const {
  readTrustedPlacesLANPeerFingerprint, verifyDesktopPlacesLANCertificate,
  placesGuestIPRequestAllowed,
}=require('../dist/main/places_guest_lan_tls.cjs')

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xdrive-places-ca-'))
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  const args=[
    ['req','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj','/CN=xDrive Places test root',
      '-addext','basicConstraints=critical,CA:TRUE',
      '-addext','keyUsage=critical,keyCertSign,cRLSign',
      '-keyout','root.key','-out','root.pem'],
    ['req','-new','-nodes','-newkey','rsa:2048','-subj','/CN=xDrive Places server',
      '-keyout','server.key','-out','server.csr'],
  ]
  for (const cmd of args) {
    const p=spawnSync('openssl',cmd,{cwd:dir,encoding:'utf8'})
    assert.equal(p.status,0,p.stderr)
  }
  fs.writeFileSync(path.join(dir,'extensions.cnf'),
    'basicConstraints=critical,CA:FALSE\n'+
    'keyUsage=critical,digitalSignature,keyEncipherment\n'+
    'extendedKeyUsage=serverAuth\n'+
    'subjectAltName=IP:127.0.0.1,IP:192.168.1.20\n')
  const signed=spawnSync('openssl',[
    'x509','-req','-in','server.csr','-CA','root.pem','-CAkey','root.key',
    '-CAcreateserial','-out','server.pem','-days','1','-extfile','extensions.cnf',
  ],{cwd:dir,encoding:'utf8'})
  assert.equal(signed.status,0,signed.stderr)
  const ca=fs.readFileSync(path.join(dir,'root.pem'),'utf8')
  const leaf=fs.readFileSync(path.join(dir,'server.pem'),'utf8')
  const key=fs.readFileSync(path.join(dir,'server.key'),'utf8')
  const fingerprint=createHash('sha256').update(new X509Certificate(leaf).raw).digest('hex')
  const sha256=createHash('sha256').update(new X509Certificate(ca).raw).digest('hex')
  return {ca,leaf,key,fingerprint,sha256}
}

test('Places guest blocks all non-current literal-IP origins, including loopback and other ports',()=>{
  const origin='https://192.168.1.20:8443'
  for(const url of [
    'https://192.168.1.20:9443/file','https://192.168.1.21:8443/file',
    'http://192.168.1.20:8443/file','http://127.0.0.1:1234/',
    'https://[::1]:8443/','file:///etc/hosts',
    'http://api.map.baidu.com/api','ws://127.0.0.1:9000/',
    'https://localhost:8443/','https://service.local:8443/',
  ]) assert.equal(placesGuestIPRequestAllowed(url,origin),false,url)
  assert.equal(placesGuestIPRequestAllowed(origin+'/api/v1/version',origin),true)
  assert.equal(placesGuestIPRequestAllowed('https://api.map.baidu.com/api',origin),true)
  assert.equal(placesGuestIPRequestAllowed('https://192.168.1.20:8443/',null),false)
})

test('browser certificate override is exact CA+IP+live Owner and never accepts other errors', {
  skip: spawnSync('openssl',['version']).status!==0,
},async t=>{
  const f=fixture(t),origin='https://192.168.1.20:8443'
  const pin={server:origin,username:'',domain:'',source:'user-approved-lan',
    root_pem:f.ca,sha256:f.sha256}
  const current=()=>true,good={hostname:'192.168.1.20',errorCode:-202,
    certificate:{data:f.leaf}}
  const approved=()=>Promise.resolve(f.fingerprint)
  assert.equal(await verifyDesktopPlacesLANCertificate(good,pin,origin,current,approved),0)
  assert.equal(await verifyDesktopPlacesLANCertificate(good,pin,origin,()=>false,approved),-2)
  assert.equal(await verifyDesktopPlacesLANCertificate(good,pin,origin,current,async()=>null),-2)
  assert.equal(await verifyDesktopPlacesLANCertificate(good,pin,origin,current,
    async()=>('0'.repeat(64))),-2)
  assert.equal(await verifyDesktopPlacesLANCertificate({...good,errorCode:-206},
    pin,origin,current,approved),-2)
  assert.equal(await verifyDesktopPlacesLANCertificate({...good,errorCode:-201},
    pin,origin,current,approved),-2)
  assert.equal(await verifyDesktopPlacesLANCertificate({...good,hostname:'192.168.1.21'},
    pin,origin,current,approved),-3)
  assert.equal(await verifyDesktopPlacesLANCertificate({...good,certificate:{data:''}},
    pin,origin,current,approved),-2)
  assert.equal(await verifyDesktopPlacesLANCertificate(good,{...pin,sha256:'0'.repeat(64)},
    origin,current,approved),-2)
  assert.equal(await verifyDesktopPlacesLANCertificate(good,{...pin,server:'https://192.168.1.20:9443'},
    origin,current,approved),-2)
})

test('native TLS probe checks the actual leaf against the pinned CA and IP SAN', {
  skip:spawnSync('openssl',['version']).status!==0,
},async t=>{
  const f=fixture(t)
  const server=tls.createServer({key:f.key,cert:f.leaf},socket=>socket.end())
  await new Promise((resolve,reject)=>{
    server.once('error',reject)
    server.listen(0,'127.0.0.1',resolve)
  })
  t.after(()=>new Promise(resolve=>server.close(resolve)))
  const port=server.address().port
  assert.equal(await readTrustedPlacesLANPeerFingerprint('127.0.0.1',port,f.ca),
    f.fingerprint)
  assert.equal(await readTrustedPlacesLANPeerFingerprint('127.0.0.2',port,f.ca),null)
  assert.equal(await readTrustedPlacesLANPeerFingerprint('not-ip',port,f.ca),null)
  assert.equal(await readTrustedPlacesLANPeerFingerprint('127.0.0.1',port,
    f.ca.replace('CERTIFICATE','NOT-CERTIFICATE')),null)
})

'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const sourcePath = 'ui/shared/src/mui/SynologyOwnerGallerySource.ts'
const source = fs.readFileSync(path.join(root, sourcePath), 'utf8')
const moduleRef = { exports: {} }
const diagnostics = ts.transpileModule(source, {
  fileName: sourcePath, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal(diagnostics.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error).length ?? 0, 0)
const revoked = []
const published = []
const urls = {
  createObjectURL: blob => { published.push(blob); return 'blob:dsm-motion-' + published.length },
  revokeObjectURL: url => revoked.push(url),
}
new Function('module','exports','require','URL','Blob',diagnostics.outputText)(
  moduleRef,moduleRef.exports,
  name => {
    if (name === '../synology-media-stream') return {
      xDriveSynologyPlaybackMIME: () => null,
      xDriveSynologyLoadNativeMediaStream: async () => { throw Error('video stream is independent') },
    }
    if (name === '../synology-media-preview') return {
      xDriveSynologyPreviewMIME: () => null,
      xDriveSynologyLoadBoundedMediaPreview: async () => { throw Error('image read forbidden') },
    }
    if (name === '../synology-owner-thumbnail') return {
      xDriveSynologyLoadOwnerThumbnail: async () => { throw Error('thumbnail read forbidden') },
    }
    throw Error('unexpected DSM Gallery import ' + name)
  },urls,Blob,
)
const create=moduleRef.exports.createXDriveSynologyOwnerGallerySource
const payload=Uint8Array.from([0,0,0,20,102,116,121,112,105,115,111,109,4,3,2,1])
const digest=crypto.createHash('sha256').update(payload).digest('hex')
const item=(revision=7)=>({
  node:{id:42,parent_id:17,name:'still.livp',type:'file',size:400,
    revision,created_at:'2026-10-29T00:00:00Z',updated_at:'2026-10-29T00:00:00Z'},
  metadata:{media_kind:'image',index_state:'ready',has_thumbnail:true},
  live_photo:true,favorite:false,
})
function client() {
  let revision=7
  const calls=[]
  const output={
    calls,
    setRevision: value => {revision=value},
    ownerGalleryItemsRange: async (_k,limit,offset)=>({
      items:offset?[]:[item(revision)],total_count:1,offset,limit,
    }),
    ownerGalleryAlbums: async ()=>[],
    ownerLivePhotoMotion: async (id, rev, signal)=>{
      calls.push({id,rev,signal})
      return {nodeID:id,revision:rev,mimeType:'video/mp4',size:payload.length,
        sha256:digest,data:payload}
    },
  }
  return output
}
test('DSM existing shared Viewer consumes exact current Live Photo motion only',async()=>{
  const local=client()
  const source=create(local)
  assert.equal(await source.loadLivePhotoMotion(42),null,'no Owner row authorization')
  await source.listItemRange(1,0)
  const progress=[]
  const url=await source.loadLivePhotoMotion(42,(...args)=>progress.push(args))
  assert.equal(url,'blob:dsm-motion-1')
  assert.equal(published.length,1)
  assert.deepEqual(local.calls.map(c=>[c.id,c.rev]),[[42,7]])
  assert.deepEqual(progress,[[payload.length,payload.length,null]])
  const aborted=new AbortController();aborted.abort()
  assert.equal(await source.loadLivePhotoMotion(42,undefined,aborted.signal),null)
  assert.equal(local.calls.length,1)
  assert.equal(await source.loadLivePhotoMotion(99),null)
})
test('DSM Live Photo rejects stale identity and invalid cryptographic bytes',async()=>{
  const local=client(),source=create(local)
  await source.listItemRange(1,0)
  let release
  local.ownerLivePhotoMotion=()=>new Promise(resolve=>{release=resolve})
  const pending=source.loadLivePhotoMotion(42)
  local.setRevision(8)
  await source.listItemRange(1,0)
  release({nodeID:42,revision:7,mimeType:'video/mp4',size:payload.length,sha256:digest,data:payload})
  assert.equal(await pending,null,'replaced current Owner must not get stale motion')
  local.ownerLivePhotoMotion=async()=>({
    nodeID:42,revision:8,mimeType:'video/mp4',size:payload.length,
    sha256:'0'.repeat(64),data:payload,
  })
  assert.equal(await source.loadLivePhotoMotion(42),null,'bad motion digest cannot publish a Blob')
  assert.equal(published.length,1)
})
test('DSM Live Photo shares original react player and requires no DSM component',()=>{
  const component=fs.readFileSync(path.join(root,'ui/shared/src/mui/MediaViewerContent.tsx'),'utf8')
  const live=fs.readFileSync(path.join(root,'ui/shared/src/mui/LivePhotoSurface.tsx'),'utf8')
  const host=fs.readFileSync(path.join(root,'web/src/synologyHost.ts'),'utf8')
  assert.match(component,/<XDriveLivePhotoSurface/)
  assert.match(component,/loadLivePhotoMotion/)
  assert.match(live,/export function XDriveLivePhotoSurface/)
  assert.match(host,/createXDriveSynologyOwnerGallerySource\(local\)/)
  assert.match(source,/loadLivePhotoMotion: async/)
  assert.doesNotMatch(source,/window\.xdriveDesktop|ipcRenderer|fetch\(|\.livp.?content/)
})

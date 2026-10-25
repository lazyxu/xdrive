'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const filename='ui/shared/src/mui/mediaPreviewStreamTeardown.ts'
const js=ts.transpileModule(read(filename),{
  fileName:filename,
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText
const m={exports:{}}
new Function('exports','module',js)(m.exports,m)
const abort=m.exports.xDriveAbortHTMLMediaElement
test('native signed preview stream is paused, detached and reset synchronously',()=>{
  const calls=[]
  abort({
    pause(){calls.push('pause')},
    removeAttribute(name){assert.equal(name,'src');calls.push('remove-src')},
    load(){calls.push('load')},
  })
  assert.deepEqual(calls,['pause','remove-src','load'])
  assert.doesNotThrow(()=>abort(null))
})
test('old browser pause failure cannot prevent signed stream from being detached',()=>{
  const calls=[]
  abort({
    pause(){calls.push('pause');throw Error('detached')},
    removeAttribute(name){assert.equal(name,'src');calls.push('remove-src')},
    load(){calls.push('load');throw Error('already removed')},
  })
  assert.deepEqual(calls,['pause','remove-src','load'])
})
test('Web/Mobile/Desktop ordinary video, audio and transformed video reuse one cleanup',()=>{
  const ordinary=read('ui/shared/src/mui/FilePreviewSurface.tsx')
  const transformed=read('ui/shared/src/mui/FilePreviewTransformedMedia.tsx')
  for(const marker of [
    "import { xDriveAbortHTMLMediaElement } from './mediaPreviewStreamTeardown'",
    'const videoStreamElementRef = useRef<HTMLVideoElement | null>(null)',
    'const audioStreamElementRef = useRef<HTMLAudioElement | null>(null)',
    'ref={videoStreamElementRef}','ref={audioStreamElementRef}',
    'useLayoutEffect(() => {',
    'return () => xDriveAbortHTMLMediaElement(media)',
    '[sourceIdentity, previewKind, previewURL, loading, failed, hasTransformedVideo]',
  ])assert.ok(ordinary.includes(marker),'ordinary shared Viewer cancel missing: '+marker)
  for(const marker of [
    "import { xDriveAbortHTMLMediaElement } from './mediaPreviewStreamTeardown'",
    'const videoRef = useRef<HTMLVideoElement | null>(null)',
    'return () => xDriveAbortHTMLMediaElement(video)',
    '}, [src])',
  ])assert.ok(transformed.includes(marker),'transformed video cancel missing: '+marker)
  assert.ok(!read(filename).includes('fetch('))
  assert.ok(!read(filename).includes('localStorage'))
})

'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  decodeVLQ, lookupMappings, sourceFamily, safeSymbol, bundleName,
  summariseCPUProfile,
} = require('../scripts/gallery-desktop-cpu-profile-analyze.cjs')

function makeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-v8-profiler-test-'))
  t.after(() => fs.rmSync(root, { recursive:true, force:true }))
  const bundle = 'index-private-test.js'
  const privateUrl = 'file:///home/private-user/photos/dist/renderer/assets/' + bundle
  fs.writeFileSync(path.join(root, bundle + '.map'), JSON.stringify({
    version:3,
    sources:['../../../ui/shared/src/mui/MediaGallery.tsx'],
    names:['XDriveMediaGalleryPage'],
    mappings:'AAAAA',
    sourcesContent:['const realPhotoToken = "secret=hidden"; export function XDriveMediaGalleryPage() {}'],
  }))
  const callFrame = (name,url,lineNumber=0,columnNumber=0) =>
    ({functionName:name,url,scriptId:'17',lineNumber,columnNumber})
  const profile = {
    nodes:[
      {id:1,callFrame:callFrame('(root)',''),children:[2,3]},
      {id:2,callFrame:callFrame('q',privateUrl),hitCount:125},
      {id:3,callFrame:callFrame('(idle)',''),hitCount:12},
    ],
    samples:[...Array(125).fill(2),...Array(12).fill(3)],
    timeDeltas:Array(137).fill(1000),
    startTime:2000000,endTime:2137000,
  }
  return {root,bundle,privateUrl,profile}
}
test('VLQ state and V3 generated column mapping have correct zero-based alignment', () => {
  assert.deepEqual(decodeVLQ('AAAAA'),[0,0,0,0,0])
  assert.deepEqual(decodeVLQ('D'),[-1])
  const map = {version:3,sources:['ui/shared/src/mui/MediaGallery.tsx'],names:['loadFirstPage'],mappings:'AAAAA'}
  const lines = lookupMappings(map,new Set([0]))
  assert.equal(lines.get(0)[0].generatedColumn,0)
  assert.equal(lines.get(0)[0].sourceIndex,0)
  assert.equal(lines.get(0)[0].originalLine,0)
  assert.equal(lines.get(0)[0].nameIndex,0)
  assert.throws(()=>decodeVLQ('%'),/VLQ/)
  assert.throws(()=>lookupMappings({version:3,sources:[],mappings:'AA'},new Set([0])),/invalid sourcemap/)
})
test('native Renderer V8 frames map to exact first-party Gallery symbols but never emit paths', t => {
  const {root,profile} = makeFixture(t)
  const result = summariseCPUProfile(profile,root)
  assert.equal(result.sampleCount,137)
  assert.equal(result.firstPartySampleCount,125)
  assert.equal(result.sourceMappedSampleFrames,1)
  assert.equal(result.topSampledCallFrames[0].family,'shared-gallery-page')
  assert.equal(result.topMappedSymbols[0].mappedSymbol,'XDriveMediaGalleryPage')
  assert.equal(result.topMappedSymbols[0].sourceLine,1)
  assert.equal(result.totalWeightedSampleMs,137)
  assert.equal(result.rawProfileArgsPathsOrURLsIncluded,false)
  assert.equal(result.rawSourceMapsIncluded,false)
  assert.equal(result.productionLogicModified,false)
  const output = JSON.stringify(result)
  for (const privateText of [
    'home/private-user','photos','secret=hidden','index-private-test',
    'file://','sourcesContent','scriptId',
  ]) {
    assert.equal(output.includes(privateText),false,'profile leaked secret or raw source: '+privateText)
  }
})
test('sourcemap first-party function symbols are allowlisted, not arbitrary credentials', t => {
  const {root,bundle,profile} = makeFixture(t)
  const file = path.join(root,bundle+'.map')
  const map = JSON.parse(fs.readFileSync(file,'utf8'))
  map.names=['passwordAccessToken']
  fs.writeFileSync(file,JSON.stringify(map))
  const result = summariseCPUProfile(profile,root)
  assert.equal(result.firstPartySampleCount,125)
  assert.equal(result.topMappedSymbols.length,0)
  assert.equal(JSON.stringify(result).includes('passwordAccessToken'),false)
  assert.equal(safeSymbol('commitRoot','react-runtime'),'commitRoot')
  assert.equal(safeSymbol('passwordToken','shared-gallery-page'),null)
  assert.equal(safeSymbol('dynamic-private-key','shared-gallery-page'),null)
  assert.equal(sourceFamily('../node_modules/react-dom/src/ReactFiberWorkLoop.js'),'react-runtime')
  assert.equal(sourceFamily('../../../ui/shared/src/mui/MediaGallery.tsx'),'shared-gallery-page')
})
test('wrong/missing map is visible as unmapped and cannot fake current first-party attribution', t => {
  const {root,bundle,privateUrl,profile} = makeFixture(t)
  fs.rmSync(path.join(root,bundle+'.map'))
  const result = summariseCPUProfile(profile,root)
  assert.equal(result.firstPartySampleCount,0)
  assert.equal(result.sourceMappedSampleFrames,0)
  assert.equal(result.topSampledCallFrames[0].family,'bundled-unmapped')
  assert.equal(bundleName(privateUrl),bundle)
  assert.equal(bundleName('https://example.com/file?token=abc'),null)
  assert.throws(()=>summariseCPUProfile({nodes:[],samples:[],timeDeltas:[]},root),/actual sampled/)
  assert.throws(()=>summariseCPUProfile({...profile,samples:Array(137).fill(999)},root),/invalid actual/)
})
test('existing production entry is reused, with fully opt-in raw-free debugger capture', () => {
  const main = fs.readFileSync(path.join(__dirname,'../scripts/gallery-desktop-real-cold-electron-main.cjs'),'utf8')
  const runner = fs.readFileSync(path.join(__dirname,'../scripts/gallery-desktop-real-cold-runner.cjs'),'utf8')
  assert.match(main,/const \{ app, contentTracing \} = require\('electron'\)/)
  assert.match(main,/XD_GALLERY_DESKTOP_COLD_CPU_PROFILE === '1'/)
  assert.match(main,/win\.webContents\.debugger\.attach\('1\.3'\)/)
  assert.match(main,/sendCommand\('Profiler\.start'\)/)
  assert.match(main,/sendCommand\('Profiler\.stop'\)/)
  assert.match(main,/win\.webContents\.debugger\.detach\(\)/)
  assert.match(main,/summariseCPUProfile\(profile,/)
  assert.match(main,/require\('\.\.\/dist\/main\/index\.cjs'\)/)
  assert.match(runner,/real first-party 100k CPU samples/)
  assert.match(runner,/cpuProfileProbeEnabled/)
})

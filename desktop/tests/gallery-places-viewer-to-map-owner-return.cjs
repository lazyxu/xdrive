'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const file = path.resolve(__dirname,'../../ui/shared/src/mui/MediaGallery.tsx')
const source = fs.readFileSync(file,'utf8')
const section = (from,to) => {
  const start=source.indexOf(from)
  const end=source.indexOf(to,start)
  assert.ok(start>=0 && end>start, 'cannot locate original Gallery boundary')
  return source.slice(start,end)
}
test('Viewer map action keeps the original Page map handler',()=>{
  assert.match(source,/onOpenDynamicMap=\{\(\) => \{/)
  assert.match(source,/closeMediaPreview\(\)/)
  assert.match(source,/if \(onShowMap\) onShowMap\(\)/)
  assert.match(source,/onShowMap=\{showMapFromCurrentGallery\}/)
})
test('signed Cell/Camera Viewer map action returns rather than broadens Gallery',()=>{
  const fn=section('const showMapFromCurrentGallery = () => {',
    'const appliedScopeLabel =')
  const branch=fn.indexOf("accepted?.kind === 'baidu-cell'")
  const viewport=fn.indexOf("accepted?.kind === 'baidu-viewport'")
  const reject=fn.indexOf('if (loading || collectionError || !accepted ||')
  assert.ok(branch>0 && viewport>branch && reject>viewport,
    'signed map wall must return BEFORE new general Gallery membership checks')
  assert.match(fn,/if \(!onOpenSecureDesktopMap &&/)
  const limited=fn.slice(0,reject)
  assert.match(limited,/leaveBaiduCellWall\(\)/)
  assert.match(limited,/setError\(''\)/)
  assert.doesNotMatch(limited,/loadFirstPage\(|listItemRange\(|\.fetch\(|onOpenSecureDesktopMap\(/)
  assert.match(fn,/xDriveGalleryMapEntryScope\(/)
  assert.match(fn,/accepted\.kind !== 'all'/)
  assert.match(fn,/accepted\.kind !== 'album'/)
})
test('map return cancels old signed operations and clears virtual wall',()=>{
  const leave=section('const leaveBaiduCellWall = useCallback(',
    'const leaveCollection = useCallback(')
  for(const safeguard of [
    'xDriveClearBaiduViewportReturn(preferenceScope)',
    'xDriveClearBaiduCellViewerReturn(preferenceScope)',
    'nativeCellOpenAbort.current?.abort()',
    'collectionTargetRef.current = null',
    'setCollectionTarget(null)',
    'virtualCollection.reset(',
    "setSection('places')",
    'setQuery({})',
  ])assert.ok(leave.includes(safeguard),safeguard)
  assert.doesNotMatch(leave,/setSection\('library'\)|listItemRange\(/)
})
test('Desktop file renderer retains independent secure HTTPS map entry',()=>{
  const fn=section('const showMapFromCurrentGallery = () => {','const appliedScopeLabel =')
  const permission=fn.indexOf('if (!entry.ok)')
  const desktop=fn.indexOf('onOpenSecureDesktopMap(entry.scope)')
  assert.ok(permission>0 && desktop>permission)
  assert.match(fn,/if \(onOpenSecureDesktopMap\) \{/)
})
test('shared Gallery TSX retains valid TypeScript syntax',()=>{
  const r=ts.transpileModule(source,{fileName:file,reportDiagnostics:true,
    compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,
      target:ts.ScriptTarget.ES2022}})
  assert.deepEqual((r.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error)
    .map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')),[])
})

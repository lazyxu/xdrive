'use strict'
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')
const root=path.resolve(__dirname,'../../..')
function load(relative,modules={}) {
  const file=path.join(root,relative)
  const result=ts.transpileModule(fs.readFileSync(file,'utf8'),{
    fileName:file,reportDiagnostics:true,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  })
  assert.deepEqual((result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error),[])
  const output={exports:{}}
  new Function('module','exports','require',result.outputText)(output,output.exports,id=>{
    assert.ok(Object.hasOwn(modules,id),'unreviewed test module '+id)
    return modules[id]
  })
  return output.exports
}
const viewport=load('ui/shared/src/media-gallery-baidu-jsapi4-viewport-range.ts')
const scope=load('ui/shared/src/media-gallery-baidu-map-photo-scope.ts',{
  './media-gallery-baidu-jsapi4-viewport-range':viewport,
})
module.exports=scope

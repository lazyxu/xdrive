'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const Module=require('node:module')
const ts=require('typescript')
const root=path.resolve(__dirname,'../..')
const name='ui/shared/src/media-gallery-places-map-mode.ts'
const built=ts.transpileModule(fs.readFileSync(path.join(root,name),'utf8'),
  {fileName:name,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}})
const m=new Module(name,module)
m.filename=path.join(root,name)
m.paths=module.paths
m._compile(built.outputText,m.filename)
const {xDrivePlacesMapModeFromHref:mode,
  xDrivePlacesMapModeNavigationURL:nav}=m.exports
test('same-document prototype is default, signed isolation must be explicit',()=>{
  assert.equal(mode('https://gallery.example.test/g?x=1#gallery'),'prototype')
  assert.equal(mode('https://gallery.example.test/g?places_map_mode=prototype'),'prototype')
  assert.equal(mode('https://gallery.example.test/g?places_map_mode=anything'),'isolated')
  assert.equal(mode('https://gallery.example.test/g?places_map_mode='),'isolated')
  assert.equal(mode('https://gallery.example.test/g?places_map_mode=isolated'),'isolated')
  assert.equal(mode('https://gallery.example.test/g?places_map_mode=prototype&places_map_mode=prototype'),'isolated')
  assert.equal(mode('https://gallery.example.test/g?places_map_mode=prototype&places_map_mode=isolated'),'isolated')
  assert.equal(mode('https://gallery.example.test/g?places_map_mode=isolated&places_map_mode=prototype'),'isolated')
  assert.equal(mode('file:///gallery/index.html'),'isolated')
  assert.equal(mode('invalid-url'),'isolated')
})
test('full document navigation preserves query/hash and refuses file:',()=>{
  const original='https://gallery.example.test/gallery?section=places&foo=1#library'
  const secure=nav(original,'isolated')
  assert.equal(secure,'https://gallery.example.test/gallery?section=places&foo=1&places_map_mode=isolated#library')
  assert.equal(nav(secure,'prototype'),original)
  assert.equal(nav('https://gallery.example.test/gallery?section=places&foo=1&places_map_mode=prototype&places_map_mode=isolated#library','isolated')?.match(/places_map_mode=isolated/g)?.length,1)
  assert.equal(nav('https://gallery.example.test/gallery?section=places&foo=1&places_map_mode=prototype&places_map_mode=isolated#library','prototype'),original)
  assert.equal(nav('file:///gallery/index.html','isolated'),null)
  assert.equal(nav('invalid','isolated'),null)
})

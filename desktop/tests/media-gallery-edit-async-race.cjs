const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const filename = path.resolve(__dirname, '../../ui/shared/src/mui/MediaGalleryEditDialog.tsx')
const ast = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'XDriveMediaGalleryEditDialog')
assert.ok(declaration, 'real shared Gallery Edit Dialog component must exist')

// Execute the actual component body and the actual Reset button click handler.
// Replace only the MUI JSX return with exposed handlers, retaining production hooks
// and async callback bodies (including their closure ownership).
let resetClick
function visit(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'Button' &&
      node.children.some(child => child.getText(ast).includes('移除已保存编辑'))) {
    const attr = node.openingElement.attributes.properties.find(entry =>
      ts.isJsxAttribute(entry) && entry.name.text === 'onClick')
    if (attr && ts.isJsxExpression(attr.initializer)) resetClick = attr.initializer.expression?.getText(ast)
  }
  ts.forEachChild(node, visit)
}
visit(declaration)
assert.ok(resetClick?.startsWith('() =>'), 'real Reset button callback must exist')
const original = declaration.getText(ast)
const boundary = /\n\s*return \(\s*<Dialog\b/m.exec(original)
assert.ok(boundary, 'expected actual component JSX return')
const snippet = original.slice(0, boundary.index) + '\n return { save, resetClick: (' + resetClick + ') }; \n}'
const compiled = ts.transpileModule(snippet, {
  fileName: filename,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText

function mount({onSave = async () => ({}), onReset = async () => ({})} = {}) {
  const slots = []
  const effects = []
  let cursor = 0
  const changed = (before, after) => !before || !after || before.length !== after.length ||
    after.some((value, i) => !Object.is(value, before[i]))
  const next = (init) => {
    const i = cursor++
    if (!slots[i]) slots[i] = { value: init() }
    return [i, slots[i]]
  }
  const useState = (initial) => {
    const [i, slot] = next(() => typeof initial === 'function' ? initial() : initial)
    return [slot.value, value => {
      slots[i].value = typeof value === 'function' ? value(slots[i].value) : value
    }]
  }
  const useRef = initial => next(() => ({current:initial}))[1].value
  const useEffect = (fn, deps) => {
    const state = next(() => ({deps:undefined, cleanup:undefined}))[1].value
    if (changed(state.deps, deps)) effects.push(() => {
      state.cleanup?.()
      state.cleanup = fn() || undefined
      state.deps = deps?.slice()
    })
  }
  const useMemo = (factory, deps) => {
    const state = next(() => ({deps:undefined, value:undefined}))[1].value
    if (changed(state.deps, deps)) { state.value = factory(); state.deps = deps?.slice() }
    return state.value
  }
  const hooks = { useState, useRef, useEffect, useMemo, useCallback:(fn, deps) => useMemo(() => fn, deps),
    xDriveDefaultMediaEditInput: kind => ({value:'default-'+kind}),
    xDriveMediaEditInputFromRecipe: recipe => ({value:recipe?.value ?? 'empty'}) }
  const exports = {}
  const keys = Object.keys(hooks)
  const factory = new Function('exports', ...keys, compiled + '\nreturn exports.XDriveMediaGalleryEditDialog')
  const Component = factory(exports, ...keys.map(key => hooks[key]))
  const fixed = {loadThumbnail:async () => null, loadPreviewURL:async () => null, onSave, onReset, onClose:() => {}}
  let handlers
  return {
    render(item, open = true) {
      cursor = 0; effects.length = 0
      handlers = Component({...fixed, item, open})
      for (const effect of effects) effect()
    },
    save:() => handlers.save(),
    reset:() => handlers.resetClick(),
    get draft() {return slots[0]?.value.value},
    get busy() {return slots[1]?.value},
    get error() {return slots[2]?.value},
  }
}
function deferred() {
  let resolve, reject
  const promise = new Promise((a,b) => { resolve=a; reject=b })
  return {promise,resolve,reject}
}
async function flush() {for(let i=0;i<8;i++) await Promise.resolve()}
const item = (id, rev=1) => ({
  node:{id,name:'image-'+id+'.jpg',revision:rev,size:1},
  metadata:{media_kind:'image',has_thumbnail:false,mime_type:'image/jpeg'},
  edit_recipe:{value:'stored-'+id,revision:rev,source_current:true},
})

test('Edit Dialog: late A save success cannot replace current B draft', async () => {
  const a=deferred(), h=mount({onSave:()=>a.promise})
  h.render(item(1)); const old=h.save()
  h.render(item(2)); assert.equal(h.draft,'stored-2')
  a.resolve({value:'saved-A'}); await old
  assert.equal(h.draft,'stored-2','A must not overwrite B after selection change')
})
test('Edit Dialog: late A save error cannot publish on B', async () => {
  const a=deferred(), h=mount({onSave:()=>a.promise})
  h.render(item(1)); const old=h.save()
  h.render(item(2)); a.reject(new Error('A-only failure')); await old
  assert.equal(h.error,'','A failed save must not display in B')
})
test('Edit Dialog: old A save completion cannot release pending B save busy', async () => {
  const a=deferred(), b=deferred()
  const h=mount({onSave:target=>target.node.id===1?a.promise:b.promise})
  h.render(item(1)); const old=h.save()
  h.render(item(2)); const current=h.save()
  assert.equal(h.busy,true)
  a.resolve({value:'A'}); await old
  assert.equal(h.busy,true,'A finally must not unlock B')
  b.resolve({value:'B'}); await current
  assert.equal(h.busy,false)
})
test('Edit Dialog: old reset success cannot overwrite new B draft', async () => {
  const a=deferred(), h=mount({onReset:()=>a.promise})
  h.render(item(1)); h.reset()
  h.render(item(2)); assert.equal(h.draft,'stored-2')
  a.resolve({value:'reset-A'}); await flush()
  assert.equal(h.draft,'stored-2','A reset result must not overwrite B')
})
test('Edit Dialog: old reset error cannot publish on new B', async () => {
  const a=deferred(), h=mount({onReset:()=>a.promise})
  h.render(item(1)); h.reset()
  h.render(item(2)); a.reject(new Error('A reset error')); await flush()
  assert.equal(h.error,'','A reset error must not appear on B')
})
test('Edit Dialog: old reset completion cannot release pending B save busy', async () => {
  const a=deferred(), b=deferred(), h=mount({onReset:()=>a.promise,onSave:()=>b.promise})
  h.render(item(1)); h.reset()
  h.render(item(2)); const current=h.save()
  assert.equal(h.busy,true)
  a.resolve({value:'reset-A'}); await flush()
  assert.equal(h.busy,true,'A reset finally must not unlock B')
  b.resolve({value:'B'}); await current
  assert.equal(h.busy,false)
})
test('Edit Dialog: same-tick double Save must single-flight', async () => {
  const a=deferred(); let count=0
  const h=mount({onSave:()=>{count++;return a.promise}})
  h.render(item(1)); const first=h.save(); const second=h.save()
  assert.equal(count,1,'immediate action owner must stop duplicate mutation')
  a.resolve({value:'saved'}); await Promise.all([first,second])
})
test('Edit Dialog: same-item close/reopen cannot accept older save completion', async () => {
  const a=deferred(), h=mount({onSave:()=>a.promise}), selected=item(1)
  h.render(selected); const old=h.save()
  h.render(selected,false); h.render(selected,true)
  assert.equal(h.draft,'stored-1')
  a.resolve({value:'before-close'}); await old
  assert.equal(h.draft,'stored-1','reopened session must not accept pre-close save')
})


test('Edit Dialog: unchanged current save accepts the acknowledged recipe', async () => {
  const a=deferred(), h=mount({onSave:()=>a.promise})
  h.render(item(1)); const pending=h.save()
  a.resolve({value:'normalized-A'}); await pending
  assert.equal(h.draft,'normalized-A')
  assert.equal(h.busy,false)
})
test('Edit Dialog: unchanged current reset accepts acknowledged recipe', async () => {
  const a=deferred(), h=mount({onReset:()=>a.promise})
  h.render(item(1)); h.reset()
  a.resolve({value:'normalized-reset-A'}); await flush()
  assert.equal(h.draft,'normalized-reset-A')
  assert.equal(h.busy,false)
})
test('Edit Dialog: A-B-A selection rejects the older A save completion', async () => {
  const a=deferred(), h=mount({onSave:()=>a.promise})
  h.render(item(1)); const pending=h.save()
  h.render(item(2)); h.render(item(1))
  a.resolve({value:'pre-switch-A'}); await pending
  assert.equal(h.draft,'stored-1','a prior visit to A cannot own the new A editor')
})
test('Edit Dialog: newer recipe revision invalidates a previous save', async () => {
  const a=deferred(), h=mount({onSave:()=>a.promise})
  h.render(item(1)); const pending=h.save()
  const newer=item(1,2); newer.edit_recipe.value='fresh-recipe'
  h.render(newer)
  a.resolve({value:'old-recipe'}); await pending
  assert.equal(h.draft,'fresh-recipe')
})
test('Edit Dialog: same-tick Save plus Reset sends only first write', async () => {
  const a=deferred()
  let saves=0, resets=0
  const h=mount({onSave:()=>{saves++;return a.promise},onReset:async()=>{resets++;return {}}})
  h.render(item(1)); const pending=h.save(); h.reset()
  assert.equal(saves,1)
  assert.equal(resets,0)
  a.resolve({value:'saved-A'}); await pending
})
test('Edit Dialog: same-tick double Reset is single-flight', async () => {
  const a=deferred()
  let resets=0
  const h=mount({onReset:()=>{resets++;return a.promise}})
  h.render(item(1)); h.reset(); h.reset()
  assert.equal(resets,1)
  a.resolve({value:'reset-A'}); await flush()
  assert.equal(h.busy,false)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const filename = path.resolve(__dirname, '../../ui/shared/src/mui/MediaGalleryViewer.tsx')
const source = fs.readFileSync(filename, 'utf8')
const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const component = file.statements.find(node =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'XDriveMediaGalleryViewer')
assert.ok(component, 'real shared Viewer component must be present')

// Run the actual component hooks, run() and close() functions. Only the JSX
// presentation tree is replaced with observable callbacks, not the production
// action code or the request ownership being tested.
const entire = component.getText(file)
const index = entire.search(/\n\s*const actions = item \? \(/)
assert.ok(index > 0, 'missing Viewer action presentation boundary')
const extracted = entire.slice(0, index) +
  '\n return {run, close, busyAction, item, setDeleteOpen}; \n}'
const compiled = ts.transpileModule(extracted, {
  fileName: filename,
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS},
}).outputText

const expressions = {}
function visit(node) {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const tag = node.tagName.getText(file)
    const all = node.attributes.properties
    const find = name => all.find(x => ts.isJsxAttribute(x) && x.name.text === name)
    const click = find('onClick')
    const confirm = find('onConfirm')
    if (tag === 'IconButton' && click && ts.isJsxExpression(click.initializer)) {
      const value = click.initializer.expression?.getText(file)
      if (value?.includes("run('favorite'")) expressions.favorite = value
      if (value?.includes("run('download'") && value.includes('onDownload(item)')) {
        expressions.download = value
      }
      if (value?.includes("run('download'") && value.includes('onExportLivePhoto(item)')) {
        expressions.exportLive = value
      }
    }
    if (tag === 'XDriveConfirmDialog' && confirm && ts.isJsxExpression(confirm.initializer)) {
      expressions.delete = confirm.initializer.expression?.getText(file)
    }
  }
  ts.forEachChild(node, visit)
}
visit(component)
for (const name of ['favorite', 'download', 'exportLive', 'delete']) {
  assert.ok(expressions[name]?.startsWith('() =>'), 'missing actual ' + name + ' handler')
}

const compiledHandlers = Object.fromEntries(Object.entries(expressions).map(([name, expression]) => {
  const src = ts.transpileModule('const realHandler = ' + expression + ';', {
    fileName: filename,
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS},
  }).outputText
  return [name, src]
}))

function fixture(ports = {}) {
  const slots = []
  const closes = []
  const calls = []
  let cursor = 0
  const next = initial => {
    const index = cursor++
    if (!(index in slots)) slots[index] = initial()
    return slots[index]
  }
  const useState = initial => {
    const holder = next(() => ({value: typeof initial === 'function' ? initial() : initial}))
    return [holder.value, nextValue => {
      holder.value = typeof nextValue === 'function' ? nextValue(holder.value) : nextValue
    }]
  }
  const useRef = initial => next(() => ({current: initial}))
  const useCallback = fn => { next(() => ({})); return fn }
  const hooks = {useState, useRef, useCallback}
  const keys = Object.keys(hooks)
  const exports = {}
  const factory = new Function('exports', ...keys, compiled +
    '\nreturn exports.XDriveMediaGalleryViewer')
  const Viewer = factory(exports, ...keys.map(key => hooks[key]))

  const defaults = {
    onToggleFavorite: async item => { calls.push('favorite-' + item.node.id) },
    onDownload: async item => { calls.push('download-' + item.node.id) },
    onExportLivePhoto: async item => { calls.push('export-' + item.node.id) },
    onDelete: async item => { calls.push('delete-' + item.node.id) },
  }
  const actions = {...defaults, ...ports}
  let current
  const harness = {
    calls, closes,
    get view() {return current},
    render(id) {
      cursor = 0
      const item = id == null ? null : {
        node: {id, name: id + '.jpg', revision: 1},
        metadata: {media_kind:'image'},
      }
      current = Viewer({
        item,
        onClose: () => closes.push('closed'),
      })
      return current
    },
    click(name, view = current) {
      const src = compiledHandlers[name]
      const env = {...actions, ...view}
      const names = Object.keys(env)
      const handler = new Function(...names, src + '\nreturn realHandler')(
        ...names.map(key => env[key]))
      return handler()
    },
  }
  return harness
}
function deferred() {
  let resolve
  let reject
  const promise = new Promise((a, b) => {resolve = a; reject = b})
  return {promise, resolve, reject}
}
async function flush() {for (let i=0;i<10;i++) await Promise.resolve()}

test('Viewer: two same-tick Favorites submit only one mutation', async () => {
  const held=deferred(), calls=[]
  const h=fixture({onToggleFavorite: item => {calls.push(item.node.id); return held.promise}})
  h.render(1)
  h.click('favorite')
  h.click('favorite')
  assert.deepEqual(calls, [1], 'same render must be single-flight before React updates Busy')
  held.resolve()
  await flush()
})

test('Viewer: two same-tick Downloads start one transfer', async () => {
  const held=deferred(), calls=[]
  const h=fixture({onDownload: item => {calls.push(item.node.id); return held.promise}})
  h.render(1)
  h.click('download')
  h.click('download')
  assert.deepEqual(calls, [1], 'same asset Download must not schedule twice before render')
  held.resolve(); await flush()
})

test('Viewer: Download and Live export share immediate Busy ownership', async () => {
  const held=deferred(), calls=[]
  const h=fixture({
    onDownload: item => {calls.push('download-'+item.node.id); return held.promise},
    onExportLivePhoto: item => {calls.push('live-'+item.node.id); return held.promise},
  })
  h.render(1)
  h.click('download')
  h.click('exportLive')
  assert.deepEqual(calls, ['download-1'],
    'normal Download + complete Live export cannot launch together in same view')
  held.resolve(); await flush()
})

test('Viewer: A pending Download must not block newly selected B', async () => {
  const a=deferred(), b=deferred(), calls=[]
  const h=fixture({onDownload: item => {
    calls.push(item.node.id)
    return item.node.id === 1 ? a.promise : b.promise
  }})
  h.render(1); h.click('download')
  h.render(2)
  assert.equal(h.view.busyAction,'','A Busy must not disable B on its first render')
  h.click('download')
  assert.deepEqual(calls,[1,2], 'B must be usable while A transfer completes')
  a.resolve(); b.resolve(); await flush()
})

test('Viewer: late A completion must not release newer B Busy ownership', async () => {
  const a=deferred(), b=deferred()
  const h=fixture({onDownload: item => item.node.id===1 ? a.promise : b.promise})
  h.render(1); h.click('download')
  h.render(2); h.click('download')
  h.render(2)
  assert.equal(h.view.busyAction,'download')
  a.resolve(); await flush()
  h.render(2)
  assert.equal(h.view.busyAction,'download', 'old A finally cannot unlock in-flight B')
  b.resolve(); await flush()
  h.render(2)
  assert.equal(h.view.busyAction,'')
})

test('Viewer: stale delete of A cannot close newer B Viewer', async () => {
  const a=deferred(), deletes=[]
  const h=fixture({onDelete: item => {deletes.push(item.node.id); return a.promise}})
  h.render(1); h.click('delete')
  h.render(2)
  a.resolve(); await flush()
  assert.deepEqual(deletes,[1])
  assert.deepEqual(h.closes,[], 'A delete completion must never close a newly selected B')
})

test('Viewer: same-tick repeated delete confirmations start only one deletion', async () => {
  const a=deferred(), deletes=[]
  const h=fixture({onDelete: item => {deletes.push(item.node.id); return a.promise}})
  h.render(1)
  h.click('delete'); h.click('delete')
  assert.deepEqual(deletes,[1], 'delete confirm must be immediate single-flight')
  a.resolve(); await flush()
  assert.deepEqual(h.closes,['closed'])
})

test('Viewer: close/reopen the same asset is a fresh action session', async () => {
  const a=deferred(), b=deferred(), calls=[]
  const h=fixture({
    onDownload: item => {calls.push('download-'+item.node.id); return a.promise},
    onToggleFavorite: item => {calls.push('favorite-'+item.node.id); return b.promise},
  })
  h.render(1); h.click('download')
  h.view.close()
  h.render(null); h.render(1)
  assert.equal(h.view.busyAction,'', 'new Viewer session must not inherit prior Busy')
  h.click('favorite')
  assert.deepEqual(calls,['download-1','favorite-1'])
  a.resolve(); await flush()
  h.render(1)
  assert.equal(h.view.busyAction,'favorite',
    'old close-session download cannot release new favorite mutation')
  b.resolve(); await flush()
})

test('Viewer: original delete confirmation still closes unchanged item', async () => {
  const a=deferred()
  const h=fixture({onDelete: () => a.promise})
  h.render(1); h.click('delete')
  a.resolve(); await flush()
  assert.deepEqual(h.closes,['closed'])
})

test('Viewer: completed Favorite clears Busy and allows another action', async () => {
  const a=deferred(), calls=[]
  const h=fixture({
    onToggleFavorite: item => {calls.push('favorite-'+item.node.id); return a.promise},
    onDownload: async item => {calls.push('download-'+item.node.id)},
  })
  h.render(1); h.click('favorite')
  h.render(1)
  assert.equal(h.view.busyAction,'favorite')
  a.resolve(); await flush()
  h.render(1)
  assert.equal(h.view.busyAction,'')
  h.click('download')
  assert.deepEqual(calls,['favorite-1','download-1'])
})


test('Viewer: A-B-A return does not inherit first A action ownership', async () => {
  const a=deferred(), b=deferred(), calls=[]
  const h=fixture({
    onDownload: item => {calls.push('download-'+item.node.id);return a.promise},
    onToggleFavorite: item => {calls.push('favorite-'+item.node.id);return b.promise},
  })
  h.render(1); h.click('download')
  h.render(2); h.render(1)
  assert.equal(h.view.busyAction,'')
  h.click('favorite')
  assert.deepEqual(calls,['download-1','favorite-1'])
  a.resolve(); await flush(); h.render(1)
  assert.equal(h.view.busyAction,'favorite',
    'the first visit to A must not release the later A session')
  b.resolve(); await flush()
})

test('Viewer: obsolete Delete confirm handler cannot delete a different session', async () => {
  const deletions=[]
  const h=fixture({onDelete: async item => {deletions.push(item.node.id)}})
  const oldView=h.render(1)
  h.render(2)
  h.click('delete', oldView)
  await flush()
  assert.deepEqual(deletions,[], 'stale first-item handler must never start a mutation')
  assert.deepEqual(h.closes,[], 'stale confirmation must not close current item')
})

test('Viewer: a rejected old Download cannot unlock current B action', async () => {
  const a=deferred(), b=deferred()
  const h=fixture({onDownload: item => item.node.id===1?a.promise:b.promise})
  h.render(1);h.click('download')
  h.render(2);h.click('download')
  a.reject(new Error('A-only transport failure')); await flush()
  h.render(2)
  assert.equal(h.view.busyAction,'download')
  b.resolve();await flush()
  h.render(2)
  assert.equal(h.view.busyAction,'')
})

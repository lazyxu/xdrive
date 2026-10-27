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
  '\n return {run, close, downloadCurrent, previousIfCurrent, nextIfCurrent, filmstripIfCurrent, setFullScreenIfCurrent, toggleSlideshowIfCurrent, fullScreen, slideshowPlaying, busyAction, actionError: visibleActionError, item, session: actionOwner.session, deleteOpen, creativeOpen, editOpen, locationOpen, setDeleteOpen, setCreativeOpen, setEditOpen, setLocationOpen}; \n}'
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
      if (value?.includes('downloadCurrent()')) {
        // The real Download button now delegates to the same synchronous
        // guarded run() action plus optional Agent receipt registration.
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
  const useLayoutEffect = (make, deps) => {
    const holder = next(() => ({deps: null, cleanup: null}))
    if (!holder.deps || holder.deps.length !== deps.length ||
        deps.some((value, index) => !Object.is(value, holder.deps[index]))) {
      holder.cleanup?.()
      holder.deps = deps
      holder.cleanup = make()
    }
  }
  // Owner/action-only fixture. The slideshow is exercised by mounted React tests;
  // keep this harness focused on the original Favorite/Download/Delete races.
  const hooks = {
    useState, useRef, useCallback, useLayoutEffect, useEffect: () => {}, useMediaQuery: () => false,
    xDriveClassifyFilePreview: () => 'image',
    useXDrivePreviewPresentation: () => ({
      sourceKey: 'action-only', presentationState: 'loading',
      onPresentationStateChange() {},
    }),
    useXDrivePreviewSlideshow: () => {},
    // This owner-race test deliberately runs without a Desktop receipt port:
    // the same original download action must still be single-flight.
    useXDriveViewerDownloadReceipt: () => ({
      claim: () => undefined, dismiss: () => {}, text: '', announce: false,
    }),
  }
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
    unmount() {
      for (const slot of slots) slot?.cleanup?.()
    },
    get view() {return current},
    render(id, loaders = {}) {
      cursor = 0
      const item = id == null ? null : {
        node: {id, name: id + '.jpg', revision: 1},
        metadata: {media_kind:'image'},
      }
      current = Viewer({
        item,
        loadThumbnail: loaders.thumbnail,
        loadPreviewURL: loaders.preview,
        loadLivePhotoMotion: loaders.motion,
        parentReportsViewerActionErrors: Boolean(loaders.parentReportsErrors),
        canPrevious: loaders.canPrevious ?? true,
        canNext: loaders.canNext ?? true,
        onPrevious: loaders.onPrevious ?? (() => calls.push('previous:' + id)),
        onNext: loaders.onNext ?? (() => calls.push('next:' + id)),
        onFilmstripSelect: loaders.onFilmstripSelect ?? (index => calls.push('filmstrip:' + id + ':' + index)),
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

test('Viewer: confirmation, editor, creative and location dialogs remain owned by their originating revision', () => {
  const h = fixture()
  const a = h.render(21)
  a.setDeleteOpen(true)
  a.setEditOpen(true)
  a.setCreativeOpen(true)
  a.setLocationOpen(true)
  const same = h.render(21)
  assert.deepEqual(
    [same.deleteOpen, same.editOpen, same.creativeOpen, same.locationOpen],
    [true, true, true, true],
    'same Node/revision keeps its existing dialog state',
  )
  const different = h.render(22)
  assert.deepEqual(
    [different.deleteOpen, different.editOpen, different.creativeOpen, different.locationOpen],
    [false, false, false, false],
    'next filmstrip item must never inherit actionable dialogs from the previous photo',
  )
  const returned = h.render(21)
  assert.deepEqual(
    [returned.deleteOpen, returned.editOpen, returned.creativeOpen, returned.locationOpen],
    [false, false, false, false],
    'returning A after A→B must not resurrect its previous confirmation',
  )
  a.setDeleteOpen(true)
  assert.equal(h.render(21).deleteOpen, false,
    'stale JSX callback from the old A session cannot rearm the current A confirmation')
})

test('P0 identical Node/revision from another loader scope starts a new action session', async () => {
  const pending = deferred()
  const calls = []
  const h = fixture({onDownload: item => { calls.push(item.node.id); return pending.promise }})
  const firstLoaders = {thumbnail: async () => null, preview: async () => null}
  const nextLoaders = {thumbnail: async () => null, preview: async () => null}
  const first = h.render(81, firstLoaders)
  first.setDeleteOpen(true)
  h.click('download')
  const same = h.render(81, firstLoaders)
  assert.equal(same.deleteOpen, true)
  assert.equal(same.busyAction, 'download')
  assert.equal(same.session, first.session, 'stable source must preserve action ownership')

  const changed = h.render(81, nextLoaders)
  assert.equal(changed.deleteOpen, false, 'old source confirmation must not survive an Owner rebind')
  assert.equal(changed.busyAction, '', 'old transfer may not disable same-ID media in a new source')
  assert.ok(changed.session > first.session)
  h.click('download', first)
  assert.deepEqual(calls, [81], 'stale action must not launch another old-source transfer')
  pending.resolve()
  await flush()
})

test('Viewer: current Download failure is visible, but old A errors cannot reach B or A→B→A', async () => {
  const a = deferred(), b = deferred()
  const h = fixture({onDownload: item => item.node.id === 31 ? a.promise : b.promise})
  h.render(31); h.click('download')
  h.render(32); h.click('download')
  a.reject(new Error('signed-private-ticket'))
  await flush()
  assert.equal(h.render(32).actionError, null, 'old action failure is hidden on B')
  b.reject(new Error('current transport failure'))
  await flush()
  const failed = h.render(32)
  assert.equal(failed.actionError?.action, 'download', 'current failure is visible')
  assert.equal(failed.busyAction, '', 'failed action releases Busy')
  assert.equal(h.render(31).actionError, null, 'return to A is a new action session')
})

test('Viewer: failed Delete preserves confirmation, shows feedback, and allows retry', async () => {
  let attempts = 0
  const h = fixture({onDelete: async () => {
    if (++attempts === 1) throw new Error('transient delete error')
  }})
  h.render(42)
  h.view.setDeleteOpen(true)
  h.render(42)
  h.click('delete')
  await flush()
  const failed = h.render(42)
  assert.equal(failed.deleteOpen, true)
  assert.equal(failed.actionError?.action, 'delete')
  assert.equal(failed.busyAction, '')
  assert.deepEqual(h.closes, [])
  h.click('delete')
  await flush()
  assert.equal(attempts, 2)
  assert.deepEqual(h.closes, ['closed'], 'successful retry preserves the original close flow')
  assert.equal(h.render(42).actionError, null)
})

test('Viewer: host-reported Download and Delete errors do not duplicate local feedback', async () => {
  const error = new Error('upstream has already reported this')
  const loaders = { parentReportsErrors: true }
  const h = fixture({
    onDownload: async () => { throw error },
    onDelete: async () => { throw error },
    onToggleFavorite: async () => { throw error },
  })
  h.render(55, loaders); h.click('download')
  await flush()
  assert.equal(h.render(55, loaders).actionError, null,
    'host Snackbar already reported the transfer failure')
  h.view.setDeleteOpen(true)
  h.render(55, loaders); h.click('delete')
  await flush()
  assert.equal(h.render(55, loaders).actionError, null,
    'host Snackbar already reported the deletion failure')
  assert.equal(h.view.deleteOpen, true, 'failed deletion remains retryable')
  h.click('favorite')
  await flush()
  assert.equal(h.render(55, loaders).actionError, null,
    'host Snackbar already reported the Favorite failure as well')
})

test('Gallery Viewer stale Close cannot close B or revisit A after A→B→A', () => {
  const h = fixture()
  const first = h.render(101)
  h.render(102)
  first.close()
  assert.deepEqual(h.closes, [], 'A Close must not dismiss B')
  h.render(101)
  first.close()
  assert.deepEqual(h.closes, [], 'the original A cannot close a new A session')
  h.view.close()
  assert.deepEqual(h.closes, ['closed'], 'current A Close stays functional')
  h.view.close()
  assert.deepEqual(h.closes, ['closed'], 'a second queued Close is ignored')
})

test('Gallery Viewer blocks stale arrows, filmstrip, fullscreen and slideshow intent', () => {
  const h = fixture()
  const old = h.render(201)
  const current = h.render(202, { canPrevious: false, canNext: false })
  old.previousIfCurrent()
  old.nextIfCurrent()
  old.filmstripIfCurrent(5)
  old.setFullScreenIfCurrent(true)
  old.toggleSlideshowIfCurrent()
  assert.deepEqual(h.calls, [], 'all old source gestures must be inert')
  assert.equal(h.render(202, { canPrevious: false, canNext: false }).fullScreen, false)
  assert.equal(h.view.slideshowPlaying, false)
  current.previousIfCurrent()
  current.nextIfCurrent()
  assert.deepEqual(h.calls, [], 'latest neighbor boundaries must be enforced')
})

test('Gallery Viewer navigation uses current capabilities and rejects replaced commands', () => {
  const h = fixture()
  const callback = () => h.calls.push('previous:current')
  const next = () => h.calls.push('next:current')
  const old = h.render(301, { onPrevious: callback, onNext: next })
  h.render(301, { onPrevious: callback, onNext: next, canNext: false })
  old.nextIfCurrent()
  assert.deepEqual(h.calls, [], 'revoked next boundary must reject queued event')
  old.previousIfCurrent()
  assert.deepEqual(h.calls, ['previous:current'], 'still-valid previous navigation works')
  const current = h.render(301, { onPrevious: () => h.calls.push('previous:new'), onNext: next })
  old.previousIfCurrent()
  current.previousIfCurrent()
  assert.deepEqual(h.calls, ['previous:current', 'previous:new'],
    'a replaced source command rejects the old callback')
})

test('Gallery Viewer unmount invalidates captured close and navigation', () => {
  const h = fixture()
  const old = h.render(401)
  h.unmount()
  old.close()
  old.nextIfCurrent()
  old.filmstripIfCurrent(0)
  assert.deepEqual(h.closes, [])
  assert.deepEqual(h.calls, [])
})

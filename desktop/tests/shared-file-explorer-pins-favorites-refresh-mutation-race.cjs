const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function sameDeps(left, right) {
  if (!left || !right || left.length !== right.length) return false
  return left.every((item, index) => Object.is(item, right[index]))
}

function createHookRuntime() {
  const slots = []
  let cursor = 0
  let pendingEffects = []
  const react = {
    useState(initialValue) {
      const index = cursor++
      if (!slots[index]) {
        slots[index] = {
          value: typeof initialValue === 'function' ? initialValue() : initialValue,
        }
      }
      const setValue = (next) => {
        const current = slots[index].value
        slots[index].value = typeof next === 'function' ? next(current) : next
      }
      return [slots[index].value, setValue]
    },
    useRef(value) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: { current: value } }
      return slots[index].value
    },
    useMemo(factory, deps) {
      const index = cursor++
      const slot = slots[index]
      if (!slot || !sameDeps(slot.deps, deps)) {
        slots[index] = { value: factory(), deps: deps ? [...deps] : undefined }
      }
      return slots[index].value
    },
    useCallback(callback, deps) {
      const index = cursor++
      const slot = slots[index]
      if (!slot || !sameDeps(slot.deps, deps)) {
        slots[index] = { value: callback, deps: deps ? [...deps] : undefined }
      }
      return slots[index].value
    },
    useEffect(effect, deps) {
      const index = cursor++
      const slot = slots[index]
      if (!slot || !sameDeps(slot.deps, deps)) {
        pendingEffects.push({ index, effect, deps: deps ? [...deps] : undefined })
      }
    },
  }
  return {
    react,
    render(factory) {
      cursor = 0
      pendingEffects = []
      const result = factory()
      for (const pending of pendingEffects) {
        const previous = slots[pending.index]
        if (typeof previous?.cleanup === 'function') previous.cleanup()
        const cleanup = pending.effect()
        slots[pending.index] = {
          deps: pending.deps,
          cleanup: typeof cleanup === 'function' ? cleanup : undefined,
        }
      }
      return result
    },
  }
}

function loadHook(filename, exportName, react) {
  const file = path.join(repo, 'ui', 'shared', 'src', 'mui', filename)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', output)(
    mod.exports,
    mod,
    (name) => name === 'react' ? react : require(name),
  )
  return mod.exports[exportName]
}

function deferred() {
  let resolve
  const promise = new Promise((yes) => { resolve = yes })
  return { promise, resolve }
}

async function flush() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve()
}

function favoriteItem(id) {
  return {
    node: { id, name: 'File ' + id, type: 'file' },
    path: '/File ' + id,
    crumbs: [{ id: 1, name: 'My Files' }],
    favorited_at: '2026-10-09T02:00:00Z',
  }
}

function quickAccessItem(id) {
  return {
    node: { id, name: 'Folder ' + id, type: 'dir' },
    path: '/Folder ' + id,
    crumbs: [{ id: 1, name: 'My Files' }, { id, name: 'Folder ' + id }],
    position: id - 1,
    pinned_at: '2026-10-09T02:00:00Z',
  }
}

const kinds = [
  {
    name: 'Favorites',
    filename: 'FileExplorerFavoriteController.ts',
    exportName: 'useXDriveFileExplorerFavorites',
    memberKey: 'favoriteIDs',
    add: 'favorite',
    remove: 'unfavorite',
    activate: 'activate',
    item: favoriteItem,
  },
  {
    name: 'Quick Access',
    filename: 'FileExplorerQuickAccessController.ts',
    exportName: 'useXDriveFileExplorerQuickAccess',
    memberKey: 'pinnedIDs',
    add: 'pin',
    remove: 'unpin',
    activate: 'navigate',
    item: quickAccessItem,
  },
]

for (const kind of kinds) {
  for (const action of ['add', 'remove']) {
    test(kind.name + ' older activation lookup cannot overwrite a newer successful ' + action + ' mutation', async () => {
      const runtime = createHookRuntime()
      const hook = loadHook(kind.filename, kind.exportName, runtime.react)
      const mutation = deferred()
      const staleLoad = deferred()
      const errors = []
      const initialItems = (action === 'add' ? [1] : [1, 2]).map(kind.item)
      let loadCalls = 0
      let mutationCalls = 0
      let activated = 0

      const render = () => runtime.render(() => hook({
        lifecycleKey: 'server:user',
        enabled: true,
        loadItems: () => {
          loadCalls += 1
          return loadCalls === 1 ? Promise.resolve(initialItems) : staleLoad.promise
        },
        favoriteItem: async () => { mutationCalls += 1; return mutation.promise },
        unfavoriteItem: async () => { mutationCalls += 1; return mutation.promise },
        pinItem: async () => { mutationCalls += 1; return mutation.promise },
        unpinItem: async () => { mutationCalls += 1; return mutation.promise },
        reorderItems: async () => {},
        onError: (error) => { errors.push(error) },
      }))

      render()
      await flush()
      let controller = render()
      assert.deepEqual([...controller[kind.memberKey]], initialItems.map((x) => x.node.id))
      const mutationPromise = controller[kind[action]](action === 'add' ? 3 : 2)
      await flush()
      assert.equal(mutationCalls, 1, 'mutation transport must be in-flight before lookup begins')

      // A user activates the existing sidebar entry while the mutation is
      // still pending. The list request observes an older server snapshot.
      controller = render()
      const activationPromise = controller[kind.activate](1, async () => { activated += 1 })
      await flush()
      assert.equal(loadCalls, 2)

      mutation.resolve(action === 'add' ? kind.item(3) : undefined)
      assert.equal(await mutationPromise, true)
      await flush()
      controller = render()
      assert.equal(
        controller[kind.memberKey].has(action === 'add' ? 3 : 2),
        action === 'add',
        'newer successful membership mutation must be visible before stale lookup',
      )

      staleLoad.resolve(initialItems)
      const activationResult = await activationPromise
      await flush()
      controller = render()
      assert.equal(
        controller[kind.memberKey].has(action === 'add' ? 3 : 2),
        action === 'add',
        'an old activation lookup must not overwrite a successful membership mutation',
      )
      assert.equal(
        activationResult,
        false,
        'superseded activation must not claim success using an obsolete list',
      )
      assert.equal(activated, 0, 'superseded lookup must not invoke an activation callback')
      assert.deepEqual(errors, [])
    })
  }

  test(kind.name + ' same-lifecycle activation still resolves a current item', async () => {
    const runtime = createHookRuntime()
    const hook = loadHook(kind.filename, kind.exportName, runtime.react)
    let loads = 0
    let activated = 0
    const render = () => runtime.render(() => hook({
      lifecycleKey: 'server:user',
      loadItems: async () => { loads += 1; return [kind.item(1)] },
      favoriteItem: async () => kind.item(2),
      unfavoriteItem: async () => {},
      pinItem: async () => kind.item(2),
      unpinItem: async () => {},
      reorderItems: async () => {},
      onError: (error) => { throw error },
    }))
    render()
    await flush()
    const controller = render()
    assert.equal(
      await controller[kind.activate](1, async () => { activated += 1 }),
      true,
    )
    assert.equal(loads, 2)
    assert.equal(activated, 1)
  })
}

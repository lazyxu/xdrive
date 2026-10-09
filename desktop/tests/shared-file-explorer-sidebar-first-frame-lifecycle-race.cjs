const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function sameDeps(a, b) {
  return !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
}

function runtime() {
  const slots = []
  let cursor = 0
  let pendingEffects = []
  const react = {
    useState(initial) {
      const i = cursor++
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, (next) => {
        slots[i].value = typeof next === 'function' ? next(slots[i].value) : next
      }]
    },
    useRef(value) {
      const i = cursor++
      if (!slots[i]) slots[i] = { value: { current: value } }
      return slots[i].value
    },
    useMemo(factory, deps) {
      const i = cursor++
      if (!slots[i] || !sameDeps(slots[i].deps, deps)) {
        slots[i] = { value: factory(), deps: deps ? [...deps] : undefined }
      }
      return slots[i].value
    },
    useCallback(callback, deps) {
      const i = cursor++
      if (!slots[i] || !sameDeps(slots[i].deps, deps)) {
        slots[i] = { value: callback, deps: deps ? [...deps] : undefined }
      }
      return slots[i].value
    },
    useEffect(effect, deps) {
      const i = cursor++
      if (!slots[i] || !sameDeps(slots[i].deps, deps)) {
        pendingEffects.push({ i, effect, deps: deps ? [...deps] : undefined })
      }
    },
  }
  return {
    react,
    render(hook) {
      cursor = 0
      pendingEffects = []
      // The result is the real Hook's render-phase output. Passive effects
      // commit afterwards; stale data must not be exposed in this first frame.
      const result = hook()
      for (const effect of pendingEffects) {
        const prior = slots[effect.i]
        prior?.cleanup?.()
        const cleanup = effect.effect()
        slots[effect.i] = { deps: effect.deps, cleanup }
      }
      return result
    },
  }
}

function loadHook(react, file, name) {
  const filename = path.join(repo, 'ui', 'shared', 'src', 'mui', file)
  const source = fs.readFileSync(filename, 'utf8')
  const js = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', js)(
    mod, mod.exports, (id) => id === 'react' ? react : require(id),
  )
  return mod.exports[name]
}

const ITEM_ID = 42
function item(kind, owner) {
  const node = {
    id: ITEM_ID,
    name: owner + (kind === 'pin' ? ' folder' : '.txt'),
    type: kind === 'pin' ? 'dir' : 'file',
  }
  const base = {
    node, path: '/' + node.name,
    crumbs: [{ id: 1, name: 'My Files' }, { id: ITEM_ID, name: node.name }],
  }
  if (kind === 'pin') return { ...base, position: 0, pinned_at: '2026-10-09T02:00:00Z' }
  if (kind === 'favorite') return { ...base, favorited_at: '2026-10-09T02:00:00Z' }
  return { ...base, accessed_at: '2026-10-09T02:00:00Z' }
}

async function flushAsync() {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

const configs = [
  { label: 'Favorites', kind: 'favorite', file: 'FileExplorerFavoriteController.ts', hook: 'useXDriveFileExplorerFavorites', idSet: 'favoriteIDs' },
  { label: 'Quick Access', kind: 'pin', file: 'FileExplorerQuickAccessController.ts', hook: 'useXDriveFileExplorerQuickAccess', idSet: 'pinnedIDs' },
  { label: 'Recent', kind: 'recent', file: 'FileExplorerRecentController.ts', hook: 'useXDriveFileExplorerRecent', idSet: null },
]

for (const config of configs) {
  function setup() {
    const rt = runtime()
    const useHook = loadHook(rt.react, config.file, config.hook)
    let lifecycleKey = 'server-a:user-a'
    let enabled = true
    let owner = 'A'
    const calls = []
    const render = () => rt.render(() => useHook({
      lifecycleKey, enabled,
      loadItems: async () => owner === 'A' ? [item(config.kind, 'A')] : [],
      pinItem: async (id) => { calls.push(['pin', owner, id]); return item('pin', owner) },
      unpinItem: async (id) => { calls.push(['unpin', owner, id]) },
      reorderItems: async () => {},
      favoriteItem: async (id) => { calls.push(['favorite', owner, id]); return item('favorite', owner) },
      unfavoriteItem: async (id) => { calls.push(['unfavorite', owner, id]) },
      touchItem: async (id) => { calls.push(['touch', owner, id]); return item('recent', owner) },
      clearItems: async () => { calls.push(['clear', owner]) },
      onError: (e) => { throw e },
    }))
    return {
      render, calls,
      switchOwner() { owner = 'B'; lifecycleKey = 'server-b:user-b' },
      disable() { enabled = false },
    }
  }

  test(config.label + ' hides old-account entries in the first render of account B', async () => {
    const scope = setup()
    scope.render()
    await flushAsync()
    const a = scope.render()
    assert.deepEqual(a.items.map(x => x.name), [item(config.kind, 'A').node.name])

    scope.switchOwner()
    const firstB = scope.render()
    assert.deepEqual(
      firstB.items, [],
      'the first render for B must not project account A sidebar entries before passive effects flush',
    )
    if (config.idSet) assert.equal(
      firstB[config.idSet].has(ITEM_ID), false,
      'account B must not inherit account A pin/favorite membership for a reused numeric node ID',
    )
    assert.equal(firstB.loading, true, 'new-account state should indicate that a fresh load is pending')

    await flushAsync()
    const b = scope.render()
    assert.deepEqual(b.items, [], 'account B should load its own empty list')
    assert.deepEqual(scope.calls, [])
  })

  test(config.label + ' hides stale entries on the first disabled render', async () => {
    const scope = setup()
    scope.render()
    await flushAsync()
    assert.equal(scope.render().items.length, 1)
    scope.disable()
    const disabled = scope.render()
    assert.deepEqual(disabled.items, [], 'disabling the sidebar must not render a prior active user list')
    if (config.idSet) assert.equal(disabled[config.idSet].has(ITEM_ID), false)
    assert.equal(disabled.loading, false)
  })

  test(config.label + ' same-account entries remain accessible without a lifecycle transition', async () => {
    const scope = setup()
    scope.render()
    await flushAsync()
    const stable = scope.render()
    assert.deepEqual(stable.items.map(x => x.name), [item(config.kind, 'A').node.name])
    if (config.idSet) assert.equal(stable[config.idSet].has(ITEM_ID), true)
  })

  if (config.idSet) {
    test(config.label + ' first B render cannot unpin/unfavorite B from A membership with a reused node ID', async () => {
      const scope = setup()
      scope.render()
      await flushAsync()
      assert.equal(scope.render()[config.idSet].has(ITEM_ID), true)

      scope.switchOwner()
      const firstB = scope.render()
      const result = await firstB.toggle(ITEM_ID)
      await flushAsync()

      const expected = config.kind === 'pin' ? 'pin' : 'favorite'
      const forbidden = config.kind === 'pin' ? 'unpin' : 'unfavorite'
      assert.deepEqual(
        scope.calls,
        [[expected, 'B', ITEM_ID]],
        'a B-side toggle must use B visible membership, never A stale member flags',
      )
      assert.equal(scope.calls.some(([action]) => action === forbidden), false)
      assert.equal(result, true)
    })
  }
}


for (const config of configs) {
  test(config.label + ' publishes B entries after fresh load even when A and B reuse the same numeric node ID', async () => {
    const rt = runtime()
    const useHook = loadHook(rt.react, config.file, config.hook)
    let lifecycleKey = 'server-a:user-a'
    let owner = 'A'
    const render = () => rt.render(() => useHook({
      lifecycleKey,
      enabled: true,
      loadItems: async () => [item(config.kind, owner)],
      pinItem: async () => item('pin', owner),
      unpinItem: async () => {},
      favoriteItem: async () => item('favorite', owner),
      unfavoriteItem: async () => {},
      reorderItems: async () => {},
      touchItem: async () => item('recent', owner),
      clearItems: async () => {},
      onError: (e) => { throw e },
    }))

    render()
    await flushAsync()
    assert.equal(render().items[0]?.name, item(config.kind, 'A').node.name)

    lifecycleKey = 'server-b:user-b'
    owner = 'B'
    assert.deepEqual(render().items, [], 'first B frame must hide A content')
    await flushAsync()
    const b = render()
    assert.deepEqual(
      b.items.map(x => x.name),
      [item(config.kind, 'B').node.name],
      'once B fetches its own list, account B entries must be displayed',
    )
    if (config.idSet) assert.equal(b[config.idSet].has(ITEM_ID), true)
  })
}

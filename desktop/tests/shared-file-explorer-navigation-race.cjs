const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function sameDeps(left, right) {
  if (!left || !right || left.length !== right.length) return false
  return left.every((value, index) => Object.is(value, right[index]))
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
          kind: 'state',
          value: typeof initialValue === 'function' ? initialValue() : initialValue,
        }
      }
      const setValue = (nextValue) => {
        const current = slots[index].value
        slots[index].value = typeof nextValue === 'function'
          ? nextValue(current)
          : nextValue
      }
      return [slots[index].value, setValue]
    },
    useRef(initialValue) {
      const index = cursor++
      if (!slots[index]) {
        slots[index] = { kind: 'ref', value: { current: initialValue } }
      }
      return slots[index].value
    },
    useMemo(factory, deps) {
      const index = cursor++
      const current = slots[index]
      if (!current || !sameDeps(current.deps, deps)) {
        slots[index] = {
          kind: 'memo',
          deps: deps ? [...deps] : undefined,
          value: factory(),
        }
      }
      return slots[index].value
    },
    useEffect(effect, deps) {
      const index = cursor++
      const current = slots[index]
      if (!current || !sameDeps(current.deps, deps)) {
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
          kind: 'effect',
          deps: pending.deps,
          cleanup: typeof cleanup === 'function' ? cleanup : undefined,
        }
      }
      return result
    },
  }
}

function loadNavigationHook(react) {
  const filename = path.join(
    repo,
    'ui',
    'shared',
    'src',
    'mui',
    'FileExplorerNavigation.ts',
  )
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText

  const mod = { exports: {} }
  const localRequire = (request) => {
    if (request === 'react') return react
    if (request === '../file-explorer-controller') {
      return {
        XDRIVE_FILE_EXPLORER_DEFAULT_SORT: {
          key: 'name',
          direction: 'asc',
        },
      }
    }
    return require(request)
  }
  const execute = new Function('exports', 'module', 'require', output)
  execute(mod.exports, mod, localRequire)
  return mod.exports.useXDriveFileExplorerNavigation
}

function cloneCrumbs(crumbs) {
  return crumbs.map((crumb) => ({ ...crumb }))
}

function createDirectoryDriver(initialCrumbs) {
  let visibleCrumbs = cloneCrumbs(initialCrumbs)
  let visibleDirectoryID = visibleCrumbs.at(-1)?.id
  let requestGeneration = 0
  let controlled = false
  const pending = []

  const onLoadDirectory = (id, crumbs) => {
    const generation = ++requestGeneration
    const requestedCrumbs = cloneCrumbs(crumbs)
    const commit = () => {
      if (generation !== requestGeneration) return
      visibleDirectoryID = id
      visibleCrumbs = requestedCrumbs
    }

    if (!controlled) {
      commit()
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      pending.push({
        id,
        generation,
        resolve() {
          commit()
          resolve()
        },
      })
    })
  }

  return {
    onLoadDirectory,
    get crumbs() {
      return cloneCrumbs(visibleCrumbs)
    },
    get visibleDirectoryID() {
      return visibleDirectoryID
    },
    controlRequests() {
      controlled = true
    },
    resolveDirectory(id) {
      const request = pending.find((entry) => entry.id === id && !entry.resolved)
      assert.ok(request, `missing pending directory request for ${id}`)
      request.resolved = true
      request.resolve()
    },
  }
}

function createNavigationHarness(driver) {
  const runtime = createHookRuntime()
  const useNavigation = loadNavigationHook(runtime.react)
  const navigated = []

  return {
    render() {
      return runtime.render(() => useNavigation({
        crumbs: driver.crumbs,
        viewModeStorageKey: 'xdrive.test.fileexplorer.navigation-race',
        onLoadDirectory: driver.onLoadDirectory,
        onAfterNavigate: (crumbs) => {
          navigated.push(cloneCrumbs(crumbs))
        },
      }))
    },
    navigated,
  }
}

test('rapid same-tab folder navigation keeps tab title aligned with the newest visible directory', async () => {
  const root = { id: 1, name: '我的文件' }
  const folderB = { id: 2, name: 'B' }
  const folderC = { id: 3, name: 'C' }

  const driver = createDirectoryDriver([root])
  const harness = createNavigationHarness(driver)

  harness.render()
  const navigation = harness.render()
  driver.controlRequests()

  const toB = navigation.navigateTo([root, folderB])
  const toC = navigation.navigateTo([root, folderC])

  driver.resolveDirectory(folderC.id)
  await toC

  driver.resolveDirectory(folderB.id)
  await toB

  const finalNavigation = harness.render()
  const activeTab = finalNavigation.tabs.find(
    (tab) => tab.id === finalNavigation.activeTabID,
  )

  assert.equal(driver.visibleDirectoryID, folderC.id)
  assert.equal(finalNavigation.current.id, folderC.id)
  assert.equal(finalNavigation.pathValue, '我的文件/C')
  assert.equal(
    activeTab.label,
    folderC.name,
    'tab title must not be overwritten by a stale earlier navigation completion',
  )
})

test('rapid multi-tab activation keeps active tab, address, directory and tree target on the same workspace', async () => {
  const root = { id: 1, name: '我的文件' }
  const folderB = { id: 2, name: 'B' }
  const folderC = { id: 3, name: 'C' }

  const driver = createDirectoryDriver([root])
  const harness = createNavigationHarness(driver)

  harness.render()
  let navigation = harness.render()

  await navigation.newTab()
  navigation = harness.render()
  const tabB = navigation.activeTabID
  await navigation.navigateTo([root, folderB])
  navigation = harness.render()

  await navigation.newTab()
  navigation = harness.render()
  const tabC = navigation.activeTabID
  await navigation.navigateTo([root, folderC])
  navigation = harness.render()

  await navigation.activateTab('tab-1')
  navigation = harness.render()
  assert.equal(navigation.activeTabID, 'tab-1')
  assert.equal(driver.visibleDirectoryID, root.id)

  driver.controlRequests()

  const activateB = navigation.activateTab(tabB)
  const activateC = navigation.activateTab(tabC)

  driver.resolveDirectory(folderC.id)
  await activateC

  driver.resolveDirectory(folderB.id)
  await activateB

  const finalNavigation = harness.render()
  const activeTab = finalNavigation.tabs.find(
    (tab) => tab.id === finalNavigation.activeTabID,
  )

  assert.equal(driver.visibleDirectoryID, folderC.id)
  assert.equal(finalNavigation.current.id, folderC.id)
  assert.equal(finalNavigation.pathValue, '我的文件/C')
  assert.equal(
    finalNavigation.activeTabID,
    tabC,
    'stale tab activation must not become active after the newer tab already won',
  )
  assert.equal(
    activeTab.label,
    folderC.name,
    'active tab title must match the address, visible directory and navigation-tree target',
  )
})

test('closing a tab while its activation is pending cannot resurrect the closed workspace', async () => {
  const root = { id: 1, name: '我的文件' }
  const folderB = { id: 2, name: 'B' }

  const driver = createDirectoryDriver([root])
  const harness = createNavigationHarness(driver)

  harness.render()
  let navigation = harness.render()

  await navigation.newTab()
  navigation = harness.render()
  const tabB = navigation.activeTabID
  await navigation.navigateTo([root, folderB])
  navigation = harness.render()

  await navigation.activateTab('tab-1')
  navigation = harness.render()
  assert.equal(navigation.activeTabID, 'tab-1')
  assert.equal(driver.visibleDirectoryID, root.id)

  driver.controlRequests()

  const activateB = navigation.activateTab(tabB)
  await navigation.closeTab(tabB)

  navigation = harness.render()
  assert.equal(
    navigation.tabs.some((tab) => tab.id === tabB),
    false,
    'closed tab must disappear immediately even while its old activation request is pending',
  )

  driver.resolveDirectory(folderB.id)
  await activateB

  const finalNavigation = harness.render()
  assert.equal(
    finalNavigation.activeTabID,
    'tab-1',
    'a stale activation completion must not reactivate a tab that has already been closed',
  )
  assert.equal(driver.visibleDirectoryID, root.id)
  assert.equal(finalNavigation.current.id, root.id)
  assert.equal(finalNavigation.pathValue, '我的文件')
})

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const shared = read('ui', 'shared', 'src', 'mui', 'FileExplorerNavigation.ts')
const workspace = read('ui', 'shared', 'src', 'mui', 'FileExplorerWorkspaceController.ts')
const controller = read('ui', 'shared', 'src', 'file-explorer-controller.ts')
const sharedMuiIndex = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const web = read('web', 'src', 'WebFileExplorer.tsx')
const desktop = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')

test('shared FileExplorer navigation controller owns cross-client per-tab view and history state', () => {
  for (const token of [
    'useXDriveFileExplorerNavigation',
    'export type XDriveFileExplorerNavigationTab',
    'history: TCrumb[][]',
    'historyIndex: number',
    'sort: XDriveFileExplorerSort',
    'grouping: XDriveFileExplorerGrouping',
    'viewMode: XDriveFileExplorerViewMode',
    'export type XDriveFileExplorerNavigationState',
    'const [navigationState, setNavigationState]',
    'const tabs = navigationState.tabs',
    'const activeTabID = navigationState.activeTabID',
    'window.localStorage.setItem(viewModeStorageKey, viewMode)',
    'navigationSessionStorageKey?: string',
    'xDriveFileExplorerNavigationSessionSnapshot',
    'xDriveNormalizeFileExplorerNavigationSession',
    'loadStoredNavigationSession<TCrumb>',
    'storeNavigationSession(navigationSessionStorageKey, next, maxTabs)',
    "initialNavigationSourceRef.current === 'session'",
    'initialSessionRestorePendingRef.current',
    "const pathValue = crumbs.map((crumb) => crumb.name).join('/')",
    'const refresh = () =>',
    'onLoadDirectory(current.id, crumbs, sort, grouping)',
    'const beginNavigationIntent = () => beginNavigation(activeTabID)',
    'const isNavigationIntentCurrent = (requestID: number)',
    'navigationIntentID?: number',
    'const requestID = navigationIntentID ?? beginNavigation(activeTabID)',
    'const navigateTo = async',
    'const navigateToCrumb = async (index: number)',
    'index < 0 || index >= crumbs.length',
    'crumbs.slice(0, index + 1)',
    'const goBack = async',
    'const goForward = async',
    'const goUp = async',
    'canGoBack: historyIndex > 0',
    'canGoForward: historyIndex >= 0 && historyIndex < history.length - 1',
    'canGoUp: crumbs.length > 1',
    'if (isSearchActive() || !current)',
    'const committed = await onLoadDirectory(',
    'committed === false || !isNavigationCurrent(requestID)',
    'onAfterNavigate?.(nextCrumbs)',
    'const newTab = async () =>',
    'const activateTab = async (id: string) =>',
    'const closeTab = async (id = activeTabID) =>',
  ]) {
    assert.ok(shared.includes(token), `shared Explorer navigation missing: ${token}`)
  }
  assert.ok(controller.includes("XDRIVE_FILE_EXPLORER_DEFAULT_SORT = {\n  key: 'name',\n  direction: 'asc',"), 'framework-neutral controller must own the default Explorer sort')
  assert.ok(shared.includes("import { XDRIVE_FILE_EXPLORER_DEFAULT_SORT } from '../file-explorer-controller'"), 'navigation must consume the shared default sort')
  assert.ok(shared.includes('changeGrouping'), 'navigation must own per-tab grouping transitions')
  assert.ok(sharedMuiIndex.includes("export * from './FileExplorerNavigation'"), 'shared Explorer navigation controller must be exported')
})

test('Web and Desktop use shared FileExplorer navigation instead of duplicating history state', () => {
  for (const [label, source, key] of [
    ['Web', web, 'FILE_VIEW_KEY'],
    ['Desktop', desktop, 'DESKTOP_FILE_VIEW_KEY'],
  ]) {
    assert.equal((source.match(/useXDriveFileExplorerWorkspace</g) || []).length, 1, `${label} must use one shared Explorer workspace controller`)
    assert.ok(source.includes(`viewModeStorageKey: ${key}`), `${label} must keep its local storage namespace`)
    assert.equal(source.includes('setHistory('), false, `${label} must not duplicate Explorer history state`)
    assert.equal(source.includes('setHistoryIndex('), false, `${label} must not duplicate Explorer history index state`)
    assert.equal(source.includes('const goBack = async'), false, `${label} must not duplicate Explorer back navigation`)
    assert.equal(source.includes('const goForward = async'), false, `${label} must not duplicate Explorer forward navigation`)
    assert.equal(source.includes('const goUp = async'), false, `${label} must not duplicate Explorer up navigation`)
    assert.equal((source.match(/onRefresh=\{trashActive \? \(\) => \{ void trash\.refresh\(\) \} : refresh\}/g) || []).length, label === 'Web' ? 2 : 1, `${label} must delegate both iOS Mobile and Desktop-class refresh to the same workspace/Trash controller`)
    assert.ok(source.includes('onRefresh: refresh'), `${label} background menu must use shared refresh`)
    assert.equal(source.includes('if (current) void onLoadDirectory(current.id, crumbs, sort)'), false, `${label} must not duplicate current-directory refresh`)
    assert.ok(source.includes("pathValue={trashActive ? '回收站' : pathValue}"), `${label} must use shared navigation path display outside Trash`)
    assert.ok(source.includes('navigateToCrumb(index)'), `${label} must use shared breadcrumb navigation`)
    assert.equal(source.includes("crumbs.map((crumb) => crumb.name).join('/')"), false, `${label} must not derive the path display locally`)
    assert.equal(source.includes('navigateTo(crumbs.slice(0, index + 1))'), false, `${label} must not slice breadcrumb navigation locally`)
  }
  assert.ok(workspace.includes('useXDriveFileExplorerNavigation({'), 'workspace controller must compose shared navigation')
  assert.ok(workspace.includes('const navigationIntentID = navigation.beginNavigationIntent()'), 'typed-path resolution must reserve a navigation intent before async traversal')
  assert.ok(workspace.includes('navigation.navigateTo(nextCrumbs, true, navigationIntentID,'), 'typed-path navigation must consume its original intent')
  assert.ok(workspace.includes('(committed) => { accepted = committed }'), 'typed-path navigation must await the current first-page receipt')
  assert.ok(workspace.includes('navigation.isNavigationIntentCurrent(navigationIntentID)'), 'stale typed-path errors must be ignored')
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(source.includes('const navigationIntentID = beginNavigationIntent()'), `${label} pre-resolved navigation must reserve an intent`)
    assert.ok(source.includes('navigateTo(nextCrumbs, true, navigationIntentID)'), `${label} Quick Access/Recent navigation must consume its reserved intent`)
    assert.ok(source.includes('isNavigationIntentCurrent(navigationIntentID)'), `${label} stale Recent file activation must be ignored`)
  }
})


test('FileExplorer session restore stays shared and persists only committed open-tab state', () => {
  for (const token of [
    'fileExplorerNavigationSessionVersion = 1',
    'fileExplorerNavigationSessionHistoryLimit = 64',
    'const storedState = initialNavigationState',
    '? undefined\n      : loadStoredNavigationSession<TCrumb>',
    "initialNavigationSourceRef.current = initialNavigationState",
    "initialNavigationSourceRef.current === 'session'",
    'const requestID = beginNavigation(targetTab.id)',
    'historyOrder(targetTab).sort,',
    'historyOrder(targetTab).grouping,',
    'if (!isNavigationCurrent(requestID) || committed !== false) return',
    'history: [fallbackCrumbs]',
  ]) {
    assert.ok(shared.includes(token), 'session-restore contract missing: ' + token)
  }
  assert.equal(
    shared.includes('JSON.stringify(closedTabsRef.current)'),
    false,
    'recently closed tabs must remain in-memory and must not be session-persisted',
  )
  assert.ok(
    workspace.includes('navigationSessionStorageKey,'),
    'workspace controller must pass the optional session storage key into shared navigation',
  )
})


test('view mode storage denial cannot unmount shared navigation or corrupt the selected view', () => {
  const ts = require('typescript')
  const ast = ts.createSourceFile('FileExplorerNavigation.ts', shared,
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const loader = ast.statements.find(node =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'loadStoredViewMode')
  assert.ok(loader, 'must test the actual shared navigation storage loader')
  const js = code => ts.transpileModule(code, {
    fileName: 'FileExplorerNavigation.ts',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loadCode = js(loader.getText(ast) + '\nexports.load = loadStoredViewMode;')
  const loaderFor = win => {
    const output = {}
    new Function('exports', 'window', loadCode)(output, win)
    return output.load
  }
  const deniedGetter = {}
  Object.defineProperty(deniedGetter, 'localStorage', {
    get() { throw new Error('SecurityError: denied by browser') },
  })
  assert.equal(loaderFor(deniedGetter)('owner-42.view'), 'details')
  assert.equal(loaderFor({ localStorage: { getItem() {
    throw new Error('SecurityError: denied read')
  } } })('owner-42.view'), 'details')
  for (const [saved, expected] of [['grid', 'grid'], ['columns', 'columns'],
    ['invalid-view', 'details'], [null, 'details']]) {
    assert.equal(loaderFor({
      localStorage: { getItem: () => saved },
    })('owner-42.view'), expected)
  }

  const writers = []
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' &&
        node.arguments.length > 0 && ts.isArrowFunction(node.arguments[0])) {
      const text = node.arguments[0].getText(ast)
      if (text.includes('window.localStorage.setItem(viewModeStorageKey, viewMode)')) {
        writers.push(text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(writers.length, 1, 'must test the production List/Grid persistence effect')
  const effectCode = js('exports.effect = ' + writers[0] + ';')
  const effectFor = (win, viewMode = 'grid') => {
    const output = {}
    new Function('exports', 'window', 'viewModeStorageKey', 'viewMode',
      effectCode)(output, win, 'owner-42.view', viewMode)
    return output.effect
  }
  assert.doesNotThrow(effectFor(deniedGetter),
    'Safari localStorage getter denial must not throw in React effect')
  assert.doesNotThrow(effectFor({
    localStorage: { setItem() { throw new Error('QuotaExceededError') } },
  }), 'denied writes must leave current in-memory view usable')
  const writes = []
  effectFor({ localStorage: {
    setItem(key, value) { writes.push([key, value]) },
  } }, 'columns')()
  assert.deepEqual(writes, [['owner-42.view', 'columns']])
})

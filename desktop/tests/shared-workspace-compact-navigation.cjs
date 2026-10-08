const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')
const modelPath = 'ui/shared/src/mui/WorkspaceNavigation.tsx'
const componentPath = 'ui/shared/src/mui/WorkspaceCompactNavigation.tsx'

// This harness executes our navigation functions and event handlers. It does
// not model React reconciliation, DOM layout, media queries, or browser focus.
function createHookRuntime() {
  const slots = []
  let cursor = 0
  let effects = []
  let changed = false
  const sameDeps = (left, right) => Boolean(left && right
    && left.length === right.length
    && left.every((value, index) => Object.is(value, right[index])))
  const react = {
    useState(initialValue) {
      const index = cursor++
      if (!slots[index]) {
        slots[index] = { value: typeof initialValue === 'function' ? initialValue() : initialValue }
      }
      return [slots[index].value, (next) => {
        const value = typeof next === 'function' ? next(slots[index].value) : next
        if (!Object.is(value, slots[index].value)) {
          slots[index].value = value
          changed = true
        }
      }]
    },
    useRef(initialValue) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: { current: initialValue } }
      return slots[index].value
    },
    useMemo(factory, deps) {
      const index = cursor++
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) {
        slots[index] = { value: factory(), deps }
      }
      return slots[index].value
    },
    useCallback(callback, deps) {
      return react.useMemo(() => callback, deps)
    },
    useEffect(effect, deps) {
      const index = cursor++
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) {
        effects.push({ index, effect, deps })
      }
    },
    useId() {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: `navigation-test-${index}` }
      return slots[index].value
    },
  }
  return {
    react,
    render(factory) {
      let result
      let passes = 0
      do {
        assert.ok(passes++ < 10, 'navigation state did not settle after effects')
        changed = false
        cursor = 0
        effects = []
        result = factory()
        for (const { index, effect, deps } of effects) {
          slots[index]?.cleanup?.()
          slots[index] = { deps, cleanup: effect() }
        }
      } while (changed)
      return result
    },
  }
}

const jsxRuntime = {
  jsx: (type, props, key) => ({ type, props: props ?? {}, key }),
  jsxs: (type, props, key) => ({ type, props: props ?? {}, key }),
  Fragment: Symbol('Fragment'),
}
const mui = new Proxy({}, { get: (_target, key) => String(key) })

function compile(source, filename) {
  const result = ts.transpileModule(source, {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  const errors = (result.diagnostics ?? []).filter((entry) => entry.category === ts.DiagnosticCategory.Error)
  assert.equal(errors.length, 0, errors.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, '\n')).join('\n'))
  return result.outputText
}

function createLoader(react = createHookRuntime().react) {
  const cache = new Map()
  const load = (relativePath) => {
    const filename = path.resolve(repo, relativePath)
    assert.ok(fs.existsSync(filename), `missing shared navigation implementation: ${relativePath}`)
    if (cache.has(filename)) return cache.get(filename)
    const mod = { exports: {} }
    cache.set(filename, mod.exports)
    const localRequire = (request) => {
      if (request === 'react') return react
      if (request === 'react/jsx-runtime') return jsxRuntime
      if (request === '@mui/material') return mui
      if (request.startsWith('@mui/icons-material/')) {
        return { __esModule: true, default: `Icon:${request.split('/').at(-1)}` }
      }
      if (request.startsWith('.')) {
        const base = path.resolve(path.dirname(filename), request)
        const target = [base, `${base}.tsx`, `${base}.ts`, path.join(base, 'index.ts')]
          .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
        assert.ok(target, `unresolved production dependency: ${request} from ${relativePath}`)
        return load(path.relative(repo, target))
      }
      return require(request)
    }
    new Function('exports', 'module', 'require', compile(fs.readFileSync(filename, 'utf8'), filename))(
      mod.exports, mod, localRequire,
    )
    cache.set(filename, mod.exports)
    return mod.exports
  }
  return load
}

function productionWebSections(profile) {
  const filename = path.join(repo, 'web/src/App.tsx')
  const source = fs.readFileSync(filename, 'utf8')
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let initializer
  const dependencies = { profile }
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.name.text === 'webSidebarSections') initializer = node.initializer
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text.startsWith('@mui/icons-material/') && node.importClause?.name) {
      dependencies[node.importClause.name.text] = `Icon:${node.importClause.name.text}`
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assert.ok(initializer, 'Web must supply its actual role-filtered sidebar sections')
  const output = compile(`exports.sections = (${initializer.getText(sourceFile)});`, filename)
  const exports = {}
  new Function('exports', 'require', ...Object.keys(dependencies), output)(
    exports,
    (request) => {
      assert.equal(request, 'react/jsx-runtime', 'unexpected dependency in Web sidebar model')
      return jsxRuntime
    },
    ...Object.values(dependencies),
  )
  return exports.sections
}

function freezeTree(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.values(value).forEach(freezeTree)
  return Object.freeze(value)
}

function keys(items) {
  return items.map((item) => item.key)
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object' || !('type' in tree)) return []
  const children = typeof tree.type === 'function' ? tree.type(tree.props) : tree.props.children
  return [tree, ...nodes(children)]
}

function only(tree, type, predicate = () => true) {
  const found = nodes(tree).filter((node) => node.type === type && predicate(node))
  assert.equal(found.length, 1, `expected exactly one ${type} matching the navigation action`)
  return found[0]
}

function textOf(tree) {
  if (tree == null || typeof tree === 'boolean') return ''
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(textOf).join('')
  return textOf(tree.props?.primary) + textOf(tree.props?.children)
}

function componentHarness(overrides = {}) {
  const runtime = createHookRuntime()
  const Component = createLoader(runtime.react)(componentPath).XDriveWorkspaceCompactNavigation
  assert.equal(typeof Component, 'function', 'shared compact navigation component must be exported')
  const calls = []
  let props = {
    primary: [
      { key: 'overview', label: '主页', icon: null },
      { key: 'files', label: '文件', icon: null },
      { key: 'gallery', label: '图库', icon: null },
      { key: 'transfers', label: '传输', compactLabel: '任务', icon: null, badge: 4 },
    ],
    moreSections: [
      { key: 'core', items: [{ key: 'sources', label: '同步文件夹', icon: null }] },
      { key: 'admin', label: '管理', items: [{ key: 'admin-users', label: '用户管理', icon: null }] },
    ],
    selected: 'files',
    ariaLabel: '网页端功能区',
    navAriaLabel: '网页端功能区导航',
    onSelect: (key, event) => calls.push({ key, event }),
    ...overrides,
  }
  const render = (next = {}) => {
    props = { ...props, ...next }
    return runtime.render(() => Component(props))
  }
  return { render, calls }
}

function moreAction(tree) {
  return only(tree, 'BottomNavigationAction', (node) => node.props.label === '更多')
}

function drawerOpen(tree) {
  return nodes(tree).some((node) => node.type === 'Drawer' && node.props.open)
}

function clickEvent(modifiers = {}) {
  return {
    type: 'click', button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
    preventDefault() {}, stopPropagation() {}, ...modifiers,
  }
}

test('core destinations omit unsupported local storage and retain the task badge on the existing key', () => {
  const { xDriveCoreWorkspaceDestinations } = createLoader()(modelPath)
  const withoutLocal = xDriveCoreWorkspaceDestinations({ transferBadge: 7 })
  assert.deepEqual(keys(withoutLocal), ['files', 'gallery', 'sources', 'transfers', 'cloud-storage'])
  const withLocal = xDriveCoreWorkspaceDestinations({ transferBadge: 7, showLocalStorage: true })
  assert.deepEqual(keys(withLocal), ['files', 'gallery', 'sources', 'transfers', 'local-storage', 'cloud-storage'])
  const tasks = withLocal.find((item) => item.key === 'transfers')
  assert.equal(tasks.label, '任务')
  assert.equal(tasks.compactLabel, '任务')
  assert.equal(tasks.badge, 7)
})

test('compact primary destinations promote Home from caller sections without inventing it', () => {
  const { xDriveCompactWorkspaceNavigation } = createLoader()(modelPath)
  const withHome = xDriveCompactWorkspaceNavigation({
    sections: [{ key: 'home', placement: 'bottom', items: [{ key: 'overview', label: '主页', icon: null }] }],
  })
  assert.deepEqual(keys(withHome.primary), ['overview', 'files', 'gallery', 'transfers'])
  assert.deepEqual(withHome.moreSections.flatMap((section) => keys(section.items)), ['sources', 'cloud-storage'])
  const withoutHome = xDriveCompactWorkspaceNavigation({})
  assert.deepEqual(keys(withoutHome.primary), ['files', 'gallery', 'transfers'])
})

test('More preserves extension placement and metadata while removing promoted and empty sections without mutation', () => {
  const { xDriveCompactWorkspaceNavigation } = createLoader()(modelPath)
  const sections = freezeTree([
    { key: 'bottom', label: '辅助', placement: 'bottom', items: [{ key: 'bottom-only', label: '诊断', icon: null }] },
    { key: 'after', label: '管理', ariaLabel: '额外管理', items: [{ key: 'after-only', label: '设置', icon: null }] },
    { key: 'empty', placement: 'before-core', items: [] },
    { key: 'before', label: '快捷位置', placement: 'before-core', items: [
      { key: 'overview', label: '主页', icon: null },
      { key: 'before-only', label: '收藏夹', icon: { type: 'custom-icon', props: {} }, badge: 3, secondary: '已固定' },
    ] },
  ])
  const before = JSON.stringify(sections)
  const result = xDriveCompactWorkspaceNavigation({ sections, showLocalStorage: true })
  assert.deepEqual(result.moreSections.map((section) => keys(section.items)), [
    ['before-only'], ['sources', 'local-storage', 'cloud-storage'], ['after-only'], ['bottom-only'],
  ])
  assert.equal(result.moreSections[0].label, '快捷位置')
  assert.deepEqual(result.moreSections[0].items[0], sections[3].items[1])
  assert.equal(result.moreSections[2].ariaLabel, '额外管理')
  assert.equal(JSON.stringify(sections), before)
})

test('the actual Web role-filtered sections feed the same compact menu for administrators and ordinary users', () => {
  const { xDriveCompactWorkspaceNavigation } = createLoader()(modelPath)
  for (const { profile, expectedMore } of [
    { profile: undefined, expectedMore: ['sources', 'local-storage', 'cloud-storage'] },
    { profile: { role: 'user' }, expectedMore: ['sources', 'local-storage', 'cloud-storage'] },
    { profile: { role: 'admin' }, expectedMore: ['sources', 'local-storage', 'cloud-storage', 'global-tasks', 'admin-users', 'admin-audit', 'admin-storage'] },
  ]) {
    const result = xDriveCompactWorkspaceNavigation({ sections: productionWebSections(profile), showLocalStorage: true })
    assert.deepEqual(keys(result.primary), ['overview', 'files', 'gallery', 'transfers'])
    assert.deepEqual(result.moreSections.flatMap((section) => keys(section.items)), expectedMore, `role: ${profile?.role ?? 'missing'}`)
  }
})

test('compact destination keys continue to resolve through the existing Web app registry', () => {
  const { xDriveWebAppForWorkspaceKey } = createLoader()('web/src/webApps.ts')
  assert.equal(xDriveWebAppForWorkspaceKey('transfers'), 'tasks')
  assert.equal(xDriveWebAppForWorkspaceKey('sources'), 'sync-folders')
  assert.equal(xDriveWebAppForWorkspaceKey('files'), 'files')
  assert.equal(xDriveWebAppForWorkspaceKey('more'), null)
})

test('primary navigation presents Task while forwarding its original click event once under the shared key', () => {
  const harness = componentHarness()
  const tree = harness.render()
  const actions = nodes(tree).filter((node) => node.type === 'BottomNavigationAction')
  assert.deepEqual(actions.map((node) => node.props.label), ['主页', '文件', '图库', '任务', '更多'])
  const event = clickEvent({ metaKey: true })
  only(tree, 'BottomNavigationAction', (node) => node.props.label === '任务').props.onClick(event)
  assert.equal(harness.calls.length, 1)
  assert.equal(harness.calls[0].key, 'transfers')
  assert.equal(harness.calls[0].event, event)
  assert.equal(drawerOpen(harness.render()), false)
})

test('More opens and closes a drawer without changing the selected route or invoking navigation', () => {
  const harness = componentHarness()
  let tree = harness.render()
  assert.equal(drawerOpen(tree), false)
  moreAction(tree).props.onClick(clickEvent())
  tree = harness.render()
  assert.equal(drawerOpen(tree), true)
  assert.equal(only(tree, 'BottomNavigation').props.value, 'files')
  assert.deepEqual(harness.calls, [])
  only(tree, 'Drawer').props.onClose({}, 'backdropClick')
  assert.equal(drawerOpen(harness.render()), false)
  assert.deepEqual(harness.calls, [])
})

test('selecting a More destination forwards the original event once and closes the drawer', () => {
  const harness = componentHarness()
  moreAction(harness.render()).props.onClick(clickEvent())
  const tree = harness.render()
  const event = clickEvent({ ctrlKey: true })
  only(tree, 'ListItemButton', (node) => textOf(node).includes('同步文件夹')).props.onClick(event)
  assert.equal(harness.calls.length, 1)
  assert.equal(harness.calls[0].key, 'sources')
  assert.equal(harness.calls[0].event, event)
  assert.equal(drawerOpen(harness.render()), false)
})

test('active navigation follows selected props and locates secondary destinations inside More', () => {
  const harness = componentHarness()
  for (const [selected, expected] of [
    ['overview', 'overview'], ['files', 'files'], ['transfers', 'transfers'],
    ['sources', 'more'], ['admin-users', 'more'], ['unknown', false], [undefined, false],
  ]) {
    assert.equal(only(harness.render({ selected }), 'BottomNavigation').props.value, expected)
  }
  let tree = harness.render({ selected: 'admin-users' })
  moreAction(tree).props.onClick(clickEvent())
  tree = harness.render()
  assert.equal(only(tree, 'ListItemButton', (node) => textOf(node).includes('用户管理')).props.selected, true)
  assert.equal(Boolean(only(tree, 'ListItemButton', (node) => textOf(node).includes('同步文件夹')).props.selected), false)
})

test('an external selected-route change closes More without navigating again', () => {
  const harness = componentHarness()
  moreAction(harness.render()).props.onClick(clickEvent())
  assert.equal(drawerOpen(harness.render()), true)
  const tree = harness.render({ selected: 'gallery' })
  assert.equal(drawerOpen(tree), false)
  assert.equal(only(tree, 'BottomNavigation').props.value, 'gallery')
  assert.deepEqual(harness.calls, [])
})

test('disabled compact navigation prevents both More opening and primary callbacks', () => {
  const harness = componentHarness({ disabled: true })
  const tree = harness.render()
  for (const action of nodes(tree).filter((node) => node.type === 'BottomNavigationAction')) {
    assert.equal(action.props.disabled, true)
    action.props.onClick(clickEvent())
  }
  assert.equal(drawerOpen(harness.render()), false)
  assert.deepEqual(harness.calls, [])
})

test('becoming disabled clears an open drawer and re-enabling starts closed', () => {
  const harness = componentHarness()
  moreAction(harness.render()).props.onClick(clickEvent())
  assert.equal(drawerOpen(harness.render()), true)
  assert.equal(drawerOpen(harness.render({ disabled: true })), false)
  assert.equal(drawerOpen(harness.render({ disabled: false })), false)
  assert.deepEqual(harness.calls, [])
})

function accountMenuHarness() {
  const runtime = createHookRuntime()
  const filename = path.join(repo, 'web/src/App.tsx')
  const sourceFile = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = sourceFile.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'WebAccountMenu')
  assert.ok(declaration, 'Web owns its account menu and platform actions')
  const effects = []
  const controller = {
    state: null, source: 'github', channel: 'stable', backupFileData: false, busy: false, error: null,
    setSource() {}, setChannel() {}, setBackupFileData() {}, start() { effects.push('update') },
  }
  const dependencies = {
    ...runtime.react,
    useXDriveServerUpdateController: () => controller,
    xDriveServerUpdateConfirmationDescription: () => 'test confirmation',
    ...Object.fromEntries([
      'XDriveAccountAvatarButton', 'XDriveAccountMenu', 'XDriveAccountMenuActions',
      'XDriveSettingsDialog', 'XDriveConfirmDialog',
    ].map((name) => [name, name])),
  }
  const mod = { exports: {} }
  new Function('exports', 'require', ...Object.keys(dependencies), compile(
    `${declaration.getText(sourceFile)}\nexports.WebAccountMenu = WebAccountMenu;`, filename,
  ))(mod.exports, (request) => {
    assert.equal(request, 'react/jsx-runtime')
    return jsxRuntime
  }, ...Object.values(dependencies))
  let props = {
    username: 'test', api: {}, serverBuild: null, appearance: 'light', canUpdateServer: true,
    onAppearanceChange() {}, onLogout() { effects.push('logout') }, disabled: false,
  }
  return {
    effects,
    render(next = {}) {
      props = { ...props, ...next }
      return runtime.render(() => mod.exports.WebAccountMenu(props))
    },
  }
}

test('entering Viewer closes the account menu and returning does not restore its portal', () => {
  const harness = accountMenuHarness()
  const anchor = { id: 'account-button' }
  only(harness.render(), 'XDriveAccountAvatarButton').props.onClick({ currentTarget: anchor })
  assert.equal(only(harness.render(), 'XDriveAccountMenu').props.anchorEl, anchor)
  assert.equal(only(harness.render({ disabled: true }), 'XDriveAccountMenu').props.anchorEl, null)
  assert.equal(only(harness.render({ disabled: false }), 'XDriveAccountMenu').props.anchorEl, null)
  assert.deepEqual(harness.effects, [])
})

test('entering Viewer also clears account settings and update confirmation without taking an action', () => {
  const harness = accountMenuHarness()
  only(harness.render(), 'XDriveAccountMenuActions').props.onSettings()
  let tree = harness.render()
  assert.equal(only(tree, 'XDriveSettingsDialog').props.open, true)
  only(tree, 'XDriveSettingsDialog').props.serverUpdate.onStart()
  assert.equal(only(harness.render(), 'XDriveConfirmDialog').props.open, true)
  for (const disabled of [true, false]) {
    tree = harness.render({ disabled })
    assert.equal(only(tree, 'XDriveSettingsDialog').props.open, false)
    assert.equal(only(tree, 'XDriveConfirmDialog').props.open, false)
  }
  assert.deepEqual(harness.effects, [])
})

test('disabled account controls cannot reopen portals or trigger account actions during exit transitions', () => {
  const harness = accountMenuHarness()
  let tree = harness.render({ disabled: true })
  only(tree, 'XDriveAccountAvatarButton').props.onClick({ currentTarget: {} })
  only(tree, 'XDriveAccountMenuActions').props.onSettings()
  only(tree, 'XDriveAccountMenuActions').props.onLogout()
  only(tree, 'XDriveSettingsDialog').props.serverUpdate.onStart()
  only(tree, 'XDriveConfirmDialog').props.onConfirm()
  tree = harness.render()
  assert.equal(only(tree, 'XDriveAccountMenu').props.anchorEl, null)
  assert.equal(only(tree, 'XDriveSettingsDialog').props.open, false)
  assert.equal(only(tree, 'XDriveConfirmDialog').props.open, false)
  assert.deepEqual(harness.effects, [])
})

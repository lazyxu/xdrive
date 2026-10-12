const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')

const web = read('web', 'src', 'App.tsx')
const desktop = read('desktop', 'src', 'renderer', 'App.tsx')
const model = read('ui', 'shared', 'src', 'web-app.ts')
const registry = read('web', 'src', 'webApps.ts')
const settings = read('ui', 'shared', 'src', 'mui', 'SettingsDialog.tsx')
const maintenance = read('ui', 'shared', 'src', 'mui', 'SystemMaintenancePage.tsx')
const router = read('internal', 'api', 'router.go')

test('administrator System Maintenance is typed and routed on Web/Desktop', () => {
  assert.ok(model.includes("'admin-maintenance'"))
  assert.ok(model.includes("'admin-maintenance': Record<string, never>"))
  assert.ok(model.includes("case 'admin-maintenance':"))
  assert.ok(registry.includes("'admin-maintenance': { id: 'admin-maintenance'"))
  assert.ok(registry.includes("workspaceKey: 'admin-maintenance', sidebar: true, admin: true"))
  assert.ok(web.includes("appView === 'admin-maintenance' && profile?.role === 'admin'"))
  assert.ok(web.includes("appView.startsWith('admin-')"))
  assert.ok(desktop.includes("view === 'admin-maintenance' && status?.role === 'admin'"))
  assert.ok(desktop.includes("view === 'global-tasks' || view === 'admin-users' || view === 'admin-services' || view === 'admin-maintenance'"))
})

test('only admin group exposes System Maintenance in Web/Desktop including Mobile Web', () => {
  for (const [source, name, guard] of [
    [web, 'webSidebarSections', "profile?.role === 'admin'"],
    [desktop, 'desktopSidebarSections', "status?.role === 'admin'"],
  ]) {
    const start = source.indexOf('const ' + name + ': XDriveSidebarSectionModel[]')
    const end = source.indexOf('\n  ]', start)
    assert.ok(start >= 0 && end > start)
    const section = source.slice(start, end)
    assert.ok(section.includes(guard))
    assert.equal((section.match(/key: 'admin-maintenance'/g) || []).length, 1)
    assert.ok(section.indexOf("key: 'admin-maintenance'") > section.indexOf("key: 'admin',"))
    if (source === desktop) assert.ok(section.indexOf("key: 'diagnostics'") < section.indexOf("key: 'admin',"))
  }
})

test('instance-wide update is absent from personal Settings and mounted only in shared admin page', () => {
  assert.equal(settings.includes('serverUpdate'), false)
  assert.equal(settings.includes('XDriveServerUpdateCard'), false)
  assert.equal(web.includes('serverUpdate={{'), false)
  assert.equal(desktop.includes('serverUpdate={{'), false)
  assert.ok(web.includes('<XDriveSettingsDialog'))
  assert.ok(desktop.includes('<XDriveSettingsDialog'))
  assert.ok(maintenance.includes('useXDriveServerUpdateController({'))
  assert.ok(maintenance.includes('open: true'))
  assert.ok(maintenance.includes('xDriveServerUpdateConfirmationDescription({'))
  assert.ok(maintenance.includes('<XDriveServerUpdateCard'))
  assert.ok(maintenance.includes('<XDriveConfirmDialog'))
  assert.ok(maintenance.includes('confirmIntent="warning"'))
  assert.ok(maintenance.includes('离开此页面不会取消更新任务'))
})

test('existing Server admin REST and Desktop Agent IPC remain authoritative', () => {
  assert.ok(router.includes('admin.Use(s.requireAdmin())'))
  assert.ok(router.includes('admin.GET("/update", s.adminServerUpdateStatus)'))
  assert.ok(router.includes('admin.POST("/update", s.adminStartServerUpdate)'))
  assert.ok(web.includes('getState: () => api.adminServerUpdate()'))
  assert.ok(web.includes('api.adminStartServerUpdate(source, channel, backupFileData)'))
  assert.ok(desktop.includes('getState: () => window.xdriveDesktop.agent.getServerUpdate()'))
  assert.ok(desktop.includes('window.xdriveDesktop.agent.startServerUpdate(source, channel, backupFileData)'))
  assert.ok(desktop.includes('supported={serverUpdateSupported}'))
})

test('administrator maintenance requires explicit confirmation before posting a durable host update', () => {
  const ts = require('typescript')
  const filename = path.join(root, 'ui/shared/src/mui/SystemMaintenancePage.tsx')
  const parsed = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = parsed.statements.find((node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'XDriveSystemMaintenancePage')
  assert.ok(declaration, 'shared administrator page function must exist')
  const program = ts.transpileModule(declaration.getText(parsed) + '\nexports.Page = XDriveSystemMaintenancePage;', {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const slots = []
  let slot = 0
  const effects = []
  const hooks = {
    useState(initial) {
      const i = slot++
      if (!slots[i]) slots[i] = { value: initial }
      return [slots[i].value, (value) => { slots[i].value = value }]
    },
    useXDriveServerUpdateController() {
      return {
        state: { supported: true, state: 'idle' },
        source: 'github', channel: 'stable', backupFileData: false,
        busy: false, error: '', setSource() {}, setChannel() {}, setBackupFileData() {},
        start() { effects.push('host-start') },
      }
    },
  }
  const jsx = (type, props) => ({type, props: props || {}})
  const deps = {
    ...hooks,
    xDriveServerUpdateConfirmationDescription: () => 'fixed confirmation summary',
    XDriveWorkspaceSurface: 'WorkspaceSurface',
    XDriveStatusAlert: 'StatusAlert',
    XDriveServerUpdateCard: 'ServerUpdateCard',
    XDriveConfirmDialog: 'ConfirmDialog',
    Stack: 'Stack',
  }
  const mod = {exports: {}}
  new Function('exports', 'require', ...Object.keys(deps), program)(
    mod.exports, (request) => {
      assert.equal(request, 'react/jsx-runtime')
      return {jsx, jsxs: jsx, Fragment: 'Fragment'}
    }, ...Object.values(deps),
  )
  function all(tree) {
    if (!tree || typeof tree !== 'object') return []
    if (Array.isArray(tree)) return tree.flatMap(all)
    return [tree, ...all(tree.props?.children)]
  }
  function render(disabled = false) {
    slot = 0
    const tree = mod.exports.Page({ updatePort: {}, disabled })
    const card = all(tree).find((node) => node.type === 'ServerUpdateCard')
    const dialog = all(tree).find((node) => node.type === 'ConfirmDialog')
    assert.ok(card && dialog, 'shared status and confirmation must be mounted')
    return {card, dialog}
  }
  let shown = render()
  assert.equal(shown.dialog.props.open, false)
  shown.card.props.onStart()
  assert.deepEqual(effects, [], 'Start must not run before explicit confirmation')
  shown = render()
  assert.equal(shown.dialog.props.open, true)
  assert.equal(shown.dialog.props.description, 'fixed confirmation summary')
  shown.dialog.props.onConfirm()
  assert.deepEqual(effects, ['host-start'])
  assert.equal(render().dialog.props.open, false)
  shown = render(true)
  assert.equal(shown.card.props.disabled, true)
  shown.card.props.onStart()
  shown.dialog.props.onConfirm()
  assert.equal(render(true).dialog.props.open, false)
  assert.deepEqual(effects, ['host-start'], 'disabled administrator control must not start another task')
})

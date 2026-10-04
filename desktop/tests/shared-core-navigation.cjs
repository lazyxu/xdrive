const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const sharedNav = read('ui', 'shared', 'src', 'mui', 'SidebarNav.tsx')
const sharedSidebar = read('ui', 'shared', 'src', 'mui', 'WorkspaceSidebar.tsx')
const web = read('web', 'src', 'App.tsx')
const desktop = read('desktop', 'src', 'renderer', 'App.tsx')

test('shared core navigation owns common destinations and capability-gates local storage', () => {
  assert.ok(sharedNav.includes("export type XDriveCoreWorkspaceKey = 'files' | 'gallery' | 'sources' | 'transfers' | 'local-storage' | 'cloud-storage'"))
  assert.ok(sharedNav.includes('export function XDriveCoreWorkspaceNavItems'))
  assert.ok(sharedNav.includes('showLocalStorage = false'), 'local storage must be opt-in because it is Desktop-only')
  const labels = [
    'primary="文件"',
    'primary="图库"',
    'primary="同步文件夹"',
    'primary="传输"',
    'primary="本地存储"',
    'primary="云端存储"',
  ]
  let cursor = -1
  for (const label of labels) {
    const next = sharedNav.indexOf(label)
    assert.ok(next > cursor, `shared core navigation order missing or changed: ${label}`)
    cursor = next
  }
  assert.ok(sharedNav.includes('{showLocalStorage ? ('), 'local storage destination must remain capability-gated')
  assert.ok(sharedNav.includes('badge={transferBadge}'), 'shared transfer destination must own the transfer badge slot')
})

test('shared WorkspaceSidebar owns the complete sidebar composition', () => {
  for (const token of [
    'export type XDriveSidebarDestination',
    'export type XDriveWorkspaceSidebarSectionModel',
    'export function XDriveWorkspaceSidebar',
    '<XDriveSidebarSurface',
    '<XDriveSidebarNavList',
    '<XDriveCoreWorkspaceNavItems',
    '<XDriveSidebarSection',
    '<XDriveSidebarStorageSummary',
    'leadingItems.map',
    'trailingItems.map',
    'sections.map',
    'showLocalStorage={showLocalStorage}',
  ]) {
    assert.ok(sharedSidebar.includes(token), `shared WorkspaceSidebar missing: ${token}`)
  }
})

test('Web and Desktop consume the same shared WorkspaceSidebar', () => {
  assert.equal((web.match(/<XDriveWorkspaceSidebar\b/g) || []).length, 1)
  assert.equal((desktop.match(/<XDriveWorkspaceSidebar\b/g) || []).length, 1)
  for (const token of [
    '<XDriveSidebarSurface',
    '<XDriveSidebarNavList',
    '<XDriveCoreWorkspaceNavItems',
    '<XDriveSidebarSection',
    '<XDriveSidebarStorageSummary',
  ]) {
    assert.equal(web.includes(token), false, `Web must not assemble sidebar primitive directly: ${token}`)
    assert.equal(desktop.includes(token), false, `Desktop must not assemble sidebar primitive directly: ${token}`)
  }
  for (const label of [
    'primary="文件"',
    'primary="图库"',
    'primary="同步文件夹"',
    'primary="传输"',
    'primary="本地存储"',
    'primary="云端存储"',
  ]) {
    assert.equal(web.includes(label), false, `Web must not duplicate shared core label: ${label}`)
    assert.equal(desktop.includes(label), false, `Desktop must not duplicate shared core label: ${label}`)
  }
})

test('local storage is Desktop-only while cloud storage remains shared', () => {
  assert.ok(desktop.includes("type View = 'overview' | 'files' | 'gallery' | 'sources' | 'transfers' | 'local-storage' | 'cloud-storage'"))
  assert.ok(desktop.includes('showLocalStorage'), 'Desktop must opt into the shared local-storage destination')
  assert.ok(desktop.includes('<DesktopLocalStoragePage source={localStorageSource} />'), 'Desktop must render Local Storage')
  assert.ok(desktop.includes('<XDriveCloudStoragePage source={cloudStorageSource} />'), 'Desktop must render shared Cloud Storage')
  assert.equal(web.includes("| 'local-storage'"), false, 'Web must not expose a local-storage route')
  assert.equal(web.includes('showLocalStorage'), false, 'Web must not expose the local-storage destination')
  assert.equal(web.includes('LocalStoragePage'), false, 'Web must not render the Desktop-only Local Storage page')
  assert.equal(web.includes('localStorageSource'), false, 'Web must not create a local-storage data adapter')
  assert.ok(web.includes("| 'cloud-storage'"), 'Web must expose Cloud Storage')
  assert.ok(web.includes('<XDriveCloudStoragePage source={cloudStorageSource} />'), 'Web must render shared Cloud Storage')
})

test('Desktop Files routing uses the shared files key directly', () => {
  assert.ok(desktop.includes("type View = 'overview' | 'files'"), 'Desktop must use files as its real view key')
  assert.equal(desktop.includes("view === 'cloud'"), false, 'legacy cloud view key must be removed')
  assert.equal(desktop.includes("setView('cloud')"), false, 'legacy cloud navigation must be removed')
  assert.ok(desktop.includes('selected={view}'), 'Desktop shared sidebar selection should use the real view directly')
  assert.ok(desktop.includes('onSelect={(destination) => setView(destination as View)}'), 'Desktop shared sidebar should route directly')
})

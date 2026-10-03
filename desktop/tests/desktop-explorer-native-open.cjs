const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const app = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx'), 'utf8')
const main = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'main', 'index.cts'), 'utf8')
const preload = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'preload', 'index.cts'), 'utf8')
const types = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'global.d.ts'), 'utf8')
const ipc = fs.readFileSync(path.join(repoRoot, 'cmd', 'xdrive-agent', 'desktop_ipc.go'), 'utf8')
const controller = fs.readFileSync(path.join(repoRoot, 'cmd', 'xdrive-agent', 'controller.go'), 'utf8')
const windowsPlatform = fs.readFileSync(path.join(repoRoot, 'cmd', 'xdrive-agent', 'platform_windows.go'), 'utf8')
const otherPlatform = fs.readFileSync(path.join(repoRoot, 'cmd', 'xdrive-agent', 'platform_other.go'), 'utf8')
const sharedActions = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerActions.tsx'), 'utf8')

test('Desktop Explorer opens files from the managed sync tree instead of defaulting to Save As', () => {
  assert.ok(app.includes('const relativePathForNode = (node: AgentCloudNode) => {'), 'Desktop Explorer relative-path resolver is missing')
  assert.ok(app.includes('await window.xdriveDesktop.agent.openPath(relativePath, reveal)'), 'Desktop Explorer is not wired to managed-path shell actions')
  assert.ok(app.includes('xDriveFileExplorerDispatchOpenItem({'), 'double-clicking should dispatch through the shared open-item controller')
  assert.ok(app.includes('openFile: openLocalNode'), 'double-clicking a file should open the synced local item through the Desktop adapter')
  assert.ok(app.includes("downloadLabel: '另存为…'"), 'Desktop must preserve explicit Save As wording through the shared action adapter')
  assert.ok(app.includes('onReveal: () => { void openLocalNode(node, true) }'), 'Desktop reveal adapter is missing')
  assert.ok(sharedActions.includes("revealLabel = '在文件资源管理器中显示'"), 'shared reveal-in-file-manager label is missing')
})

test('managed path shell actions are enforced inside the Agent boundary', () => {
  assert.ok(ipc.includes('"open-path"'), 'Agent capability for managed path actions is missing')
  assert.ok(ipc.includes('POST /v1/open-path'), 'Agent managed-path route is missing')
  assert.ok(ipc.includes('filepath.IsAbs(input.Path)'), 'Agent IPC must reject absolute path requests')
  assert.ok(controller.includes('func (c *agentController) OpenManagedPath(path string, reveal bool) error'), 'managed path controller action is missing')
  assert.ok(controller.includes('_, root, abs, err := managedPath(path)'), 'managed path action must reuse the sync-root containment boundary')
  assert.ok(controller.includes('_ = mount.RequestSync(root)'), 'missing local placeholders should request a sync before returning')
  assert.ok(controller.includes('return selectFilePlatform(abs)'), 'reveal action is not using the platform file manager')
  assert.ok(controller.includes('return openFilePlatform(abs)'), 'file open action is not using the system default application')
})

test('renderer only receives relative-path shell contracts through preload/main IPC', () => {
  assert.ok(preload.includes("openPath: (relativePath: string, reveal = false) => ipcRenderer.invoke('agent:open-path', relativePath, reveal)"), 'preload managed-path contract is missing')
  assert.ok(types.includes('openPath: (relativePath: string, reveal?: boolean)'), 'renderer managed-path typing is missing')
  assert.ok(main.includes("requireAgentCapability(hello, 'open-path')"), 'Electron main must capability-gate managed-path actions')
  assert.ok(main.includes('path.isAbsolute(relativePath)'), 'Electron main must reject absolute renderer paths before Agent IPC')
})

test('platform reveal semantics use the native file manager', () => {
  assert.ok(windowsPlatform.includes('exec.Command("explorer.exe", "/select,"+path)'), 'Windows reveal must select the file in Explorer')
  assert.ok(otherPlatform.includes('openFolderPlatform(filepath.Dir(path))'), 'non-Windows reveal should open the containing folder')
})
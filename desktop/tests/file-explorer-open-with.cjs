const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const controller = read('cmd', 'xdrive-agent', 'controller.go')
const agentIPC = read('cmd', 'xdrive-agent', 'desktop_ipc.go')
const windowsPlatform = read('cmd', 'xdrive-agent', 'platform_windows.go')
const otherPlatform = read('cmd', 'xdrive-agent', 'platform_other.go')
const agentClient = read('desktop', 'src', 'main', 'agent_client.cts')
const main = read('desktop', 'src', 'main', 'index.cts')
const preload = read('desktop', 'src', 'preload', 'index.cts')
const rendererTypes = read('desktop', 'src', 'renderer', 'global.d.ts')
const app = read('desktop', 'src', 'renderer', 'App.tsx')
const explorer = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')

test('Windows Open With stays behind the managed Agent path boundary', () => {
  for (const token of [
    'func (c *agentController) OpenManagedPathWith(path string) error',
    'managedPath(path)',
    'os.Stat(abs)',
    'openWithPlatform(abs)',
  ]) {
    assert.ok(controller.includes(token), 'managed Open With boundary missing: ' + token)
  }

  for (const token of [
    'desktopIPCHelloCapabilities',
    'openWithSupportedPlatform()',
    'capabilities = append(capabilities, "open-with")',
    'POST /v1/open-with',
    'OpenManagedPathWith(path string) error',
    'func (h *desktopIPCHandler) openWith',
    'filepath.IsAbs(input.Path)',
  ]) {
    assert.ok(agentIPC.includes(token), 'Agent Open With IPC contract missing: ' + token)
  }
})

test('Windows uses SHOpenWithDialog instead of a rundll32 Open-As shortcut', () => {
  for (const token of [
    'SHOpenWithDialog',
    'type openAsInfo struct',
    'openAsInfoExec = 0x00000004',
    'func openWithSupportedPlatform() bool { return true }',
    'func openWithPlatform(path string) error',
  ]) {
    assert.ok(windowsPlatform.includes(token), 'Windows native Open With missing: ' + token)
  }
  const openWithStart = windowsPlatform.indexOf('func openWithPlatform(path string) error')
  const openWithBody = windowsPlatform.slice(openWithStart)
  assert.equal(
    openWithBody.includes('rundll32.exe'),
    false,
    'Open With must use SHOpenWithDialog rather than a rundll32 Open-As hack',
  )
})

test('macOS open and reveal use Finder-native open commands without advertising Open With', () => {
  for (const token of [
    'case "darwin":',
    'exec.Command("open", path).Start()',
    'exec.Command("open", "-R", path).Start()',
    'func openWithSupportedPlatform() bool { return false }',
  ]) {
    assert.ok(otherPlatform.includes(token), 'macOS open/reveal contract missing: ' + token)
  }
})

test('Electron and Desktop expose Open With only when Agent advertises it', () => {
  for (const token of [
    "openWith(path: string)",
    "'/v1/open-with'",
  ]) {
    assert.ok(agentClient.includes(token), 'Electron Agent client missing: ' + token)
  }

  for (const token of [
    "ipcMain.handle('agent:open-with'",
    "requireAgentCapability(hello, 'open-with')",
    'requireAgentClient().openWith(relativePath)',
  ]) {
    assert.ok(main.includes(token), 'Electron main Open With bridge missing: ' + token)
  }

  assert.ok(preload.includes("openWith: (relativePath: string) => ipcRenderer.invoke('agent:open-with', relativePath)"))
  assert.ok(rendererTypes.includes('openWith: (relativePath: string) => Promise<DesktopResult<{ ok: boolean }>>'))
  assert.ok(app.includes("agent.hello?.capabilities.includes('open-with')"))
  assert.ok(app.includes('openWithSupported: fileOpenWithSupported'))

  for (const token of [
    'openWithSupported = false',
    'openWithSupported?: boolean',
    'const openLocalNodeWith = async',
    'window.xdriveDesktop.agent.openWith(relativePath)',
    "id: 'open-with'",
    "label: '打开方式…'",
  ]) {
    assert.ok(explorer.includes(token), 'Desktop FileExplorer Open With action missing: ' + token)
  }
})

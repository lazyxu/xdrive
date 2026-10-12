const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const shared = read('ui', 'shared', 'src', 'mui', 'LocalStoragePage.tsx')
const sharedIndex = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const web = read('web', 'src', 'App.tsx')
const webStorage = read('web', 'src', 'browserStorage.ts')
const desktop = read('desktop', 'src', 'renderer', 'App.tsx')
const main = read('desktop', 'src', 'main', 'index.cts')
const preload = read('desktop', 'src', 'preload', 'index.cts')
const globals = read('desktop', 'src', 'renderer', 'global.d.ts')

test('Web and Desktop share one local storage workspace', () => {
  assert.ok(sharedIndex.includes("export * from './LocalStoragePage'"))
  assert.ok(shared.includes('export function XDriveLocalStoragePage'))
  assert.ok(shared.includes('title="浏览器存储"'))
  assert.ok(shared.includes('title="Desktop 存储"'))
  assert.ok(shared.includes('清理浏览器缓存'))
  assert.ok(shared.includes('释放可回收 Desktop 缓存'))
  assert.ok(shared.includes('不会清除 Cookie、登录状态、token、主题或布局偏好'))
  assert.ok(web.includes('<XDriveLocalStoragePage source={localStorageSource} />'))
  assert.ok(desktop.includes('<XDriveLocalStoragePage source={localStorageSource} />'))
})

test('Web browser cleanup is constrained to regenerable Cache Storage', () => {
  assert.ok(webStorage.includes('navigator.storage?.estimate'))
  assert.ok(webStorage.includes('cacheStorage.keys()'))
  assert.ok(webStorage.includes('cacheStorage.delete(name)'))
  assert.ok(webStorage.includes('浏览器 HTTP 缓存由浏览器自身管理'))
  assert.equal(webStorage.includes('localStorage.clear'), false)
  assert.equal(webStorage.includes('sessionStorage.clear'), false)
  assert.equal(webStorage.includes('document.cookie'), false)
  assert.equal(webStorage.includes('indexedDB.deleteDatabase'), false)
})

test('browser/Agent cache scope and clear confirmations do not falsely claim per-account isolation', () => {
  for (const token of [
    '当前浏览器资料中的 xDrive 站点（非账号专属）',
    '不是单个登录账号',
    '可能影响此前在此站点登录的其他账号',
    '浏览器 HTTP 缓存由浏览器自身管理',
  ]) assert.ok(webStorage.includes(token), 'Web origin-scoped cache disclosure missing: ' + token)
  for (const token of [
    '当前设备 Electron HTTP 缓存（非账号专属）',
    '不按当前登录账号隔离',
    '与本机 Agent 文件缓存相互独立',
  ]) assert.ok(desktop.includes(token), 'Desktop Electron cache scope disclosure missing: ' + token)
  for (const token of [
    '不代表当前账号的云端配额',
    '清理范围是当前客户端的整个站点或 Electron 会话缓存，而非当前登录账号',
    '同一会话其他账号可能需要重新下载缓存资源',
    '当前设备 Agent 可回收的按需文件缓存',
    '不会删除服务器上的原始文件',
    '实际释放量可能不同',
  ]) assert.ok(shared.includes(token), 'shared Local Storage must disclose cache scope: ' + token)
  assert.ok(shared.includes('onConfirm={() => {'))
  assert.ok(shared.includes("source.clearBrowserCache()"))
  assert.ok(shared.includes("source.releaseDesktopCache()"))
})

test('Desktop browser cache uses Electron cache-only APIs and remains separate from Agent cache', () => {
  assert.ok(main.includes("ipcMain.handle('desktop:get-browser-cache'"))
  assert.ok(main.includes('session.defaultSession.getCacheSize()'))
  assert.ok(main.includes("ipcMain.handle('desktop:clear-browser-cache'"))
  assert.ok(main.includes('session.defaultSession.clearCache()'))
  assert.equal(main.includes('session.defaultSession.clearStorageData'), false)
  assert.ok(preload.includes("ipcRenderer.invoke('desktop:get-browser-cache')"))
  assert.ok(preload.includes("ipcRenderer.invoke('desktop:clear-browser-cache')"))
  assert.ok(globals.includes('getBrowserCache: () => Promise<DesktopResult<DesktopBrowserCacheStats>>'))
  assert.ok(globals.includes('clearBrowserCache: () => Promise<DesktopResult<DesktopBrowserCacheClearResult>>'))
  assert.ok(desktop.includes('window.xdriveDesktop.agent.releaseCache()'))
  assert.ok(desktop.includes('window.xdriveDesktop.clearBrowserCache()'))
})

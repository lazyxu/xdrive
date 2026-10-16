'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { app } = require('electron')
assert.equal(path.resolve(app.getAppPath()), path.resolve(__dirname, '..'), 'actual production Desktop app root required')
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
const mode = process.env.XD_FILEEXPLORER_DESKTOP_GO_CANCEL_MODE
const sample = Number(process.env.XD_FILEEXPLORER_DESKTOP_GO_CANCEL_SAMPLE)
const server = process.env.XD_FILEEXPLORER_DESKTOP_GO_CANCEL_SERVER
const output = process.env.XD_FILEEXPLORER_DESKTOP_GO_CANCEL_OUTPUT
const desktopPhysicalCancelMode = process.env.XD_FILEEXPLORER_DESKTOP_PHYSICAL_GO_CANCEL_100K_PERF === '1'
const originalPhysicalPayloadBytes = Number(process.env.XD_FILEEXPLORER_DESKTOP_CANCEL_SOURCE_BYTES || 0)
const deadlineMs = 160
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const nativeHz = desktopPhysicalCancelMode ? Number(require('node:child_process').execFileSync('getconf',['CLK_TCK'],{encoding:'utf8'}).trim()) : 0
function desktopProcessSnapshot(pid) {
  if(!Number.isSafeInteger(pid)||pid<=0)return null
  let status,stat
  try{
    status=fs.readFileSync('/proc/'+pid+'/status','utf8')
    stat=fs.readFileSync('/proc/'+pid+'/stat','utf8')
  }catch{return null}
  const rss=status.match(/^VmRSS:\s+(\d+) kB/m)
  const fields=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)
  const ticks=Number(fields[11])+Number(fields[12])
  if(!rss||!Number.isFinite(ticks)||nativeHz<=0)return null
  return { rssBytes:Number(rss[1])*1024, cpuMs:ticks*1000/nativeHz }
}
async function until(check, timeout, label) {
  const began = performance.now()
  while (performance.now() - began < timeout) {
    const value = await check()
    if (value) return value
    await delay(25)
  }
  throw Error('timeout ' + label)
}
async function stats() {
  const response = await fetch(server + '/__perf/viewport-cancel-stats', { cache: 'no-store' })
  assert.equal(response.status, 200, 'real Gin Context.Done counter missing')
  return response.json()
}
function pressFiles() {
  const nav = document.querySelector('nav[aria-label="桌面版功能区"]')
  const button = Array.from(nav?.querySelectorAll('[role="button"]') || [])
    .find(item => item.textContent?.trim() === '文件')
  if (!button || !window.xdriveDesktop?.agent) return false
  button.click()
  return true
}
function enter100kFolder() {
  const rootItem = Array.from(document.querySelectorAll('[data-xdrive-file-explorer-item]'))
    .find(item => item.textContent?.includes('100k Images'))
  if (!rootItem) return false
  rootItem.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
  return true
}
function fileViewState() {
  const host = document.querySelector('[data-xdrive-file-explorer-scroll-host]')
  const tiles = document.querySelectorAll('[data-xdrive-file-explorer-item]')
  const status = document.querySelector('[data-xdrive-file-explorer-status-bar]')?.textContent || ''
  return {
    mounted: Boolean(document.querySelector('[data-xdrive-file-explorer]')),
    items: tiles.length,
    totalReady: status.includes('100000 个项目'),
    extent: host ? host.scrollHeight - host.clientHeight : 0,
    status: status.slice(0, 120),
  }
}
function moveRealFilesViewport() {
  const host = document.querySelector('[data-xdrive-file-explorer-scroll-host]')
  if (!host) return { error: 'real FileExplorer scroll host missing' }
  const before = host.scrollTop
  const extent = host.scrollHeight - host.clientHeight
  host.scrollTop = Math.floor(extent / 2)
  host.dispatchEvent(new Event('scroll', { bubbles: true }))
  return { before, after: host.scrollTop, delta: host.scrollTop - before, extent }
}
function switchToHome() {
  const nav = document.querySelector('nav[aria-label="桌面版功能区"]')
  const item = Array.from(nav?.querySelectorAll('[role="button"]') || [])
    .find(button => button.textContent?.trim() === '主页')
  if (!item) return { error: 'real Desktop Home navigation missing' }
  const wasFiles = !!document.querySelector('[data-xdrive-file-explorer]')
  item.click()
  return { clicked: true, wasFiles }
}
let attached = false
async function run(win) {
  try {
    assert(['virtual-scroll', 'app-switch', 'window-destroy'].includes(mode))
    assert(server && output && Number.isSafeInteger(sample) && sample > 0)
    win.setContentSize(1440, 900)
    await until(async () => {
      const loaded = await win.webContents.executeJavaScript(
        'Boolean(document.querySelector(\'nav[aria-label="桌面版功能区"]\') && window.xdriveDesktop?.agent)',
        true).catch(() => false)
      return loaded
    }, 45000, 'authentic Desktop Sidebar / Agent preload')
    const before = await stats()
    assert(await win.webContents.executeJavaScript('(' + pressFiles.toString() + ')()', true),
      'real FileExplorer Sidebar not selected')
    await until(async () => win.webContents.executeJavaScript(
      '(' + enter100kFolder.toString() + ')()', true), 45000, 'real 100k Images directory')
    const started = await until(async () => {
      const result = await stats()
      if (result.started > before.started + 6) throw Error('unexpected extra native streams ' + JSON.stringify(result))
      return result.started === before.started + 6 && result.active === 6 &&
        result.first_chunks === before.first_chunks + 6 &&
        result.emitted_bytes === before.emitted_bytes + 1536 ? result : null
    }, 45000, '6 real Electron/Agent/Gin streams with 256 bytes each')
    const mounted = await win.webContents.executeJavaScript('(' + fileViewState.toString() + ')()', true)
    assert(mounted.mounted && mounted.totalReady && mounted.items > 0 && mounted.items < 1000 &&
      mounted.extent > 10000, 'native 100k directory not mounted: ' + JSON.stringify(mounted))
    const rendererPID = desktopPhysicalCancelMode ? win.webContents.getOSProcessId() : null
    const rendererBefore = desktopPhysicalCancelMode ? desktopProcessSnapshot(rendererPID) : null
    if(desktopPhysicalCancelMode) assert(rendererBefore, 'P053 native Renderer CPU/RSS unavailable')
    const mark = await fetch(server + '/__perf/viewport-cancel-mark', { method: 'POST' })
    assert.equal(mark.status, 204)
    const markedAt = performance.now()
    let action
    if (mode === 'virtual-scroll') {
      action = await win.webContents.executeJavaScript('(' + moveRealFilesViewport.toString() + ')()', true)
      assert(!action.error && action.delta > 10000, 'real virtual scroll not performed: ' + JSON.stringify(action))
    } else if (mode === 'app-switch') {
      action = await win.webContents.executeJavaScript('(' + switchToHome.toString() + ')()', true)
      assert(action.clicked && action.wasFiles, 'real Files app switch failed: ' + JSON.stringify(action))
    } else {
      win.destroy()
      action = { destroyed: win.isDestroyed() }
      assert(action.destroyed, 'real BrowserWindow destruction did not occur')
    }
    const remainder = deadlineMs - (performance.now() - markedAt)
    if (remainder > 0) await delay(remainder)
    const after = await stats()
    if (mode === 'app-switch') action.filesStillMounted = await win.webContents.executeJavaScript(
      'Boolean(document.querySelector("[data-xdrive-file-explorer]"))', true)
    const row = {
      sample, mode,
      source: 'actual Electron Renderer/Preload/Main -> Go Agent IPC -> authenticated Gin/PostgreSQL17/local CAS',
      data: { logicalFiles: 100000, distinctPhysicalJPEGs: 16, initialStreams: 6 },
      physicalCancelMode: desktopPhysicalCancelMode,
      initial: { visibleDOMItems: mounted.items, extent: mounted.extent },
      action,
      startedRequests: started.started - before.started,
      firstBytesTransferred: started.emitted_bytes - before.emitted_bytes,
      contextDone: after.context_done - started.context_done,
      cancelledHandlers: after.cancelled - started.cancelled,
      stillActiveHandlersAt160ms: after.active,
      wastedBytesAfterAction: after.emitted_bytes - started.emitted_bytes,
      worstGoContextNotificationMs: after.max_cancel_us / 1000,
      checkedAfterActionMs: performance.now() - markedAt,
    }
    if(desktopPhysicalCancelMode){
      row.data.distinctPhysicalJPEGs=100000
      row.data.originalPhysicalPayloadBytes=originalPhysicalPayloadBytes
      const rendererAfter = mode==='window-destroy' ? null : desktopProcessSnapshot(rendererPID)
      if(mode!=='window-destroy') assert(rendererAfter,'P053 live Renderer after-action sample missing')
      row.renderer160msRssGrowthBytes = rendererAfter ? Math.max(0,rendererAfter.rssBytes-rendererBefore.rssBytes) : null
      row.renderer160msCpuDeltaMs = rendererAfter ? Math.max(0,rendererAfter.cpuMs-rendererBefore.cpuMs) : null
      row.rendererDestroyed = mode==='window-destroy' && win.isDestroyed()
      assert(row.data.originalPhysicalPayloadBytes>=50000000,'physical P053 100k JPEG data missing')
    }
    row.passed = row.startedRequests === 6 && row.firstBytesTransferred === 1536 &&
      row.contextDone === 6 && row.cancelledHandlers === 6 &&
      row.stillActiveHandlersAt160ms === 0 && row.wastedBytesAfterAction === 0 &&
      row.worstGoContextNotificationMs <= deadlineMs &&
      (mode !== 'app-switch' || action.filesStillMounted === false) &&
      (!desktopPhysicalCancelMode || (row.data.distinctPhysicalJPEGs===100000 &&
        (mode==='window-destroy'||row.renderer160msRssGrowthBytes<=134217728)))
    console.log('FILEEXPLORER_DESKTOP_GO_CANCEL_100K_MODE ' + JSON.stringify(row))
    fs.writeFileSync(output, JSON.stringify(row, null, 2) + '\n')
    assert(row.passed, 'real FileExplorer viewport -> Go context cancel performance budget RED')
    app.exit(0)
  } catch (error) {
    console.error('FILEEXPLORER_DESKTOP_GO_CANCEL_100K_ERROR ' + (error?.stack || String(error)))
    app.exit(1)
  }
}
app.on('browser-window-created', (_event, win) => {
  if (attached) return
  attached = true
  win.webContents.once('did-finish-load', () => { void run(win) })
})
require('../dist/main/index.cjs')

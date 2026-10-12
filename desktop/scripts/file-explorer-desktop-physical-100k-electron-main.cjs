'use strict'
const { app } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')

assert.equal(path.resolve(app.getAppPath()), path.resolve(__dirname, '..'), 'real Desktop app root required')
for (const flag of ['no-sandbox', 'disable-background-timer-throttling', 'disable-renderer-backgrounding', 'enable-precise-memory-info']) {
  app.commandLine.appendSwitch(flag)
}
const view = process.env.XD_FILEEXPLORER_DESKTOP_PHYSICAL_VIEW
const url = process.env.XD_FILEEXPLORER_DESKTOP_PHYSICAL_URL
const output = process.env.XD_FILEEXPLORER_DESKTOP_PHYSICAL_OUTPUT
const sample = Number(process.env.XD_FILEEXPLORER_DESKTOP_PHYSICAL_SAMPLE)
assert(['grid', 'details'].includes(view) && url && output && sample >= 1)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, ms, label) {
  const start = performance.now()
  while (performance.now() - start < ms) {
    const value = await fn()
    if (value) return value
    await delay(65)
  }
  throw Error('timed out waiting for ' + label)
}
function rendererMemory(win) {
  const pid = win.webContents.getOSProcessId()
  const kb = app.getAppMetrics().find(row => row.pid === pid)?.memory?.workingSetSize
  assert(Number.isFinite(kb) && kb > 0, 'real Chromium Renderer working set unavailable')
  return kb * 1024
}
async function counters() {
  const response = await fetch(url + '/__perf/physical-jpeg-stats')
  assert.equal(response.status, 200, 'original Gin handler stats missing')
  return response.json()
}
function execute(win, fn, ...args) {
  return win.webContents.executeJavaScript(
    '(' + fn.toString() + ')(' + args.map(arg => JSON.stringify(arg)).join(',') + ')', true,
  )
}
function clickFiles(mode) {
  const nav = document.querySelector('nav[aria-label="桌面版功能区"]')
  const file = Array.from(nav?.querySelectorAll('[role="button"]') || [])
    .find(node => node.textContent?.trim() === '文件')
  if (!file || !window.xdriveDesktop?.agent) return false
  window.localStorage.setItem('xdrive.desktop.files.view_mode', mode)
  file.click()
  return true
}
function openFolder() {
  const folder = Array.from(document.querySelectorAll('[data-xdrive-file-explorer-item]'))
    .find(node => node.textContent?.includes('100k Images'))
  if (!folder) return false
  folder.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
  return true
}
function openLayoutMenu() {
  const bar = document.querySelector('[data-xdrive-file-explorer-command-bar]')
  const button = Array.from(bar?.querySelectorAll('button[aria-haspopup="menu"]') || [])
    .find(node => node.textContent?.trim() === '视图')
  if (!button) return false
  button.click()
  return true
}
function selectLayoutFromMenu(mode) {
  const wanted = mode === 'details' ? '详细信息' : '中图标'
  const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
    .find(node => node.textContent?.trim() === wanted)
  if (!item) return false
  item.click()
  return true
}
function snapshot() {
  const host = document.querySelector('[data-xdrive-file-explorer-scroll-host]')
  const tiles = Array.from(document.querySelectorAll('[data-xdrive-file-explorer-item]'))
  const ids = tiles.filter(tile => {
    const img = tile.querySelector('[data-xdrive-file-explorer-item-visual] img')
    return img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0
  }).map(tile => tile.getAttribute('data-xdrive-file-explorer-item-id')).filter(Boolean)
  const status = document.querySelector('[data-xdrive-file-explorer-status-bar]')?.textContent || ''
  const viewText = document.querySelector('[aria-label^="当前视图："]')?.getAttribute('aria-label') || ''
  return {
    totalReady: status.includes('100000 个项目'),
    status: status.slice(0, 150), viewText,
    mounted: tiles.length, decodedIDs: Array.from(new Set(ids)),
    scrollTop: host?.scrollTop ?? null,
    scrollExtent: host ? host.scrollHeight - host.clientHeight : 0,
  }
}
function scroll(fraction) {
  const host = document.querySelector('[data-xdrive-file-explorer-scroll-host]')
  if (!host) return { error: 'no real FileExplorer DOM scroll host' }
  const extent = host.scrollHeight - host.clientHeight
  host.scrollTop = Math.floor(extent * fraction)
  host.dispatchEvent(new Event('scroll', { bubbles: true }))
  return { top: host.scrollTop, extent }
}
const fractions = [0, .25, .5, .75, .95]
let attached = false
async function run(win) {
  let memoryTimer
  try {
    win.setContentSize(1440, 900)
    await until(() => win.webContents.executeJavaScript(
      'Boolean(document.querySelector(\'nav[aria-label="桌面版功能区"]\') && window.xdriveDesktop?.agent)',
      true,
    ).catch(() => false), 45000, 'actual authenticated Desktop Agent/Sidebar')
    assert(await execute(win, clickFiles, view), 'could not select authentic Desktop Files app')
    await until(() => execute(win, openFolder), 45000, '100k Images real root folder')
    // A Desktop workspace controller may already have captured its view mode from storage.
    // Select the actual production FileExplorer menu item for each independent mode session.
    await until(() => execute(win, openLayoutMenu), 15000, 'real FileExplorer view menu')
    await until(() => execute(win, selectLayoutFromMenu, view), 15000,
      'real FileExplorer view menu selection: ' + view)
    const expectMode = view === 'grid' ? '当前视图：图标 · ' : '当前视图：详细信息 · '
    await until(async () => {
      const state = await execute(win, snapshot)
      if (!state.totalReady || state.scrollExtent < 10000) return false
      assert(state.viewText.startsWith(expectMode), 'Desktop view mode incorrect: ' + JSON.stringify(state))
      return true
    }, 45000, 'real 100k virtualized FileExplorer ' + view)
    const memoryStart = rendererMemory(win)
    let memoryPeak = memoryStart
    memoryTimer = setInterval(() => {
      try { memoryPeak = Math.max(memoryPeak, rendererMemory(win)) } catch {}
    }, 25)
    const begin = await counters()
    const cpuBefore = process.cpuUsage()
    let previous = new Set()
    const rows = []
    for (const fraction of fractions) {
      const started = performance.now()
      if (fraction > 0) {
        const moved = await execute(win, scroll, fraction)
        assert(!moved.error && moved.extent > 10000 && moved.top > 10000,
          'virtual scroll did not move: ' + JSON.stringify(moved))
      }
      const state = await until(async () => {
        const current = await execute(win, snapshot)
        if (!current.totalReady || current.mounted < 1 || current.mounted >= 1000) return false
        const fresh = current.decodedIDs.filter(id => !previous.has(id))
        if (current.decodedIDs.length < 6 || (fraction > 0 && fresh.length < 6)) return false
        return { ...current, fresh }
      }, 20000, 'six actually decoded new JPEG thumbnails at ' + view + '/' + fraction)
      const ms = performance.now() - started
      previous = new Set(state.decodedIDs)
      memoryPeak = Math.max(memoryPeak, rendererMemory(win))
      const probe = await counters()
      rows.push({
        fraction, firstSixDecodedMs: ms, decoded: state.decodedIDs.length,
        newlyDecoded: state.fresh.length, mounted: state.mounted,
        scrollTop: state.scrollTop, realGoRequests: probe.started,
        realGoBytes: probe.response_bytes, goActive: probe.active,
        canceled: probe.canceled, failed: probe.failed,
      })
    }
    clearInterval(memoryTimer); memoryTimer = null
    const end = await counters()
    const cpu = process.cpuUsage(cpuBefore)
    const growth = Math.max(0, memoryPeak - memoryStart)
    const result = {
      sample, view, productionDesktop: true, physicalDistinctJPEGCAS: 100000,
      viewportFractions: fractions, viewportRows: rows,
      viewportFirstSixP50Ms: [...rows.map(x => x.firstSixDecodedMs)].sort((a, b) => a - b)[2],
      rendererWorkingSetStartBytes: memoryStart, rendererWorkingSetPeakBytes: memoryPeak,
      rendererWorkingSetGrowthBytes: growth, mainCpuUserMs: cpu.user / 1000,
      mainCpuSystemMs: cpu.system / 1000,
      goThumbnailRequests: end.started - begin.started,
      goResponseBytes: end.response_bytes - begin.response_bytes,
      maxGoConcurrent: end.max_active, canceled: end.canceled, errors: end.failed,
      budgets: { viewportMs: 20000, rendererGrowthBytes: 268435456, maxGoConcurrent: 6 },
      exclusions: 'Native Linux Xvfb; Grid/Details 5 sampled windows not 100k simultaneous decodes; no H264/Live/RAW/HEVC, no WAN, no Windows hardware and no cancellation-latency proof',
    }
    result.passed = rows.length === 5 && rows.every(x =>
      x.decoded >= 6 && x.newlyDecoded >= 6 && x.mounted > 0 &&
      x.mounted < 1000 && x.firstSixDecodedMs <= 20000) &&
      growth <= 268435456 && result.maxGoConcurrent <= 6 &&
      result.goThumbnailRequests > 0 && result.goResponseBytes > 0 && end.failed === 0
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
    console.log('FILEEXPLORER_DESKTOP_PHYSICAL_100K_RESULT ' + JSON.stringify(result))
    assert(result.passed, 'unchanged product Desktop FileExplorer physical 100k CURRENT is RED')
    app.exit(0)
  } catch (error) {
    if (memoryTimer) clearInterval(memoryTimer)
    // A failed real-app navigation is a harness failure, not a viewport latency.
    // Capture only synthetic fixture UI evidence; never print Agent credentials.
    const diagnostics = await execute(win, function inspectNativeFilesFixtureDOM() {
      const nav = document.querySelector('nav[aria-label="桌面版功能区"]')
      return {
        nav: Array.from(nav?.querySelectorAll('[role="button"]') || []).map(node => ({
          label: node.textContent?.trim().slice(0, 65), selected: node.getAttribute('aria-current'),
        })),
        fileExplorerMounted: Boolean(document.querySelector('[data-xdrive-file-explorer]')),
        itemCount: document.querySelectorAll('[data-xdrive-file-explorer-item]').length,
        visibleItemNames: Array.from(document.querySelectorAll('[data-xdrive-file-explorer-item]'))
          .slice(0, 8).map(node => node.textContent?.trim().slice(0, 90)),
        viewStatus: document.querySelector('[data-xdrive-file-explorer-status-bar]')?.textContent?.slice(0, 200),
        bodyExcerpt: document.body?.innerText?.slice(0, 1400),
      }
    }).catch(diagnosticError => ({ diagnosticFailure: String(diagnosticError) }))
    console.error('FILEEXPLORER_DESKTOP_PHYSICAL_100K_NAV_DIAGNOSTIC ' + JSON.stringify(diagnostics))
    console.error('FILEEXPLORER_DESKTOP_PHYSICAL_100K_ERROR ' + (error?.stack || error))
    app.exit(1)
  }
}
app.on('browser-window-created', (_event, win) => {
  if (attached) return
  attached = true
  win.webContents.once('did-finish-load', () => { void run(win) })
})
require('../dist/main/index.cjs')

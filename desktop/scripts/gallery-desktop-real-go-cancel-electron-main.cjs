'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { app } = require('electron')

const expectedRoot = path.resolve(__dirname, '..')
assert.equal(path.resolve(app.getAppPath()), expectedRoot,
  'real production Electron App path required')
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const mode = process.env.XD_GALLERY_DESKTOP_GO_CANCEL_MODE
const sample = Number(process.env.XD_GALLERY_DESKTOP_GO_CANCEL_SAMPLE)
const server = process.env.XD_GALLERY_DESKTOP_GO_CANCEL_SERVER
const deadlineMs = 160

async function until(check, timeout, reason) {
  const start = performance.now()
  while (performance.now() - start < timeout) {
    const value = await check()
    if (value) return value
    await delay(25)
  }
  throw Error('timeout waiting for ' + reason)
}
async function probe() {
  const response = await fetch(server + '/__perf/viewport-cancel-stats', { cache: 'no-store' })
  assert.equal(response.status, 200, 'real Go Gin request context probe absent')
  return response.json()
}
function activateGallery() {
  const nav = document.querySelector('nav[aria-label="桌面版功能区"]')
  const button = Array.from(nav?.querySelectorAll('[role="button"]') || [])
    .find(el => el.textContent?.trim() === '图库')
  if (!button || !window.xdriveDesktop?.agent) return { started: false }
  button.click()
  return { started: true, navButtons: nav.querySelectorAll('[role="button"]').length }
}
function scrollActualGallery() {
  const grid = document.querySelector('[data-xdrive-media-gallery-virtual-grid]')
  if (!(grid instanceof HTMLElement)) return { error: 'real shared Gallery virtual grid missing' }
  const candidates = []
  let parent = grid.parentElement
  while (parent) {
    const style = getComputedStyle(parent)
    if (/(auto|scroll|overlay)/.test(style.overflowY)) {
      const extent = parent.scrollHeight - parent.clientHeight
      if (extent > 10000) candidates.push({ element: parent, extent })
    }
    parent = parent.parentElement
  }
  if (candidates.length === 0) return { error: 'no native 100k Gallery scrolling host' }
  const host = candidates[0].element
  const before = host.scrollTop
  host.scrollTop = Math.round(candidates[0].extent / 2)
  host.dispatchEvent(new Event('scroll'))
  return {
    before, after: host.scrollTop, delta: host.scrollTop - before,
    itemsBefore: grid.querySelectorAll('[role="button"]').length,
    scrollExtent: candidates[0].extent,
  }
}
function switchRealDesktopApp() {
  const nav = document.querySelector('nav[aria-label="桌面版功能区"]')
  const button = Array.from(nav?.querySelectorAll('[role="button"]') || [])
    .find(el => el.textContent?.trim() === '主页')
  if (!button) return { error: 'real Home (overview view) navigation missing' }
  const wasGallery = !!document.querySelector('[data-xdrive-media-gallery-virtual-grid]')
  button.click()
  return { clicked: true, wasGallery, label: button.textContent?.trim() }
}
function galleryMounted() {
  return Boolean(document.querySelector('[data-xdrive-media-gallery-virtual-grid]'))
}

let attached = false
async function run(win) {
  try {
    assert(['virtual-scroll', 'app-switch', 'window-destroy'].includes(mode), 'invalid scoped mode')
    assert(server && Number.isSafeInteger(sample) && sample > 0, 'fixture and sample required')
    win.setContentSize(1440, 900)
    await until(async () => {
      if (win.isDestroyed()) throw Error('real Electron window destroyed before startup')
      const value = await win.webContents.executeJavaScript(
        '({nav: Boolean(document.querySelector("nav[aria-label=\\"桌面版功能区\\"]")), preload: Boolean(window.xdriveDesktop?.agent)})',
      ).catch(error => ({error: String(error)}))
      return value.nav && value.preload
    }, 45000, 'real Desktop Renderer sidebar and production preload')
    const before = await probe()
    const armed = await win.webContents.executeJavaScript(
      '(' + activateGallery.toString() + ')()', true)
    assert(armed?.started, 'real production Gallery navigation not activated')
    const started = await until(async () => {
      const row = await probe()
      if (row.started > before.started + 6) {
        throw Error('unexpected excess real JPEG streams: ' + JSON.stringify(row))
      }
      return row.started === before.started + 6 && row.active === 6 &&
        row.first_chunks === before.first_chunks + 6 &&
        row.emitted_bytes === before.emitted_bytes + 6 * 256 ? row : null
    }, 45000, 'six actual Renderer->Preload->Main->Agent->Gin JPEG streams with 256 bytes')
    const mounted = await win.webContents.executeJavaScript(
      '({mounted: Boolean(document.querySelector("[data-xdrive-media-gallery-virtual-grid]")), items: document.querySelectorAll("[data-xdrive-media-gallery-virtual-grid] [role=button]").length})')
    assert(mounted.mounted && mounted.items > 0 && mounted.items < 1000,
      'real 100k viewport not mounted: ' + JSON.stringify(mounted))
    const marked = await fetch(server + '/__perf/viewport-cancel-mark', { method: 'POST' })
    assert.equal(marked.status, 204)
    const markedAt = performance.now()
    let action
    if (mode === 'virtual-scroll') {
      action = await win.webContents.executeJavaScript(
        '(' + scrollActualGallery.toString() + ')()', true)
      assert(!action?.error && action.delta > 10000,
        'real virtual scroll gesture missing: ' + JSON.stringify(action))
    } else if (mode === 'app-switch') {
      action = await win.webContents.executeJavaScript(
        '(' + switchRealDesktopApp.toString() + ')()', true)
      assert(action?.clicked && action?.wasGallery,
        'real Desktop app switch not executed: ' + JSON.stringify(action))
    } else {
      win.destroy()
      action = { destroyed: win.isDestroyed() }
      assert(action.destroyed, 'actual Electron BrowserWindow was not destroyed')
    }
    const remainder = deadlineMs - (performance.now() - markedAt)
    if (remainder > 0) await delay(remainder)
    const after = await probe()
    if (mode === 'app-switch') {
      action.galleryStillMounted = await win.webContents.executeJavaScript(
        '(' + galleryMounted.toString() + ')()', true)
    }
    const row = {
      mode, sample, scope: 'production Electron Renderer, real Preload/Main, real Go Agent, real signed Gin/CAS JPEG',
      actualWindowDestroyed: mode === 'window-destroy' ? action.destroyed : false,
      actualGalleryNavigation: armed.started, actualMountedItems: mounted.items,
      action,
      expectedStartedRequests: 6,
      startedRequests: started.started - before.started,
      firstBytesTransferred: started.emitted_bytes - before.emitted_bytes,
      contextDone: after.context_done - started.context_done,
      returnedCanceledHandlers: after.cancelled - started.cancelled,
      activeOldHandlers: after.active,
      extraStaleHttpBytes: after.emitted_bytes - started.emitted_bytes,
      worstGoNotificationMs: after.max_cancel_us / 1000,
      observedAfterMarkerMs: performance.now() - markedAt,
    }
    row.passed =
      row.startedRequests === 6 && row.firstBytesTransferred === 1536 &&
      row.contextDone === 6 && row.returnedCanceledHandlers === 6 &&
      row.activeOldHandlers === 0 && row.extraStaleHttpBytes === 0 &&
      row.worstGoNotificationMs <= deadlineMs &&
      (mode !== 'app-switch' || action.galleryStillMounted === false)
    console.log('GALLERY_REAL_DESKTOP_GO_CANCEL_SAMPLE ' + JSON.stringify(row))
    if (!row.passed) throw Error('real Renderer-to-Go viewport resource gate red: ' + JSON.stringify(row))
    app.exit(0)
  } catch (error) {
    console.error('GALLERY_REAL_DESKTOP_GO_CANCEL_ERROR ' + (error?.stack || String(error)))
    app.exit(1)
  }
}
app.on('browser-window-created', (_e, window) => {
  if (attached) return
  attached = true
  window.webContents.once('did-finish-load', () => { void run(window) })
})
require('../dist/main/index.cjs')

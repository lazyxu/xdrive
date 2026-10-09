#!/usr/bin/env node
// Real-renderer Mobile Web acceptance for the shared FileExplorer. Requires
// Desktop dependencies and Playwright/Chromium; no running xDrive server.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')

const repoRoot = path.resolve(__dirname, '../..')
const options = {}
for (const argument of process.argv.slice(2)) {
  const match = /^--(source-root|output-dir|case)=(.+)$/.exec(argument)
  if (!match) throw new Error(`Unknown argument: ${argument}. Use --source-root, --output-dir and --case.`)
  options[match[1]] = match[2]
}
if (!options['output-dir']) throw new Error('Supply --output-dir=/path for JSON, bundle and screenshots.')
if (options.case && !['columns', 'all'].includes(options.case)) throw new Error('Use --case=columns or --case=all.')
const sourceRoot = path.resolve(options['source-root'] || repoRoot)
const outputDir = path.resolve(options['output-dir'])
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright')
const results = { sourceRoot, checks: [], samples: {}, errors: [] }

async function main() {
  fs.mkdirSync(outputDir, { recursive: true })
  results.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim()
  results.sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: sourceRoot, encoding: 'utf8' }).trim())
  results.fileExplorerSha256 = createHash('sha256')
    .update(fs.readFileSync(path.join(sourceRoot, 'ui/shared/src/mui/FileExplorer.tsx'))).digest('hex')
  const bundlePath = path.join(outputDir, 'bundle.js')
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'file-explorer-mobile-browser.tsx')],
    bundle: true,
    outfile: bundlePath,
    jsx: 'automatic',
    nodePaths: [path.join(repoRoot, 'desktop/node_modules')],
    alias: {
      __FILE_EXPLORER__: path.join(sourceRoot, 'ui/shared/src/mui/FileExplorer.tsx'),
      __THEME__: path.join(sourceRoot, 'ui/shared/src/mui/AppearanceThemeProvider.tsx'),
    },
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    const url = new URL(request.url, 'http://localhost')
    if (url.pathname === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script src="/bundle.js"></script></body></html>')
    } else if (url.pathname === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript')
      response.end(fs.readFileSync(bundlePath))
    } else {
      response.statusCode = 404
      response.end()
    }
  })
  let browser
  const check = (name, actual, expected) => {
    try {
      assert.deepEqual(actual, expected)
      results.checks.push({ name, passed: true })
    } catch {
      results.checks.push({ name, passed: false, actual, expected })
    }
  }
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const args = process.env.XDRIVE_BROWSER_ARGS ? JSON.parse(process.env.XDRIVE_BROWSER_ARGS) : undefined
    if (args && (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string'))) {
      throw new Error('XDRIVE_BROWSER_ARGS must be a JSON array of strings.')
    }
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || undefined,
      args,
    })
    results.browserVersion = browser.version()
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1,
    })
    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    page.on('pageerror', (error) => results.errors.push(error.message))
    const row = (name) => page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: name }).first()
    const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const state = () => page.evaluate(() => ({
      ...window.fileExplorerHarness.state,
      events: window.fileExplorerHarness.events,
      storedViewMode: localStorage.getItem('xdrive.mobile-browser.view-mode'),
    }))
    const sample = async (name) => {
      const value = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('[data-xdrive-file-explorer-item]')]
        const moreButtons = [...document.querySelectorAll('[data-xdrive-file-explorer-item-more]')]
        const host = document.querySelector('[data-xdrive-file-explorer-scroll-host]')
        return {
          viewport: { width: innerWidth, height: innerHeight },
          coarsePointer: matchMedia('(pointer: coarse)').matches,
          compactTouch: matchMedia('(max-width:899.95px) and (pointer: coarse)').matches,
          columnViews: document.querySelectorAll('[data-xdrive-file-explorer-column-view]').length,
          moreButtons: moreButtons.length,
          moreButtonTargets: moreButtons.slice(0, 3).map((element) => {
            const { width, height } = element.getBoundingClientRect()
            return { width, height }
          }),
          rowHeights: rows.slice(0, 3).map((element) => element.getBoundingClientRect().height),
          scrollHost: host ? { clientHeight: host.clientHeight, scrollHeight: host.scrollHeight, scrollTop: host.scrollTop } : null,
          documentWidth: document.documentElement.scrollWidth,
          state: window.fileExplorerHarness.state,
          events: window.fileExplorerHarness.events,
        }
      })
      results.samples[name] = value
      await page.screenshot({ path: path.join(outputDir, `${name}.png`) })
      return value
    }
    await page.goto(`http://127.0.0.1:${server.address().port}/?mode=columns`)
    await row('alpha.txt').waitFor({ state: 'visible' })
    await settle()
    let snapshot = await sample('inherited-columns-390')
    check('390px browser uses a coarse primary pointer', snapshot.compactTouch, true)
    check('inherited columns project to a compact List or Grid', snapshot.columnViews, 0)
    check('compact inherited items expose 44px More controls', snapshot.moreButtons > 0
      && snapshot.moreButtonTargets.every((target) => target.width >= 44 && target.height >= 44), true)
    check('compact inherited item targets are at least 44px high', snapshot.rowHeights.every((height) => height >= 44), true)
    await row('alpha.txt').tap({ position: { x: 80, y: 15 } })
    await settle()
    check('single touch opens a file inherited from columns', (await state()).events.filter((event) => event.type === 'open').map((event) => event.ids), [[1]])
    await page.getByRole('button', { name: '选择', exact: true }).tap()
    await page.evaluate(() => window.fileExplorerHarness.clearEvents())
    await row('alpha.txt').tap({ position: { x: 80, y: 15 } })
    await row('beta.txt').tap({ position: { x: 80, y: 15 } })
    await settle()
    check('compact inherited selection mode toggles multiple files', (await state()).selectedIDs.map(String).sort(), ['1', '2'])
    check('selection mode does not open files', (await state()).events.filter((event) => event.type === 'open'), [])
    await sample('inherited-columns-selection-390')
    await page.setViewportSize({ width: 900, height: 700 })
    await settle()
    snapshot = await sample('inherited-columns-900')
    check('900px restores the persisted desktop columns view', snapshot.columnViews, 1)
    check('compact projection leaves the persisted view mode intact', (await state()).storedViewMode, 'columns')
    await page.setViewportSize({ width: 390, height: 844 })
    await settle()
    snapshot = await sample('inherited-columns-390-return')
    check('returning to compact reprojects inherited columns', snapshot.columnViews, 0)
    check('responsive projection never invokes onViewModeChange', (await state()).events.filter((event) => event.type === 'view-mode'), [])
    if (options.case !== 'columns') {
      const reset = async (mode = 'details', width = 390, height = 844) => {
        await page.setViewportSize({ width, height })
        await page.evaluate((next) => window.fileExplorerHarness.reset(next), mode)
        await row('alpha.txt').waitFor({ state: 'visible' })
        await settle()
        await page.evaluate(() => {
          document.querySelector('[data-xdrive-file-explorer-scroll-host]').scrollTop = 0
          window.fileExplorerHarness.clearEvents()
        })
      }
      const tapRow = async (name) => {
        const bounds = await row(name).boundingBox()
        await row(name).tap({ position: { x: bounds.width / 2, y: bounds.height / 2 } })
        await settle()
      }
      const opened = async () => (await state()).events.filter((event) => event.type === 'open').map((event) => event.ids)

      // Resizing keeps the same mounted component and controlled desktop view.
      for (const width of [360, 430, 899, 900, 390]) {
        await page.setViewportSize({ width, height: width === 899 || width === 900 ? 700 : 844 })
        await settle()
        const measured = await sample(`inherited-columns-${width}-matrix`)
        check(`${width}px inherited columns follow the 900px boundary`, measured.columnViews, width >= 900 ? 1 : 0)
        check(`${width}px shell has no horizontal document overflow`, measured.documentWidth <= measured.viewport.width, true)
        check(`${width}px resize preserves stored desktop columns`, (await state()).storedViewMode, 'columns')
      }

      for (const mode of ['details', 'grid']) {
        await reset(mode)
        await sample(`${mode}-before-touch`)
        await tapRow('alpha.txt')
        check(`${mode}: one touch opens exactly one file`, await opened(), [[1]])
        await page.getByRole('button', { name: '选择', exact: true }).tap()
        await page.evaluate(() => window.fileExplorerHarness.clearEvents())
        await tapRow('alpha.txt')
        await tapRow('beta.txt')
        check(`${mode}: selection mode toggles multiple items`, (await state()).selectedIDs.map(String).sort(), ['1', '2'])
        check(`${mode}: selection taps never open a file`, await opened(), [])
        await page.getByRole('button', { name: '复制所选项目', exact: true }).tap()
        check(`${mode}: copy receives the complete selection`, (await state()).events.filter((event) => event.type === 'copy').map((event) => event.ids.map(String).sort()), [['1', '2']])
        await page.getByRole('button', { name: '完成', exact: true }).tap()
        check(`${mode}: Done leaves selection empty`, (await state()).selectedIDs, [])
        await sample(`${mode}-touch-selection`)
      }

      // Check browser-owned focus and dismissal, not a mocked Drawer callback.
      await reset()
      const more = page.getByRole('button', { name: '更多操作：alpha.txt', exact: true })
      await more.tap()
      const sheet = page.locator('[data-xdrive-file-explorer-touch-action-sheet]')
      await sheet.waitFor({ state: 'visible' })
      check('touch More opens the real action sheet without opening a file', await opened(), [])
      await page.keyboard.press('Tab')
      check('action sheet traps keyboard focus inside its paper', await page.evaluate(() => Boolean(document.activeElement?.closest('.MuiDrawer-paper'))), true)
      await page.keyboard.press('Escape')
      await sheet.waitFor({ state: 'hidden' })
      check('Escape restores focus to the item More button', await more.evaluate((element) => document.activeElement === element), true)
      await more.tap()
      await sheet.waitFor({ state: 'visible' })
      await page.touchscreen.tap(10, 10)
      await sheet.waitFor({ state: 'hidden' })
      check('backdrop touch dismisses the action sheet', await sheet.isVisible(), false)
      await page.getByRole('button', { name: '位置', exact: true }).tap()
      const navigation = page.locator('[data-xdrive-file-explorer-touch-navigation-drawer]')
      await navigation.waitFor({ state: 'visible' })
      await page.getByRole('button', { name: '测试位置', exact: true }).tap()
      await navigation.waitFor({ state: 'hidden' })
      check('choosing a navigation location closes the Drawer', (await state()).crumbs, [0, 3])

      // CDP dispatches trusted touchscreen input and lets the browser own scroll
      // recognition/pointer cancellation. We never dispatch synthetic DOM events.
      const input = await context.newCDPSession(page)
      const touchAt = (type, point) => input.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: point ? [{ x: point.x, y: point.y, id: 1, radiusX: 2, radiusY: 2, force: 1 }] : [],
      })
      await reset()
      let bounds = await row('alpha.txt').boundingBox()
      await touchAt('touchStart', { x: bounds.x + 80, y: bounds.y + bounds.height / 2 })
      // The contract is a 450ms hold. This wait exercises that user gesture and
      // is deliberately unrelated to any application-performance measurement.
      await page.waitForTimeout(520)
      await touchAt('touchEnd')
      await settle()
      check('450ms hold enters selection with the held item', (await state()).selectedIDs.map(String), ['1'])
      check('long-press release does not also open the item', await opened(), [])
      check('long press exposes Done for explicit selection mode', await page.getByRole('button', { name: '完成', exact: true }).isVisible(), true)
      await sample('details-long-press')

      await reset()
      const scroll = page.locator('[data-xdrive-file-explorer-scroll-host]')
      await row('文件-006.txt').scrollIntoViewIfNeeded()
      bounds = await row('文件-006.txt').boundingBox()
      const scrollBefore = await scroll.evaluate((element) => element.scrollTop)
      const start = { x: bounds.x + 80, y: bounds.y + bounds.height / 2 }
      await touchAt('touchStart', start)
      for (let step = 1; step <= 6; step += 1) {
        await touchAt('touchMove', { x: start.x, y: start.y - step * 22 })
      }
      // Stay in the moved gesture beyond the long-press deadline. Otherwise
      // releasing/resetting early could hide an uncancelled selection timer.
      await page.waitForTimeout(520)
      await touchAt('touchEnd')
      await settle()
      check('vertical touch motion scrolls the actual FileExplorer host', await scroll.evaluate((element, before) => element.scrollTop > before, scrollBefore), true)
      check('scroll motion does not trigger tap-open', await opened(), [])
      check('scroll motion cancels pending long-press selection', (await state()).selectedIDs, [])
      await sample('details-touch-scroll')

      // Real trusted mobile pointer stream, with pointer capture on the stable
      // FileExplorer Paper. No synthetic React dispatch or dataTransfer spoofing.
      const dragPoint = async (locator) => {
        const box = await locator.boundingBox()
        assert.ok(box, 'touch drag target must exist')
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      }
      const enterTouchSelection = async (mode) => {
        await reset(mode)
        await page.getByRole('button', { name: '选择', exact: true }).tap()
        await settle()
      }
      const touchDragFrom = async (itemName, destination) => {
        const handle = row(itemName).locator('[data-xdrive-file-explorer-touch-drag-handle]')
        await handle.waitFor({ state: 'visible' })
        const targetArea = destination === 'folder'
          ? row('文件夹')
          : destination === 'crumb'
            ? page.locator('[data-xdrive-file-explorer-drop-crumb-index="0"]')
            : row('beta.txt')
        const from = await dragPoint(handle)
        const to = await dragPoint(targetArea)
        const start = await handle.boundingBox()
        check('drag handle preserves independent44px target', start.width >= 44 && start.height >= 44, true)
        check('only touch handle disables native pan', await handle.evaluate((element) =>
          getComputedStyle(element).touchAction), 'none')
        await touchAt('touchStart', from)
        await touchAt('touchMove', { x: from.x + 12, y: from.y + 4 })
        await touchAt('touchMove', to)
        await settle()
        return { handle, from, to, targetArea }
      }
      await enterTouchSelection('details')
      await touchDragFrom('alpha.txt', 'folder')
      check('touch drag highlights the live destination folder', await row('文件夹').evaluate((element) =>
        getComputedStyle(element).outlineStyle), 'solid')
      await touchAt('touchEnd')
      await settle()
      check('touch drag submits one atomic move using existing callback', (await state()).events.filter((event) =>
        event.type === 'drop').map((event) => ({ ids: event.ids, value: event.value })), [
        { ids: [1, 3], value: 'move' },
      ])
      check('completed drag clears its overlay', await page.locator('[data-xdrive-file-explorer-touch-drag-status]').count(), 0)
      await sample('details-touch-folder-drop')

      await enterTouchSelection('details')
      await tapRow('alpha.txt')
      await tapRow('beta.txt')
      await page.evaluate(() => window.fileExplorerHarness.clearEvents())
      await touchDragFrom('alpha.txt', 'folder')
      await touchAt('touchEnd')
      await settle()
      check('dragging one selected item carries the full selection', (await state()).events.filter((event) =>
        event.type === 'drop').map((event) => event.ids), [[1, 2, 3]])
      check('after drop selected identities remain intact', (await state()).selectedIDs.map(String).sort(), ['1', '2'])

      await enterTouchSelection('grid')
      await touchDragFrom('alpha.txt', 'folder')
      await touchAt('touchEnd')
      await settle()
      check('grid touch drop uses same callback without remount', (await state()).events.filter((event) =>
        event.type === 'drop').map((event) => event.ids), [[1, 3]])

      await enterTouchSelection('details')
      await touchDragFrom('alpha.txt', 'crumb')
      check('touch drag highlights breadcrumb target', await page.locator('[data-xdrive-file-explorer-drop-crumb-index="0"]').evaluate((element) =>
        getComputedStyle(element).outlineStyle), 'solid')
      await touchAt('touchEnd')
      await settle()
      check('breadcrumb touch release uses existing parent operation', (await state()).events.filter((event) =>
        event.type === 'crumb-drop').map((event) => event.ids), [[1, 0]])

      await enterTouchSelection('details')
      await touchDragFrom('alpha.txt', 'invalid')
      await touchAt('touchEnd')
      await settle()
      check('releasing over ordinary file cancels instead of moving', (await state()).events.filter((event) =>
        event.type === 'drop' || event.type === 'crumb-drop'), [])

      await enterTouchSelection('details')
      await touchDragFrom('alpha.txt', 'folder')
      await page.keyboard.press('Escape')
      await touchAt('touchEnd')
      await settle()
      check('Escape cancels an in-flight touch drag', (await state()).events.filter((event) =>
        event.type === 'drop'), [])
      check('Escape clears drop highlight and overlay', await row('文件夹').evaluate((element) =>
        getComputedStyle(element).outlineStyle !== 'solid') &&
        await page.locator('[data-xdrive-file-explorer-touch-drag-status]').count() === 0, true)

      await enterTouchSelection('details')
      await touchDragFrom('alpha.txt', 'folder')
      await touchAt('touchCancel')
      await settle()
      check('pointer cancellation never dispatches a file move', (await state()).events.filter((event) =>
        event.type === 'drop'), [])
      await sample('details-touch-drag-cancel')

      await input.detach()

      // A mouse remains a mouse even while the viewport's primary pointer is
      // coarse; this is the attached-mouse-on-touch-device acceptance path.
      await reset()
      await row('alpha.txt').click({ position: { x: 80, y: 15 } })
      await settle()
      check('mouse single click in compact layout selects only', (await state()).selectedIDs.map(String), ['1'])
      check('mouse single click in compact layout does not open', await opened(), [])
      await row('beta.txt').click({ position: { x: 80, y: 15 }, modifiers: ['Control'] })
      await settle()
      check('attached mouse retains Ctrl multi-selection', (await state()).selectedIDs.map(String).sort(), ['1', '2'])
      await row('alpha.txt').dblclick({ position: { x: 80, y: 15 } })
      await settle()
      check('attached mouse double click opens exactly once', await opened(), [[1]])
      await reset('details', 900, 700)
      await tapRow('alpha.txt')
      check('900px touch retains desktop single-click selection semantics', (await state()).selectedIDs.map(String), ['1'])
      check('900px touch does not direct-open a file', await opened(), [])
      check('900px desktop items retain native drag capability', await row('alpha.txt').getAttribute('draggable'), 'true')
      await context.close()
    } else {
      await context.close()
    }
  } catch (error) {
    results.errors.push(error.stack || String(error))
  } finally {
    results.passed = results.checks.length > 0 && results.checks.every((entry) => entry.passed) && results.errors.length === 0
    fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(results, null, 2))
    console.log(JSON.stringify({
      sourceRoot, outputDir, browserVersion: results.browserVersion,
      checks: results.checks, errors: results.errors, passed: results.passed,
    }, null, 2))
    if (!results.passed) process.exitCode = 1
    try { if (browser) await browser.close() } finally {
      if (server.listening) await new Promise((resolve) => server.close(resolve))
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })

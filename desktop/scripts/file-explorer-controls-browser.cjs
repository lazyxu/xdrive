#!/usr/bin/env node
// Real-renderer checks for compact file tabs, location controls and filters.
// Platform adapters are fixtures; production React/MUI controls are unchanged.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const esbuild = require('esbuild')

const repoRoot = path.resolve(__dirname, '../..')
const options = {}
for (const argument of process.argv.slice(2)) {
  const match = /^--(source-root|output-dir|case)=(.+)$/.exec(argument)
  if (!match) throw new Error(`Unknown argument: ${argument}`)
  options[match[1]] = match[2]
}
if (!options['output-dir']) throw new Error('Supply --output-dir=/path for results and screenshots.')
if (options.case && !['all', 'reviewed'].includes(options.case)) throw new Error('Use --case=all or --case=reviewed.')
const coreCases = options.case !== 'reviewed'
const sourceRoot = path.resolve(options['source-root'] || repoRoot)
const outputDir = path.resolve(options['output-dir'])
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright')
const results = { sourceRoot, checks: [], errors: [], samples: {} }
const check = (name, actual, expected = true) => {
  try { assert.deepEqual(actual, expected); results.checks.push({ name, passed: true }) }
  catch { results.checks.push({ name, passed: false, actual, expected }); process.stdout.write(`FAIL ${name}: ${JSON.stringify(actual)}\n`) }
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true })
  results.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim()
  results.sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: sourceRoot, encoding: 'utf8' }).trim())
  const sourceNames = { __FILE_EXPLORER__: 'FileExplorer.tsx', __NAVIGATION_PANE__: 'FileExplorerNavigationPane.tsx', __SEARCH_FILTERS__: 'FileExplorerSearchFilters.tsx', __TABS__: 'FileExplorerTabs.tsx', __THEME__: 'AppearanceThemeProvider.tsx' }
  results.sourceHashes = Object.fromEntries(Object.values(sourceNames).map((name) => [name, createHash('sha256').update(fs.readFileSync(path.join(sourceRoot, 'ui/shared/src/mui', name))).digest('hex')]))
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'file-explorer-controls-browser.tsx')], bundle: true,
    outfile: path.join(outputDir, 'bundle.js'), jsx: 'automatic',
    nodePaths: [path.join(repoRoot, 'desktop/node_modules')],
    alias: Object.fromEntries(Object.entries(sourceNames).map(([alias, file]) => [alias, path.join(sourceRoot, 'ui/shared/src/mui', file)])),
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    const route = new URL(request.url, 'http://localhost').pathname
    if (route === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script src="/bundle.js"></script></body></html>')
    } else if (route === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript'); response.end(fs.readFileSync(path.join(outputDir, 'bundle.js')))
    } else if (route === '/favicon.ico') { response.statusCode = 204; response.end() }
    else { results.errors.push(`Unexpected fixture request ${route}`); response.statusCode = 404; response.end() }
  })
  let browser
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const args = process.env.XDRIVE_BROWSER_ARGS ? JSON.parse(process.env.XDRIVE_BROWSER_ARGS) : undefined
    browser = await chromium.launch({ headless: true, executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || undefined, args })
    results.browserVersion = browser.version()
    const baseURL = `http://127.0.0.1:${server.address().port}/`

    async function pageFor(width, height, touch) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 })
      const page = await context.newPage()
      page.setDefaultTimeout(4500)
      page.on('pageerror', (error) => results.errors.push(error.message))
      page.on('console', (message) => { if (message.type() === 'error') results.errors.push(message.text()) })
      await page.goto(baseURL)
      await page.locator('[data-xdrive-file-explorer-item]').first().waitFor({ state: 'visible' })
      await settle(page)
      return { context, page }
    }
    const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const state = (page) => page.evaluate(() => ({ ...window.fileExplorerControlsHarness.state, selectedIDs: window.fileExplorerControlsHarness.selectedIDs, events: window.fileExplorerControlsHarness.events }))
    const clear = (page) => page.evaluate(() => window.fileExplorerControlsHarness.clearEvents())
    const stableBox = (locator) => locator.evaluate((element) => new Promise((resolve) => {
      let previous = ''; let consecutive = 0; let frames = 0
      const sample = () => {
        const r = element.getBoundingClientRect()
        const next = [r.x, r.y, r.width, r.height].map((value) => Math.round(value * 10)).join(':')
        consecutive = next === previous ? consecutive + 1 : 0
        previous = next; frames += 1
        if (consecutive >= 3 || frames > 90) resolve()
        else requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    }))
    const visible = async (locator) => {
      const flags = await locator.evaluateAll((elements) => elements.map((element) => {
        const r = element.getBoundingClientRect(); const style = getComputedStyle(element)
        return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
      }))
      return flags.some(Boolean)
    }
    const button = (page, label) => page.getByRole('button', { name: label, exact: true })
    const activate = (locator, touch) => touch ? locator.tap() : locator.click()
    const capture = async (page, name) => {
      // Capture settled visuals without a retiring Menu/Fade ghost; interaction
      // and focus assertions still run with production animation behavior.
      await page.screenshot({ path: path.join(outputDir, `${name}.png`), animations: 'disabled' })
      results.samples[name] = await page.evaluate(() => ({
        viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth,
        state: window.fileExplorerControlsHarness.state,
      }))
    }
    const checkIconAlignment = async (pane, name) => {
      const positions = []
      for (const label of ['我的文件', '固定工作目录', '回收站', '收藏报告.txt']) {
        const control = pane.getByRole('button', { name: label, exact: true })
        const x = await control.evaluate((element) => element.firstElementChild.getBoundingClientRect().x)
        positions.push({ label, x })
      }
      results.samples[`${name}-icon-alignment`] = positions
      check(`${name}: tree, Quick Access, Trash and Favorite icon starts align`, Math.max(...positions.map((item) => item.x)) - Math.min(...positions.map((item) => item.x)) <= 0.75)
    }
    const attempt = async (name, action) => {
      try { await action() }
      catch (error) { results.checks.push({ name, passed: false, error: String(error.message || error).split('\n').slice(0, 5).join('\n') }); process.stdout.write(`FAIL ${name}: ${String(error.message || error).split('\n')[0]}\n`) }
    }

    // Both mobile presentation and a narrow window with a fine pointer own one
    // accessible browsing context. We invoke actual browser input handlers.
    for (const touch of coreCases ? [true, false] : []) {
      for (const width of [360, 899]) {
        const name = `${touch ? 'touch' : 'mouse'}-${width}`
        const { context, page } = await pageFor(width, 780, touch)
        await attempt(`${name}: tabs and keyboard`, async () => {
          check(`${name}: no visible file tab strip`, await visible(page.getByRole('tablist', { name: '文件标签页' })), false)
          if (touch && width === 360) {
            const targets = await page.locator('[data-xdrive-file-explorer-touch-command-bar] button:not([disabled])').evaluateAll((elements) => elements.map((element) => {
              const r = element.getBoundingClientRect()
              return { label: element.getAttribute('aria-label') || element.textContent.trim(), x: r.x, right: r.right, width: r.width, height: r.height }
            }).filter((item) => item.width > 0 && item.height > 0))
            results.samples[`${name}-toolbar-targets`] = targets
            check(`${name}: compact toolbar targets are 44px and inside viewport`, targets.filter((item) => item.width < 43.9 || item.height < 43.9 || item.x < -0.1 || item.right > width + 0.1), [])
          }
          const row = page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: '一级文件夹' }).first()
          await row.click()
          await clear(page)
          for (const key of ['Control+t', 'Control+Shift+t', 'Control+Tab', 'Control+Shift+Tab', 'Control+1', 'Control+w']) await page.keyboard.press(key)
          check(`${name}: internal tab shortcuts never call adapters`, (await state(page)).events.filter((event) => event.type.startsWith('tab-')), [])
          await clear(page)
          await row.click({ button: 'middle' })
          check(`${name}: middle click never opens an internal tab`, (await state(page)).events.filter((event) => event.type === 'tab-middle'), [])
          await row.click({ button: 'right' })
          await settle(page)
          check(`${name}: item actions omit internal new-tab command`, await visible(page.getByText('在新标签页中打开', { exact: true })), false)
          await page.keyboard.press('Escape')
          await page.evaluate(() => {
            const host = document.querySelector('[data-xdrive-file-explorer-scroll-host]')
            host.scrollTop = 200
            window.controlsScrollOwner = host
            window.controlsCrumbsBeforeResize = JSON.stringify(window.fileExplorerControlsHarness.state.crumbs)
          })
          await page.setViewportSize({ width: 900, height: 700 }); await settle(page)
          check(`${name}: wide tab strip returns`, await visible(page.getByRole('tablist', { name: '文件标签页' })))
          await checkIconAlignment(page.locator('[data-xdrive-file-explorer-navigation-pane]'), `${name}-wide`)
          await page.getByRole('tab', { name: '第二目录' }).click()
          check(`${name}: desktop tab activation works`, (await state(page)).activeTabID, 'two')
          await page.setViewportSize({ width, height: 780 }); await settle(page)
          check(`${name}: wide return retains active committed tab`, (await state(page)).activeTabID, 'two')
          check(`${name}: narrow return hides the tab strip again`, await visible(page.getByRole('tablist', { name: '文件标签页' })), false)
          check(`${name}: resize retains scroll host and current crumbs`, await page.evaluate(() => document.querySelector('[data-xdrive-file-explorer-scroll-host]') === window.controlsScrollOwner && JSON.stringify(window.fileExplorerControlsHarness.state.crumbs) === window.controlsCrumbsBeforeResize))
          await capture(page, name)
        })
        // Single-process portable Chromium can terminate its process when an
        // incognito context is destroyed. Close pages here; browser.close owns
        // final context teardown after every scenario has completed.
        await page.close()
      }
    }

    // The real navigation pane includes every persisted discovery section.
    for (const [width, height] of coreCases ? [[390, 844], [844, 390]] : []) {
      const name = `location-${width}x${height}`
      const { context, page } = await pageFor(width, height, true)
      await attempt(name, async () => {
        await button(page, '位置').tap()
        const drawer = page.locator('[data-xdrive-file-explorer-touch-navigation-drawer]')
        await drawer.waitFor({ state: 'visible' })
        await stableBox(drawer)
        await checkIconAlignment(drawer, name)
        for (const section of ['快速访问', '智能文件夹', '标签', '收藏', '最近使用']) check(`${name}: ${section} is present`, await drawer.getByRole('navigation', { name: section, exact: true }).count(), 1)
        const controlSizes = await drawer.locator('button:not([disabled]), [role="button"]:not([aria-disabled="true"])').evaluateAll((elements) => elements.map((element) => {
          const r = element.getBoundingClientRect()
          return { label: element.getAttribute('aria-label') || element.textContent.trim(), width: r.width, height: r.height }
        }).filter((item) => item.width > 0 && item.height > 0))
        results.samples[`${name}-control-targets`] = controlSizes
        check(`${name}: enabled location controls have actual 44px targets`, controlSizes.filter((item) => item.width < 43.9 || item.height < 43.9), [])
        await capture(page, `${name}-open`)
        await clear(page)
        const expandRoot = drawer.getByRole('button', { name: '展开 我的文件', exact: true })
        await expandRoot.scrollIntoViewIfNeeded(); await expandRoot.tap({ position: { x: 2, y: 2 } })
        check(`${name}: expanding root does not navigate`, (await state(page)).events.filter((event) => event.type === 'navigate'), [])
        let currentName = '一级文件夹'
        for (let level = 1; level <= 7; level += 1) {
          const expand = drawer.getByRole('button', { name: `展开 ${currentName}`, exact: true })
          await expand.scrollIntoViewIfNeeded()
          const navigateRow = drawer.getByRole('button', { name: currentName, exact: true })
          const a = await expand.boundingBox(); const b = await navigateRow.boundingBox()
          check(`${name}: level ${level} distinct touch targets`, !!a && !!b && a.width >= 43.9 && a.height >= 43.9 && b.width >= 43.9 && b.height >= 43.9 && a.x + a.width <= b.x + 0.1)
          await expand.tap(); await settle(page)
          currentName = `${level + 1}级深层文件夹名称`
        }
        check(`${name}: deep expansion still does not navigate`, (await state(page)).events.filter((event) => event.type === 'navigate'), [])
        const deepest = drawer.getByRole('button', { name: currentName, exact: true })
        await deepest.scrollIntoViewIfNeeded(); await stableBox(deepest)
        await capture(page, `${name}-deep`)
        await deepest.tap({ position: { x: 2, y: 2 } })
        await drawer.waitFor({ state: 'hidden' })
        check(`${name}: navigation chooses the deep directory once`, (await state(page)).events.filter((event) => event.type === 'navigate').length, 1)
        await button(page, '位置').tap(); await drawer.waitFor({ state: 'visible' })
        await button(page, '关闭位置').tap(); await drawer.waitFor({ state: 'hidden' })
        check(`${name}: close returns keyboard focus to location trigger`, await button(page, '位置').evaluate((element) => element === document.activeElement))
        await capture(page, name)
      })
      await page.close()
    }

    // Reachability is checked once per viewport before deeper interactions, so a
    // missing mobile entry records a true red without cascaded long timeouts.
    for (const [width, height, touch] of coreCases ? [[360, 780, true], [844, 390, true], [899, 700, false], [900, 700, false]] : []) {
      const name = `filters-${touch ? 'touch' : 'mouse'}-${width}x${height}`
      const { context, page } = await pageFor(width, height, touch)
      await attempt(name, async () => {
        const trigger = button(page, '筛选文件')
        const reachable = await visible(trigger)
        check(`${name}: filter trigger is visible and reachable`, reachable)
        if (!reachable) { await capture(page, name); return }
        if (width < 900) {
          const r = await trigger.boundingBox()
          check(`${name}: filter trigger has 44px actual target`, r.width >= 43.9 && r.height >= 43.9)
        }
        await activate(trigger, touch)
        const panel = page.locator('[data-xdrive-file-explorer-search-filters]')
        await panel.waitFor({ state: 'visible' })
        await stableBox(panel)
        // The marker is the field body; mobile header/footer intentionally stay
        // outside that scroller. Use the accessible dialog for panel actions.
        const namedDialog = page.getByRole('dialog', { name: '文件筛选', exact: true })
        const filterDialog = await namedDialog.count() ? namedDialog : panel
        await capture(page, `${name}-open`)
        if (width < 900) check(`${name}: mobile filter is an accessible dialog`, await page.getByRole('dialog', { name: '文件筛选', exact: true }).count(), 1)
        await activate(panel.getByText('类型', { exact: true }), touch)
        await activate(page.getByRole('menuitem', { name: '图片', exact: true }), touch)
        check(`${name}: choosing image changes shared filters`, (await state(page)).filters.kind, 'image')
        check(`${name}: selected condition remains visible`, await visible(panel.getByText('类型：图片', { exact: true })))
        await activate(panel.getByText('类型：图片', { exact: true }), touch)
        await page.keyboard.press('Escape'); await settle(page)
        check(`${name}: nested Escape returns focus inside filter panel`, await panel.evaluate((element) => element.contains(document.activeElement)))
        const clearType = button(page, '清除类型')
        if (await visible(clearType)) {
          await activate(clearType, touch)
        } else {
          const deletion = panel.locator('.MuiChip-root').filter({ hasText: '类型：图片' }).locator('.MuiChip-deleteIcon')
          await activate(deletion, touch)
        }
        check(`${name}: remove individual condition clears kind`, (await state(page)).filters.kind ?? null, null)
        await activate(panel.getByText('类型', { exact: true }), touch)
        await activate(page.getByRole('menuitem', { name: '图片', exact: true }), touch)
        await activate(panel.getByText('大小', { exact: true }), touch)
        await activate(page.getByRole('menuitem', { name: '小于 1 MiB', exact: true }), touch)
        await activate(filterDialog.getByRole('button', { name: '清除全部', exact: true }), touch)
        check(`${name}: Clear All clears shared conditions`, Object.values((await state(page)).filters).filter((value) => value !== undefined), [])
        await activate(panel.getByText('类型', { exact: true }), touch)
        await activate(page.getByRole('menuitem', { name: '图片', exact: true }), touch)
        await activate(filterDialog.getByRole('button', { name: '保存搜索', exact: true }), touch)
        check(`${name}: save delegates the active conditions once`, (await state(page)).events.filter((event) => event.type === 'save-search').map((event) => event.value), [{ kind: 'image' }])
        check(`${name}: current filter count remains visible on trigger`, await trigger.evaluate((element) => /1/.test([element.textContent, element.getAttribute('aria-label'), element.getAttribute('title')].join(' '))))
        await activate(trigger, touch); await panel.waitFor({ state: 'visible' })
        await stableBox(panel)
        await capture(page, `${name}-saved`)
        if (width < 900) {
          const labels = await page.evaluate(() => window.fileExplorerControlsHarness.labels)
          for (const [field, option, stateKey, id] of [
            ['同步文件夹', labels.longSource, 'sourceID', 42],
            ['标签', labels.longTag, 'tagID', 32],
          ]) {
            await activate(panel.getByText(field, { exact: true }), touch)
            await activate(page.getByRole('menuitem', { name: option, exact: true }), touch)
            check(`${name}: long ${field} option updates its filter`, (await state(page)).filters[stateKey], id)
            const fieldButton = panel.getByRole('button', { name: `${field}：${option}`, exact: true })
            await fieldButton.scrollIntoViewIfNeeded(); await stableBox(fieldButton)
            const box = await fieldButton.boundingBox()
            check(`${name}: long ${field} value wraps within available width`, box.width >= 43.9 && box.height >= 43.9 && box.x >= -0.1 && box.x + box.width <= width + 0.1)
            if (height === 390 && field === '标签') {
              check(`${name}: short-height field body scrolls independently`, await panel.evaluate((element) => element.scrollHeight > element.clientHeight && element.scrollTop > 0))
              await capture(page, `${name}-long-tag`)
            }
            await activate(button(page, `清除${field}`), touch)
            check(`${name}: long ${field} remains individually clearable`, (await state(page)).filters[stateKey] ?? null, null)
          }
          const controls = await filterDialog.locator('button:not([disabled]), [role="button"]:not([aria-disabled="true"])').evaluateAll((elements) => elements.map((element) => {
            const r = element.getBoundingClientRect(); return { label: element.getAttribute('aria-label') || element.textContent.trim(), width: r.width, height: r.height }
          }).filter((item) => item.width > 0 && item.height > 0))
          check(`${name}: filter controls have 44px touch targets`, controls.filter((item) => item.width < 43.9 || item.height < 43.9), [])
          const fixedActions = await filterDialog.getByRole('button').filter({ hasText: /保存搜索|清除全部/ }).evaluateAll((elements) => elements.map((element) => {
            const r = element.getBoundingClientRect(); return r.y >= 0 && r.bottom <= innerHeight + 0.1
          }))
          check(`${name}: save and clear stay inside the short viewport`, fixedActions.length === 2 && fixedActions.every(Boolean))
          await activate(button(page, '关闭筛选'), touch); await panel.waitFor({ state: 'hidden' })
          check(`${name}: close restores filter trigger focus`, await trigger.evaluate((element) => element === document.activeElement))
          await page.setViewportSize({ width: 900, height: 700 }); await settle(page)
          check(`${name}: wide return retains current filter`, (await state(page)).filters.kind, 'image')
        } else { await page.keyboard.press('Escape') }
        await capture(page, name)
      })
      await page.close()
    }

    // Review reproducers: React keyboard events from portaled filter content
    // must not dispatch Explorer commands behind the modal. A responsive slot
    // remount must hand focus to the newly mounted, visible filter trigger.
    for (const key of ['Enter', 'Space']) {
      const name = `reviewed-filter-trigger-keyboard-${key}`
      const { page } = await pageFor(390, 844, true)
      await attempt(name, async () => {
        const file = page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: '报告-001.txt' }).first()
        await file.click()
        check(`${name}: setup selects file 1000`, (await state(page)).selectedIDs, [1000])
        await button(page, '筛选文件').focus()
        await clear(page)
        await page.keyboard.press(key); await settle(page)
        check(`${name}: inline button key never opens the background file or Quick Look`, (await state(page)).events.filter((event) => ['open', 'quick-look'].includes(event.type)), [])
        check(`${name}: native trigger keyboard activation opens its filter`, await visible(page.locator('[data-xdrive-file-explorer-search-filters]')))
        check(`${name}: trigger keyboard preserves caller selection`, (await state(page)).selectedIDs, [1000])
        await capture(page, name)
      })
      await page.close()
    }
    for (const key of ['Enter', 'Space']) {
      const name = `reviewed-filter-keyboard-${key}`
      const { page } = await pageFor(390, 844, true)
      await attempt(name, async () => {
        const file = page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: '报告-001.txt' }).first()
        await file.click()
        check(`${name}: setup selects file 1000`, (await state(page)).selectedIDs, [1000])
        await button(page, '筛选文件').tap()
        const panel = page.locator('[data-xdrive-file-explorer-search-filters]')
        await panel.waitFor({ state: 'visible' }); await stableBox(panel)
        await panel.getByRole('button', { name: '类型', exact: true }).focus()
        await clear(page)
        await page.keyboard.press(key); await settle(page)
        check(`${name}: modal key never opens the background file or Quick Look`, (await state(page)).events.filter((event) => ['open', 'quick-look'].includes(event.type)), [])
        check(`${name}: native field keyboard activation opens its menu`, await visible(page.getByRole('menuitem', { name: '图片', exact: true })))
        check(`${name}: modal keyboard preserves caller selection`, (await state(page)).selectedIDs, [1000])
        await capture(page, name)
      })
      await page.close()
    }
    {
      const name = 'reviewed-filter-responsive-focus'
      const { page } = await pageFor(899, 700, true)
      await attempt(name, async () => {
        const file = page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: '报告-001.txt' }).first()
        await file.click()
        await button(page, '筛选文件').tap()
        const panel = page.locator('[data-xdrive-file-explorer-search-filters]')
        await panel.waitFor({ state: 'visible' }); await stableBox(panel)
        await panel.getByRole('button', { name: '类型', exact: true }).tap()
        const imageOption = page.getByRole('menuitem', { name: '图片', exact: true })
        await imageOption.waitFor({ state: 'visible' })
        await page.setViewportSize({ width: 900, height: 700 })
        await panel.waitFor({ state: 'hidden' }); await imageOption.waitFor({ state: 'hidden' }); await settle(page)
        check(`${name}: responsive change dismisses the filter and nested menu`, !(await visible(panel)) && !(await visible(imageOption)))
        results.samples[`${name}-active-element`] = await page.evaluate(() => ({
          tag: document.activeElement?.tagName,
          label: document.activeElement?.getAttribute('aria-label'),
          text: document.activeElement?.tagName === 'BODY' ? '' : document.activeElement?.textContent,
        }))
        check(`${name}: new visible trigger receives focus after slot remount`, await button(page, '筛选文件').evaluate((element) => element === document.activeElement))
        check(`${name}: responsive dismissal preserves selected file`, (await state(page)).selectedIDs, [1000])
        await capture(page, name)
      })
      await page.close()
    }
    {
      const name = 'reviewed-filter-narrow-mouse-reachability'
      const { page } = await pageFor(360, 780, false)
      await attempt(name, async () => {
        const trigger = button(page, '筛选文件')
        const geometry = await trigger.evaluate((element) => {
          const r = element.getBoundingClientRect()
          let left = 0; let top = 0; let right = innerWidth; let bottom = innerHeight
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent); const p = parent.getBoundingClientRect()
            if (/(hidden|auto|scroll|clip)/.test(style.overflowX)) { left = Math.max(left, p.left); right = Math.min(right, p.right) }
            if (/(hidden|auto|scroll|clip)/.test(style.overflowY)) { top = Math.max(top, p.top); bottom = Math.min(bottom, p.bottom) }
          }
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return {
            rect: { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom },
            clip: { left, top, right, bottom },
            fullTargetVisible: r.width >= 43.9 && r.height >= 43.9 && r.left >= left - 0.1 && r.right <= right + 0.1 && r.top >= top - 0.1 && r.bottom <= bottom + 0.1,
            centerReceivesPointer: element.contains(hit),
          }
        })
        results.samples[name] = geometry
        check(`${name}: complete 44px filter target fits viewport and clipping ancestors`, geometry.fullTargetVisible)
        check(`${name}: native pointer hit resolves to the filter before any auto-scroll`, geometry.centerReceivesPointer)
        await capture(page, `${name}-initial`)
      })
      await page.close()
    }
    for (const touch of [true, false]) {
      const name = `reviewed-search-focus-${touch ? 'touch' : 'mouse'}`
      const { page } = await pageFor(360, 780, touch)
      await attempt(name, async () => {
        const file = page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: '报告-001.txt' }).first()
        await file.click()
        await clear(page)
        await page.keyboard.press('Control+f'); await settle(page)
        const focusedSearch = await page.evaluate(() => document.activeElement?.tagName === 'INPUT' && document.activeElement.getAttribute('placeholder')?.includes('搜索'))
        check(`${name}: compact shortcut reveals and focuses search`, Boolean(focusedSearch))
        if (focusedSearch) {
          await page.keyboard.type('report')
          await page.keyboard.press('Escape'); await settle(page)
          await file.focus()
          await page.keyboard.press('Control+f'); await settle(page)
          const selectedQuery = await page.evaluate(() => ({
            value: document.activeElement?.value,
            start: document.activeElement?.selectionStart,
            end: document.activeElement?.selectionEnd,
          }))
          check(`${name}: reopening selects the retained query`, selectedQuery, { value: 'report', start: 0, end: 6 })
        }
        check(`${name}: focusing search preserves caller selection and never opens a file`, { selected: (await state(page)).selectedIDs, opened: (await state(page)).events.filter((event) => ['open', 'quick-look'].includes(event.type)) }, { selected: [1000], opened: [] })
      })
      await page.close()
    }
    check('no unexpected browser/page/request errors', results.errors, [])
  } finally {
    if (browser) await browser.close()
    await new Promise((resolve) => server.close(resolve))
    results.passed = results.checks.filter((item) => item.passed).length
    results.failed = results.checks.filter((item) => !item.passed).length
    fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(results, null, 2) + '\n')
    process.stdout.write(`${results.passed} passed; ${results.failed} failed; ${results.errors.length} browser errors\n`)
    if (results.failed || results.errors.length) process.exitCode = 1
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })

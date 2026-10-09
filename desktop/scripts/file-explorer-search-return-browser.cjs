#!/usr/bin/env node
// Focused real Workspace + Navigation + Search + MUI renderer acceptance.
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
if (!options['output-dir']) throw new Error('Supply --output-dir=/path for evidence.')
if (options.case && !['all', 'surface', 'return', 'recovery', 'window'].includes(options.case)) throw new Error('Use --case=all|surface|return|recovery|window.')
const sourceRoot = path.resolve(options['source-root'] || repoRoot)
const outputDir = path.resolve(options['output-dir'])
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright')
const results = { sourceRoot, checks: [], errors: [], samples: {} }
function check(name, actual, expected = true) {
  try { assert.deepEqual(actual, expected); results.checks.push({ name, passed: true }) }
  catch { results.checks.push({ name, passed: false, actual, expected }); process.stdout.write(`FAIL ${name}: ${JSON.stringify(actual)}\n`) }
}
async function main() {
  fs.mkdirSync(outputDir, { recursive: true })
  try { results.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { results.sourceCommit = fs.existsSync(path.join(sourceRoot, 'source-revision.txt')) ? fs.readFileSync(path.join(sourceRoot, 'source-revision.txt'), 'utf8').trim() : null }
  const sources = {
    __FILE_EXPLORER__: 'mui/FileExplorer.tsx', __WORKSPACE__: 'mui/FileExplorerWorkspaceController.ts',
    __SEARCH_FILTERS__: 'mui/FileExplorerSearchFilters.tsx', __ACTIONS__: 'mui/FileExplorerActions.tsx',
    __THEME__: 'mui/AppearanceThemeProvider.tsx', __SEARCH_MODEL__: 'file-explorer-search.ts',
  }
  const measuredSources = [...Object.values(sources), 'mui/FileExplorerNavigation.ts', 'mui/FileExplorerSearch.ts', 'mui/VirtualCollectionController.ts']
  results.sourceHashes = Object.fromEntries(measuredSources.map((name) => [name, createHash('sha256').update(fs.readFileSync(path.join(sourceRoot, 'ui/shared/src', name))).digest('hex')]))
  results.fixtureHashes = Object.fromEntries(['file-explorer-search-return-browser.cjs', 'file-explorer-search-return-browser.tsx'].map((name) => [name, createHash('sha256').update(fs.readFileSync(path.join(__dirname, name))).digest('hex')]))
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'file-explorer-search-return-browser.tsx')], bundle: true,
    outfile: path.join(outputDir, 'bundle.js'), jsx: 'automatic', nodePaths: [path.join(repoRoot, 'desktop/node_modules')],
    alias: Object.fromEntries(Object.entries(sources).map(([alias, name]) => [alias, path.join(sourceRoot, 'ui/shared/src', name)])),
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  results.bundleHash = createHash('sha256').update(fs.readFileSync(path.join(outputDir, 'bundle.js'))).digest('hex')
  const server = http.createServer((request, response) => {
    const route = new URL(request.url, 'http://localhost').pathname
    response.setHeader('Cache-Control', 'no-store')
    if (route === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script src="/bundle.js"></script></body></html>')
    } else if (route === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(fs.readFileSync(path.join(outputDir, 'bundle.js'))) }
    else if (route === '/favicon.ico') { response.statusCode = 204; response.end() }
    else { response.statusCode = 404; response.end(); results.errors.push(`Unexpected request ${route}`) }
  })
  let browser
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    browser = await chromium.launch({ headless: true, executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || undefined, args: process.env.XDRIVE_BROWSER_ARGS ? JSON.parse(process.env.XDRIVE_BROWSER_ARGS) : undefined })
    results.browserVersion = browser.version()
    const baseURL = `http://127.0.0.1:${server.address().port}/`
    const state = (page) => page.evaluate(() => ({ ...window.searchReturnHarness.state, selectedIDs: window.searchReturnHarness.selectedIDs, requests: window.searchReturnHarness.requests, events: window.searchReturnHarness.events, errors: window.searchReturnHarness.errors, returnSnapshot: window.searchReturnHarness.returnSnapshot?.() }))
    const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const button = (page, name) => page.getByRole('button', { name, exact: true })
    const sortTrigger = (page) => page.getByRole('button', { name: /^排序与分组/ })
    const sortField = (page, label) => page.locator('[role="menuitem"], [role="menuitemradio"]').filter({ hasText: new RegExp(`${label}$`) })
    const openSort = async (page) => {
      if (await page.getByRole('menu').count()) {
        await page.keyboard.press('Escape')
        await page.getByRole('menu').waitFor({ state: 'hidden' })
      }
      await sortTrigger(page).click()
      await page.getByRole('menu').waitFor()
      await page.getByRole('menu').evaluate((menu) => Promise.all(menu.closest('.MuiPaper-root').getAnimations().map((animation) => animation.finished.catch(() => undefined))))
    }
    const searchSummaryText = async (page) => (await page.locator('[data-xdrive-file-explorer-search-summary]').allTextContents()).join(' ')
    const quietSearch = (page) => page.waitForFunction(() => window.searchReturnHarness?.state.searchActive && !window.searchReturnHarness.state.searchLoading && window.searchReturnHarness.state.count === 4096)
    let activeCasePage
    const pageFor = async (mode = 'details', width = 390, touch = true) => {
      const context = await browser.newContext({ viewport: { width, height: 780 }, isMobile: touch, hasTouch: touch, deviceScaleFactor: 1 })
      const page = await context.newPage(); page.setDefaultTimeout(4500)
      activeCasePage = page
      page.on('pageerror', (error) => results.errors.push(error.message))
      page.on('console', (message) => { if (message.type() === 'error') results.errors.push(message.text()) })
      await page.goto(`${baseURL}?mode=${mode}`)
      await quietSearch(page); await settle(page)
      return page
    }
    const attempt = async (name, action) => {
      try { await action() }
      catch (error) {
        results.checks.push({ name, passed: false, error: String(error.message || error).split('\n').slice(0, 5).join('\n') })
        process.stdout.write(`FAIL ${name}: ${String(error.message || error).split('\n')[0]}\n`)
        if (activeCasePage && !activeCasePage.isClosed()) {
          const label = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
          await capture(activeCasePage, `${label}-failure`)
          results.samples[`${label}-failure-viewport`] = await snapshot(activeCasePage)
        }
      } finally { if (activeCasePage && !activeCasePage.isClosed()) await activeCasePage.close(); activeCasePage = null }
    }
    const capture = async (page, name) => {
      await page.screenshot({ path: path.join(outputDir, `${name}.png`), animations: 'disabled' })
      results.samples[name] = await state(page)
    }
    const snapshot = (page) => page.evaluate(() => {
      const host = document.querySelector('[data-xdrive-file-explorer-scroll-host]')
      const r = host.getBoundingClientRect()
      const visible = [...host.querySelectorAll('[data-xdrive-file-explorer-item]')].filter((el) => {
        const b = el.getBoundingClientRect(); return b.bottom > r.top + 32 && b.top < r.bottom
      }).map((el) => ({ text: el.textContent, top: el.getBoundingClientRect().top - r.top }))
      return { scrollTop: host.scrollTop, scrollLeft: host.scrollLeft, visible, selectedIDs: [...window.searchReturnHarness.selectedIDs] }
    })
    const visibleItem = async (page, kind) => {
      const text = await page.locator('[data-xdrive-file-explorer-scroll-host]').evaluate((element, type) => {
        const bounds = element.getBoundingClientRect()
        const name = type === 'dir' ? /结果-\d+-文件夹/ : /结果-\d+\.txt/
        return [...element.querySelectorAll('[data-xdrive-file-explorer-item]')].find((item) => {
          const box = item.getBoundingClientRect()
          return name.test(item.textContent) && box.top >= bounds.top + 32 && box.bottom <= bounds.bottom
        })?.textContent
      }, kind)
      assert.ok(text, `a loaded ${kind} is inside the actual viewport`)
      return page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: text })
    }
    const deepItem = async (page, kind = 'dir') => {
      await page.locator('[data-xdrive-file-explorer-scroll-host]').evaluate((element) => {
        window.searchReturnScrollOwner = element
        element.scrollTop = Math.floor((element.scrollHeight - element.clientHeight) * 0.61)
      })
      await page.waitForFunction(() => window.searchReturnHarness.state.loadedIndexes.some((index) => index > 2000))
      await settle(page)
      const item = await visibleItem(page, kind)
      await item.click(); await settle(page)
      return { item, before: await snapshot(page) }
    }
    const waitFolder = (page) => page.waitForFunction(() => !window.searchReturnHarness.state.searchActive && window.searchReturnHarness.state.crumbs.length > 1)
    const assertReturn = async (page, before, label) => {
      await quietSearch(page)
      await page.waitForFunction((top) => Math.abs(document.querySelector('[data-xdrive-file-explorer-scroll-host]').scrollTop - top) < 1, before.scrollTop).catch(() => undefined)
      await settle(page)
      const after = await snapshot(page)
      check(`${label}: exact unchanged viewport`, after.scrollTop, before.scrollTop)
      check(`${label}: selected stable IDs`, after.selectedIDs, before.selectedIDs)
      return after
    }

    if (!options.case || options.case === 'all' || options.case === 'surface') {
      await attempt('M05 sort field/direction', async () => {
        const page = await pageFor()
        await sortTrigger(page).click()
        await sortField(page, '名称').click()
        await settle(page)
        check('selecting a different sort field preserves descending direction', (await state(page)).sort, { key: 'name', direction: 'desc' })
        await openSort(page)
        const ascending = page.getByRole('menuitemradio', { name: /升序/ })
        const descending = page.getByRole('menuitemradio', { name: /降序/ })
        check('sort exposes an explicit ascending radio choice', await ascending.count(), 1)
        check('sort exposes an explicit descending radio choice', await descending.count(), 1)
        const repeatedFieldOrder = (await state(page)).sort
        await sortField(page, '名称').click(); await settle(page)
        check('reselecting the current sort field is idempotent', (await state(page)).sort, repeatedFieldOrder)
        await openSort(page)
        if (await ascending.count()) {
          const box = await ascending.boundingBox()
          check('explicit mobile sort direction target is at least44px', box.width >= 44 && box.height >= 44)
          await ascending.click(); await settle(page)
          check('explicit ascending direction applies without changing field', (await state(page)).sort, { key: 'name', direction: 'asc' })
          await openSort(page)
          check('ascending radio exposes checked state', await ascending.getAttribute('aria-checked'), 'true')
          await sortField(page, '修改时间').click(); await settle(page)
          check('changing sort field also preserves ascending direction', (await state(page)).sort, { key: 'updated', direction: 'asc' })
          await openSort(page)
          await descending.click(); await settle(page)
          check('explicit descending direction applies without changing field', (await state(page)).sort, { key: 'updated', direction: 'desc' })
          check('direction choice preserves grouping and folders-first', (await state(page)).grouping, { groupBy: 'modified', foldersFirst: false })
          await page.keyboard.press('Escape'); await settle(page)
          check('mobile sort trigger reports the active field and direction', /修改时间.*降序/.test(await sortTrigger(page).getAttribute('aria-label')))
        }
        await capture(page, 'sort-direction'); await page.close()
      })
      await attempt('M05 wide keyboard sort and grouping', async () => {
        const page = await pageFor('details', 900, false)
        await openSort(page)
        await sortField(page, '名称').press('Enter'); await settle(page)
        check('wide keyboard field choice preserves direction', (await state(page)).sort, { key: 'name', direction: 'desc' })
        await openSort(page)
        const ascending = page.getByRole('menuitemradio', { name: /升序/ })
        check('wide sort exposes the explicit direction control', await ascending.count(), 1)
        if (await ascending.count()) {
          await ascending.press('Enter'); await settle(page)
          check('wide keyboard explicitly selects ascending', (await state(page)).sort, { key: 'name', direction: 'asc' })
          await openSort(page)
          await page.getByRole('menuitemradio', { name: /不分组/ }).press('Enter'); await settle(page)
          await openSort(page)
          await page.getByRole('menuitemcheckbox', { name: /文件夹优先/ }).press('Enter'); await settle(page)
          check('wide grouping and folders-first remain independent of sort', { sort: (await state(page)).sort, grouping: (await state(page)).grouping }, { sort: { key: 'name', direction: 'asc' }, grouping: { groupBy: 'none', foldersFirst: true } })
        }
        await capture(page, 'wide-sort-grouping')
      })
      await attempt('M05 unavailable Columns', async () => {
        const page = await pageFor('columns', 900, false)
        check('Search falls back from unsupported Columns to Details', await page.getByRole('table', { name: '文件列表', exact: true }).count(), 1)
        check('unsupported Columns fallback preserves preferred view', (await state(page)).preferredView, 'columns')
        check('unsupported Columns does not silently render Grid', await page.getByRole('list', { name: '文件图标', exact: true }).count(), 0)
        await capture(page, 'columns-search')
        await page.evaluate(() => window.searchReturnHarness.current.clearSearch()); await settle(page)
        await page.locator('[data-xdrive-file-explorer-column-view]').waitFor()
        check('leaving Search restores available preferred Columns', await page.locator('[data-xdrive-file-explorer-column-view]').count() > 0)
        await page.setViewportSize({ width: 899, height: 780 }); await settle(page)
        check('899px fine-pointer projects Columns to List', await page.getByRole('table', { name: '文件列表', exact: true }).count(), 1)
        check('narrow projection leaves preferred Columns unchanged', (await state(page)).preferredView, 'columns')
        await page.setViewportSize({ width: 900, height: 780 }); await settle(page)
        check('900px restores Columns without a view preference write', await page.locator('[data-xdrive-file-explorer-column-view]').count() > 0 && !(await state(page)).events.some((event) => event.type === 'view-choice'))
        await page.setViewportSize({ width: 899, height: 780 }); await settle(page)
        await page.getByRole('button', { name: /^视图/ }).click()
        await page.getByRole('menuitem', { name: '网格', exact: true }).click(); await settle(page)
        await page.setViewportSize({ width: 900, height: 780 }); await settle(page)
        check('explicit narrow Grid choice persists when widened', (await state(page)).preferredView, 'grid')
        check('explicit Grid remains rendered when widened', await page.getByRole('list', { name: '文件图标', exact: true }).count(), 1)
        await page.close()
      })
      await attempt('M04 readable scope and clear', async () => {
        const page = await pageFor()
        const text = await searchSummaryText(page)
        check('active Search states all-files scope', text.includes('范围：全部文件'))
        check('active Search shows its authoritative result count', text.includes('4096 个结果'))
        check('active Search shows committed query', text.includes('搜索：“项目”'))
        check('active Search shows source condition without opening filters', text.includes('同步文件夹：项目同步'))
        check('active Search shows tag condition without opening filters', text.includes('标签：研究'))
        await page.getByRole('button', { name: /搜索.*文件/ }).click()
        const searchInput = page.getByRole('textbox')
        check('search input states its all-files scope', await searchInput.getAttribute('aria-label'), '搜索全部文件和文件夹')
        check('search input opens with the committed query', await searchInput.inputValue(), '项目')
        const close = page.getByRole('button', { name: /关闭搜索/ })
        if (await close.count()) {
          await close.click(); await settle(page)
          check('collapsing Search preserves the query and filters', { active: (await state(page)).searchActive, query: (await state(page)).query, filters: (await state(page)).filters }, { active: true, query: '项目', filters: { sourceID: 7, tagID: 9 } })
        }
        const clear = button(page, '清除搜索与筛选')
        check('active Search exposes a real clear-search action', await clear.count(), 1)
        if (await clear.count()) {
          const box = await clear.boundingBox(); check('clear-search target is at least44px', box.width >= 44 && box.height >= 44)
          await clear.click(); await settle(page)
          check('clear-search exits Search and clears committed definition', { active: (await state(page)).searchActive, query: (await state(page)).query, filters: (await state(page)).filters }, { active: false, query: '', filters: {} })
        }
        await capture(page, 'scope-clear'); await page.close()
      })
    }

    if (!options.case || options.case === 'all' || options.case === 'return') for (const mode of ['details', 'grid']) {
      await attempt(`M04 grouped ${mode} deep return`, async () => {
        const page = await pageFor(mode)
        const host = page.locator('[data-xdrive-file-explorer-scroll-host]')
        const { item: folder, before } = await deepItem(page)
        results.samples[`${mode}-before`] = before
        check(`${mode}: setup is a deep sparse Search window`, before.scrollTop > 10000 && (await state(page)).loadedIndexes.length < 1000)
        if (mode === 'details') {
          await page.evaluate(() => { window.searchReturnHarness.failNextDirectory = true })
          await folder.press('Enter'); await settle(page)
          check('failed directory navigation leaves committed Search intact', { active: (await state(page)).searchActive, query: (await state(page)).query, filters: (await state(page)).filters }, { active: true, query: '项目', filters: { sourceID: 7, tagID: 9 } })
          check('failed directory navigation leaves selected item and viewport intact', await snapshot(page), before)
        }
        await folder.press('Enter')
        await waitFolder(page)
        await page.evaluate(() => window.searchReturnHarness.current.changeSort({ key: 'name', direction: 'asc' }))
        await page.waitForFunction(() => window.searchReturnHarness.state.sort.key === 'name')
        const destination = (await state(page)).crumbs
        await page.evaluate(() => window.searchReturnHarness.resetEvents())
        await button(page, '后退').click()
        await page.waitForFunction(() => window.searchReturnHarness.state.crumbs.length === 1 && !window.searchReturnHarness.state.searchLoading)
        await settle(page)
        const restored = await state(page)
        check(`${mode}: Back restores Search definition`, { active: restored.searchActive, query: restored.query, filters: restored.filters }, { active: true, query: '项目', filters: { sourceID: 7, tagID: 9 } })
        check(`${mode}: Back restores source Search ordering`, restored.sort, { key: 'updated', direction: 'desc' })
        check(`${mode}: Back restores source grouping`, restored.grouping, { groupBy: 'modified', foldersFirst: false })
        if (restored.searchActive) {
          const after = await assertReturn(page, before, `${mode}: Back restores`)
          check(`${mode}: Back restores visible item offsets`, after.visible, before.visible)
          check(`${mode}: Back retains the same mounted scroll host`, await host.evaluate((element) => element === window.searchReturnScrollOwner))
          const searchRequests = (await state(page)).requests.filter((request) => request.type === 'search')
          check(`${mode}: return loads count plus a bounded deep window without scanning the prefix`, searchRequests.length > 0 && searchRequests.every((request) => request.limit <= 200 && (request.offset <= 200 || request.offset >= 2000 && request.offset <= 2800)))
          await host.press('Alt+ArrowRight'); await waitFolder(page)
          check(`${mode}: Forward restores destination folder and its own ordering`, { crumbs: (await state(page)).crumbs, sort: (await state(page)).sort }, { crumbs: destination, sort: { key: 'name', direction: 'asc' } })
          await button(page, '后退').click()
          await assertReturn(page, before, `${mode}: repeated Back restores`)
        }
        await capture(page, `${mode}-after`); await page.close()
      })
    }

    if (!options.case || options.case === 'all' || options.case === 'recovery') {
      for (const kind of ['file', 'dir']) await attempt(`M04 ${kind} containing folder`, async () => {
        const page = await pageFor('details', kind === 'file' ? 390 : 900, kind === 'file')
        const { item, before } = await deepItem(page, kind)
        const selectedID = before.selectedIDs[0]
        const expectedParent = 500 + Math.floor((selectedID - 10000) / 100)
        if (kind === 'file') {
          await item.press('Enter'); await settle(page)
          check('ordinary file-open callback preserves Search and viewport', { active: (await state(page)).searchActive, snapshot: await snapshot(page) }, { active: true, snapshot: before })
          check('ordinary file-open callback receives the selected stable ID', (await state(page)).events.filter((event) => event.type === 'file-open').at(-1)?.value, selectedID)
        }
        await item.click({ button: 'right' })
        const showParent = page.getByText('显示所在文件夹', { exact: true })
        check(`${kind}: context action exposes containing-folder navigation`, await showParent.count(), 1)
        await showParent.click(); await waitFolder(page)
        check(`${kind}: containing-folder action uses authoritative parent crumbs`, (await state(page)).crumbs, [1, expectedParent])
        await button(page, '后退').click()
        await assertReturn(page, before, `${kind}: containing-folder Back restores`)
        await capture(page, `${kind}-containing-folder`)
      })

      await attempt('M04 zero anchor and touch selection', async () => {
        const page = await pageFor()
        await button(page, '选择').tap()
        const first = page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: '结果-004095-文件夹' })
        await first.tap(); await settle(page)
        const before = await snapshot(page)
        check('touch setup selects stable item at logical zero', before.selectedIDs, [14095])
        check('touch setup starts at scroll zero', before.scrollTop, 0)
        await first.click({ button: 'right' })
        await page.getByText('显示所在文件夹', { exact: true }).click(); await waitFolder(page)
        await button(page, '后退').click()
        await assertReturn(page, before, 'logical-zero Back restores')
        check('Back restores explicit touch selection mode', await button(page, '完成').count(), 1)
        check('Back retains logical-zero selection anchor', (await state(page)).returnSnapshot?.selectionAnchorIndex, 0)
        await capture(page, 'zero-anchor-touch-selection')
      })

      await attempt('M04 failed count retry', async () => {
        const page = await pageFor()
        const { item, before } = await deepItem(page)
        await item.press('Enter'); await waitFolder(page)
        await page.evaluate(() => { window.searchReturnHarness.failNextSearch = true })
        await button(page, '后退').click()
        await page.waitForFunction(() => Boolean(window.searchReturnHarness.state.searchError))
        const failed = await state(page)
        check('failed count keeps committed Search definition', { active: failed.searchActive, query: failed.query, filters: failed.filters }, { active: true, query: '项目', filters: { sourceID: 7, tagID: 9 } })
        check('failed count is not presented as zero results', !/0 个结果/.test(await searchSummaryText(page)))
        check('failed count retains the saved selected IDs for retry', failed.returnSnapshot?.selectedIDs, before.selectedIDs)
        await button(page, '重试搜索').click()
        await assertReturn(page, before, 'count retry restores')
        check('retry clears visible Search failure', (await state(page)).searchError, null)
        await capture(page, 'failed-count-retry')
      })

      await attempt('M04 newer scroll and query cancel pending return', async () => {
        const page = await pageFor()
        const { item, before } = await deepItem(page)
        await item.press('Enter'); await waitFolder(page)
        await page.evaluate(() => { window.searchReturnHarness.holdSearchOffset = 2000 })
        await button(page, '后退').click()
        await page.waitForFunction(() => window.searchReturnHarness.pending.length > 0)
        const host = page.locator('[data-xdrive-file-explorer-scroll-host]')
        await host.hover(); await page.mouse.wheel(0, 520)
        await page.waitForFunction(() => document.querySelector('[data-xdrive-file-explorer-scroll-host]').scrollTop > 0)
        const newerTop = (await snapshot(page)).scrollTop
        await page.evaluate(() => window.searchReturnHarness.releaseSearch())
        await quietSearch(page); await settle(page)
        check('newer real wheel scroll wins over the saved deep return', (await snapshot(page)).scrollTop, newerTop)
        check('canceled return does not resurrect its selected IDs', (await snapshot(page)).selectedIDs, [])
        const nextFolder = await visibleItem(page, 'dir')
        await nextFolder.click(); await nextFolder.press('Enter'); await waitFolder(page)
        await page.evaluate(() => { window.searchReturnHarness.holdSearchOffset = 0 })
        await button(page, '后退').click()
        await page.waitForFunction(() => window.searchReturnHarness.pending.length > 0)
        await page.getByRole('button', { name: /搜索.*文件/ }).click()
        const input = page.getByRole('textbox', { name: /搜索.*文件/ })
        await input.fill('新搜索'); await input.press('Enter')
        await page.evaluate(() => window.searchReturnHarness.releaseSearch())
        await page.waitForFunction(() => window.searchReturnHarness.state.query === '新搜索' && window.searchReturnHarness.state.searchReady)
        check('new committed query supersedes delayed old return work', (await state(page)).query, '新搜索')
        check('new query cannot resurrect old selection', (await state(page)).selectedIDs.some((id) => before.selectedIDs.includes(id)), false)
        await button(page, '清除搜索与筛选').click(); await settle(page)
        check('clear after pending return leaves no Search definition', { active: (await state(page)).searchActive, query: (await state(page)).query, filters: (await state(page)).filters }, { active: false, query: '', filters: {} })
        await host.press('Alt+ArrowRight'); await waitFolder(page)
        await button(page, '后退').click()
        await page.waitForFunction(() => window.searchReturnHarness.state.crumbs.length === 1)
        check('Forward and Back cannot resurrect an explicitly cleared Search', { active: (await state(page)).searchActive, query: (await state(page)).query, filters: (await state(page)).filters }, { active: false, query: '', filters: {} })
        await capture(page, 'new-intent-cancels-return')
      })

      await attempt('M04 changed result namespace preserves identity safety', async () => {
        const page = await pageFor()
        const { item, before } = await deepItem(page)
        await item.press('Enter'); await waitFolder(page)
        await page.evaluate(() => { window.searchReturnHarness.namespaceOffset = 500000 })
        await button(page, '后退').click(); await quietSearch(page)
        await page.getByText('搜索结果已变化，已返回原浏览位置附近。', { exact: true }).waitFor()
        check('changed results return to the saved logical neighborhood', (await snapshot(page)).scrollTop, before.scrollTop)
        check('changed results never select a new item at the old ordinal', (await state(page)).selectedIDs, [])
        check('changed results do not scan the full collection to find a vanished anchor', (await state(page)).loadedIndexes.length < 1000)
        await capture(page, 'changed-namespace-return')
      })

      await attempt('M04 pending Grid restore uses resized layout', async () => {
        const page = await pageFor('grid')
        const { item, before } = await deepItem(page)
        const saved = (await state(page)).returnSnapshot
        assert.ok(saved?.firstVisibleID !== null, 'capture has a stable first-visible ID')
        await item.press('Enter'); await waitFolder(page)
        await page.evaluate(() => { window.searchReturnHarness.holdSearchOffset = 2000 })
        await button(page, '后退').click()
        await page.waitForFunction(() => window.searchReturnHarness.pending.length > 0)
        await page.setViewportSize({ width: 900, height: 780 }); await settle(page)
        await page.evaluate(() => window.searchReturnHarness.releaseSearch())
        await quietSearch(page); await settle(page)
        await page.waitForFunction((ids) => JSON.stringify(window.searchReturnHarness.selectedIDs) === JSON.stringify(ids), before.selectedIDs)
        const position = await page.evaluate((id) => {
          const item = window.searchReturnHarness.current.nodeByID.get(Number(id))
          const host = document.querySelector('[data-xdrive-file-explorer-scroll-host]')
          const element = [...host.querySelectorAll('[data-xdrive-file-explorer-item]')].find((el) => el.textContent.includes(item?.name))
          if (!element) return null
          const a = element.getBoundingClientRect(); const b = host.getBoundingClientRect()
          return { top: a.top - b.top, bottom: a.bottom - b.top }
        }, saved.firstVisibleID)
        check('resized Grid restores the same logical anchor in the first visible row', Boolean(position && position.top <= 16 && position.bottom > 0))
        check('resized Grid restores stable selected IDs', (await state(page)).selectedIDs, before.selectedIDs)
        await capture(page, 'pending-grid-resize')
      })

      await attempt('M04 off-window active and selection anchor', async () => {
        const page = await pageFor()
        const host = page.locator('[data-xdrive-file-explorer-scroll-host]')
        await host.evaluate((element) => { element.scrollTop = 350 * 52 })
        await page.waitForFunction(() => window.searchReturnHarness.state.loadedIndexes.some((index) => index > 350 && index < 500))
        await settle(page)
        const selected = await visibleItem(page, 'file')
        await selected.click(); await settle(page)
        const selectedID = (await state(page)).selectedIDs[0]
        await host.evaluate((element) => { element.scrollTop = Math.floor((element.scrollHeight - element.clientHeight) * 0.61) })
        await page.waitForFunction(() => window.searchReturnHarness.state.loadedIndexes.some((index) => index > 2000))
        await settle(page)
        const before = await snapshot(page)
        await page.evaluate(() => window.searchReturnHarness.current.navigateTo([{ id: 1, name: '我的文件' }, { id: 700, name: '另一目录' }]))
        await waitFolder(page)
        await button(page, '后退').click()
        await assertReturn(page, before, 'off-window selection Back restores')
        await host.press('ArrowDown')
        await page.waitForFunction((id) => window.searchReturnHarness.selectedIDs[0] === id, selectedID - 1)
        check('ArrowDown continues from saved off-window active item', (await state(page)).selectedIDs, [selectedID - 1])
        check('restored active navigation remains bounded', (await state(page)).loadedIndexes.length < 1400)
        await capture(page, 'off-window-active-anchor')
      })
    }
    if (!options.case || ['all', 'recovery', 'window'].includes(options.case)) await attempt('M04 failed return-window retry control', async () => {
      const page = await pageFor()
      const { item, before } = await deepItem(page)
      await item.press('Enter'); await waitFolder(page)
      await page.evaluate(() => { window.searchReturnHarness.failReturnWindow = true })
      await button(page, '后退').click()
      await page.waitForFunction(() => window.searchReturnHarness.state.searchError === '测试：搜索返回窗口暂时不可用')
      const retryPosition = button(page, '重试恢复位置')
      await retryPosition.waitFor()
      check('failed return window keeps the counted collection and saved selection', { count: (await state(page)).count, selected: (await state(page)).returnSnapshot?.selectedIDs }, { count: 4096, selected: before.selectedIDs })
      check('failed return window exposes the error beside the retry controls', (await searchSummaryText(page)).includes('测试：搜索返回窗口暂时不可用'))
      await page.evaluate(() => { window.searchReturnHarness.failReturnWindow = false })
      await retryPosition.click()
      await assertReturn(page, before, 'position retry after window failure restores')
      check('position retry clears the range failure', (await state(page)).searchError, null)
      await capture(page, 'failed-return-window-retry')
    })
    check('no unexpected browser/page/request errors', results.errors, [])
  } finally {
    if (browser) await browser.close()
    await new Promise((resolve) => server.close(resolve))
    results.passed = results.checks.filter((value) => value.passed).length
    results.failed = results.checks.filter((value) => !value.passed).length
    fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(results, null, 2) + '\n')
    process.stdout.write(`${results.passed} passed; ${results.failed} failed; ${results.errors.length} browser errors\n`)
    if (results.failed || results.errors.length) process.exitCode = 1
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })

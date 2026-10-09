#!/usr/bin/env node
// Real Workspace + Navigation + Search + sparse VirtualCollection acceptance.
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
if (options.case && !['all', 'surface', 'bulk', 'cancel', 'eligibility', 'feedback'].includes(options.case)) throw new Error('Use --case=all|surface|bulk|cancel|eligibility|feedback.')
const sourceRoot = path.resolve(options['source-root'] || repoRoot)
const outputDir = path.resolve(options['output-dir'])
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright')
const results = { sourceRoot, startedAt: new Date().toISOString(), checks: [], errors: [], samples: {} }
const enabled = (name) => !options.case || options.case === 'all' || options.case === name
function check(name, actual, expected = true) {
  try { assert.deepEqual(actual, expected); results.checks.push({ name, passed: true }) }
  catch { results.checks.push({ name, passed: false, actual, expected }); process.stdout.write(`FAIL ${name}: ${JSON.stringify(actual)}\n`) }
}
const hashFile = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

async function main() {
  fs.mkdirSync(outputDir, { recursive: true })
  try { results.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { results.sourceCommit = fs.readFileSync(path.join(sourceRoot, 'source-revision.txt'), 'utf8').trim() }
  const sources = {
    __FILE_EXPLORER__: 'mui/FileExplorer.tsx', __WORKSPACE__: 'mui/FileExplorerWorkspaceController.ts',
    __VIRTUAL_COLLECTION__: 'mui/VirtualCollectionController.ts', __SEARCH_FILTERS__: 'mui/FileExplorerSearchFilters.tsx',
    __ACTIONS__: 'mui/FileExplorerActions.tsx', __SEARCH_MODEL__: 'file-explorer-search.ts', __THEME__: 'mui/AppearanceThemeProvider.tsx',
  }
  const hasActionFeedback = fs.existsSync(path.join(sourceRoot, 'ui/shared/src/mui/FileExplorerActionFeedback.tsx'))
  if (hasActionFeedback) sources.__ACTION_FEEDBACK__ = 'mui/FileExplorerActionFeedback.tsx'
  results.sourceHashes = Object.fromEntries([...Object.values(sources), 'mui/FileExplorerNavigation.ts', 'mui/FileExplorerSearch.ts', 'file-operations.ts'].map((name) => [name, hashFile(path.join(sourceRoot, 'ui/shared/src', name))]))
  results.fixtureHashes = Object.fromEntries(['file-explorer-selection-browser.cjs', 'file-explorer-selection-browser.tsx'].map((name) => [name, hashFile(path.join(__dirname, name))]))
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'file-explorer-selection-browser.tsx')], bundle: true,
    outfile: path.join(outputDir, 'bundle.js'), jsx: 'automatic', nodePaths: [path.join(repoRoot, 'desktop/node_modules')],
    alias: Object.fromEntries(Object.entries(sources).map(([alias, name]) => [alias, path.join(sourceRoot, 'ui/shared/src', name)])),
    define: { 'process.env.NODE_ENV': '"production"', __HAS_ACTION_FEEDBACK__: String(hasActionFeedback) },
  })
  results.bundleHash = hashFile(path.join(outputDir, 'bundle.js'))
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
  const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const state = (page) => page.evaluate(() => ({ ...window.selectionHarness.state, selectedIDs: [...window.selectionHarness.selectedIDs], events: window.selectionHarness.events, requests: window.selectionHarness.requests, errors: window.selectionHarness.errors, pendingCount: window.selectionHarness.pending.length, activeRequests: window.selectionHarness.activeRequests, peakRequests: window.selectionHarness.peakRequests }))
  const enter = (page) => page.getByRole('button', { name: /^选择$/ })
  const finish = (page) => page.getByRole('button', { name: /^完成(?:选择)?$/ })
  const clear = (page) => page.getByRole('button', { name: /^清除选择$/ })
  const selectAll = (page) => page.getByRole('button', { name: /^全选(?:当前目录|搜索结果)/ })
  const direct = (page, action) => page.getByRole('button', { name: new RegExp(`^${{ copy: '复制', cut: '剪切', download: '下载', delete: '删除' }[action]}(?:所选项目)?$`) })
  const capture = async (page, name) => {
    await page.screenshot({ path: path.join(outputDir, `${name}.png`), animations: 'disabled' })
    results.samples[name] = await state(page)
  }
  const geometry = async (locator) => locator.evaluate((element) => {
    const rect = (value) => ({ x: value.x, y: value.y, width: value.width, height: value.height, top: value.top, right: value.right, bottom: value.bottom, left: value.left })
    const box = element.getBoundingClientRect()
    let clipping = { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
    const ancestors = []
    for (let parent = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent)
      const bounds = parent.getBoundingClientRect()
      if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) { clipping.left = Math.max(clipping.left, bounds.left); clipping.right = Math.min(clipping.right, bounds.right) }
      if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) { clipping.top = Math.max(clipping.top, bounds.top); clipping.bottom = Math.min(clipping.bottom, bounds.bottom) }
      if (/(hidden|clip|auto|scroll)/.test(style.overflowX + style.overflowY)) ancestors.push({ tag: parent.tagName, overflowX: style.overflowX, overflowY: style.overflowY, rect: rect(bounds) })
    }
    const visibleWidth = Math.max(0, Math.min(box.right, clipping.right) - Math.max(box.left, clipping.left))
    const visibleHeight = Math.max(0, Math.min(box.bottom, clipping.bottom) - Math.max(box.top, clipping.top))
    const textRects = []
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue
      const range = document.createRange(); range.selectNodeContents(walker.currentNode)
      for (const value of range.getClientRects()) if (value.width && value.height) textRects.push(rect(value))
    }
    return { rect: rect(box), clipping, ancestors, visibleWidth, visibleHeight, textRects,
      unclipped: visibleWidth >= box.width - 0.5 && visibleHeight >= box.height - 0.5,
      readable: textRects.every((value) => value.left >= clipping.left - 0.5 && value.right <= clipping.right + 0.5 && value.top >= clipping.top - 0.5 && value.bottom <= clipping.bottom + 0.5) }
  })
  const checkControl = async (page, locator, label) => {
    const present = await locator.count() === 1
    check(`${label}: control is visible without reopening More`, present)
    if (!present) return
    const value = await geometry(locator)
    results.samples[`${label}-geometry`] = value
    check(`${label}: actual target is at least 44 × 44 and inside clipping ancestors`, value.rect.width >= 44 && value.rect.height >= 44 && value.unclipped)
    check(`${label}: rendered label stays readable`, value.readable)
  }
  const item = (page, index, scope = 'directory') => page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: new RegExp(`${scope === 'search' ? '结果' : '目录'}-${String(index).padStart(4, '0')}(?:-文件夹|\\.txt)`) })
  const clickItem = async (page, index, scope = 'directory', touch = true) => {
    const target = item(page, index, scope)
    if (touch) await target.tap(); else await target.click()
    await settle(page)
  }
  const waitSelected = (page, count) => page.waitForFunction((expected) => window.selectionHarness.selectedIDs.length === expected, count)
  const waitQuiet = (page) => page.waitForFunction(() => window.selectionHarness.activeRequests === 0)
  const attempt = async (name, config, action) => {
    let browser, page
    try {
      browser = await chromium.launch({ headless: true, executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || undefined, args: process.env.XDRIVE_BROWSER_ARGS ? JSON.parse(process.env.XDRIVE_BROWSER_ARGS) : undefined })
      results.browserVersion = browser.version()
      const context = await browser.newContext({ viewport: { width: config.width ?? 390, height: config.height ?? 780 }, isMobile: config.touch !== false, hasTouch: config.touch !== false, deviceScaleFactor: 1 })
      page = await context.newPage(); page.setDefaultTimeout(4500)
      page.on('pageerror', (error) => results.errors.push(`${name}: ${error.message}`))
      page.on('console', (message) => { if (message.type() === 'error') results.errors.push(`${name}: ${message.text()}`) })
      const query = new URLSearchParams({ scope: config.scope ?? 'directory', count: String(config.count ?? 1024), mode: config.mode ?? 'details' })
      await page.goto(`http://127.0.0.1:${server.address().port}/?${query}`)
      await page.waitForFunction(({ scope, count }) => window.selectionHarness?.state.count === count && (scope !== 'search' || window.selectionHarness.state.searchActive && window.selectionHarness.state.searchReady), { scope: config.scope, count: config.count ?? 1024 })
      await waitQuiet(page); await settle(page)
      if (config.textScale) { await page.addStyleTag({ content: `html { font-size: ${16 * config.textScale}px !important; }` }); await settle(page) }
      await action(page, name)
      await capture(page, name)
    } catch (error) {
      results.checks.push({ name, passed: false, error: String(error.message || error).split('\n').slice(0, 7).join('\n') })
      process.stdout.write(`FAIL ${name}: ${String(error.message || error).split('\n')[0]}\n`)
      if (page && !page.isClosed()) await capture(page, `${name}-failure`).catch(() => undefined)
    } finally {
      // Each case owns its browser; direct browser close avoids portable
      // single-process Chromium's separate context-disposal stall.
      if (browser) await browser.close()
    }
  }

  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    if (enabled('surface')) {
      for (const config of [
        { width: 360, touch: true }, { width: 700, touch: true }, { width: 899, touch: false },
        { width: 360, touch: false, textScale: 2 },
      ]) {
        const name = `surface-${config.width}-${config.touch ? 'touch' : 'mouse'}-${config.textScale ?? 1}x`
        await attempt(name, config, async (page, label) => {
          const initial = await state(page)
          check(`${label}: logical count is sparse before selection`, initial.count === 1024 && initial.loadedIndexes.length < 1024)
          await enter(page).click(); await settle(page)
          check(`${label}: empty selection count is visible`, await page.getByText(/^已选择\s*0\s*项/).count() > 0)
          check(`${label}: actual current directory selection scope is visible`, /(?:范围|当前目录|当前文件夹).{0,20}项目目录/.test(await page.locator('body').innerText()))
          await checkControl(page, finish(page), `${label}-finish`)
          await checkControl(page, selectAll(page), `${label}-select-all`)
          await checkControl(page, clear(page), `${label}-clear`)
          for (const action of ['copy', 'cut', 'download', 'delete']) {
            await checkControl(page, direct(page, action), `${label}-${action}`)
            if (await direct(page, action).count() === 1) check(`${label}: ${action} is disabled with zero selection`, await direct(page, action).isDisabled())
          }
          await clickItem(page, 0, 'directory', config.touch)
          await clickItem(page, 1, 'directory', config.touch)
          check(`${label}: mixed folder/file selects exact unique IDs`, (await state(page)).selectedIDs, [20000, 20001])
          const counter = page.getByText(/^已选择\s*2\s*项/).first()
          check(`${label}: selected counter is visible`, await counter.count() === 1)
          if (await counter.count()) {
            const measured = await geometry(counter)
            results.samples[`${label}-counter-geometry`] = measured
            check(`${label}: selected count text is not clipped`, measured.readable && measured.unclipped)
          }
          await capture(page, `${label}-selected`)
          for (const action of ['copy', 'cut', 'download', 'delete']) {
            const target = direct(page, action)
            if (await target.count() !== 1) continue
            await target.click(); await settle(page)
            const event = (await state(page)).events.filter((event) => event.type === action).at(-1)
            check(`${label}: direct ${action} receives complete mixed selection and revisions`, event?.value, { ids: [20000, 20001], rawIDs: [20000, 20001], revisions: [1, 2], kinds: ['dir', 'file'], selectedCount: 2 })
          }
          await finish(page).click(); await settle(page)
          check(`${label}: Finish clears selection`, (await state(page)).selectedIDs, [])
          check(`${label}: Finish returns focus to selection trigger`, await enter(page).evaluate((element) => element === document.activeElement))
          check(`${label}: direct actions did not open an item or menu`, (await state(page)).events.filter((event) => event.type === 'open').length === 0 && await page.getByRole('menu').count() === 0)
        })
      }
    }
    if (enabled('bulk')) {
      for (const scope of ['directory', 'search']) {
        await attempt(`logical-keyboard-all-${scope}`, { width: 900, touch: false, scope }, async (page, label) => {
          const before = await state(page)
          check(`${label}: starts with unloaded logical results`, before.loadedIndexes.length < before.count)
          await page.locator('[data-xdrive-file-explorer-scroll-host]').click({ position: { x: 8, y: 8 } })
          await page.keyboard.press('Control+a')
          await waitSelected(page, 1024).catch(() => undefined)
          const after = await state(page)
          check(`${label}: keyboard Select All resolves all 1024 identities`, after.selectedIDs.length, 1024)
          check(`${label}: selected identities are unique`, new Set(after.selectedIDs).size, after.selectedIDs.length)
          check(`${label}: transport page sizes remain bounded`, after.requests.every((request) => request.limit <= 200))
          check(`${label}: range resolution uses bounded concurrent pages`, after.peakRequests <= 8)
          if (after.selectedIDs.length === 1024) {
            await page.locator('[data-xdrive-file-explorer-scroll-host]').evaluate((host) => { host.scrollTop = host.scrollHeight - host.clientHeight })
            await page.waitForFunction(() => window.selectionHarness.state.loadedIndexes.some((index) => index > 1000))
            await settle(page)
            await page.keyboard.press('Control+c'); await settle(page)
            check(`${label}: mutation limit blocks oversized keyboard copy without truncation`, (await state(page)).events.filter((event) => event.type === 'copy').length, 0)
          }
        })
        await attempt(`logical-touch-all-${scope}`, { scope, mode: scope === 'search' ? 'grid' : 'details' }, async (page, label) => {
          const initial = await state(page)
          check(`${label}: initial rendering is sparse`, initial.count === 1024 && initial.loadedIndexes.length < 1024)
          await enter(page).tap(); await settle(page)
          const all = selectAll(page)
          const present = await all.count() === 1
          check(`${label}: touch can select the complete logical scope`, present)
          if (!present) return
          check(`${label}: Select All names the actual scope`, (scope === 'search' ? /全选搜索结果/ : /全选当前目录/).test(await all.textContent()))
          if (scope === 'search') check(`${label}: Search query, condition and all-files scope remain visible`, /项目/.test(await page.locator('body').innerText()) && /标签：研究/.test(await page.locator('body').innerText()) && /全部文件/.test(await page.locator('body').innerText()))
          await all.tap()
          await waitSelected(page, 1024).catch(() => undefined)
          const after = await state(page)
          check(`${label}: complete selection is not capped at 200 or loaded rows`, after.selectedIDs.length, 1024)
          check(`${label}: all selected identities match the current collection`, after.selectedIDs, Array.from({ length: 1024 }, (_, index) => (scope === 'search' ? 100000 : 20000) + index))
          if (after.selectedIDs.length !== 1024) return
          await page.locator('[data-xdrive-file-explorer-scroll-host]').evaluate((host) => { host.scrollTop = host.scrollHeight - host.clientHeight })
          await page.waitForFunction(() => window.selectionHarness.state.loadedIndexes.some((index) => index > 1000))
          await waitQuiet(page); await settle(page)
          check(`${label}: selected render pages may be evicted`, (await state(page)).loadedIndexes.length < 1024)
          check(`${label}: the real 1000-root download limit blocks oversized submission`, await direct(page, 'download').isDisabled())
          check(`${label}: Download limit is explained without reducing selection`, /最多\s*1000/.test(await page.locator('body').innerText()) && (await state(page)).selectedIDs.length === 1024)
          check(`${label}: oversized Download is not silently split or submitted`, (await state(page)).events.filter((event) => event.type === 'download').length, 0)
          await clear(page).tap(); await settle(page)
          check(`${label}: Clear removes the complete selection`, (await state(page)).selectedIDs, [])
          check(`${label}: Clear remains inside explicit selection mode`, await finish(page).count(), 1)
        })
        await attempt(`retained-valid-download-${scope}`, { scope, count: 768 }, async (page, label) => {
          const initial = await state(page)
          check(`${label}: valid batch starts with unloaded pages`, initial.count === 768 && initial.loadedIndexes.length < 768)
          await enter(page).tap(); await settle(page)
          const all = selectAll(page)
          check(`${label}: complete selection is available`, await all.count(), 1)
          if (await all.count() !== 1) return
          await all.tap(); await waitSelected(page, 768)
          await page.locator('[data-xdrive-file-explorer-scroll-host]').evaluate((host) => { host.scrollTop = host.scrollHeight - host.clientHeight })
          await page.waitForFunction(() => window.selectionHarness.state.loadedIndexes.includes(767))
          await waitQuiet(page); await settle(page)
          check(`${label}: selected render pages have been evicted`, (await state(page)).loadedIndexes.length < 768)
          check(`${label}: valid Download is enabled above mutation capacity`, await direct(page, 'download').isDisabled(), false)
          await direct(page, 'download').tap(); await settle(page)
          const download = (await state(page)).events.filter((event) => event.type === 'download').at(-1)
          const expectedIDs = Array.from({ length: 768 }, (_, index) => (scope === 'search' ? 100000 : 20000) + index)
          check(`${label}: callback receives the complete valid 768-root batch`, download?.value.ids, expectedIDs)
          check(`${label}: retained raw metadata covers every selected identity`, download?.value.rawIDs, expectedIDs)
          check(`${label}: every original revision survives page eviction`, download?.value.revisions, Array.from({ length: 768 }, (_, index) => index + 1))
          check(`${label}: submitting Download preserves selected identities`, (await state(page)).selectedIDs, expectedIDs)
        })
      }
      await attempt('mixed-input-899-900-return', { width: 899, touch: false }, async (page, label) => {
        await enter(page).click(); await clickItem(page, 0, 'directory', false); await clickItem(page, 1, 'directory', false)
        const before = (await state(page)).selectedIDs
        await page.evaluate(() => { window.selectionOwner = document.querySelector('[data-xdrive-file-explorer-scroll-host]') })
        await page.setViewportSize({ width: 900, height: 780 }); await settle(page)
        check(`${label}: widening preserves selected identities`, (await state(page)).selectedIDs, before)
        check(`${label}: wide exits compact selection chrome`, await finish(page).count(), 0)
        check(`${label}: same scroll host remains mounted`, await page.evaluate(() => window.selectionOwner === document.querySelector('[data-xdrive-file-explorer-scroll-host]')))
        for (const action of ['copy', 'cut', 'download', 'delete']) {
          const target = direct(page, action)
          check(`${label}: wide ${action} remains in its existing command bar`, await target.count(), 1)
          if (await target.count() === 1) {
            const measured = await geometry(target)
            results.samples[`${label}-wide-${action}-geometry`] = measured
            check(`${label}: wide ${action} remains inside clipping ancestors`, measured.unclipped && measured.readable)
          }
        }
        await page.setViewportSize({ width: 899, height: 780 }); await settle(page)
        check(`${label}: narrowing preserves selected identities`, (await state(page)).selectedIDs, before)
        await page.keyboard.press('Escape'); await settle(page)
        check(`${label}: Escape clears selection through existing keyboard semantics`, (await state(page)).selectedIDs, [])
      })
    }
    if (enabled('cancel')) {
      for (const intent of ['selection', 'search', 'session']) {
        await attempt(`pending-all-new-${intent}`, { scope: 'directory' }, async (page, label) => {
          await enter(page).tap(); await clickItem(page, 1)
          await page.evaluate(() => { window.selectionHarness.holdOffset = 400 })
          await page.keyboard.press('Control+a')
          await page.waitForFunction(() => window.selectionHarness.pending.length > 0)
          check(`${label}: unresolved All does not commit a partial selection`, (await state(page)).selectedIDs, [20001])
          if (intent === 'selection') await clickItem(page, 2)
          if (intent === 'search') {
            await page.getByRole('button', { name: /^搜索全部文件和文件夹$/ }).tap()
            const search = page.getByRole('textbox', { name: '搜索全部文件和文件夹' })
            await search.fill('新搜索'); await search.press('Enter')
            await page.waitForFunction(() => window.selectionHarness.state.query === '新搜索' && window.selectionHarness.state.searchReady)
          }
          if (intent === 'session') { await page.evaluate(() => window.selectionHarness.changeSession()); await settle(page) }
          const expected = intent === 'selection' ? [20001, 20002] : []
          await page.evaluate(() => window.selectionHarness.releaseRanges())
          await waitQuiet(page); await settle(page)
          check(`${label}: released older All cannot overwrite newer intent`, (await state(page)).selectedIDs, expected)
          check(`${label}: cancelled range completion does not report an error`, (await state(page)).errors, [])
        })
      }
      await attempt('pending-all-visible-cancel', { scope: 'search', width: 360 }, async (page, label) => {
        await enter(page).tap(); await clickItem(page, 1, 'search')
        const all = selectAll(page)
        check(`${label}: touch All entry is available`, await all.count(), 1)
        if (await all.count() !== 1) return
        await page.evaluate(() => { window.selectionHarness.holdOffset = 400 })
        await all.tap()
        await page.waitForFunction(() => window.selectionHarness.pending.length > 0)
        check(`${label}: loading selection is explicit`, /正在选择/.test(await page.locator('body').innerText()))
        const cancel = page.getByRole('button', { name: /^取消选择加载$/ })
        await checkControl(page, cancel, `${label}-cancel`)
        await checkControl(page, finish(page), `${label}-finish`)
        await capture(page, `${label}-loading`)
        if (await cancel.count() !== 1) return
        await cancel.tap(); await settle(page)
        check(`${label}: cancel keeps the previous complete selection`, (await state(page)).selectedIDs, [100001])
        check(`${label}: cancellation immediately clears the loading control`, await cancel.count(), 0)
        await page.evaluate(() => window.selectionHarness.releaseRanges())
        await waitQuiet(page); await settle(page)
        check(`${label}: late transport completion stays cancelled`, (await state(page)).selectedIDs, [100001])
        await clear(page).tap(); await settle(page)
        check(`${label}: clear remains usable after cancellation`, (await state(page)).selectedIDs, [])
      })
    }
    if (enabled('eligibility')) {
      for (const count of [200, 201]) {
        await attempt(`mutation-limit-${count}`, { count }, async (page, label) => {
          await enter(page).tap()
          await page.locator('[data-xdrive-file-explorer-scroll-host]').click({ position: { x: 8, y: 8 } })
          await page.keyboard.press('Control+a'); await waitSelected(page, count)
          check(`${label}: operation limit does not reduce selection`, (await state(page)).selectedIDs.length, count)
          for (const action of ['copy', 'cut', 'delete']) {
            const target = direct(page, action)
            check(`${label}: ${action} remains a visible direct action`, await target.count(), 1)
            if (await target.count() !== 1) continue
            check(`${label}: ${action} availability respects the 200-root operation limit`, await target.isDisabled(), count > 200)
            if (count === 200) {
              await target.tap(); await settle(page)
              const event = (await state(page)).events.filter((event) => event.type === action).at(-1)
              check(`${label}: ${action} submits every selected root exactly once`, event?.value.ids, Array.from({ length: 200 }, (_, index) => 20000 + index))
            }
          }
          if (count === 201) {
            check(`${label}: readable disabled reason explains the limit`, /最多.{0,8}200/.test(await page.locator('body').innerText()))
            await page.keyboard.press('Control+c'); await page.keyboard.press('Control+x'); await page.keyboard.press('Delete'); await settle(page)
            check(`${label}: keyboard cannot bypass action eligibility or split submission`, (await state(page)).events.filter((event) => ['copy', 'cut', 'delete'].includes(event.type)).length, 0)
          }
          check(`${label}: Download uses its own capability instead of the mutation limit`, await direct(page, 'download').isDisabled(), false)
        })
      }
      await attempt('unavailable-selected-metadata', {}, async (page, label) => {
        await enter(page).tap(); await clickItem(page, 0); await clickItem(page, 1)
        await page.evaluate(() => window.selectionHarness.setMissingIDs([20000])); await settle(page)
        check(`${label}: selected identity count remains 2`, (await state(page)).selectedIDs.length, 2)
        for (const action of ['copy', 'cut', 'download', 'delete']) {
          const target = direct(page, action)
          check(`${label}: ${action} is present and blocked before dropping missing metadata`, await target.count() === 1 && await target.isDisabled())
        }
        check(`${label}: the unavailable reason is readable`, /部分所选项目.*不可用/.test(await page.locator('body').innerText()))
        await page.keyboard.press('Control+c'); await page.keyboard.press('Delete'); await settle(page)
        check(`${label}: no partially resolved action reaches the adapter`, (await state(page)).events.filter((event) => ['copy', 'cut', 'download', 'delete'].includes(event.type)).length, 0)
      })
      await attempt('controlled-unique-unavailable-count', {}, async (page, label) => {
        await enter(page).tap()
        await page.evaluate(() => window.selectionHarness.setControlledIDs([20000, 20000, 20000, 999999]))
        await settle(page)
        check(`${label}: count reflects two unique selected identities, including unresolved one`, await page.getByText(/^已选择\s*2\s*项/).count() > 0)
        check(`${label}: unresolved selection cannot submit its available subset`, await direct(page, 'copy').isDisabled())
        check(`${label}: missing metadata is explained`, /部分所选项目.*不可用/.test(await page.locator('body').innerText()))
      })
      await attempt('empty-current-directory', { count: 0 }, async (page, label) => {
        await enter(page).tap(); await settle(page)
        check(`${label}: selection mode is available without results`, await finish(page).count(), 1)
        check(`${label}: Select All is visible but unavailable for an empty scope`, await selectAll(page).count() === 1 && await selectAll(page).isDisabled())
        check(`${label}: empty scope is not fabricated as loaded selection`, (await state(page)).selectedIDs, [])
        await finish(page).tap(); await settle(page)
        check(`${label}: Finish restores focus from zero selection`, await enter(page).evaluate((element) => element === document.activeElement))
      })
    }
    if (enabled('feedback')) {
      await attempt('selection-feedback-constrained', { width: 360 }, async (page, label) => {
        await enter(page).tap(); await clickItem(page, 0); await clickItem(page, 1)
        await page.evaluate(() => {
          window.selectionOwner = document.querySelector('[data-xdrive-file-explorer-scroll-host]')
          window.selectionHarness.setFeedback({ kind: 'operation', operation: {
            id: 'operation-real-17', type: 'copy', status: 'failed', total_items: 5, processed_items: 3,
            total_bytes: 8192, processed_bytes: 4096, percent: 50, retryable: false,
            created_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z',
            failure_code: 'name_conflict', failed_item_id: 42,
            current_item: '目录/照片-'.repeat(60) + 'THE-LAST-FILE.jpg',
            error: '服务端很长的错误说明 <保留原文> & '.repeat(80) + 'THE-LAST-ERROR',
          } })
        })
        const presenter = page.locator('[data-xdrive-file-explorer-action-feedback]')
        await presenter.waitFor({ state: 'attached' })
        check(`${label}: real presenter is mounted in the Files feedback slot`, await page.locator('[data-xdrive-file-explorer-action-feedback-slot] [data-xdrive-file-explorer-action-feedback]').count(), 1)
        check(`${label}: atomic failure does not report transient progress as success`, /未完成|回滚|没有.*生效|未.*生效|未提交/.test(await presenter.innerText()) && !/3\s*个.*成功/.test(await presenter.innerText()))
        for (const config of [{ height: 780, textScale: 1 }, { height: 390, textScale: 2 }]) {
          await page.setViewportSize({ width: 360, height: config.height })
          await page.addStyleTag({ content: `html { font-size: ${16 * config.textScale}px !important; }` }); await settle(page)
          for (const [control, name] of [[page.getByRole('button', { name: /^查看任务$/ }), 'view-task'], [page.getByRole('button', { name: /^关闭提示$/ }), 'dismiss']]) {
            let measured = await geometry(control)
            if (!measured.unclipped) {
              // Only a real user-scrollable ancestor can reveal a clipped action.
              // Locator auto-scroll would also scroll overflow:hidden containers
              // and could hide a genuine unreachable Files-slot layout.
              const scroller = await control.evaluate((element) => {
                for (let parent = element.parentElement; parent; parent = parent.parentElement) {
                  if (!/(auto|scroll)/.test(getComputedStyle(parent).overflowY) || parent.scrollHeight <= parent.clientHeight) continue
                  const box = parent.getBoundingClientRect()
                  const top = Math.max(0, box.top), bottom = Math.min(innerHeight, box.bottom)
                  if (bottom > top) {
                    const target = element.getBoundingClientRect()
                    const distance = target.bottom > bottom ? target.bottom - bottom + 2 : target.top - top - 2
                    return { x: Math.max(1, box.left + 2), y: (top + bottom) / 2, distance }
                  }
                }
                return null
              })
              if (scroller) { await page.mouse.move(scroller.x, scroller.y); await page.mouse.wheel(0, scroller.distance); await settle(page); measured = await geometry(control) }
            }
            results.samples[`${label}-${config.height}-${config.textScale}x-${name}-geometry`] = measured
            check(`${label}: ${name} is reachable at 360×${config.height}, ${config.textScale * 100}% text`, measured.rect.width >= 44 && measured.rect.height >= 44 && measured.unclipped && measured.readable)
          }
          const doneGeometry = await geometry(finish(page))
          check(`${label}: Finish remains reachable alongside feedback at ${config.height}px height`, doneGeometry.unclipped && doneGeometry.readable)
          check(`${label}: feedback preserves current selection at ${config.height}px height`, (await state(page)).selectedIDs, [20000, 20001])
          await capture(page, `${label}-${config.height}-${config.textScale}x`)
        }
        await page.setViewportSize({ width: 360, height: 780 })
        await page.addStyleTag({ content: 'html { font-size: 16px !important; }' }); await settle(page)
        const viewTask = page.getByRole('button', { name: /^查看任务$/ })
        const dismiss = page.getByRole('button', { name: /^关闭提示$/ })
        if ((await geometry(viewTask)).unclipped && (await geometry(dismiss)).unclipped) {
          await viewTask.tap(); await settle(page)
          check(`${label}: task action targets the actual operation ID`, (await state(page)).events.filter((event) => event.type === 'view-task').map((event) => event.value), ['operation-real-17'])
          await dismiss.tap(); await settle(page)
          check(`${label}: dismiss clears the actual Files feedback`, await presenter.count(), 0)
        }
        check(`${label}: feedback never replaces the mounted Files scroll owner`, await page.evaluate(() => window.selectionOwner === document.querySelector('[data-xdrive-file-explorer-scroll-host]')))
      })
    }
    check('No renderer or fixture errors', results.errors, [])
  } finally {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
    results.finishedAt = new Date().toISOString()
    results.passed = results.checks.every((entry) => entry.passed) && results.errors.length === 0
    fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(results, null, 2))
    process.stdout.write(`${JSON.stringify({ passed: results.passed, checks: results.checks.length, failures: results.checks.filter((entry) => !entry.passed).length, errors: results.errors, outputDir }, null, 2)}\n`)
    if (!results.passed) process.exitCode = 1
  }
}
main().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1 })

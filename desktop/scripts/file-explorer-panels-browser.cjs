#!/usr/bin/env node
// M11 Files panels. Real shared controls and trusted Chromium input; this does
// not certify physical software keyboards or visual-viewport-only behavior.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http')
const { createRequire } = require('node:module'), { createHash } = require('node:crypto'), { execFileSync } = require('node:child_process')
const options = {}
for (const argument of process.argv.slice(2)) {
  const match = /^--(repo-root|source-root|output-dir|case)=(.+)$/.exec(argument)
  if (!match) throw new Error('Unknown argument: ' + argument)
  options[match[1]] = match[2]
}
if (!options['output-dir']) throw new Error('Supply --output-dir=/path for evidence')
if (options.case && !['baseline', 'all', 'panels', 'search'].includes(options.case)) throw new Error('Unknown case: ' + options.case)
const repoRoot = path.resolve(options['repo-root'] || path.join(__dirname, '../..'))
const sourceRoot = path.resolve(options['source-root'] || repoRoot)
const outputDir = path.resolve(options['output-dir'])
const dependency = createRequire(path.join(repoRoot, 'desktop/package.json'))
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || dependency.resolve('playwright'))
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const result = { sourceRoot, case: options.case || 'all', checks: [], errors: [], samples: {}, scope: 'Real M01 Files controls; trusted keyboard, touch and wheel; layout/visual viewport resize and200% root text. Physical OS keyboards and visual-only insets are not certified.' }
const check = (name, actual) => {
  result.checks.push({ name, passed: Boolean(actual) })
  if (!actual) process.stdout.write('FAIL ' + name + '\n')
}
const settle = (page) => page.evaluate(async () => {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  await Promise.all(document.getAnimations().filter((animation) => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => undefined)))
})
async function dimensions(locator) {
  return locator.evaluate((element) => {
    const r = element.getBoundingClientRect()
    let left = Math.max(0, r.left), right = Math.min(innerWidth, r.right), top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom)
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const c = getComputedStyle(parent), p = parent.getBoundingClientRect()
      if (/(hidden|auto|scroll|clip)/.test(c.overflowY)) { top = Math.max(top, p.top); bottom = Math.min(bottom, p.bottom) }
      if (/(hidden|auto|scroll|clip)/.test(c.overflowX)) { left = Math.max(left, p.left); right = Math.min(right, p.right) }
    }
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
    return { text: element.getAttribute('aria-label') || element.textContent, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop, visibleWidth: Math.max(0, right - left), visibleHeight: Math.max(0, bottom - top), hittable: Boolean(hit && element.contains(hit)) }
  })
}
const reachable = (value) => value.visibleWidth >= 44 && value.visibleHeight >= 44 && value.hittable
async function capture(page, name, controls) {
  const value = {
    viewport: await page.evaluate(() => ({ layout: { width: innerWidth, height: innerHeight }, visual: { width: visualViewport.width, height: visualViewport.height, offsetTop: visualViewport.offsetTop, scale: visualViewport.scale }, rootFont: getComputedStyle(document.documentElement).fontSize, focused: document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.slice(0, 100) })),
    controls: Object.fromEntries(await Promise.all(Object.entries(controls).map(async ([key, locator]) => [key, await dimensions(locator)]))),
  }
  result.samples[name] = value
  await page.screenshot({ path: path.join(outputDir, name + '.png') })
  return value
}
async function wheelContent(page, body, direction = 1) {
  const before = await dimensions(body)
  await page.mouse.move(before.rect.x + before.rect.width / 2, before.rect.y + before.visibleHeight / 2)
  await page.mouse.wheel(0, direction * Math.max(800, before.scrollHeight))
  await page.waitForFunction((direction) => {
    const body = document.querySelector('[data-xdrive-file-explorer-search-filters]')
    return direction > 0 ? body.scrollTop >= body.scrollHeight - body.clientHeight - 1 : body.scrollTop <= 1
  }, direction)
  await settle(page)
  return { before, after: await dimensions(body) }
}
async function prepareImageFilter(page, ready) {
  await ready()
  await page.getByRole('button', { name: '筛选文件', exact: true }).tap()
  await page.getByRole('dialog', { name: '文件筛选' }).waitFor()
  await settle(page)
  const body = page.locator('[data-xdrive-file-explorer-search-filters]')
  await body.getByRole('button', { name: '类型', exact: true }).tap()
  await page.getByRole('menuitem', { name: '图片', exact: true }).tap()
  await settle(page)
  return body
}
async function panelBaseline(page, ready) {
  const body = await prepareImageFilter(page, ready)
  const controls = { type: body.getByRole('button', { name: '类型：图片', exact: true }), close: page.getByRole('button', { name: '关闭筛选', exact: true }), save: page.getByRole('button', { name: '保存搜索', exact: true }), clear: page.getByRole('button', { name: '清除全部', exact: true }) }
  for (const { name, height, font } of [{ name: 'landscape-original', height: 390, font: '100%' }, { name: 'reduced-original-text', height: 200, font: '100%' }, { name: 'reduced-200-text', height: 200, font: '200%' }]) {
    await page.setViewportSize({ width: 844, height })
    await page.evaluate((font) => { document.documentElement.style.fontSize = font }, font)
    await settle(page)
    await controls.type.scrollIntoViewIfNeeded()
    await settle(page)
    const field = await capture(page, name + '-field', { fields: body, type: controls.type, close: controls.close })
    check(name + ': first structured field retains44px visible touch area', reachable(field.controls.type))
    // Fields and actions need to be reachable, not simultaneously visible in a
    // short scroller. Run this same native-wheel sequence before and after.
    const scroll = await wheelContent(page, body)
    const actions = await capture(page, name + '-actions', { fields: body, close: controls.close, save: controls.save, clear: controls.clear })
    result.samples[name] = { field, actions, scroll }
    check(name + ': Close Save and Clear retain44px visible touch areas', ['close', 'save', 'clear'].every((key) => reachable(actions.controls[key])))
  }
  await controls.close.tap()
  await page.getByRole('dialog', { name: '文件筛选' }).waitFor({ state: 'hidden' })
  await settle(page)
  check('reduced200 text: filter close preserves trigger focus', await page.getByRole('button', { name: '筛选文件', exact: true }).evaluate((element) => document.activeElement === element))
  await page.getByRole('button', { name: '位置', exact: true }).tap()
  const drawer = page.locator('[data-xdrive-file-explorer-touch-navigation-drawer]')
  await drawer.waitFor()
  await settle(page)
  const location = drawer.getByRole('button', { name: '我的文件', exact: true })
  await location.scrollIntoViewIfNeeded()
  await settle(page)
  const nav = await capture(page, 'location-reduced-200-text', { location, close: page.getByRole('button', { name: '关闭位置', exact: true }) })
  check('location reduced200 text: actual row and Close retain44px touch area', Object.values(nav.controls).every(reachable))
  await page.getByRole('button', { name: '关闭位置', exact: true }).tap()
  await drawer.waitFor({ state: 'hidden' })
  await settle(page)
  check('location reduced200 text: close preserves trigger focus', await page.getByRole('button', { name: '位置', exact: true }).evaluate((element) => document.activeElement === element))
  check('No renderer transport or scenario error', result.errors.length === 0)
}
async function searchBaseline(page, ready) {
  await prepareImageFilter(page, ready)
  await page.getByRole('button', { name: '关闭筛选', exact: true }).tap()
  await page.getByRole('dialog', { name: '文件筛选' }).waitFor({ state: 'hidden' })
  await page.setViewportSize({ width: 844, height: 200 })
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; window.m11SearchOwner = document.querySelector('[data-xdrive-file-explorer-scroll-host]'); window.fileExplorerControlsHarness.clearEvents() })
  await settle(page)
  const search = page.getByRole('textbox', { name: '搜索全部文件和文件夹', exact: true })
  const searchToggle = page.getByRole('button', { name: '搜索全部文件和文件夹', exact: true })
  const snapshot = () => page.evaluate(() => ({ inputMounted: Boolean(document.querySelector('input[aria-label="搜索全部文件和文件夹"]')), focused: document.activeElement?.getAttribute('aria-label'), value: document.activeElement?.value, start: document.activeElement?.selectionStart, end: document.activeElement?.selectionEnd, state: window.fileExplorerControlsHarness.state, events: window.fileExplorerControlsHarness.events, sameOwner: window.m11SearchOwner === document.querySelector('[data-xdrive-file-explorer-scroll-host]') }))
  check('Short200% text: Search initially collapsed while current filter remains image', await search.count() === 0 && await searchToggle.count() === 1 && await page.evaluate(() => window.fileExplorerControlsHarness.state.filters.kind === 'image'))
  await page.keyboard.press('Control+f'); await settle(page)
  let current = await snapshot()
  check('Short200% text: native Ctrl+F reveals and focuses the real Search input', current.inputMounted && current.focused === '搜索全部文件和文件夹')
  await page.keyboard.type('retained query'); await page.keyboard.press('Enter'); await settle(page)
  current = await snapshot(); result.samples.submitted = current
  check('Short200% text: native Enter submits once while preserving current filter and mounted Files', current.sameOwner && current.state.filters.kind === 'image' && current.events.filter(event => event.type === 'search').length === 1 && current.events.find(event => event.type === 'search')?.value === 'retained query' && !current.events.some(event => ['open', 'quick-look'].includes(event.type)))
  await page.keyboard.press('Escape'); await settle(page)
  current = await snapshot(); result.samples.collapsed = current
  check('Short200% text: Escape collapses only Search and returns focus to its trigger', !current.inputMounted && current.focused === '搜索全部文件和文件夹' && current.state.searchValue === 'retained query' && current.state.filters.kind === 'image')
  await page.keyboard.press('Control+f'); await settle(page)
  current = await snapshot(); result.samples.reopened = current
  check('Short200% text: reopening selects the full retained query', current.inputMounted && current.value === 'retained query' && current.start === 0 && current.end === 'retained query'.length)
  await capture(page, 'short200-search-focused', { search, close: page.getByRole('button', { name: '关闭搜索框', exact: true }) })
  await page.evaluate(() => { window.m11SearchInput = document.activeElement })
  await page.setViewportSize({ width: 844, height: 390 }); await settle(page)
  current = await snapshot(); result.samples.restoredHeight = current
  check('Restoring available height preserves focused input instance query filter and Files owner', current.sameOwner && current.inputMounted && current.value === 'retained query' && current.state.filters.kind === 'image' && await page.evaluate(() => document.activeElement === window.m11SearchInput))
  await capture(page, 'height-restored-search-focused', { search, close: page.getByRole('button', { name: '关闭搜索框', exact: true }) })
  check('No renderer transport or scenario error', result.errors.length === 0)
}
async function panelInteractions(page, ready) {
  const body = await prepareImageFilter(page, ready)
  const dialog = page.getByRole('dialog', { name: '文件筛选' })
  const close = page.getByRole('button', { name: '关闭筛选', exact: true })
  const save = page.getByRole('button', { name: '保存搜索', exact: true })
  const clear = page.getByRole('button', { name: '清除全部', exact: true })
  await page.setViewportSize({ width: 844, height: 200 })
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; window.m11PanelOwner = document.querySelector('[role="dialog"][aria-label="文件筛选"]'); window.m11PanelScroller = document.querySelector('[data-xdrive-file-explorer-search-filters]'); window.m11WheelInputs = []; document.addEventListener('wheel', (event) => window.m11WheelInputs.push(event.isTrusted), { passive: true }); window.fileExplorerControlsHarness.clearEvents() })
  await settle(page)
  const scroll = await wheelContent(page, body)
  const actions = await capture(page, 'short200-native-wheel-actions', { fields: body, close, save, clear })
  check('Native wheel reveals actions in the same bounded scroller while Close remains reachable', scroll.after.scrollTop > scroll.before.scrollTop && ['close', 'save', 'clear'].every((key) => reachable(actions.controls[key])) && await page.evaluate(() => window.m11PanelScroller === document.querySelector('[data-xdrive-file-explorer-search-filters]') && window.m11WheelInputs.includes(true)))
  await wheelContent(page, body, -1)
  let type = body.getByRole('button', { name: '类型：图片', exact: true })
  await type.tap(); await page.getByRole('menu').waitFor(); await settle(page)
  await page.keyboard.press('Escape'); await page.getByRole('menu').waitFor({ state: 'hidden' }); await settle(page)
  check('Nested Escape closes only the menu and restores field focus', await dialog.isVisible() && await type.evaluate((element) => document.activeElement === element))
  await type.tap(); await page.getByRole('menuitem', { name: '视频', exact: true }).tap(); await settle(page)
  type = body.getByRole('button', { name: '类型：视频', exact: true })
  check('Nested selection updates the retained panel and restores field focus', await dialog.isVisible() && await type.evaluate((element) => document.activeElement === element) && await page.evaluate(() => window.fileExplorerControlsHarness.state.filters.kind === 'video' && !window.fileExplorerControlsHarness.events.some(event => ['open', 'quick-look'].includes(event.type))))
  await wheelContent(page, body)
  await clear.tap(); await settle(page)
  check('Native Clear updates conditions without replacing or closing the panel', await page.evaluate(() => Object.keys(window.fileExplorerControlsHarness.state.filters).length === 0 && window.m11PanelOwner === document.querySelector('[role="dialog"][aria-label="文件筛选"]')))
  await wheelContent(page, body, -1)
  await body.getByRole('button', { name: '类型', exact: true }).tap()
  await page.getByRole('menuitem', { name: '图片', exact: true }).tap(); await settle(page)
  await wheelContent(page, body)
  await save.tap(); await dialog.waitFor({ state: 'hidden' }); await settle(page)
  check('Native Save submits the current filters once and returns trigger focus', await page.evaluate(() => { const events = window.fileExplorerControlsHarness.events.filter(event => event.type === 'save-search'); return events.length === 1 && events[0].value.kind === 'image' }) && await page.getByRole('button', { name: '筛选文件', exact: true }).evaluate((element) => document.activeElement === element))
}
async function main() {
  fs.mkdirSync(outputDir, { recursive: true })
  result.startedAt = new Date().toISOString()
  result.sourceCommit = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const aliases = { __FILE_EXPLORER__: 'FileExplorer.tsx', __NAVIGATION_PANE__: 'FileExplorerNavigationPane.tsx', __SEARCH_FILTERS__: 'FileExplorerSearchFilters.tsx', __TABS__: 'FileExplorerTabs.tsx', __THEME__: 'AppearanceThemeProvider.tsx' }
  const sources = [...Object.values(aliases), 'useMobilePanelViewport.ts']
  result.sourceHashes = Object.fromEntries(sources.map((name) => [name, hash(path.join(sourceRoot, 'ui/shared/src/mui', name))]))
  const fixtures = ['file-explorer-panels-browser.cjs', 'file-explorer-panels-browser.tsx', 'file-explorer-controls-browser.tsx']
  result.fixtureHashes = Object.fromEntries(fixtures.map((name) => [name, hash(path.join(__dirname, name))]))
  for (const name of fixtures) fs.copyFileSync(path.join(__dirname, name), path.join(outputDir, name))
  await dependency('esbuild').build({ entryPoints: [path.join(__dirname, 'file-explorer-panels-browser.tsx')], bundle: true, outfile: path.join(outputDir, 'bundle.js'), jsx: 'automatic', nodePaths: [path.join(repoRoot, 'desktop/node_modules')], alias: Object.fromEntries(Object.entries(aliases).map(([key, name]) => [key, path.join(sourceRoot, 'ui/shared/src/mui', name)])), define: { 'process.env.NODE_ENV': '"production"' } })
  result.bundleHash = hash(path.join(outputDir, 'bundle.js'))
  const server = http.createServer((request, response) => {
    const route = new URL(request.url, 'http://localhost').pathname
    if (route === '/') { response.setHeader('Content-Type', 'text/html;charset=utf-8'); response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script src="/bundle.js"></script></body></html>') }
    else if (route === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(fs.readFileSync(path.join(outputDir, 'bundle.js'))) }
    else if (route === '/favicon.ico') { response.statusCode = 204; response.end() }
    else { result.errors.push('Unknown request ' + route); response.statusCode = 404; response.end() }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  let browser, page
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE, args: process.env.XDRIVE_BROWSER_ARGS ? JSON.parse(process.env.XDRIVE_BROWSER_ARGS) : undefined })
    result.browserVersion = browser.version()
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
    page = await context.newPage(); page.setDefaultTimeout(8000)
    page.on('pageerror', (error) => result.errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') result.errors.push(message.text()) })
    const ready = async () => { await page.setViewportSize({ width: 844, height: 390 }); await page.goto('http://127.0.0.1:' + server.address().port); await page.locator('[data-xdrive-file-explorer-item]').first().waitFor(); await settle(page) }
    if (result.case !== 'search') await panelBaseline(page, ready)
    if (result.case !== 'panels') await searchBaseline(page, ready)
    if (result.case === 'all' || result.case === 'panels') await panelInteractions(page, ready)
  } catch (error) { result.errors.push({ type: 'scenario', message: error.message, stack: error.stack }); if (page) await page.screenshot({ path: path.join(outputDir, 'failure.png') }).catch(() => undefined) }
  finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)) }
  result.sourceHashesAfter = Object.fromEntries(sources.map((name) => [name, hash(path.join(sourceRoot, 'ui/shared/src/mui', name))]))
  result.sourceHashMatch = JSON.stringify(result.sourceHashes) === JSON.stringify(result.sourceHashesAfter)
  result.finishedAt = new Date().toISOString()
  result.passed = result.checks.every((entry) => entry.passed) && !result.errors.length && result.sourceHashMatch
  fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(result, null, 2) + '\n')
  process.stdout.write(JSON.stringify({ checks: result.checks.length, passed: result.checks.filter(entry => entry.passed).length, failed: result.checks.filter(entry => !entry.passed).length, errors: result.errors.length, sourceHashMatch: result.sourceHashMatch, outputDir }, null, 2) + '\n')
  process.exitCode = result.passed ? 0 : 1
}
main().catch((error) => { process.stderr.write(error.stack + '\n'); process.exitCode = 1 })

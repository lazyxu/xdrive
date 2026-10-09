#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { createRequire } = require('node:module')
const { execFileSync } = require('node:child_process')
const options = {}
for (const value of process.argv.slice(2)) {
  const match = /^--(repo-root|source-root|output-dir|case)=(.+)$/.exec(value)
  if (!match) throw new Error('Unknown argument: ' + value)
  options[match[1]] = match[2]
}
if (!options['output-dir']) throw new Error('Supply --output-dir=/path for evidence.')
if (options.case && !['all', 'discovery', 'manage', 'assignment', 'rules'].includes(options.case)) throw new Error('Use --case=all|discovery|manage|assignment|rules.')
const repoRoot = path.resolve(options['repo-root'] || path.join(__dirname, '../..'))
const sourceRoot = path.resolve(options['source-root'] || repoRoot)
const outputDir = path.resolve(options['output-dir'])
const dependency = createRequire(path.join(repoRoot, 'desktop/package.json'))
const esbuild = dependency('esbuild')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || dependency.resolve('playwright'))
const enabled = (name) => !options.case || options.case === 'all' || options.case === name
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const results = { startedAt: new Date().toISOString(), sourceRoot, checks: [], errors: [], samples: {} }
function check(name, actual, expected = true) {
  try { assert.deepEqual(actual, expected); results.checks.push({ name, passed: true }) }
  catch { results.checks.push({ name, passed: false, actual, expected }); process.stdout.write('FAIL ' + name + ': ' + JSON.stringify(actual) + '\n') }
}
async function main() {
  fs.mkdirSync(outputDir, { recursive: true })
  try { results.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { results.sourceCommit = fs.readFileSync(path.join(sourceRoot, 'source-revision.txt'), 'utf8').trim() }
  const sources = {
    __FILE_EXPLORER__: 'mui/FileExplorer.tsx', __WORKSPACE__: 'mui/FileExplorerWorkspaceController.ts',
    __ORGANIZATION__: 'mui/FileExplorerOrganizationController.ts', __NAVIGATION__: 'mui/FileExplorerNavigationPane.tsx',
    __FILTERS__: 'mui/FileExplorerSearchFilters.tsx', __TAG_DIALOG__: 'mui/FileTagDialog.tsx',
    __NAME_DIALOG__: 'mui/FileNameDialog.tsx', __THEME__: 'mui/AppearanceThemeProvider.tsx',
    __ORGANIZATION_MODEL__: 'file-explorer-organization.ts', __SEARCH_MODEL__: 'file-explorer-search.ts',
  }
  results.sourceHashes = Object.fromEntries([...Object.values(sources), 'mui/FileExplorerSearch.ts', 'mui/FileExplorerNavigation.ts'].map((name) => [name, hash(path.join(sourceRoot, 'ui/shared/src', name))]))
  results.fixtureHashes = {}
  for (const name of ['file-explorer-organization-browser.cjs', 'file-explorer-organization-browser.tsx']) {
    results.fixtureHashes[name] = hash(path.join(__dirname, name))
    fs.copyFileSync(path.join(__dirname, name), path.join(outputDir, name))
  }
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'file-explorer-organization-browser.tsx')], bundle: true, jsx: 'automatic',
    outfile: path.join(outputDir, 'bundle.js'), nodePaths: [path.join(repoRoot, 'desktop/node_modules')],
    alias: Object.fromEntries(Object.entries(sources).map(([alias, name]) => [alias, path.join(sourceRoot, 'ui/shared/src', name)])),
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  results.bundleHash = hash(path.join(outputDir, 'bundle.js'))
  const server = http.createServer((request, response) => {
    const route = new URL(request.url, 'http://localhost').pathname
    response.setHeader('Cache-Control', 'no-store')
    if (route === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><html style="height:100%"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;height:100%"><div id="root" style="height:100%;min-height:0"></div><script src="/bundle.js"></script></body></html>') }
    else if (route === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(fs.readFileSync(path.join(outputDir, 'bundle.js'))) }
    else if (route === '/favicon.ico') { response.statusCode = 204; response.end() }
    else { response.statusCode = 404; response.end(); results.errors.push('Unexpected request ' + route) }
  })
  const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const settleTransitions = async (page) => {
    await settle(page)
    await page.evaluate(async () => {
      const finite = document.getAnimations().filter((animation) => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity)
      await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)))
    })
    await settle(page)
  }
  const state = (page) => page.evaluate(() => ({ ...window.organizationHarness.state, requests: window.organizationHarness.requests, events: window.organizationHarness.events, selectedIDs: window.organizationHarness.selectedIDs, rendererErrors: window.organizationHarness.rendererErrors }))
  const capture = async (page, name) => {
    results.samples[name] = await state(page)
    results.samples[name].viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, rootFontSize: getComputedStyle(document.documentElement).fontSize, coarsePointer: matchMedia('(pointer:coarse)').matches }))
    results.samples[name].focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, role: document.activeElement?.getAttribute('role'), label: document.activeElement?.getAttribute('aria-label'), text: document.activeElement?.textContent?.slice(0, 100), modal: Boolean(document.activeElement?.closest('.MuiModal-root')) }))
    results.samples[name].dialogs = await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"]')).map((element) => ({ label: element.getAttribute('aria-label'), title: (element.getAttribute('aria-labelledby') || '').split(' ').map((id) => document.getElementById(id)?.textContent || '').join(' ') })))
    await page.screenshot({ path: path.join(outputDir, name + '.png'), animations: 'disabled' })
  }
  const geometry = (target) => target.evaluate((element) => {
    const box = element.getBoundingClientRect(), clipping = { left: 0, top: 0, right: innerWidth, bottom: innerHeight }, textRects = []
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const rect = parent.getBoundingClientRect(), style = getComputedStyle(parent)
      if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) { clipping.left = Math.max(clipping.left, rect.left); clipping.right = Math.min(clipping.right, rect.right) }
      if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) { clipping.top = Math.max(clipping.top, rect.top); clipping.bottom = Math.min(clipping.bottom, rect.bottom) }
    }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue
      const range = document.createRange(); range.selectNodeContents(walker.currentNode)
      for (const value of range.getClientRects()) if (value.width && value.height) textRects.push({ left: value.left, right: value.right, top: value.top, bottom: value.bottom })
    }
    const rect = { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom }
    return { rect, clipping, textRects, unclipped: box.left >= clipping.left - 0.5 && box.right <= clipping.right + 0.5 && box.top >= clipping.top - 0.5 && box.bottom <= clipping.bottom + 0.5, hittable: element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) }
  })
  const targetCheck = async (page, target, label, compact = true, scroll = true) => {
    check(label + ': one visible control exists', await target.count(), 1)
    if (await target.count() !== 1) return
    if (scroll) await target.scrollIntoViewIfNeeded()
    const measured = await geometry(target); results.samples[label + '-geometry'] = measured
    check(label + ': actual control is unclipped and hittable', measured.unclipped && measured.hittable)
    if (compact) check(label + ': actual hit area is at least44px', measured.rect.width >= 44 && measured.rect.height >= 44)
  }
  const revealVertically = async (page, target, scroller) => {
    for (let index = 0; index < 10; index += 1) {
      const measured = await geometry(target), scrollBox = await scroller.boundingBox()
      if (measured.unclipped) return true
      if (!scrollBox) return false
      await page.mouse.move(scrollBox.x + scrollBox.width / 2, scrollBox.y + scrollBox.height / 2)
      await page.mouse.wheel(0, measured.rect.y < measured.clipping.top ? measured.rect.y - measured.clipping.top - 8 : measured.rect.bottom - measured.clipping.bottom + 8)
      await settle(page)
    }
    return false
  }
  const revealTextEdge = async (page, target, scroller, edge) => {
    for (let index = 0; index < 10; index += 1) {
      const measured = await geometry(target), text = edge === 'first' ? measured.textRects[0] : measured.textRects.at(-1)
      if (!text) return false
      if (text.top >= measured.clipping.top - 0.5 && text.bottom <= measured.clipping.bottom + 0.5) return true
      const box = await scroller.boundingBox()
      if (!box) return false
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(0, text.top < measured.clipping.top ? text.top - measured.clipping.top - 8 : text.bottom - measured.clipping.bottom + 8)
      await settle(page)
    }
    return false
  }
  const openLocations = async (page) => {
    // A committed Search intentionally closes this drawer. Finish its real CSS
    // transition before deciding whether to reuse or reopen it.
    await settleTransitions(page)
    if (await page.getByRole('navigation', { name: '标签', exact: true }).isVisible().catch(() => false)) return
    const trigger = page.getByRole('button', { name: '位置', exact: true })
    if (await trigger.count()) await trigger.click()
    await page.getByRole('navigation', { name: '标签', exact: true }).waitFor()
    await settleTransitions(page)
  }
  const closeLocations = async (page) => {
    await settleTransitions(page)
    const close = page.getByRole('button', { name: '关闭位置', exact: true })
    if (await close.isVisible().catch(() => false)) { await close.click(); await close.waitFor({ state: 'hidden' }) }
  }
  const submitSearch = async (page, query) => {
    const input = page.getByRole('textbox', { name: '搜索全部文件和文件夹', exact: true })
    if (!await input.isVisible().catch(() => false)) await page.getByRole('button', { name: '搜索全部文件和文件夹', exact: true }).click()
    await input.fill(query); await input.press('Enter')
    await page.waitForFunction((value) => window.organizationHarness.state.query === value && window.organizationHarness.state.searchReady, query)
  }
  const tagDialog = (page) => page.getByRole('dialog', { name: /标签/ })
  const assignmentRequests = (value) => value.requests.filter((request) => /^(query-node-tags|add-tag-nodes|remove-tag-nodes)$/.test(request.type))
  const attempt = async (name, config, action) => {
    let browser, page
    try {
      browser = await chromium.launch({ headless: true, executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || undefined, args: process.env.XDRIVE_BROWSER_ARGS ? JSON.parse(process.env.XDRIVE_BROWSER_ARGS) : undefined })
      results.browserVersion = browser.version()
      const context = await browser.newContext({ viewport: { width: config.width || 390, height: config.height || 780 }, isMobile: config.touch !== false, hasTouch: config.touch !== false, deviceScaleFactor: 1 })
      page = await context.newPage(); page.setDefaultTimeout(4500)
      page.on('pageerror', (error) => results.errors.push(name + ': ' + error.message))
      page.on('console', (message) => { if (message.type() === 'error') results.errors.push(name + ': ' + message.text()) })
      const query = new URLSearchParams({ scene: config.scene || 'files', catalog: config.catalog || 'populated' })
      if (config.longRule) query.set('long-rule', '1')
      await page.goto('http://127.0.0.1:' + server.address().port + '/?' + query)
      await page.waitForFunction(() => Boolean(window.organizationHarness?.state || window.organizationHarness?.rendererErrors.length))
      if (config.catalog !== 'hold') await page.waitForFunction(() => !window.organizationHarness.state.loading)
      if (config.textScale) await page.addStyleTag({ content: 'html { font-size:' + 16 * config.textScale + 'px !important; }' })
      await settle(page); await action(page, name); await capture(page, name)
    } catch (error) {
      const value = String(error.message || error).split('\n').slice(0, 7).join('\n')
      results.checks.push({ name, passed: false, error: value }); process.stdout.write('FAIL ' + name + ': ' + value.split('\n')[0] + '\n')
      if (page && !page.isClosed()) await capture(page, name + '-failure').catch(() => undefined)
    } finally { if (browser) await browser.close() }
  }
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    if (enabled('discovery')) {
      await attempt('organization-empty-discovery', { catalog: 'empty', width: 360 }, async (page, label) => {
        await openLocations(page)
        const tags = page.getByRole('navigation', { name: '标签', exact: true }), saved = page.getByRole('navigation', { name: '智能文件夹', exact: true })
        await targetCheck(page, tags.getByRole('button', { name: /管理标签|新建标签/ }), label + '-manage')
        check(label + ': Smart Folder offers a creation/save entry', await saved.getByRole('button', { name: /保存当前搜索|新建智能文件夹|创建智能文件夹/ }).count(), 1)
        check(label + ': Favorites and folder pinning have distinct empty help', /文件/.test(await page.getByRole('navigation', { name: '收藏', exact: true }).innerText()) && /文件夹|目录/.test(await page.getByRole('navigation', { name: '快速访问', exact: true }).innerText()))
        check(label + ': empty discovery makes no tag assignment request', assignmentRequests(await state(page)), [])
        const manage = tags.getByRole('button', { name: '管理标签', exact: true })
        if (await manage.count()) {
          await manage.click(); await tagDialog(page).waitFor()
          check(label + ': real navigation opens management with no Files selection', { mode: (await state(page)).tagDialog.mode, nodes: (await state(page)).tagDialog.nodeIDs, selection: (await state(page)).selectedIDs }, { mode: 'manage', nodes: [], selection: [] })
          check(label + ': management entry makes no assignment request', assignmentRequests(await state(page)), [])
          await tagDialog(page).getByRole('button', { name: '完成', exact: true }).click()
          await tagDialog(page).waitFor({ state: 'hidden' }); await settle(page)
          check(label + ': closing management restores focus to its navigation trigger', await manage.evaluate((element) => document.activeElement === element))
        }
      })
      await attempt('organization-loading-is-not-empty', { catalog: 'hold' }, async (page, label) => {
        await openLocations(page)
        for (const name of ['标签', '智能文件夹']) {
          const section = page.getByRole('navigation', { name, exact: true })
          check(label + ': ' + name + ' exposes pending read', await section.getByRole('progressbar').count() > 0 || /加载|读取/.test(await section.innerText()))
          check(label + ': ' + name + ' does not claim confirmed empty', !/暂无|还没有/.test(await section.innerText()))
        }
        await page.evaluate(() => window.organizationHarness.releaseCatalog())
        await page.waitForFunction(() => window.organizationHarness.state.tags.length === 2 && !window.organizationHarness.state.loading)
        check(label + ': both real lists commit after release', { tags: (await state(page)).tags.length, saved: (await state(page)).savedSearches.length }, { tags: 2, saved: 1 })
      })
      await attempt('organization-error-retry', { catalog: 'error' }, async (page, label) => {
        await openLocations(page)
        const section = page.getByRole('navigation', { name: '标签', exact: true })
        check(label + ': read error is shown inside discovery', /测试：组织列表暂时不可用/.test(await section.innerText()))
        const retry = section.getByRole('button', { name: /重试|重新加载/ })
        await targetCheck(page, retry, label + '-retry')
        if (await retry.count() === 1) {
          await page.evaluate(() => { window.organizationHarness.failCatalog = false })
          await retry.click(); await page.waitForFunction(() => window.organizationHarness.state.tags.length === 2)
          check(label + ': retry uses the same organization refresh transport', (await state(page)).requests.filter((request) => request.type === 'list-tags').length, 2)
        }
      })
    }
    if (enabled('rules')) {
      await attempt('saved-rule-discovery-and-tag-search', {}, async (page, label) => {
        await openLocations(page)
        const saved = page.getByRole('navigation', { name: '智能文件夹', exact: true })
        check(label + ': saved query is inspectable', /搜索：.?项目/.test(await saved.innerText()))
        check(label + ': persisted predicates are inspectable', /项目同步/.test(await saved.innerText()) && /研究/.test(await saved.innerText()))
        check(label + ': saved rule explains dynamic matching without moving files', /动态/.test(await saved.innerText()) && /不移动|不会移动|保留在原位置/.test(await saved.innerText()))
        await page.getByRole('navigation', { name: '标签', exact: true }).getByText('研究', { exact: true }).click()
        await page.waitForFunction(() => window.organizationHarness.state.searchReady && window.organizationHarness.state.filters.tagID === 9)
        check(label + ': activating a tag runs real Search with no assignment', assignmentRequests(await state(page)), [])
        check(label + ': tag query is owned by Workspace transport', (await state(page)).requests.filter((request) => request.type === 'search').every((request) => request.query === '' && request.filters.tagID === 9 && request.limit <= 200))
      })
      await attempt('saved-rule-real-workspace-return', { width: 390 }, async (page, label) => {
        check(label + ': actual shared matching helper is available', (await state(page)).matchingHelperAvailable)
        if (!(await state(page)).matchingHelperAvailable) return
        await openLocations(page)
        await page.getByRole('navigation', { name: '智能文件夹', exact: true }).getByRole('button', { name: '项目文档', exact: true }).click()
        await page.waitForFunction(() => window.organizationHarness.state.searchReady && window.organizationHarness.state.query === '项目')
        const before = await state(page)
        check(label + ': committed definition derives both current markers', { saved: before.organizationSearchState.activeSavedSearchID, tag: before.organizationSearchState.activeTagID }, { saved: 41, tag: 9 })
        await closeLocations(page)
        await page.getByRole('button', { name: '上一级', exact: true }).click()
        await page.waitForFunction(() => !window.organizationHarness.state.searchActive && window.organizationHarness.state.crumbs.length === 1)
        check(label + ': directory history clears Search markers', { saved: (await state(page)).organizationSearchState.activeSavedSearchID, tag: (await state(page)).organizationSearchState.activeTagID }, { saved: null, tag: null })
        await page.getByRole('button', { name: '后退', exact: true }).click()
        await page.waitForFunction(() => window.organizationHarness.state.searchReady && window.organizationHarness.state.query === '项目')
        const returned = await state(page)
        check(label + ': Back restores the same committed query and predicates', { query: returned.query, filters: returned.filters, historyKey: returned.historyKey }, { query: before.query, filters: before.filters, historyKey: before.historyKey })
        await openLocations(page)
        check(label + ': restored rule is visibly current', await page.getByRole('navigation', { name: '智能文件夹', exact: true }).getByRole('button', { name: '项目文档', exact: true }).getAttribute('aria-current'), 'page')
        check(label + ': restored tag is visibly current', await page.getByRole('navigation', { name: '标签', exact: true }).getByRole('button', { name: '研究', exact: true }).getAttribute('aria-current'), 'page')
        await closeLocations(page); await submitSearch(page, '修改项目')
        await openLocations(page)
        const saved = page.getByRole('navigation', { name: '智能文件夹', exact: true })
        check(label + ': a changed committed query removes saved-rule marker', await saved.getByRole('button', { name: '项目文档', exact: true }).getAttribute('aria-current'), null)
        check(label + ': changed definition explains its unsaved state', /当前条件.*不同|当前搜索尚未保存|已修改/.test(await saved.innerText()))
        await saved.getByRole('button', { name: '智能文件夹 项目文档 选项', exact: true }).click()
        await page.getByRole('menuitem', { name: '更新为当前搜索', exact: true }).click()
        await page.waitForFunction(() => window.organizationHarness.state.savedSearches[0].query === '修改项目')
        check(label + ': replace uses the real organization update transport', (await state(page)).requests.filter((request) => request.type === 'update-saved-search').map((request) => request.input), [{ name: '项目文档', query: '修改项目', filters: { kind: 'file', sourceID: 7, tagID: 9 } }])
        check(label + ': replaced rule is readable and current', /修改项目/.test(await saved.locator('[data-xdrive-saved-search-rule="41"]').innerText()) && await saved.getByRole('button', { name: '项目文档', exact: true }).getAttribute('aria-current') === 'page')
        await closeLocations(page); await page.getByRole('button', { name: '筛选文件', exact: true }).click()
        const filters = page.getByRole('dialog', { name: '文件筛选', exact: true })
        await filters.getByRole('button', { name: '清除标签', exact: true }).click()
        await filters.getByRole('button', { name: '关闭筛选', exact: true }).click()
        await page.waitForFunction(() => window.organizationHarness.state.searchReady && window.organizationHarness.state.filters.tagID === undefined)
        check(label + ': real filter edit removes both obsolete markers', { saved: (await state(page)).organizationSearchState.activeSavedSearchID, tag: (await state(page)).organizationSearchState.activeTagID }, { saved: null, tag: null })
        check(label + ': organization controls do not create a parallel query fanout', (await state(page)).requests.filter((request) => request.type === 'search').every((request) => request.limit <= 200 && request.offset < 256))
      })
      await attempt('saved-rule-portable-device-condition', { width: 390 }, async (page, label) => {
        check(label + ': actual shared matching helper is available', (await state(page)).matchingHelperAvailable)
        if (!(await state(page)).matchingHelperAvailable) return
        await page.getByRole('button', { name: '筛选文件', exact: true }).click()
        const filters = page.getByRole('dialog', { name: '文件筛选', exact: true })
        await filters.getByRole('button', { name: '可用性', exact: true }).click()
        await page.getByRole('menuitem', { name: '本机可用', exact: true }).click()
        await filters.getByRole('button', { name: '关闭筛选', exact: true }).click()
        await page.waitForFunction(() => window.organizationHarness.state.searchReady && window.organizationHarness.state.filters.availability === 'local')
        await openLocations(page)
        const saved = page.getByRole('navigation', { name: '智能文件夹', exact: true }), save = saved.getByRole('button', { name: '保存当前搜索', exact: true })
        check(label + ': device-only condition cannot become an empty saved rule', await save.isDisabled())
        check(label + ': unsaved device condition is explained before saving', /仅在此设备.*不包含.*保存规则/.test(await saved.innerText()))
        await closeLocations(page); await submitSearch(page, '本机规则'); await openLocations(page)
        await save.click()
        const name = page.getByRole('dialog', { name: /保存搜索/ })
        await name.getByRole('textbox', { name: '智能文件夹名称', exact: true }).fill('可跨设备规则')
        await name.getByRole('button', { name: '保存', exact: true }).click()
        await page.waitForFunction(() => window.organizationHarness.state.savedSearches.some((entry) => entry.name === '可跨设备规则'))
        check(label + ': real save stores only portable query and filters', (await state(page)).requests.filter((request) => request.type === 'create-saved-search').map((request) => request.input), [{ name: '可跨设备规则', query: '本机规则', filters: {} }])
        check(label + ': saving retains the active device condition', (await state(page)).filters, { availability: 'local' })
        check(label + ': the matched portable rule retains its device warning', /仅在此设备/.test((await state(page)).organizationSearchState.currentSearchNotice))
      })
      for (const width of [700, 899]) {
        await attempt('saved-rule-mouse-targets-' + width, { width, height: width === 899 ? 390 : 780, textScale: width === 899 ? 2 : 1, touch: false, longRule: width === 899 }, async (page, label) => {
          await openLocations(page)
          const tree = page.locator('[data-xdrive-file-explorer-navigation-tree]'), saved = page.getByRole('navigation', { name: '智能文件夹', exact: true })
          const rule = saved.locator('[data-xdrive-saved-search-rule="41"]')
          if (await rule.count()) {
            check(label + ': native wheel exposes the first saved-rule line', await revealTextEdge(page, rule, tree, 'first'))
            check(label + ': native wheel exposes the final saved-rule line', await revealTextEdge(page, rule, tree, 'last'))
            const measured = await geometry(rule); results.samples[label + '-rule-geometry'] = measured
            check(label + ': complete rule text has no horizontal clipping', measured.textRects.every((text) => text.left >= measured.clipping.left - 0.5 && text.right <= measured.clipping.right + 0.5))
          }
          await saved.getByRole('button', { name: '项目文档', exact: true }).click()
          await page.waitForFunction(() => window.organizationHarness.state.searchReady)
          await openLocations(page)
          const options = saved.getByRole('button', { name: '智能文件夹 项目文档 选项', exact: true })
          check(label + ': native wheel reveals the saved-rule options', await revealVertically(page, options, tree))
          await targetCheck(page, options, label + '-options', true, false); await options.click()
          await targetCheck(page, page.getByRole('menuitem', { name: '更新为当前搜索', exact: true }), label + '-replace')
          await targetCheck(page, page.getByRole('menuitem', { name: /删除智能文件夹|删除保存的搜索/ }), label + '-delete')
          await page.keyboard.press('Escape'); await page.getByRole('menu').waitFor({ state: 'hidden' })
          await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '智能文件夹 项目文档 选项', undefined, { timeout: 1200 }).catch(() => undefined)
          check(label + ': menu dismissal restores its own trigger focus', await options.evaluate((element) => document.activeElement === element))
          const tags = page.getByRole('navigation', { name: '标签', exact: true }), manage = tags.getByRole('button', { name: '管理标签', exact: true })
          check(label + ': native wheel reaches management', await revealVertically(page, manage, tree))
          await targetCheck(page, manage, label + '-manage', true, false)
          check(label + ': a tag with zero global items is explicit', /共\s*0\s*项/.test(await tags.getByRole('button', { name: '研究资料'.repeat(5), exact: true }).innerText()))
        })
      }
    }
    if (enabled('manage')) {
      await attempt('tag-manage-without-selected-nodes', { scene: 'manage', width: 360 }, async (page, label) => {
        const dialog = tagDialog(page)
        check(label + ': management has no assignment checkbox', await dialog.getByRole('checkbox').count(), 0)
        check(label + ': management does not describe a zero-node assignment', !/已选择的 0|选择 0/.test(await dialog.innerText()))
        check(label + ': opening management makes no assignment read', assignmentRequests(await state(page)), [])
        await dialog.getByRole('textbox', { name: '新标签', exact: true }).fill('新研究')
        await dialog.getByRole('button', { name: /^(添加|创建)(标签)?$/ }).click()
        await page.waitForFunction(() => window.organizationHarness.state.tags.some((tag) => tag.name === '新研究'))
        await settle(page)
        check(label + ': create changes the tag catalog once', (await state(page)).requests.filter((request) => request.type === 'create-tag').length, 1)
        check(label + ': create in management never queries or assigns zero nodes', assignmentRequests(await state(page)), [])
      })
      for (const width of [360, 700, 899, 900]) {
        await attempt('tag-management-targets-' + width, { scene: 'manage', width, touch: width < 700 }, async (page, label) => {
          const dialog = tagDialog(page)
          await targetCheck(page, dialog.getByRole('button', { name: '编辑标签 研究', exact: true }), label + '-edit', width < 900)
          await targetCheck(page, dialog.getByRole('button', { name: /^删除标签(?:定义)? 研究$/ }), label + '-delete', width < 900)
          await targetCheck(page, dialog.getByRole('button', { name: '完成', exact: true }), label + '-done', width < 900)
          await targetCheck(page, dialog.getByRole('textbox', { name: '新标签', exact: true }).locator('..'), label + '-name-input-owner', width < 900)
          await targetCheck(page, dialog.getByLabel('标签颜色', { exact: true }).locator('..'), label + '-color-input-owner', width < 900)
        })
      }
      await attempt('tag-name-utf8-native-enter', { scene: 'manage', width: 700, touch: false }, async (page, label) => {
        const dialog = tagDialog(page), input = dialog.getByRole('textbox', { name: '新标签', exact: true })
        const add = dialog.getByRole('button', { name: /^(添加|创建)(标签)?$/ })
        const invalid = '标'.repeat(22)
        await input.fill(invalid)
        await input.press('Enter'); await settle(page)
        check(label + ': native Enter cannot submit a66byte name', (await state(page)).requests.filter((request) => request.type === 'create-tag'), [])
        check(label + ': validation preserves the over-limit draft for correction', await input.inputValue(), invalid)
        check(label + ': validation explains the byte limit', /64.*字节|字节.*64/.test(await dialog.innerText()))
        const valid = '标'.repeat(21) + 'x'
        await input.fill(valid); await add.click()
        await page.waitForFunction((name) => window.organizationHarness.state.tags.some((tag) => tag.name === name), valid)
        check(label + ':64 UTF8 bytes is accepted intact', (await state(page)).requests.filter((request) => request.type === 'create-tag').at(-1).name, valid)
        check(label + ': boundary-name creation remains catalog-only', assignmentRequests(await state(page)), [])
      })
      await attempt('tag-edit-short-200-percent', { scene: 'manage', width: 360, height: 390, textScale: 2 }, async (page, label) => {
        const dialog = tagDialog(page), content = dialog.locator('.MuiDialogContent-root')
        const edit = dialog.getByRole('button', { name: '编辑标签 研究', exact: true })
        check(label + ': actual wheel reaches tag edit', await revealVertically(page, edit, content))
        await targetCheck(page, edit, label + '-edit', true, false); await edit.click()
        const input = dialog.getByRole('textbox', { name: '标签名称', exact: true }), save = dialog.getByRole('button', { name: '保存', exact: true })
        const draft = '保留的研究标签'
        await input.fill(draft)
        const longError = '测试：保存失败；标签定义仍保留，请检查名称后重试。'.repeat(18) + ' THE-LAST-TAG-ERROR'
        await page.evaluate((message) => { window.organizationHarness.failMutation = true; window.organizationHarness.mutationError = message }, longError)
        check(label + ': actual wheel reaches Save', await revealVertically(page, save, content))
        await targetCheck(page, save, label + '-save', true, false); await save.click()
        const error = dialog.getByText(longError, { exact: true }); await error.waitFor()
        check(label + ': rejected update preserves the exact draft', await input.inputValue(), draft)
        check(label + ': actual wheel exposes error beginning', await revealTextEdge(page, error, content, 'first'))
        results.samples[label + '-error-first-geometry'] = await geometry(error)
        await page.screenshot({ path: path.join(outputDir, label + '-error-first.png'), animations: 'disabled' })
        check(label + ': actual wheel exposes error ending', await revealTextEdge(page, error, content, 'last'))
        const errorGeometry = await geometry(error); results.samples[label + '-error-last-geometry'] = errorGeometry
        check(label + ': long error has no horizontal text clipping', errorGeometry.textRects.every((rect) => rect.left >= errorGeometry.clipping.left - 0.5 && rect.right <= errorGeometry.clipping.right + 0.5))
        await page.screenshot({ path: path.join(outputDir, label + '-error-last.png'), animations: 'disabled' })
        const cancel = dialog.getByRole('button', { name: '取消编辑', exact: true })
        check(label + ': actual wheel reaches Cancel Edit', await revealVertically(page, cancel, content))
        await targetCheck(page, cancel, label + '-cancel', true, false)
        await cancel.click(); await settle(page)
        check(label + ': cancel discards only the edit draft', await dialog.getByRole('textbox', { name: '新标签', exact: true }).inputValue(), '')
        await page.waitForFunction(() => Boolean(document.activeElement?.closest('.MuiModal-root')), undefined, { timeout: 1200 }).catch(() => undefined)
        check(label + ': cancel keeps focus in the current modal', await dialog.evaluate((element) => element.closest('.MuiModal-root').contains(document.activeElement)))
        check(label + ': failed edit leaves original definition', (await state(page)).tags.find((tag) => tag.id === 9).name, '研究')
        await revealVertically(page, edit, content); await edit.click(); await input.fill(draft)
        await page.evaluate(() => { window.organizationHarness.failMutation = false })
        await revealVertically(page, save, content); await save.click()
        await page.waitForFunction((name) => window.organizationHarness.state.tags.some((tag) => tag.id === 9 && tag.name === name), draft)
        check(label + ': retry updates the same definition once', (await state(page)).requests.filter((request) => request.type === 'update-tag').map((request) => ({ id: request.id, name: request.input.name })), [{ id: 9, name: draft }, { id: 9, name: draft }])
        await targetCheck(page, dialog.getByRole('button', { name: '完成', exact: true }), label + '-done', true, false)
      })
    }
    if (enabled('assignment')) {
      await attempt('tag-assignment-untagged-wire-null', { scene: 'assign' }, async (page, label) => {
        check(label + ': real untagged null wire renders without crashing', (await state(page)).rendererErrors, [])
        const dialog = tagDialog(page)
        if (await dialog.count()) {
          check(label + ': selected scope distinguishes1-of2 from global count128', /当前选择\s*1\s*\/\s*2\s*已标记.*全部项目\s*128/.test(await dialog.innerText()))
          check(label + ': a known empty tag retains both zero counts', /当前选择\s*0\s*\/\s*2\s*已标记.*全部项目\s*0/.test(await dialog.innerText()))
        }
      })
      await attempt('tag-assignment-read-error', { scene: 'assign-error', width: 700, touch: false }, async (page, label) => {
        const dialog = tagDialog(page)
        check(label + ': unknown assignment cannot be mutated as unchecked', await dialog.getByRole('checkbox').evaluateAll((elements) => elements.every((element) => element.disabled || Boolean(element.closest('[aria-disabled="true"]')))))
        const retry = dialog.getByRole('button', { name: /重试|重新加载/ })
        await targetCheck(page, retry, label + '-retry')
        check(label + ': a failed read never calls a write', (await state(page)).requests.filter((request) => /^(add-tag-nodes|remove-tag-nodes)$/.test(request.type)), [])
        if (await retry.count()) {
          await page.evaluate(() => { window.organizationHarness.failQuery = false })
          await retry.click()
          const add = dialog.getByRole('button', { name: '为当前选择添加标签 研究', exact: true })
          await add.waitFor()
          check(label + ': retry makes the exact bounded selection readable', (await state(page)).requests.filter((request) => request.type === 'query-node-tags').map((request) => request.nodeIDs), [[21, 22], [21, 22]])
          await targetCheck(page, add, label + '-assign-row'); await add.click()
          const remove = dialog.getByRole('button', { name: '从当前选择移除标签 研究', exact: true }); await remove.waitFor()
          check(label + ': assignment reports actual2-of2 with refreshed global count129', /当前选择\s*2\s*\/\s*2\s*已标记.*全部项目\s*129/.test(await remove.innerText()))
          await remove.click(); await add.waitFor()
          check(label + ': removal reports actual0-of2 with global count127', /当前选择\s*0\s*\/\s*2\s*已标记.*全部项目\s*127/.test(await add.innerText()))
          check(label + ': writes preserve the complete selected scope', (await state(page)).requests.filter((request) => /^(add-tag-nodes|remove-tag-nodes)$/.test(request.type)), [{ type: 'add-tag-nodes', tagID: 9, nodeIDs: [21, 22] }, { type: 'remove-tag-nodes', tagID: 9, nodeIDs: [21, 22] }])
        }
      })
    }
    check('No renderer or fixture errors', results.errors, [])
  } finally {
    server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve))
    results.finishedAt = new Date().toISOString(); results.passed = results.checks.every((entry) => entry.passed) && results.errors.length === 0
    fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(results, null, 2))
    process.stdout.write(JSON.stringify({ passed: results.passed, checks: results.checks.length, failures: results.checks.filter((entry) => !entry.passed).length, errors: results.errors.length, outputDir }, null, 2) + '\n')
    if (!results.passed) process.exitCode = 1
  }
}
main().catch((error) => { process.stderr.write(String(error.stack || error) + '\n'); process.exitCode = 1 })

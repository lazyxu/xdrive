#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const options = {}
for (const argument of process.argv.slice(2)) {
  const match = /^--(repo-root|source-root|output-dir|case)=(.+)$/.exec(argument)
  if (!match) throw new Error(`Unknown argument: ${argument}`)
  options[match[1]] = match[2]
}
if (!options['output-dir']) throw new Error('Supply --output-dir=/path for evidence.')
if (options.case && !['all', 'entry', 'rename', 'name-dialog', 'tasks', 'acceptance', 'destination'].includes(options.case)) throw new Error('Use --case=all|entry|rename|name-dialog|tasks|acceptance|destination.')
const repoRoot = path.resolve(options['repo-root'] || path.join(__dirname, '../..'))
const sourceRoot = path.resolve(options['source-root'] || repoRoot)
const outputDir = path.resolve(options['output-dir'])
const dependency = createRequire(path.join(repoRoot, 'desktop/package.json'))
const esbuild = dependency('esbuild')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || dependency.resolve('playwright'))
const results = { sourceRoot, startedAt: new Date().toISOString(), checks: [], errors: [], samples: {} }
const enabled = (name) => !options.case || options.case === 'all' || options.case === name
function check(name, actual, expected = true) {
  try { assert.deepEqual(actual, expected); results.checks.push({ name, passed: true }) }
  catch { results.checks.push({ name, passed: false, actual, expected }); process.stdout.write(`FAIL ${name}: ${JSON.stringify(actual)}\n`) }
}
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

async function main() {
  fs.mkdirSync(outputDir, { recursive: true })
  try { results.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { results.sourceCommit = fs.readFileSync(path.join(sourceRoot, 'source-revision.txt'), 'utf8').trim() }
  const sources = {
    __FILE_EXPLORER__: 'mui/FileExplorer.tsx', __WORKSPACE__: 'mui/FileExplorerWorkspaceController.ts',
    __OPERATION_CONTROLLER__: 'mui/FileExplorerOperationController.ts', __OPERATION_LIFECYCLE__: 'mui/FileOperationLifecycle.ts',
    __OPERATION_ACTIONS__: 'mui/FileOperationActions.ts', __TASK_CENTER__: 'mui/TaskCenterPage.tsx',
    __FILE_NAME_DIALOG__: 'mui/FileNameDialog.tsx', __THEME__: 'mui/AppearanceThemeProvider.tsx',
    __CONTROLLER_MODEL__: 'file-explorer-controller.ts',
    __ACTION_FEEDBACK__: 'mui/FileExplorerActionFeedback.tsx',
  }
  const destinationPath = path.join(sourceRoot, 'ui/shared/src/mui/FileExplorerDestinationDialog.tsx')
  const destinationPresent = fs.existsSync(destinationPath)
  const includeDestination = destinationPresent && (enabled('destination') || enabled('acceptance'))
  results.destinationPresent = destinationPresent
  results.destinationIncluded = includeDestination
  const absentDestinationPath = path.join(outputDir, 'absent-destination.tsx')
  if (!includeDestination) fs.writeFileSync(absentDestinationPath, 'export const XDriveFileExplorerDestinationDialog = undefined;\n')
  results.sourceHashes = Object.fromEntries([...Object.values(sources), 'mui/FileExplorerSearch.ts', 'mui/FileExplorerNavigation.ts', 'mui/FileOperationCenter.tsx', 'file-operations.ts'].map((name) => [name, hash(path.join(sourceRoot, 'ui/shared/src', name))]))
  results.fixtureHashes = Object.fromEntries(['file-explorer-operations-browser.cjs', 'file-explorer-operations-browser.tsx'].map((name) => [name, hash(path.join(__dirname, name))]))
  for (const name of ['file-explorer-operations-browser.cjs', 'file-explorer-operations-browser.tsx']) fs.copyFileSync(path.join(__dirname, name), path.join(outputDir, name))
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'file-explorer-operations-browser.tsx')], bundle: true,
    outfile: path.join(outputDir, 'bundle.js'), jsx: 'automatic', nodePaths: [path.join(repoRoot, 'desktop/node_modules')],
    alias: { ...Object.fromEntries(Object.entries(sources).map(([alias, name]) => [alias, path.join(sourceRoot, 'ui/shared/src', name)])), __DESTINATION_DIALOG__: includeDestination ? destinationPath : absentDestinationPath },
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  results.sourceHashes['mui/FileExplorerDestinationDialog.tsx'] = destinationPresent ? hash(destinationPath) : null
  results.bundleHash = hash(path.join(outputDir, 'bundle.js'))
  const server = http.createServer((request, response) => {
    const route = new URL(request.url, 'http://localhost').pathname
    response.setHeader('Cache-Control', 'no-store')
    if (route === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end('<!doctype html><html style="height:100%"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;height:100%"><div id="root" style="height:100%;min-height:0"></div><script src="/bundle.js"></script></body></html>')
    } else if (route === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(fs.readFileSync(path.join(outputDir, 'bundle.js'))) }
    else if (route === '/favicon.ico') { response.statusCode = 204; response.end() }
    else { response.statusCode = 404; response.end(); results.errors.push(`Unexpected request ${route}`) }
  })
  const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const state = (page) => page.evaluate(() => ({ ...window.operationsHarness.state, selectedIDs: [...window.operationsHarness.selectedIDs], nameState: window.operationsHarness.nameState, events: window.operationsHarness.events, requests: window.operationsHarness.requests, pendingCount: window.operationsHarness.pending.length }))
  const capture = async (page, name) => {
    await page.screenshot({ path: path.join(outputDir, `${name}.png`), animations: 'disabled' })
    results.samples[name] = await state(page)
    results.samples[name].ui = await page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight, rootFontSize: getComputedStyle(document.documentElement).fontSize, coarsePointer: matchMedia('(pointer: coarse)').matches },
      regions: Array.from(document.querySelectorAll('[data-xdrive-file-explorer], [data-xdrive-file-explorer-scroll-host], [data-xdrive-file-explorer-context-panel], [data-xdrive-file-explorer-command-bar], [data-xdrive-file-explorer-scroll-host] [role="row"], [data-xdrive-file-explorer-selection-scope]')).slice(0, 15).map((element) => {
        const box = element.getBoundingClientRect()
        return { marker: Array.from(element.attributes).filter((attribute) => attribute.name.startsWith('data-xdrive') || attribute.name === 'role').map((attribute) => `${attribute.name}=${attribute.value}`).join(' '), text: element.textContent.slice(0, 50), x: box.x, y: box.y, width: box.width, height: box.height, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop }
      }),
      dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).map((element) => ({ label: element.getAttribute('aria-label'), labelledBy: element.getAttribute('aria-labelledby'), labelText: (element.getAttribute('aria-labelledby') || '').split(' ').map((id) => document.getElementById(id)?.textContent || '').join(' ') })),
    }))
  }
  const geometry = (locator) => locator.evaluate((element) => {
    const rect = (box) => ({ x: box.x, y: box.y, width: box.width, height: box.height, top: box.top, right: box.right, bottom: box.bottom, left: box.left })
    const box = element.getBoundingClientRect()
    const clipping = { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
    const ancestors = []
    for (let parent = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect()
      if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) { clipping.left = Math.max(clipping.left, bounds.left); clipping.right = Math.min(clipping.right, bounds.right) }
      if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) { clipping.top = Math.max(clipping.top, bounds.top); clipping.bottom = Math.min(clipping.bottom, bounds.bottom) }
      if (/(hidden|clip|auto|scroll)/.test(style.overflowX + style.overflowY)) ancestors.push({ tag: parent.tagName, rect: rect(bounds), overflowX: style.overflowX, overflowY: style.overflowY })
    }
    const textRects = [], walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue
      const range = document.createRange(); range.selectNodeContents(walker.currentNode)
      for (const value of range.getClientRects()) if (value.width && value.height) textRects.push(rect(value))
    }
    const unclipped = box.left >= clipping.left - 0.5 && box.right <= clipping.right + 0.5 && box.top >= clipping.top - 0.5 && box.bottom <= clipping.bottom + 0.5
    return { rect: rect(box), clipping, ancestors, textRects, unclipped,
      readable: textRects.every((value) => value.left >= clipping.left - 0.5 && value.right <= clipping.right + 0.5 && value.top >= clipping.top - 0.5 && value.bottom <= clipping.bottom + 0.5),
      hittable: element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) }
  })
  const checkTarget = async (page, target, label, compact = true) => {
    const count = await target.count()
    check(`${label}: visible control exists`, count, 1)
    if (count !== 1) return
    const value = await geometry(target)
    results.samples[`${label}-geometry`] = value
    check(`${label}: rendered target is reachable and unclipped`, value.unclipped && value.readable && value.hittable)
    if (compact) check(`${label}: actual target is at least 44 × 44`, value.rect.width >= 44 && value.rect.height >= 44)
  }
  const revealVertically = async (page, target, scroller) => {
    for (let index = 0; index < 8; index += 1) {
      const targetBox = await target.boundingBox(), scrollBox = await scroller.boundingBox()
      if (!targetBox || !scrollBox) return false
      if (targetBox.y >= Math.max(0, scrollBox.y) && targetBox.y + targetBox.height <= Math.min(page.viewportSize().height, scrollBox.y + scrollBox.height)) return true
      await page.mouse.move(Math.min(page.viewportSize().width - 5, scrollBox.x + scrollBox.width / 2), Math.max(10, Math.min(page.viewportSize().height - 10, scrollBox.y + scrollBox.height / 2)))
      await page.mouse.wheel(0, targetBox.y < scrollBox.y ? -240 : 240)
      await settle(page)
    }
    return false
  }
  const revealTextEdge = async (page, target, scroller, edge) => {
    for (let index = 0; index < 8; index += 1) {
      const value = await geometry(target), text = edge === 'first' ? value.textRects[0] : value.textRects.at(-1)
      if (!text) return false
      if (text.top >= value.clipping.top - 0.5 && text.bottom <= value.clipping.bottom + 0.5) return true
      const box = await scroller.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(0, text.top < value.clipping.top ? text.top - value.clipping.top - 8 : text.bottom - value.clipping.bottom + 8)
      await settle(page)
    }
    return false
  }
  const checkScrollableLongControl = async (page, target, scroller, label) => {
    // A long wrapped name may exceed a short scroll viewport. Prove its first
    // and last lines are actually reachable instead of requiring all lines at
    // once, while preserving the real 44px visible activation requirement.
    check(`${label}: actual wheel exposes the first text line`, await revealTextEdge(page, target, scroller, 'first'))
    results.samples[`${label}-first-text-geometry`] = await geometry(target)
    check(`${label}: actual wheel exposes the final text line`, await revealTextEdge(page, target, scroller, 'last'))
    const value = await geometry(target)
    results.samples[`${label}-last-text-geometry`] = value
    check(`${label}: wrapped text is never horizontally clipped`, value.textRects.every((text) => text.left >= value.clipping.left - 0.5 && text.right <= value.clipping.right + 0.5))
    const visible = await target.evaluate((element, clipping) => {
      const box = element.getBoundingClientRect(), left = Math.max(box.left, clipping.left), right = Math.min(box.right, clipping.right), top = Math.max(box.top, clipping.top), bottom = Math.min(box.bottom, clipping.bottom)
      return { width: right - left, height: bottom - top, hittable: element.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2)) }
    }, value.clipping)
    check(`${label}: visible target retains at least44px and accepts pointer input`, visible.width >= 44 && visible.height >= 44 && visible.hittable)
  }
  const byName = (page, name) => page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: name })
  const renameInput = async (page) => await page.getByRole('dialog', { name: /重命名/ }).count()
    ? page.getByRole('dialog', { name: /重命名/ }).getByRole('textbox')
    : page.locator('[aria-label^="重命名"] input')
  const beginRename = async (page, compact) => {
    if (compact) await page.getByRole('button', { name: '更多操作：报告.txt' }).click()
    else await byName(page, '报告.txt').click({ button: 'right' })
    await page.getByText('重命名', { exact: true }).click()
    await (await renameInput(page)).waitFor()
    await settle(page)
  }
  const renameSubmit = async (page) => {
    const save = page.getByRole('button', { name: /^保存$/ })
    if (await save.count() === 1) await save.click()
    else await (await renameInput(page)).press('Enter')
  }
  const destinationDialog = (page) => page.getByRole('dialog', { name: /^(移动|复制)到文件夹/ })
  const destinationChild = (page, id) => destinationDialog(page).locator(`[data-xdrive-file-explorer-destination-directory="${id}"]`)
  const openDestination = async (page, operation = 'move', mixed = true) => {
    const compact = page.viewportSize().width < 900
    if (compact && await page.getByRole('button', { name: /^选择$/ }).count()) await page.getByRole('button', { name: /^选择$/ }).click()
    if (mixed) await byName(page, '源文件夹').click()
    await byName(page, '报告.txt').click(!compact && mixed ? { modifiers: ['Control'] } : undefined)
    if (!compact) await byName(page, '报告.txt').click({ button: 'right' })
    await page.getByRole(compact ? 'button' : 'menuitem', { name: operation === 'move' ? /^移动到…$/ : /^复制到…$/ }).click()
    await destinationDialog(page).waitFor()
    await destinationChild(page, 20).waitFor()
    await settle(page)
  }
  const mainContext = async (page) => {
    const value = await state(page)
    return { directory: value.directoryID, crumbs: value.crumbs, historyKey: value.historyKey, query: value.query, selectedIDs: value.selectedIDs }
  }
  const setSearch = async (page, value) => {
    let input = page.getByRole('textbox', { name: '搜索全部文件和文件夹' })
    if (await input.count() !== 1) await page.getByRole('button', { name: '搜索全部文件和文件夹', exact: true }).click()
    input = page.getByRole('textbox', { name: '搜索全部文件和文件夹' })
    await input.fill(value); await input.press('Enter')
    await page.waitForFunction((query) => window.operationsHarness.state.query === query && window.operationsHarness.state.searchReady, value)
    await settle(page)
  }
  const attempt = async (name, config, action) => {
    let browser, page
    try {
      browser = await chromium.launch({ headless: true, executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || undefined, args: process.env.XDRIVE_BROWSER_ARGS ? JSON.parse(process.env.XDRIVE_BROWSER_ARGS) : undefined })
      results.browserVersion = browser.version()
      const context = await browser.newContext({ viewport: { width: config.width ?? 390, height: config.height ?? 780 }, isMobile: config.touch !== false, hasTouch: config.touch !== false, deviceScaleFactor: 1 })
      page = await context.newPage(); page.setDefaultTimeout(4500)
      page.on('pageerror', (error) => results.errors.push(`${name}: ${error.message}`))
      page.on('console', (message) => { if (message.type() === 'error') results.errors.push(`${name}: ${message.text()}`) })
      const query = new URLSearchParams({ scene: config.scene ?? 'files', scope: config.scope ?? 'directory', capability: config.capability ?? 'full' })
      await page.goto(`http://127.0.0.1:${server.address().port}/?${query}`)
      await page.waitForFunction(() => Boolean(window.operationsHarness?.state || window.operationsHarness?.nameState))
      if (config.scope === 'search') await page.waitForFunction(() => window.operationsHarness.state.searchReady)
      await settle(page)
      if (config.textScale) { await page.addStyleTag({ content: `html { font-size: ${16 * config.textScale}px !important; }` }); await settle(page) }
      await action(page, name)
      await capture(page, name)
    } catch (error) {
      results.checks.push({ name, passed: false, error: String(error.message || error).split('\n').slice(0, 7).join('\n') })
      process.stdout.write(`FAIL ${name}: ${String(error.message || error).split('\n')[0]}\n`)
      if (page && !page.isClosed()) await capture(page, `${name}-failure`).catch(() => undefined)
    } finally { if (browser) await browser.close() }
  }
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    if (enabled('entry')) {
      for (const width of [360, 700, 899, 900]) {
        await attempt(`destination-entry-${width}`, { width, touch: width < 899 }, async (page, label) => {
          if (width < 900) await page.getByRole('button', { name: /^选择$/ }).click()
          await byName(page, '源文件夹').click()
          await byName(page, '报告.txt').click(width >= 900 ? { modifiers: ['Control'] } : undefined)
          await settle(page)
          check(`${label}: mixed source selection remains exact`, (await state(page)).selectedIDs, [20, 21])
          if (width >= 900) await byName(page, '报告.txt').click({ button: 'right' })
          const role = width < 900 ? 'button' : 'menuitem'
          await checkTarget(page, page.getByRole(role, { name: /^移动(?:所选项目)?到(?:…|\.\.\.)?$/ }), `${label}-move`, width < 900)
          await checkTarget(page, page.getByRole(role, { name: /^复制(?:所选项目)?到(?:…|\.\.\.)?$/ }), `${label}-copy`, width < 900)
          check(`${label}: entry does not require a clipboard operation`, (await state(page)).clipboardPlan, null)
        })
      }
      await attempt('selection-entry-short-height-200pct', { width: 360, height: 390, textScale: 2 }, async (page, label) => {
        await page.getByRole('button', { name: /^选择$/ }).click()
        const host = page.locator('[data-xdrive-file-explorer-scroll-host]'), item = byName(page, '源文件夹')
        await revealVertically(page, item, host)
        const measured = await geometry(item)
        results.samples[`${label}-first-row-geometry`] = measured
        check(`${label}: first selectable row can be reached after actual user scrolling`, measured.unclipped && measured.hittable && measured.rect.height >= 44)
      })
    }
    if (enabled('destination')) {
      if (!destinationPresent) check('destination: shared component exists', false)
      else {
        await attempt('destination-path-paging-invalid-targets', { width: 390 }, async (page, label) => {
          await openDestination(page)
          const dialog = destinationDialog(page), before = await mainContext(page)
          check(`${label}: immutable mixed source identity is captured`, (await state(page)).destination.sources.map((node) => ({ id: node.id, revision: node.revision, name: node.name, type: node.type, parent_id: node.parent_id })), [{ id: 20, revision: 30, name: '源文件夹', type: 'dir', parent_id: 2 }, { id: 21, revision: 31, name: '报告.txt', type: 'file', parent_id: 2 }])
          check(`${label}: current same-parent move is explained and unavailable`, await dialog.getByRole('button', { name: '移动到这里', exact: true }).isDisabled())
          check(`${label}: source count is visible`, (await dialog.innerText()).includes('2 个项目'))
          check(`${label}: only one bounded first page loads on open`, (await state(page)).requests.filter((request) => request.type === 'tree').map((request) => ({ id: request.id, limit: request.options.limit, cursor: request.options.cursor })), [{ id: 2, limit: 200, cursor: undefined }])
          await destinationChild(page, 20).click(); await destinationChild(page, 200).waitFor()
          check(`${label}: moving a directory into itself is unavailable`, await dialog.getByRole('button', { name: '移动到这里', exact: true }).isDisabled())
          await destinationChild(page, 200).click(); await dialog.getByText('此位置没有子文件夹。').waitFor()
          check(`${label}: moving a directory into its known descendant is unavailable`, await dialog.getByRole('button', { name: '移动到这里', exact: true }).isDisabled())
          check(`${label}: invalid target has a readable explanation`, /自身|自己|子目录|子文件夹/.test(await dialog.getByRole('alert').innerText()))
          await dialog.getByRole('button', { name: '前往 项目目录', exact: true }).click(); await destinationChild(page, 30).waitFor()
          await dialog.getByRole('button', { name: '下一页文件夹', exact: true }).click(); await destinationChild(page, 50).waitFor()
          check(`${label}: paging renders only its bounded page`, await dialog.locator('[data-xdrive-file-explorer-destination-directory]').evaluateAll((elements) => elements.map((element) => Number(element.getAttribute('data-xdrive-file-explorer-destination-directory')))), [40, 50])
          check(`${label}: next page forwards opaque Server cursor`, (await state(page)).requests.filter((request) => request.type === 'tree').at(-1).options.cursor, 'page:2')
          await destinationChild(page, 50).click(); await dialog.getByText('此位置没有子文件夹。').waitFor()
          check(`${label}: loaded long target name is present without synthesized path`, (await dialog.locator('[data-xdrive-file-explorer-destination-path]').innerText()).endsWith('项目归档资料'.repeat(12)))
          await dialog.getByRole('button', { name: '前往 我的文件', exact: true }).click(); await destinationChild(page, 2).waitFor()
          check(`${label}: authoritative root is a valid target`, await dialog.getByRole('button', { name: '移动到这里', exact: true }).isEnabled())
          check(`${label}: picker browsing leaves main navigation and selection unchanged`, await mainContext(page), before)
          await dialog.getByRole('button', { name: /^取消$/ }).click(); await settle(page)
          check(`${label}: Cancel leaves no operation or clipboard mutation`, { destination: (await state(page)).destination, submits: (await state(page)).requests.filter((request) => request.type === 'operation-submit').length, clipboard: (await state(page)).clipboardPlan }, { destination: null, submits: 0, clipboard: null })
          check(`${label}: Cancel preserves main context`, await mainContext(page), before)
        })
        await attempt('destination-submit-failure-retry-immutable-source', { width: 390 }, async (page, label) => {
          await openDestination(page, 'copy')
          const dialog = destinationDialog(page), before = await mainContext(page)
          check(`${label}: same-parent copy is allowed for Server conflict handling`, await dialog.getByRole('button', { name: '复制到这里', exact: true }).isEnabled())
          await destinationChild(page, 30).click(); await destinationChild(page, 300).waitFor()
          await destinationChild(page, 300).click(); await destinationChild(page, 3000).waitFor()
          await page.evaluate(() => { window.operationsHarness.failNextOperation = true; window.operationsHarness.mutateSourceMetadata() })
          await dialog.getByRole('button', { name: '复制到这里', exact: true }).click()
          await dialog.getByText('测试：提交失败，请重试', { exact: true }).waitFor()
          check(`${label}: rejected submit retains loaded target`, (await dialog.locator('[data-xdrive-file-explorer-destination-path]').innerText()).endsWith('目标目录 / 目标子目录'))
          check(`${label}: failed submit retains original raw source snapshot`, (await state(page)).destination.sources.map((node) => ({ id: node.id, revision: node.revision })), [{ id: 20, revision: 30 }, { id: 21, revision: 31 }])
          await page.evaluate(() => { window.operationsHarness.holdOperation = true })
          await dialog.getByRole('button', { name: '复制到这里', exact: true }).click()
          await page.waitForFunction(() => window.operationsHarness.pending.some((pending) => pending.type === 'operation'))
          check(`${label}: accepted-request wait disables Cancel and submit`, { cancel: await dialog.getByRole('button', { name: /^取消$/ }).isDisabled(), submit: await dialog.getByRole('button', { name: /正在提交任务/ }).isDisabled() }, { cancel: true, submit: true })
          await page.keyboard.press('Escape'); await settle(page)
          check(`${label}: pending Escape cannot dismiss or cancel the queued request`, await dialog.count(), 1)
          const plans = (await state(page)).requests.filter((request) => request.type === 'operation-submit').map((request) => request.plan)
          check(`${label}: retry uses the identical target and captured revision references`, plans.map((plan) => ({ operation: plan.operation, parentID: plan.parentID, items: plan.items, count: plan.count })), [{ operation: 'copy', parentID: 300, items: [{ id: 20, revision: 30 }, { id: 21, revision: 31 }], count: 2 }, { operation: 'copy', parentID: 300, items: [{ id: 20, revision: 30 }, { id: 21, revision: 31 }], count: 2 }])
          await page.evaluate(() => window.operationsHarness.release('operation'))
          await dialog.waitFor({ state: 'hidden' })
          check(`${label}: acceptance records one durable operation`, (await state(page)).events.filter((event) => event.type === 'queued').length, 1)
          check(`${label}: operation never routes through clipboard`, (await state(page)).clipboardPlan, null)
          check(`${label}: picker submit preserves main directory/history/selection`, await mainContext(page), before)
          const feedback = page.locator('[data-xdrive-file-explorer-action-feedback]')
          const viewTask = feedback.getByRole('button', { name: '查看任务', exact: true })
          await revealVertically(page, viewTask, page.locator('[data-xdrive-file-explorer-context-panel]'))
          await viewTask.click()
          await page.locator('[data-xdrive-file-operation-id="operation-1"]').waitFor()
          check(`${label}: actual Files feedback opens and focuses the matching Task Center operation`, await page.locator('[data-xdrive-file-operation-id="operation-1"]').evaluate((element) => element === document.activeElement))
        })
        await attempt('destination-loading-error-cancel-replacement', { width: 390 }, async (page, label) => {
          await openDestination(page, 'copy', false)
          let dialog = destinationDialog(page)
          await page.evaluate(() => { window.operationsHarness.failNextTree = true })
          await destinationChild(page, 30).click(); await dialog.getByText('测试：目录暂时不可用', { exact: true }).waitFor()
          check(`${label}: directory failure disables submit but retains local path`, { disabled: await dialog.getByRole('button', { name: '复制到这里', exact: true }).isDisabled(), path: (await dialog.locator('[data-xdrive-file-explorer-destination-path]').innerText()).endsWith('目标目录') }, { disabled: true, path: true })
          await dialog.getByRole('button', { name: '重试加载', exact: true }).click(); await destinationChild(page, 300).waitFor()
          await page.evaluate(() => { window.operationsHarness.holdTreeID = 300 })
          await destinationChild(page, 300).click(); await dialog.getByRole('progressbar', { name: '正在加载文件夹' }).waitFor()
          await dialog.getByRole('button', { name: /^取消$/ }).click(); await settle(page)
          check(`${label}: loading can be cancelled without a Server operation`, (await state(page)).requests.filter((request) => request.type === 'operation-submit').length, 0)
          await page.getByRole('button', { name: /^复制到…$/ }).click(); dialog = destinationDialog(page)
          await destinationChild(page, 20).waitFor()
          await page.evaluate(() => window.operationsHarness.release('tree')); await settle(page)
          check(`${label}: late old directory page cannot replace a new picker target`, (await dialog.locator('[data-xdrive-file-explorer-destination-path]').innerText()).endsWith('我的文件 / 项目目录'))
          check(`${label}: replacement retains current page rather than old descendants`, await dialog.locator('[data-xdrive-file-explorer-destination-directory]').evaluateAll((elements) => elements.map((element) => Number(element.getAttribute('data-xdrive-file-explorer-destination-directory')))), [20, 30])
          await page.evaluate(() => window.operationsHarness.changeSession()); await settle(page)
          check(`${label}: account/session replacement closes the owned destination draft`, (await state(page)).destination, null)
        })
        for (const config of [{ width: 360, height: 390, textScale: 2 }, { width: 700, height: 390 }, { width: 899, height: 390, touch: false }, { width: 900, height: 390, touch: false }]) {
          await attempt(`destination-layout-${config.width}-${config.textScale || 1}x`, config, async (page, label) => {
            await openDestination(page, 'copy')
            const dialog = destinationDialog(page)
            await checkTarget(page, dialog.getByRole('button', { name: /^取消$/ }), `${label}-cancel`, config.width < 900)
            await checkTarget(page, dialog.getByRole('button', { name: '复制到这里', exact: true }), `${label}-submit`, config.width < 900)
            const pager = dialog.getByRole('button', { name: '下一页文件夹', exact: true })
            await revealVertically(page, pager, dialog.locator('.MuiDialogContent-root')); await pager.click()
            const longDirectory = destinationChild(page, 50); await longDirectory.waitFor()
            const content = dialog.locator('.MuiDialogContent-root')
            const longBox = await longDirectory.boundingBox(), contentBox = await content.boundingBox()
            if (longBox.height > contentBox.height) await checkScrollableLongControl(page, longDirectory, content, `${label}-long-directory`)
            else { await revealVertically(page, longDirectory, content); await checkTarget(page, longDirectory, `${label}-long-directory`, config.width < 900) }
            await longDirectory.click(); await dialog.getByText('此位置没有子文件夹。').waitFor()
            check(`${label}: full long path is retained in readable DOM text`, (await dialog.locator('[data-xdrive-file-explorer-destination-path]').innerText()).endsWith('项目归档资料'.repeat(12)))
            const targetPath = dialog.locator('[data-xdrive-file-explorer-destination-path]')
            check(`${label}: actual wheel can read the start of target path`, await revealTextEdge(page, targetPath, content, 'first'))
            check(`${label}: actual wheel can read the end of target path`, await revealTextEdge(page, targetPath, content, 'last'))
            await checkTarget(page, dialog.getByRole('button', { name: /^取消$/ }), `${label}-long-cancel`, config.width < 900)
            await checkTarget(page, dialog.getByRole('button', { name: '复制到这里', exact: true }), `${label}-long-submit`, config.width < 900)
            await page.waitForFunction(() => document.querySelector('[data-xdrive-file-explorer-destination-dialog]')?.contains(document.activeElement))
            await page.keyboard.press('Escape'); await settle(page)
            await dialog.waitFor({ state: 'hidden' })
            check(`${label}: Escape dismisses the destination`, await dialog.count(), 0)
            check(`${label}: keyboard dismissal does not open a background file`, (await state(page)).events.filter((event) => event.type === 'file-open').length, 0)
          })
        }
      }
    }
    if (enabled('rename')) {
      for (const width of [360, 700, 899, 900]) {
        await attempt(`rename-presentation-${width}`, { width, touch: width < 899 }, async (page, label) => {
          const before = await state(page)
          await beginRename(page, width < 900)
          const input = await renameInput(page)
          check(`${label}: initial draft retains the filename`, await input.inputValue(), '报告.txt')
          check(`${label}: basename selection preserves extension convenience`, await input.evaluate((element) => [element.selectionStart, element.selectionEnd]), [0, 2])
          if (width < 900) {
            check(`${label}: compact rename uses a labeled dialog`, await page.getByRole('dialog', { name: /重命名/ }).count(), 1)
            await checkTarget(page, page.getByRole('button', { name: /^保存$/ }), `${label}-save`)
            await checkTarget(page, page.getByRole('button', { name: /^取消$/ }), `${label}-cancel`)
          } else check(`${label}: wide retains the existing inline editor`, await page.getByRole('dialog', { name: /重命名/ }).count(), 0)
          await page.evaluate(() => { window.operationsHarness.renameMode = 'reject' })
          await input.fill('重命名后.txt'); await renameSubmit(page)
          await page.waitForFunction(() => document.querySelector('[title*="名称已存在"]') || document.body.textContent.includes('测试：名称已存在'))
          check(`${label}: rejected rename preserves the draft`, await (await renameInput(page)).inputValue(), '重命名后.txt')
          if (width < 900) check(`${label}: asynchronous rename error is visible in the panel`, await page.getByText(/测试：名称已存在/).count() > 0)
          await capture(page, `${label}-error`)
          if (width < 900 && await page.getByRole('button', { name: /^取消$/ }).count()) await page.getByRole('button', { name: /^取消$/ }).click()
          else await (await renameInput(page)).press('Escape')
          await settle(page)
          check(`${label}: cancel closes the editor`, await page.locator('[aria-label^="重命名"] input').count() + await page.getByRole('dialog', { name: /重命名/ }).count(), 0)
          check(`${label}: focus returns to the renamed item`, await byName(page, '报告.txt').evaluate((element) => element === document.activeElement || element.contains(document.activeElement)))
          const after = await state(page)
          check(`${label}: rename leaves main history unchanged`, { key: after.historyKey, crumbs: after.crumbs, query: after.query }, { key: before.historyKey, crumbs: before.crumbs, query: before.query })
          check(`${label}: dialog keyboard never opens a background file`, after.events.filter((event) => event.type === 'file-open').length, 0)
        })
      }
      await attempt('rename-retains-draft-across-boundary', { width: 899, touch: false }, async (page, label) => {
        await beginRename(page, true)
        await (await renameInput(page)).fill('跨宽度保留的草稿.txt')
        await page.setViewportSize({ width: 900, height: 780 }); await settle(page)
        check(`${label}: wide uses the original inline editor`, await page.getByRole('dialog', { name: /重命名/ }).count(), 0)
        check(`${label}: wide retains exact draft`, await (await renameInput(page)).inputValue(), '跨宽度保留的草稿.txt')
        await page.setViewportSize({ width: 360, height: 390 }); await settle(page)
        check(`${label}: compact remounts only the presentation with exact draft`, await (await renameInput(page)).inputValue(), '跨宽度保留的草稿.txt')
        check(`${label}: passive width changes never submit rename`, (await state(page)).requests.filter((request) => request.type === 'rename').length, 0)
        await page.getByRole('button', { name: /^取消$/ }).click(); await settle(page)
        check(`${label}: Cancel after resize retains the original file`, await byName(page, '报告.txt').count(), 1)
      })
      await attempt('rename-short-error-retry-pending', { width: 360, height: 390, textScale: 2 }, async (page, label) => {
        await beginRename(page, true)
        const dialog = page.getByRole('dialog', { name: /重命名/ })
        await page.evaluate(() => { window.operationsHarness.renameMode = 'reject'; window.operationsHarness.renameError = '测试：此名称已存在，长错误说明。'.repeat(12) + '错误末尾' })
        await dialog.getByRole('textbox').fill('成功重试后的名称.txt'); await dialog.getByRole('button', { name: /^保存$/ }).click()
        await dialog.getByRole('alert').waitFor()
        check(`${label}: long error remains visible as text`, (await dialog.getByRole('alert').innerText()).endsWith('错误末尾'))
        await checkTarget(page, dialog.getByRole('button', { name: /^取消$/ }), `${label}-cancel`)
        await checkTarget(page, dialog.getByRole('button', { name: /^保存$/ }), `${label}-retry`)
        check(`${label}: a short error panel remains user scrollable`, await dialog.locator('.MuiDialogContent-root').evaluate((element) => element.scrollHeight > element.clientHeight && /auto|scroll/.test(getComputedStyle(element).overflowY)))
        const error = dialog.getByRole('alert')
        await page.mouse.move(180, 180); await page.mouse.wheel(0, 1200); await settle(page)
        results.samples[`${label}-error-geometry`] = await geometry(error)
        await capture(page, `${label}-error`)
        await page.evaluate(() => { window.operationsHarness.renameMode = 'hold' })
        await dialog.getByRole('button', { name: /^保存$/ }).click()
        await page.waitForFunction(() => window.operationsHarness.pending.some((pending) => pending.type === 'rename'))
        check(`${label}: pending rename disables Cancel`, await dialog.getByRole('button', { name: /^取消$/ }).isDisabled())
        await page.keyboard.press('Escape'); await settle(page)
        check(`${label}: Escape cannot promise cancellation of accepted PATCH`, await dialog.count(), 1)
        check(`${label}: pending retry submits the preserved draft exactly once`, (await state(page)).requests.filter((request) => request.type === 'rename').map((request) => request.name), ['成功重试后的名称.txt', '成功重试后的名称.txt'])
        await page.evaluate(() => window.operationsHarness.release('rename'))
        await page.getByRole('dialog', { name: /重命名/ }).waitFor({ state: 'hidden' })
        check(`${label}: retry updates the actual Files row`, await byName(page, '成功重试后的名称.txt').count(), 1)
        check(`${label}: dialog interaction never opens a background file`, (await state(page)).events.filter((event) => event.type === 'file-open').length, 0)
      })
    }
    if (enabled('name-dialog')) {
      for (const config of [{ width: 360, height: 390, textScale: 2 }, { width: 700, height: 390 }, { width: 899, height: 390, touch: false }, { width: 900, height: 390, touch: false }]) {
        await attempt(`name-dialog-controls-${config.width}-${config.textScale || 1}x`, { ...config, scene: 'name-dialog' }, async (page, label) => {
          const dialog = page.getByRole('dialog', { name: /重命名/ })
          await dialog.getByRole('textbox').fill('较长的中文文件名称'.repeat(6) + '.txt')
          const save = dialog.getByRole('button', { name: /^保存$/ }), cancel = dialog.getByRole('button', { name: /^取消$/ })
          await revealVertically(page, save, dialog.locator('.MuiDialogContent-root'))
          await checkTarget(page, save, `${label}-save`, config.width < 900)
          if (await cancel.count()) await revealVertically(page, cancel, dialog.locator('.MuiDialogContent-root'))
          await checkTarget(page, cancel, `${label}-cancel`, config.width < 900)
          if (await cancel.count()) {
            await cancel.click(); await settle(page)
            check(`${label}: explicit Cancel closes without a rename request`, { open: (await state(page)).nameState.open, count: (await state(page)).requests.filter((request) => request.type === 'rename').length }, { open: false, count: 0 })
          }
        })
      }
      await attempt('name-dialog-async-error', { scene: 'name-dialog', width: 360 }, async (page, label) => {
        const dialog = page.getByRole('dialog', { name: /重命名/ })
        await page.evaluate(() => { window.operationsHarness.renameMode = 'reject' })
        await dialog.getByRole('textbox').fill('新名称.txt')
        await dialog.getByRole('button', { name: /^保存$/ }).click(); await settle(page)
        check(`${label}: callback rejection stays visible inside the dialog`, await dialog.getByText(/测试：名称已存在/).count() > 0)
        check(`${label}: rejection preserves retry draft`, await dialog.getByRole('textbox').inputValue(), '新名称.txt')
        check(`${label}: rejection leaves the dialog open`, (await state(page)).nameState.open)
      })
      await attempt('name-dialog-utf8-boundary', { scene: 'name-dialog', width: 360 }, async (page, label) => {
        const value = '图'.repeat(84) + '.txt'
        check(`${label}: fixture is 256 bytes below the old character limit`, Buffer.byteLength(value), 256)
        const dialog = page.getByRole('dialog', { name: /重命名/ })
        await dialog.getByRole('textbox').fill(value)
        await dialog.getByRole('button', { name: /^保存$/ }).click(); await settle(page)
        check(`${label}: over-limit UTF-8 name never reaches rename transport`, (await state(page)).requests.filter((request) => request.type === 'rename').length, 0)
        check(`${label}: byte limit is explained without silent truncation`, /255.*字节|255.*bytes/i.test(await page.locator('body').innerText()))
      })
      await attempt('name-dialog-valid-utf8-boundary', { scene: 'name-dialog', width: 360 }, async (page, label) => {
        const value = '图'.repeat(83) + 'aa.txt'
        check(`${label}: valid boundary is exactly 255 UTF-8 bytes`, Buffer.byteLength(value), 255)
        const dialog = page.getByRole('dialog', { name: /重命名/ })
        await dialog.getByRole('textbox').fill(value); await dialog.getByRole('button', { name: /^保存$/ }).click(); await settle(page)
        check(`${label}: accepted valid name reaches transport unchanged`, (await state(page)).requests.filter((request) => request.type === 'rename').map((request) => request.name), [value])
      })
      await attempt('name-dialog-native-repeat-submit', { scene: 'name-dialog', width: 360 }, async (page, label) => {
        await page.evaluate(() => { window.operationsHarness.renameMode = 'hold' })
        const dialog = page.getByRole('dialog', { name: /重命名/ }), input = dialog.getByRole('textbox')
        await input.fill('保存一次.txt'); await input.press('Enter'); await input.press('Enter')
        check(`${label}: repeated native Enter submits only once`, (await state(page)).requests.filter((request) => request.type === 'rename').length, 1)
        await page.evaluate(() => window.operationsHarness.release('rename')); await settle(page)
      })
      await attempt('name-dialog-same-tick-submit', { scene: 'name-dialog', width: 360 }, async (page, label) => {
        await page.evaluate(() => { window.operationsHarness.renameMode = 'hold' })
        const dialog = page.getByRole('dialog', { name: /重命名/ })
        await dialog.getByRole('textbox').fill('同一事件循环保存.txt')
        // Two real DOM form events in one JS turn test submission ownership before
        // React can commit the disabled button. Native repeated Enter is separate.
        await dialog.locator('form').evaluate((form) => {
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        })
        check(`${label}: one pending transport owns both same-tick form events`, (await state(page)).requests.filter((request) => request.type === 'rename').length, 1)
        await page.evaluate(() => window.operationsHarness.release('rename')); await settle(page)
      })
      await attempt('name-dialog-target-replacement', { scene: 'name-dialog', width: 360 }, async (page, label) => {
        await page.evaluate(() => { window.operationsHarness.renameMode = 'hold' })
        const dialog = page.getByRole('dialog', { name: /重命名/ })
        await dialog.getByRole('textbox').fill('目标A的新名称.txt'); await dialog.getByRole('button', { name: /^保存$/ }).click()
        await page.evaluate(() => window.operationsHarness.replaceNameTarget()); await settle(page)
        check(`${label}: replacement target draft is presented`, await dialog.getByRole('textbox').inputValue(), '替换目标.txt')
        await page.evaluate(() => window.operationsHarness.release('rename')); await settle(page)
        check(`${label}: old target completion cannot close replacement target`, (await state(page)).nameState.open)
        check(`${label}: old target completion does not invoke close for either target`, (await state(page)).events.filter((event) => event.type === 'name-close').length, 0)
      })
    }
    if (enabled('tasks')) {
      for (const config of [{ width: 360, touch: true }, { width: 700, touch: true }, { width: 899, touch: false }, { width: 900, touch: false }, { width: 360, height: 390, touch: true, textScale: 2 }]) {
        await attempt(`task-conflict-controls-${config.width}-${config.textScale || 1}x`, { ...config, scene: 'tasks' }, async (page, label) => {
          await page.evaluate(() => window.operationsHarness.seedConflict())
          await page.getByRole('button', { name: /^跳过冲突$/ }).waitFor()
          for (const name of ['跳过冲突', '保留两者', '替换或合并']) {
            const button = page.getByRole('button', { name, exact: true })
            await revealVertically(page, button, page.locator('[data-fixture-task-scroll]'))
            await checkTarget(page, button, `${label}-${name}`, config.width < 900)
          }
          check(`${label}: conflict is not advertised as a generic retry`, await page.getByRole('button', { name: /^重试$/ }).count(), 0)
        })
      }
      await attempt('task-unsupported-conflict', { width: 390, scene: 'tasks', capability: 'limited' }, async (page, label) => {
        await page.evaluate(() => window.operationsHarness.seedConflict())
        await page.getByText('operation-conflict-1', { exact: true }).waitFor()
        check(`${label}: unsupported platform exposes no working-looking conflict controls`, await page.getByRole('button', { name: /跳过冲突|保留两者|替换或合并/ }).count(), 0)
      })
      for (const [buttonLabel, policy] of [['跳过冲突', 'skip'], ['保留两者', 'keep_both'], ['替换或合并', 'replace']]) {
        await attempt(`task-conflict-${policy}-continuation`, { width: 390, scene: 'tasks' }, async (page, label) => {
          await page.evaluate(() => window.operationsHarness.seedConflict())
          const button = page.getByRole('button', { name: buttonLabel, exact: true })
          await button.waitFor(); await button.click()
          await page.waitForFunction(() => window.operationsHarness.state.operations.some((operation) => operation.retry_of_id === 'operation-conflict-1'))
          const current = await state(page), continuation = current.operations.find((operation) => operation.retry_of_id === 'operation-conflict-1')
          check(`${label}: policy uses the actual resolve transport once`, current.requests.filter((request) => request.type === 'operation-resolve').map((request) => ({ id: request.id, policy: request.policy })), [{ id: 'operation-conflict-1', policy }])
          check(`${label}: continuation retains parent identity and policy`, { parent: continuation.retry_of_id, policy: continuation.conflict_policy, status: continuation.status }, { parent: 'operation-conflict-1', policy, status: 'queued' })
          check(`${label}: old conflict cannot be continued again`, await page.getByRole('button', { name: /跳过冲突|保留两者|替换或合并/ }).count(), 0)
        })
      }
      await attempt('task-cancel-remains-requested-until-server', { width: 390, scene: 'tasks' }, async (page, label) => {
        await page.evaluate(() => window.operationsHarness.seedOperation('running'))
        await page.getByRole('button', { name: /^取消$/ }).click()
        await page.waitForFunction(() => window.operationsHarness.state.operations[0]?.status === 'cancel_requested')
        check(`${label}: cancel calls existing Server operation ID`, (await state(page)).requests.filter((request) => request.type === 'operation-cancel').map((request) => request.id), ['operation-seeded-1'])
        check(`${label}: requested cancellation is not claimed terminal`, (await state(page)).operations[0].status, 'cancel_requested')
        check(`${label}: repeated cancel is unavailable`, await page.getByRole('button', { name: /^取消$/ }).count(), 0)
        await page.evaluate(() => window.operationsHarness.setOperationStatus('operation-seeded-1', 'failed', { failure_code: 'io_error', error: '测试：取消完成前存储失败', retryable: true }))
        await page.getByRole('button', { name: /^重试$/ }).waitFor()
        check(`${label}: late Server failure remains authoritative`, (await state(page)).operations[0].status, 'failed')
        await page.getByRole('button', { name: /^重试$/ }).click()
        await page.waitForFunction(() => window.operationsHarness.state.operations.some((operation) => operation.retry_of_id === 'operation-seeded-1'))
        check(`${label}: retry records a continuation, preserving original failure`, (await state(page)).operations.map((operation) => ({ id: operation.id, status: operation.status, parent: operation.retry_of_id })), [{ id: 'operation-seeded-1-retry-1', status: 'queued', parent: 'operation-seeded-1' }, { id: 'operation-seeded-1', status: 'failed', parent: undefined }])
      })
    }
    if (enabled('acceptance')) {
      await attempt('pending-paste-search-aba', { scope: 'search', width: 390 }, async (page, label) => {
        await page.getByRole('button', { name: /^选择$/ }).click()
        await byName(page, '报告.txt').click()
        await page.getByRole('button', { name: /^复制所选项目$/ }).click()
        await page.evaluate(() => { window.operationsHarness.holdOperation = true })
        await page.locator('[data-xdrive-file-explorer-scroll-host]').focus()
        await page.keyboard.press('Control+v')
        await page.waitForFunction(() => window.operationsHarness.pending.some((pending) => pending.type === 'operation'))
        await setSearch(page, '中间搜索'); await setSearch(page, '原搜索')
        const before = await state(page)
        await page.evaluate(() => window.operationsHarness.release('operation')); await settle(page)
        check(`${label}: accepted old operation preserves re-applied current Search`, { active: (await state(page)).searchActive, query: (await state(page)).query }, { active: true, query: '原搜索' })
        check(`${label}: operation completion does not change current history entry`, (await state(page)).historyKey, before.historyKey)
        check(`${label}: the accepted operation remains recorded`, (await state(page)).events.filter((event) => event.type === 'queued').length, 1)
      })
      if (destinationPresent) await attempt('pending-destination-external-search-aba', { scope: 'search', width: 390 }, async (page, label) => {
        await openDestination(page, 'copy', false)
        const dialog = destinationDialog(page)
        await page.evaluate(() => { window.operationsHarness.holdOperation = true })
        await dialog.getByRole('button', { name: '复制到这里', exact: true }).click()
        await page.waitForFunction(() => window.operationsHarness.pending.some((pending) => pending.type === 'operation'))
        // This is an external Workspace intent (for example an App navigation
        // request), not typing into an inert background field through a modal.
        await page.evaluate(() => window.operationsHarness.current.applySearch('中间搜索', {}))
        await page.waitForFunction(() => window.operationsHarness.state.query === '中间搜索' && window.operationsHarness.state.searchReady)
        await page.evaluate(() => window.operationsHarness.current.applySearch('原搜索', {}))
        await page.waitForFunction(() => window.operationsHarness.state.query === '原搜索' && window.operationsHarness.state.searchReady)
        const before = await state(page)
        check(`${label}: external navigation never rewrites captured sources`, before.destination.sources.map((node) => ({ id: node.id, revision: node.revision })), [{ id: 21, revision: 31 }])
        await page.evaluate(() => window.operationsHarness.release('operation'))
        await dialog.waitFor({ state: 'hidden' }); await settle(page)
        check(`${label}: acceptance preserves re-applied Search intent`, { active: (await state(page)).searchActive, query: (await state(page)).query, key: (await state(page)).historyKey }, { active: true, query: '原搜索', key: before.historyKey })
        check(`${label}: source operation is still recorded once`, (await state(page)).events.filter((event) => event.type === 'queued').length, 1)
      })
    }
    check('No renderer or fixture errors', results.errors, [])
  } finally {
    server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve))
    results.finishedAt = new Date().toISOString()
    results.passed = results.checks.every((entry) => entry.passed) && results.errors.length === 0
    fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(results, null, 2))
    process.stdout.write(`${JSON.stringify({ passed: results.passed, checks: results.checks.length, failures: results.checks.filter((entry) => !entry.passed).length, errors: results.errors, outputDir }, null, 2)}\n`)
    if (!results.passed) process.exitCode = 1
  }
}
main().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1 })

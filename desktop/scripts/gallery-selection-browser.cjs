const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const arg = (name, fallback) => {
  const prefix = `--${name}=`
  const joined = process.argv.find(value => value.startsWith(prefix))
  if (joined) return joined.slice(prefix.length)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}
const repo = path.resolve(arg('source-root', path.join(__dirname, '../..')))
const source = repo
const dependencyRoot = path.resolve(arg('dependency-root', repo))
const out = path.resolve(arg('output-dir', process.env.XDRIVE_M12_SELECTION_OUT || '/tmp/xdrive-gallery-selection'))
const fixture = path.join(__dirname, 'gallery-selection-browser.tsx')
const { build } = createRequire(path.join(dependencyRoot, 'desktop/package.json'))('esbuild')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright')
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const sourceFiles = ['MediaGallerySelectionToolbar.tsx', 'useMobilePanelViewport.ts', 'AppearanceThemeProvider.tsx', 'theme.ts']
const result = { startedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  boundary: 'Real shared SelectionToolbar, AppearanceThemeProvider and MUI Drawer/controls. Parent selection and action callbacks are controlled, so this is component geometry/interaction evidence, not full GalleryPage transport or physical software-keyboard evidence. Short viewport is an actual layout+visual resize; 200% text is root font-size32px.',
  sourceHashes: Object.fromEntries(sourceFiles.map(file => [file, hash(path.join(source, 'ui/shared/src/mui', file))])),
  fixtureHashes: { cjs: hash(__filename), tsx: hash(fixture) }, checks: [], samples: {}, errors: [] }
const check = (name, actual, expected = true) => { try { assert.deepEqual(actual, expected); result.checks.push({ name, passed: true, actual }) } catch { result.checks.push({ name, passed: false, actual, expected }) } }
const settle = page => page.evaluate(async () => {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  await Promise.all(document.getAnimations().filter(animation => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))
})
const geometry = locator => locator.evaluate(element => {
  const rect = element.getBoundingClientRect()
  let left = 0, top = 0, right = innerWidth, bottom = innerHeight
  const ancestors = []
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect()
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right) }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom) }
    if (ancestor.matches('[role="dialog"], [data-xdrive-gallery-album-picker]')) ancestors.push({ role: ancestor.getAttribute('role'), albumList: ancestor.hasAttribute('data-xdrive-gallery-album-picker'), height: box.height, scrollHeight: ancestor.scrollHeight, scrollTop: ancestor.scrollTop, overflow: style.overflow })
  }
  const x = Math.max(left, rect.left), y = Math.max(top, rect.top)
  const visibleWidth = Math.max(0, Math.min(right, rect.right) - x), visibleHeight = Math.max(0, Math.min(bottom, rect.bottom) - y)
  const hit = visibleWidth && visibleHeight ? document.elementFromPoint(x + visibleWidth / 2, y + visibleHeight / 2) : null
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, visibleWidth, visibleHeight, hit: Boolean(hit && element.contains(hit)), ancestors }
})
const target44 = box => box.visibleWidth >= 43.5 && box.visibleHeight >= 43.5 && box.hit
async function main() {
  fs.mkdirSync(out, { recursive: true })
  fs.copyFileSync(__filename, path.join(out, path.basename(__filename)))
  fs.copyFileSync(fixture, path.join(out, path.basename(fixture)))
  await build({ entryPoints: [fixture], bundle: true, outfile: path.join(out, 'bundle.js'), jsx: 'automatic', nodePaths: [path.join(dependencyRoot, 'desktop/node_modules')],
    alias: { '@probe/toolbar': path.join(source, 'ui/shared/src/mui/MediaGallerySelectionToolbar.tsx'), '@probe/theme': path.join(source, 'ui/shared/src/mui/AppearanceThemeProvider.tsx') },
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
  result.bundleHash = hash(path.join(out, 'bundle.js'))
  const server = http.createServer((request, response) => {
    if (new URL(request.url, 'http://localhost').pathname === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(fs.readFileSync(path.join(out, 'bundle.js'))) }
    else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({ executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || undefined, headless: true, args: JSON.parse(process.env.XDRIVE_BROWSER_ARGS || '[]') })
  result.browserVersion = browser.version()
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: 'UTC' })
    const page = await context.newPage(); page.setDefaultTimeout(4500)
    page.on('pageerror', error => result.errors.push({ kind: 'page', message: error.message }))
    page.on('console', message => { if (message.type() === 'error') result.errors.push({ kind: 'console', message: message.text() }) })
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    const trigger = page.getByRole('button', { name: '加入相册', exact: true })
    await trigger.waitFor(); await settle(page)
    const exit = await geometry(page.getByRole('button', { name: '退出选择', exact: true }))
    const triggerBox = await geometry(trigger)
    result.samples.compactToolbar = { exit, trigger: triggerBox, status: await page.getByRole('status').textContent() }
    check('compact toolbar: Exit and album trigger have visible44px targets', target44(exit) && target44(triggerBox))
    check('compact toolbar: selection count is announced', (await page.getByRole('status').textContent()).replace(/\s/g, ''), '已选择2项')
    await trigger.tap(); await settle(page)
    const dialog = page.getByRole('dialog', { name: '选择手动相册', exact: true })
    const family = dialog.getByRole('button', { name: /^家庭相册/ })
    check('album picker: actual named MUI dialog opens', await dialog.isVisible())
    check('album picker: smart albums excluded from choices', await dialog.getByText('自动规则相册', { exact: true }).count(), 0)
    check('album picker: normal-height album row is a visible44px target', target44(await geometry(family)))
    await family.tap()
    check('album picker: choosing a row does not submit', await page.evaluate(() => window.selectionPickerProbe.calls), [])
    await dialog.getByRole('button', { name: '添加到相册', exact: true }).tap(); await settle(page)
    check('album picker: confirm calls the existing action once with selected album revision', await page.evaluate(() => window.selectionPickerProbe.calls), [{ kind: 'add-to-album', value: { id: 'manual-1', revision: 7 } }])
    check('album picker: confirm returns focus to the same visible trigger', await trigger.evaluate(element => element === document.activeElement))
    for (const font of [16, 32]) {
      await trigger.tap(); await settle(page)
      await page.setViewportSize({ width: 844, height: 200 })
      await page.evaluate(value => { document.documentElement.style.fontSize = `${value}px` }, font); await settle(page)
      const list = dialog.locator('[data-xdrive-gallery-album-picker]')
      const rowsBefore = await geometry(family)
      const close = await geometry(dialog.getByRole('button', { name: '关闭相册选择', exact: true }))
      const apply = await geometry(dialog.getByRole('button', { name: '添加到相册', exact: true }))
      const listBefore = await list.evaluate(element => ({ box: element.getBoundingClientRect().toJSON(), scrollHeight: element.scrollHeight, scrollTop: element.scrollTop }))
      check(`short200 text${font}: an album choice retains a visible44px target`, target44(rowsBefore))
      check(`short200 text${font}: explicit Close retains a visible44px target`, target44(close))
      const wheelPoint = { x: listBefore.box.x + listBefore.box.width / 2,
        y: listBefore.box.height > 0 ? listBefore.box.y + listBefore.box.height / 2 : 105 }
      await page.mouse.move(wheelPoint.x, wheelPoint.y); await page.mouse.wheel(0, 480); await settle(page)
      const listAfter = await list.evaluate(element => ({ height: element.getBoundingClientRect().height, scrollTop: element.scrollTop }))
      result.samples[`short200-text${font}`] = { row: rowsBefore, close, apply, listBefore, listAfter, wheelPoint,
        viewport: await page.evaluate(() => ({ innerWidth, innerHeight, visualViewport: { width: visualViewport.width, height: visualViewport.height, offsetTop: visualViewport.offsetTop } })) }
      await page.screenshot({ path: path.join(out, `short200-text${font}.png`) })
      await dialog.getByRole('button', { name: '关闭相册选择', exact: true }).tap(); await settle(page)
      check(`short200 text${font}: Close leaves existing selected action untouched`, await page.evaluate(() => window.selectionPickerProbe.calls.length), 1)
      await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => { document.documentElement.style.fontSize = '16px' }); await settle(page)
    }
    if (arg('case', 'all') !== 'baseline') {
      const keyboardContext = await browser.newContext({ viewport: { width: 700, height: 390 }, hasTouch: false, timezoneId: 'UTC' })
      const keyboardPage = await keyboardContext.newPage(); keyboardPage.setDefaultTimeout(4500)
      keyboardPage.on('pageerror', error => result.errors.push({ kind: 'keyboard-page', message: error.message }))
      keyboardPage.on('console', message => { if (message.type() === 'error') result.errors.push({ kind: 'keyboard-console', message: message.text() }) })
      await keyboardPage.goto(`http://127.0.0.1:${server.address().port}/`)
      const keyboardTrigger = keyboardPage.getByRole('button', { name: '加入相册', exact: true })
      const keyboardDialog = keyboardPage.getByRole('dialog', { name: '选择手动相册', exact: true })
      const search = keyboardDialog.getByRole('textbox', { name: '搜索相册', exact: true })
      const keyboardFamily = keyboardDialog.getByRole('button', { name: /^家庭相册/ })
      const confirm = keyboardDialog.getByRole('button', { name: '添加到相册', exact: true })
      await keyboardTrigger.focus(); await keyboardPage.keyboard.press('Enter'); await settle(keyboardPage)
      check('keyboard: Enter opens the actual compact album dialog', await keyboardDialog.isVisible())
      await search.fill('家庭'); await keyboardPage.keyboard.press('Enter')
      check('keyboard: search filters choices without submitting', {
        choices: await keyboardDialog.locator('[data-xdrive-gallery-album-picker]').getByRole('button').count(),
        calls: await keyboardPage.evaluate(() => window.selectionPickerProbe.calls.length),
      }, { choices: 1, calls: 0 })
      await keyboardPage.keyboard.press('Tab')
      check('keyboard: Tab reaches a visible album choice', await keyboardFamily.evaluate(element => element === document.activeElement) && target44(await geometry(keyboardFamily)))
      await keyboardPage.keyboard.press('Space')
      check('keyboard: Space chooses without implicit submission', { enabled: await confirm.isEnabled(), calls: await keyboardPage.evaluate(() => window.selectionPickerProbe.calls.length) }, { enabled: true, calls: 0 })
      await keyboardPage.keyboard.press('Tab'); await keyboardPage.keyboard.press('Tab')
      check('keyboard: natural Tab reaches explicit confirmation', await confirm.evaluate(element => element === document.activeElement))
      await keyboardPage.evaluate(() => { window.selectionPickerProbe.nextAlbumError = '相册权限已变化，请重新确认后重试。' })
      await keyboardPage.keyboard.press('Enter')
      await keyboardDialog.getByRole('alert').waitFor(); await settle(keyboardPage)
      check('keyboard: rejected confirmation retains the dialog, choice and readable error', {
        open: await keyboardDialog.isVisible(), enabled: await confirm.isEnabled(),
        error: await keyboardDialog.getByRole('alert').textContent(),
      }, { open: true, enabled: true, error: '相册权限已变化，请重新确认后重试。' })
      await confirm.focus(); await keyboardPage.keyboard.press('Enter'); await settle(keyboardPage)
      check('keyboard: retry submits the same chosen album once more', await keyboardPage.evaluate(() => window.selectionPickerProbe.calls), [
        { kind: 'add-to-album', value: { id: 'manual-1', revision: 7 } },
        { kind: 'add-to-album', value: { id: 'manual-1', revision: 7 } },
      ])
      check('keyboard: retry success returns focus to the visible trigger', await keyboardTrigger.evaluate(element => element === document.activeElement) && target44(await geometry(keyboardTrigger)))
      await keyboardPage.keyboard.press('Space'); await settle(keyboardPage)
      check('keyboard: Space also opens the album dialog', await keyboardDialog.isVisible())
      await search.fill('保留前不提交'); await keyboardPage.keyboard.press('Escape'); await settle(keyboardPage)
      check('keyboard: Escape dismisses without submission and restores trigger focus', {
        open: await keyboardDialog.count(), calls: await keyboardPage.evaluate(() => window.selectionPickerProbe.calls.length),
        focus: await keyboardTrigger.evaluate(element => element === document.activeElement),
      }, { open: 0, calls: 2, focus: true })
      await keyboardPage.keyboard.press('Enter'); await settle(keyboardPage)
      await search.fill('家庭'); await keyboardFamily.click()
      await keyboardPage.evaluate(() => window.selectionPickerProbe.replaceSelection([201, 202]))
      await keyboardDialog.getByRole('alert').waitFor()
      check('selection: same count with a different identity refuses old confirmation', {
        count: (await keyboardDialog.getByRole('status').textContent()).replace(/\s/g, ''),
        disabled: await confirm.isDisabled(),
        warning: (await keyboardDialog.getByRole('alert').textContent()).includes('选择范围已变化'),
        calls: await keyboardPage.evaluate(() => window.selectionPickerProbe.calls.length),
      }, { count: '已选择2项', disabled: true, warning: true, calls: 2 })
      await keyboardPage.keyboard.press('Escape'); await settle(keyboardPage)
      await keyboardTrigger.focus(); await keyboardPage.keyboard.press('Enter'); await settle(keyboardPage)
      const searchHandle = await search.elementHandle()
      await search.focus(); await search.fill('手动相册 24')
      await keyboardPage.setViewportSize({ width: 844, height: 200 })
      await keyboardPage.evaluate(() => { document.documentElement.style.fontSize = '32px' }); await settle(keyboardPage)
      check('short keyboard: resize preserves the same focused input and search draft', {
        same: await search.evaluate((element, original) => element === original, searchHandle),
        focus: await search.evaluate(element => element === document.activeElement), value: await search.inputValue(),
      }, { same: true, focus: true, value: '手动相册 24' })
      const lastAlbum = keyboardDialog.getByRole('button', { name: /^手动相册 24 / })
      await keyboardPage.keyboard.press('Tab'); await settle(keyboardPage)
      check('short keyboard: native focus scrolling exposes the complete album target', await lastAlbum.evaluate(element => element === document.activeElement) && target44(await geometry(lastAlbum)))
      await keyboardPage.keyboard.press('Space'); await keyboardPage.keyboard.press('Tab'); await keyboardPage.keyboard.press('Tab'); await settle(keyboardPage)
      const shortConfirm = await geometry(confirm)
      const shortClose = await geometry(keyboardDialog.getByRole('button', { name: '关闭相册选择', exact: true }))
      check('short keyboard: native focus scrolling reaches the complete Add button', await confirm.evaluate(element => element === document.activeElement) && target44(shortConfirm) && shortConfirm.visibleHeight >= shortConfirm.height - .5)
      check('short keyboard: Close remains fixed and hittable while content scrolls', target44(shortClose))
      result.samples.shortKeyboard = { confirm: shortConfirm, close: shortClose,
        content: await keyboardDialog.locator('[data-xdrive-gallery-album-picker-content]').evaluate(element => ({ height: element.getBoundingClientRect().height, scrollTop: element.scrollTop, scrollHeight: element.scrollHeight })) }
      await keyboardPage.screenshot({ path: path.join(out, 'short-keyboard-confirm.png') })
      await keyboardPage.keyboard.press('Enter'); await settle(keyboardPage)
      check('short keyboard: explicit confirmation keeps the observed album revision', await keyboardPage.evaluate(() => window.selectionPickerProbe.calls.at(-1)), { kind: 'add-to-album', value: { id: 'manual-24', revision: 30 } })
      await keyboardPage.setViewportSize({ width: 390, height: 844 }); await keyboardPage.evaluate(() => { document.documentElement.style.fontSize = '16px' }); await settle(keyboardPage)
      await keyboardTrigger.click(); await settle(keyboardPage)
      await keyboardFamily.click()
      await keyboardPage.setViewportSize({ width: 844, height: 200 }); await keyboardPage.evaluate(() => { document.documentElement.style.fontSize = '32px' }); await settle(keyboardPage)
      const content = keyboardDialog.locator('[data-xdrive-gallery-album-picker-content]')
      const contentBox = await content.boundingBox()
      await keyboardPage.mouse.move(contentBox.x + contentBox.width / 2, contentBox.y + contentBox.height / 2)
      await keyboardPage.mouse.wheel(0, 10000); await settle(keyboardPage)
      await keyboardPage.waitForFunction(() => { const element = document.querySelector('[data-xdrive-gallery-album-picker-content]'); return element && element.scrollTop + element.clientHeight >= element.scrollHeight - 2 })
      const wheelConfirm = await geometry(confirm)
      const wheelCancel = await geometry(keyboardDialog.getByRole('button', { name: '取消', exact: true }))
      check('short wheel: one content scroller reaches both complete actions', [wheelConfirm, wheelCancel].every(box => target44(box) && box.visibleHeight >= box.height - .5))
      check('short wheel: Close remains a visible44px target at the end of content', target44(await geometry(keyboardDialog.getByRole('button', { name: '关闭相册选择', exact: true }))))
      result.samples.shortWheel = { confirm: wheelConfirm, cancel: wheelCancel,
        content: await content.evaluate(element => ({ height: element.getBoundingClientRect().height, scrollTop: element.scrollTop, scrollHeight: element.scrollHeight })) }
      await keyboardPage.screenshot({ path: path.join(out, 'short-wheel-actions.png') })
      await keyboardDialog.getByRole('button', { name: '取消', exact: true }).click(); await settle(keyboardPage)
      check('short wheel: Cancel preserves the current selected count without submitting', {
        calls: await keyboardPage.evaluate(() => window.selectionPickerProbe.calls.length),
        count: (await keyboardPage.getByRole('status').textContent()).replace(/\s/g, ''),
      }, { calls: 3, count: '已选择2项' })
      const wideContext = await browser.newContext({ viewport: { width: 900, height: 600 }, hasTouch: false, timezoneId: 'UTC' })
      const widePage = await wideContext.newPage(); widePage.setDefaultTimeout(4500)
      widePage.on('pageerror', error => result.errors.push({ kind: 'wide-page', message: error.message }))
      await widePage.goto(`http://127.0.0.1:${server.address().port}/`)
      const wideSelect = widePage.getByRole('combobox', { name: '添加到相册', exact: true })
      await wideSelect.waitFor(); await settle(widePage)
      check('wide900: the existing select remains available without a compact Drawer', { select: await wideSelect.isVisible(), compact: await widePage.getByRole('button', { name: '加入相册', exact: true }).count() }, { select: true, compact: 0 })
      await wideSelect.focus(); await widePage.keyboard.press('ArrowDown')
      await widePage.getByRole('option', { name: '家庭相册', exact: true }).click(); await settle(widePage)
      check('wide900: the existing selection action still submits its album revision', await widePage.evaluate(() => window.selectionPickerProbe.calls), [{ kind: 'add-to-album', value: { id: 'manual-1', revision: 7 } }])
    }
  } catch (error) { result.errors.push({ kind: 'scenario', message: String(error), stack: error.stack }) }
  finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
  result.finishedAt = new Date().toISOString()
  result.passed = result.checks.filter(check => check.passed).length
  result.failed = result.checks.filter(check => !check.passed).length
  result.sourceHashMatch = sourceFiles.every(file => hash(path.join(source, 'ui/shared/src/mui', file)) === result.sourceHashes[file])
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ out, passed: result.passed, failed: result.failed, errors: result.errors, sourceHashMatch: result.sourceHashMatch }))
  if (result.failed || result.errors.length || !result.sourceHashMatch) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })

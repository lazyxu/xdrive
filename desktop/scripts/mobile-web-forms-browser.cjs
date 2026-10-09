#!/usr/bin/env node
// Optional real-Chromium checks for Mobile Web forms. This is UI acceptance
// with bounded fixture data, not a Server, connector, keyboard or device test.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const esbuild = require('esbuild')
const options = {}
for (const argument of process.argv.slice(2)) {
  const match = /^--(source-root|output-dir)=(.+)$/.exec(argument)
  if (!match) throw new Error(`Unknown argument: ${argument}`)
  options[match[1]] = match[2]
}
if (!options['output-dir']) throw new Error('Supply --output-dir=/path for JSON, bundle and screenshots.')
const repoRoot = path.resolve(__dirname, '../..')
const sourceRoot = path.resolve(options['source-root'] || repoRoot)
const outputDir = path.resolve(options['output-dir'])
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright')
const files = {
  __THEME__: 'AppearanceThemeProvider.tsx', __ACTION__: 'ActionButton.tsx',
  __TITLE__: 'DialogTitle.tsx', __CONTENT__: 'DialogContent.tsx',
  __ROOTS__: 'SourceConnectorConfigFields.tsx', __CARD__: 'SourceSummaryCard.tsx',
  __FILENAME__: 'FileNameDialog.tsx', __UPLOAD__: 'UploadConflictDialog.tsx',
}
const results = { sourceRoot, startedAt: new Date().toISOString(), checks: [], samples: {}, errors: [] }
const check = (name, actual, expected = true) => {
  try { assert.deepEqual(actual, expected); results.checks.push({ name, passed: true }) }
  catch { results.checks.push({ name, passed: false, actual, expected }) }
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true })
  results.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim()
  results.sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' }).trim())
  results.sourceSHA256 = Object.fromEntries(Object.values(files).map((file) => [file,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(sourceRoot, 'ui/shared/src/mui', file))).digest('hex'),
  ]))
  const bundlePath = path.join(outputDir, 'bundle.js')
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'mobile-web-forms-browser.tsx')], bundle: true,
    outfile: bundlePath, jsx: 'automatic', nodePaths: [path.join(repoRoot, 'desktop/node_modules')],
    alias: Object.fromEntries(Object.entries(files).map(([alias, file]) => [alias, path.join(sourceRoot, 'ui/shared/src/mui', file)])),
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    const url = new URL(request.url, 'http://localhost')
    if (url.pathname === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript'); response.end(fs.readFileSync(bundlePath))
    } else if (url.pathname === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script src="/bundle.js"></script></body></html>')
    } else { response.statusCode = 204; response.end() }
  })
  let browser
  let page
  let stage = 'startup'
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const origin = `http://127.0.0.1:${server.address().port}`
    const args = process.env.XDRIVE_BROWSER_ARGS ? JSON.parse(process.env.XDRIVE_BROWSER_ARGS) : undefined
    if (args && (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string'))) throw new Error('XDRIVE_BROWSER_ARGS must be a JSON string array.')
    const launch = async (touch) => {
      browser = await chromium.launch({ headless: true, executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || undefined, args })
      results.browserVersion = browser.version()
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 })
      page = await context.newPage()
      page.setDefaultTimeout(5000)
      page.on('pageerror', (error) => results.errors.push(`${stage}: ${error.message}`))
    }
    const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const state = () => page.evaluate(() => ({ ...window.mobileFormsHarness.state, events: window.mobileFormsHarness.events, browseCalls: window.mobileFormsHarness.browseCalls }))
    const visit = async (name) => {
      stage = name
      await page.goto(`${origin}/?case=${name}`)
      await page.waitForFunction(() => Boolean(window.mobileFormsHarness?.state))
      await settle()
    }
    const dimensions = async (name) => page.getByRole('button', { name, exact: true }).evaluate((element) => {
      const { width, height } = element.getBoundingClientRect(); return { width, height }
    })
    const sample = async (name) => {
      stage = name
      const value = await page.evaluate(() => {
        const paper = [...document.querySelectorAll('.MuiDialog-paper')].at(-1)
        const scope = paper || document
        const rect = (element) => {
          const { x, y, width, height } = element.getBoundingClientRect()
          return { x, y, width, height, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }
        }
        return {
          viewport: { width: innerWidth, height: innerHeight }, coarse: matchMedia('(pointer: coarse)').matches,
          documentWidth: document.documentElement.scrollWidth, paper: paper ? rect(paper) : null,
          content: [...scope.querySelectorAll('.MuiDialogContent-root')].map(rect),
          buttons: [...scope.querySelectorAll('button')].map((element) => ({ text: element.textContent, label: element.getAttribute('aria-label'), disabled: element.disabled, ...rect(element) })),
          chips: [...scope.querySelectorAll('.MuiChip-root')].map((element) => ({ text: element.textContent, ...rect(element) })),
          deleteTargets: [...scope.querySelectorAll('.MuiChip-deleteIcon')].map(rect),
          overflowingText: [...scope.querySelectorAll('.MuiTypography-root')].filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => ({ text: element.textContent.slice(0, 70), ...rect(element) })),
          state: window.mobileFormsHarness.state, events: window.mobileFormsHarness.events, browseCalls: window.mobileFormsHarness.browseCalls,
        }
      })
      results.samples[name] = value
      await page.screenshot({ path: path.join(outputDir, `${name}.png`) })
      return value
    }
    const touchPoint = async (locator) => {
      const rect = await locator.boundingBox()
      await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2)
    }
    const noHorizontalOverflow = (measurement) => measurement.content.every((content) => content.scrollWidth <= content.clientWidth + 1)
    const smallButtons = (measurement) => measurement.buttons.filter((button) => !button.disabled && (button.height < 44 || button.width < 44))

    await launch(true)
    await visit('controls')
    for (const width of [390, 360, 899, 900, 390]) {
      await page.setViewportSize({ width, height: width >= 899 ? 700 : 844 }); await settle()
      for (const name of ['停止', '保存', '查看', '设置']) {
        const target = await dimensions(name)
        check(`${width}px coarse ${name}: expected target height`, target.height, width < 900 ? 44 : name === '保存' ? 36 : 28)
        if (width < 900) check(`${width}px coarse ${name}: target width >=44`, target.width >= 44)
      }
      await sample(`controls-coarse-${width}`)
    }
    await page.getByRole('button', { name: '停止', exact: true }).tap()
    await page.getByRole('button', { name: '保存', exact: true }).tap()
    await touchPoint(page.getByRole('button', { name: '禁用按钮', exact: true }))
    await touchPoint(page.getByRole('button', { name: '正在处理…', exact: true }))
    check('enabled actions fire once; disabled/loading ignore native touch', (await state()).events.map((event) => event.type), ['compact-action', 'normal-action'])

    await visit('roots')
    await page.getByRole('button', { name: '浏览群晖目录', exact: true }).tap()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor(); await page.getByRole('checkbox').first().waitFor(); await settle()
    let measured = await sample('roots-390-initial')
    check('390px long directory name does not create horizontal content overflow', noHorizontalOverflow(measured))
    check('390px directory navigation/entry/footer buttons have 44px targets', smallButtons(measured), [])
    const longPath = await page.evaluate(() => window.mobileFormsHarness.longPath)
    await page.getByRole('checkbox', { name: `选择 ${longPath}`, exact: true }).tap()
    await settle()
    measured = await sample('roots-390-selected')
    check('selecting one directory checks exactly one root', await page.getByRole('checkbox').evaluateAll((elements) => elements.filter((element) => element.checked).length), 1)
    check('selected long root keeps horizontal content bounded', noHorizontalOverflow(measured))
    // Match both the existing Chip delete affordance and an accessible explicit
    // remove button, so the behavioral check does not prescribe the rendering.
    const remove = () => dialog.locator('.MuiChip-deleteIcon, button[aria-label^="移除"], button[aria-label^="删除所选"], button[aria-label^="取消选择"]').last()
    const removeRect = await remove().boundingBox()
    check('selected-root removal target is at least 44px', removeRect.width >= 44 && removeRect.height >= 44)
    await page.getByRole('button', { name: '进入', exact: true }).first().tap()
    await page.getByRole('checkbox', { name: `选择 ${longPath}/child`, exact: true }).waitFor()
    check('enter requests the selected directory', (await state()).browseCalls.at(-1), longPath)
    await page.getByRole('button', { name: '上一级', exact: true }).tap()
    await page.getByRole('checkbox', { name: `选择 ${longPath}`, exact: true }).waitFor()
    check('Up returns to root and preserves draft selection', await page.getByRole('checkbox', { name: `选择 ${longPath}`, exact: true }).isChecked())
    await remove().tap()
    check('removing a root updates the matching checkbox', await page.getByRole('checkbox', { name: `选择 ${longPath}`, exact: true }).isChecked(), false)
    await page.getByRole('checkbox', { name: `选择 ${longPath}`, exact: true }).tap()
    for (const viewport of [{ width: 360, height: 390 }, { width: 390, height: 320 }, { width: 899, height: 700 }, { width: 900, height: 700 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport); await settle()
      measured = await sample(`roots-${viewport.width}x${viewport.height}`)
      check(`${viewport.width}x${viewport.height}: content remains horizontally bounded`, noHorizontalOverflow(measured))
      check(`${viewport.width}x${viewport.height}: dialog stays within viewport`, measured.paper.x >= -1 && measured.paper.y >= -1 && measured.paper.x + measured.paper.width <= viewport.width + 1 && measured.paper.y + measured.paper.height <= viewport.height + 1)
      check(`${viewport.width}x${viewport.height}: resize keeps selected root`, await page.getByRole('checkbox', { name: `选择 ${longPath}`, exact: true }).isChecked())
    }
    await page.getByRole('button', { name: '使用所选目录', exact: true }).tap()
    await dialog.waitFor({ state: 'hidden' })
    check('confirm commits the exact selected root once', (await state()).events.filter((event) => event.type === 'roots-change').map((event) => event.value), [[longPath]])
    await page.getByRole('button', { name: '浏览群晖目录', exact: true }).tap()
    await page.getByRole('checkbox', { name: `选择 ${longPath}`, exact: true }).waitFor()
    await page.getByRole('checkbox', { name: `选择 ${longPath}`, exact: true }).tap()
    await page.getByRole('button', { name: '取消', exact: true }).tap()
    await dialog.waitFor({ state: 'hidden' })
    check('cancel discards changed root draft without a second commit', (await state()).roots, [longPath])
    check('cancel never invokes onChange', (await state()).events.filter((event) => event.type === 'roots-change').length, 1)

    await visit('title'); await page.getByRole('dialog').waitFor()
    await page.getByRole('textbox', { name: '测试设置值', exact: true }).fill('edited-before-resize')
    for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 390 }, { width: 900, height: 700 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport); await settle()
      measured = await sample(`title-${viewport.width}x${viewport.height}`)
      check(`${viewport.width}x${viewport.height}: valid long Source title wraps inside paper`, measured.overflowingText.length, 0)
      check(`${viewport.width}x${viewport.height}: resize keeps form draft`, (await state()).draft, 'edited-before-resize')
    }
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).tap()
    check('long-title close remains operable', (await state()).open, false)

    await visit('filename')
    await page.getByRole('textbox', { name: '文件夹名称', exact: true }).fill('手机输入的文件夹')
    await page.setViewportSize({ width: 360, height: 390 }); await settle()
    check('ordinary FileName modal retains typed value after short viewport resize', await page.getByRole('textbox', { name: '文件夹名称', exact: true }).inputValue(), '手机输入的文件夹')
    await sample('filename-short')
    await page.getByRole('textbox', { name: '文件夹名称', exact: true }).press('Enter')
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    check('Enter submits the ordinary form exactly once', (await state()).events.filter((event) => event.type === 'name-submit').map((event) => event.value), ['手机输入的文件夹'])
    await visit('upload')
    await page.getByRole('checkbox').check()
    await page.setViewportSize({ width: 390, height: 320 }); await settle()
    measured = await sample('upload-short')
    check('upload conflict keeps its choice across viewport resize', (await state()).applyToRemaining)
    check('upload conflict footer actions have 44px targets on touch', smallButtons(measured).filter((button) => button.text), [])
    await page.getByRole('button', { name: '保留两者', exact: true }).tap()
    check('upload conflict invokes only the selected action', (await state()).events.filter((event) => event.type === 'upload-decision').map((event) => event.value), ['keep-both'])

    await browser.close(); browser = null
    await launch(false); await visit('controls')
    for (const name of ['停止', '保存', '查看', '设置']) {
      check(`390px fine pointer preserves desktop ${name} height`, (await dimensions(name)).height, name === '保存' ? 36 : 28)
    }
    await page.getByRole('button', { name: '保存', exact: true }).click()
    check('fine-pointer action callback still fires once', (await state()).events.map((event) => event.type), ['normal-action'])
    await sample('controls-fine-390')
  } catch (error) {
    results.errors.push(`${stage}: ${error.stack || error}`)
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(outputDir, 'scenario-error.png') }).catch(() => {})
  } finally {
    results.finishedAt = new Date().toISOString()
    results.passed = results.checks.length > 0 && results.checks.every((entry) => entry.passed) && results.errors.length === 0
    fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(results, null, 2))
    console.log(JSON.stringify({ outputDir, browserVersion: results.browserVersion, total: results.checks.length, failed: results.checks.filter((entry) => !entry.passed), errors: results.errors, passed: results.passed }, null, 2))
    if (!results.passed) process.exitCode = 1
    try { if (browser) await browser.close() } finally { if (server.listening) await new Promise((resolve) => server.close(resolve)) }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })

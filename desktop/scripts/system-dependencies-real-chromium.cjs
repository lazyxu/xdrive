#!/usr/bin/env node
'use strict'
// Actual compiled xDrive shared MUI System Dependencies in Chromium. The
// fixture is local-only and synthetic, not a live Server/Agent or iOS device.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '../..')
const requireDesktop = createRequire(path.join(root, 'desktop/package.json'))
const esbuild = requireDesktop('esbuild')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')
const resultDir = path.resolve(process.env.XD_SYSTEM_DEPS_CHROMIUM_OUT ||
  path.join(os.tmpdir(), 'xdrive-system-dependencies-real-chromium'))
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-system-deps-'))
fs.mkdirSync(resultDir, { recursive: true })
const summary = {
  sourceCommit: process.env.XD_PR_HEAD || null,
  realChromium: false, mountedSharedMUI: false, syntheticOnly: true,
  widths: [], checks: [], externalRequests: 0, pageErrors: [],
  passed: false, error: null,
}
const record = (name, condition) => {
  summary.checks.push({ name, passed: !!condition })
  assert(condition, name)
}
const html = '<!doctype html><html lang="zh-CN"><head>' +
  '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '</head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'
const serve = (res, code, type, body) => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}
let server
let browser
const noOverflow = async (page) => {
  const box = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  return box.client > 0 && box.scroll <= box.client + 1
}
const screenshot = async (page, name) => {
  await page.screenshot({
    path: path.join(resultDir, name + '.png'), fullPage: true,
    animations: 'disabled',
  })
}
async function checkWidth(width, port) {
  const mobile = width <= 390
  const context = await browser.newContext({
    viewport: { width, height: mobile ? 812 : 820 },
    isMobile: mobile, hasTouch: mobile,
    locale: 'zh-CN', deviceScaleFactor: 1, reducedMotion: 'reduce',
    serviceWorkers: 'block',
  })
  const page = await context.newPage()
  const origin = 'http://127.0.0.1:' + port
  page.setDefaultTimeout(22000)
  page.on('pageerror', error => summary.pageErrors.push(error.name + ': ' +
    String(error.message).slice(0, 180)))
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) {
      summary.externalRequests++
      return route.abort()
    }
    return route.continue()
  })
  try {
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' })
    await page.locator('[data-xdrive-system-dependencies-overview]').waitFor()
    await page.locator('[data-xdrive-system-dependency-overview-card="photo-smart"]').waitFor()
    record(width + ': genuine shared overview renders all 11 fixed services',
      await page.locator('[data-xdrive-system-dependency-overview-card]').count() === 11)
    record(width + ': five exclusive status metric filters',
      await page.locator('[data-xdrive-system-dependencies-filter]').count() === 5)
    record(width + ': overview has no document horizontal overflow', await noOverflow(page))
    await screenshot(page, 'overview-' + width)
    if (width === 320) {
      const capabilityDisclosure = page.locator('[data-xdrive-system-dependencies-capability-matrix]')
      record('320: optional capability matrix stays compact and collapsed',
        await page.locator('[data-xdrive-system-dependency-capability]').count() === 0 &&
        (await capabilityDisclosure.boundingBox())?.height < 62)
      await page.getByRole('button', { name: '显示 11 项配置能力' }).click()
      record('320: existing matrix expands all eleven service capabilities',
        await page.locator('[data-xdrive-system-dependency-capability]').count() === 11)
      await page.getByRole('button', { name: '隐藏配置能力' }).click()
      record('320: capability disclosure closes without changing the service list',
        await page.locator('[data-xdrive-system-dependency-capability]').count() === 0 &&
        await page.locator('[data-xdrive-system-dependency-overview-card]').count() === 11)
      await page.locator('[data-xdrive-system-dependency-overview-card="geonames"]').click()
      await page.locator('[data-xdrive-system-dependency-detail]').waitFor()
      record('320: mobile dependency picker is visible',
        await page.getByLabel('选择系统依赖').isVisible())
      record('320: GeoNames detail does not overflow', await noOverflow(page))
      const readScope = page.locator('[data-xdrive-geonames-read-scope]')
      record('320: GeoNames technical scope is initially collapsed',
        !(await readScope.evaluate(element => element.open)))
      await screenshot(page, 'geonames-320')
      await readScope.locator('summary').click()
      record('320: full GeoNames evidence scope expands on demand',
        await readScope.evaluate(element => element.open))
      await page.getByRole('button', { name: '返回总览' }).click()
      const readBefore = await page.evaluate(() =>
        window.__xdriveSystemDependenciesFixture.readsA)
      await page.evaluate(() => { window.__xdriveSystemDependenciesFixture.failNext = true })
      await page.getByRole('button', { name: '刷新状态' }).click()
      await page.locator('[data-xdrive-system-dependencies-refresh-error]').waitFor()
      record('320: failed read preserves last 11-service snapshot',
        await page.locator('[data-xdrive-system-dependency-overview-card]').count() === 11)
      record('320: error redacts synthetic underlying exception',
        !(await page.locator('body').innerText()).includes('SYNTHETIC_SECRET_MUST_NEVER_RENDER'))
      record('320: read-only refresh actually reached the fixture',
        await page.evaluate(() => window.__xdriveSystemDependenciesFixture.readsA) > readBefore)
      await screenshot(page, 'refresh-failed-320')
    } else if (width === 390) {
      await page.locator('[data-xdrive-system-dependency-overview-card="photo-smart"]').click()
      await page.locator('[data-xdrive-ocr-dependency-status]').waitFor()
      await screenshot(page, 'ocr-status-before-probe-390')
      record('390: OCR reports an unready runner rather than a false enabled state',
        (await page.locator('[data-xdrive-ocr-auto-state]').innerText()).includes('当前无法运行'))
      const hostProbe = page.getByRole('button', { name: '检测宿主与模型（只读）' })
      await hostProbe.waitFor()
      record('390: true host/model read-only action mounts after actual config read',
        await hostProbe.count() === 1 && await hostProbe.isEnabled())
      await hostProbe.click()
      await page.locator('[data-xdrive-photo-smart-ocr-fixture-state]').waitFor()
      record('390: model preflight calls only the synthetic readonly fixture',
        await page.evaluate(() => window.__xdriveSystemDependenciesFixture.hostChecks) === 1)
      record('390: model probe result never claims OCR verified',
        (await page.locator('[data-xdrive-photo-smart-ocr-fixture-state]').innerText())
          .includes('未验证'))
      record('390: removed pseudo-OCR probe does not recur',
        await page.getByRole('button', { name: '检测 OCR 模型' }).count() === 0)
      record('390: OCR detail fits the narrow document', await noOverflow(page))
      await screenshot(page, 'ocr-detail-390')
      await page.getByRole('button', { name: '返回总览' }).click()
      await page.getByRole('button', { name: /全局分析策略（独立管理/ }).click()
      const policySwitch = page.getByLabel('自动安排照片智能分析')
      await policySwitch.waitFor()
      record('390: saved policy initially enabled', await policySwitch.isChecked())
      await policySwitch.uncheck()
      record('390: policy changed via the accessible control', !(await policySwitch.isChecked()))
      const policySave = page.getByRole('button', { name: '保存并应用到当前实例' })
      record('390: modified auto policy exposes pending Save without submitting it',
        await policySave.isEnabled())
      await page.getByRole('button', { name: '返回总览' }).click()
      // Capture the real UI even if the dialog cannot be found, rather than
      // treating a particular MUI accessible-name implementation as the truth.
      await screenshot(page, 'unsaved-leave-attempt-390')
      const pendingDialog = page.getByRole('dialog').filter({
        hasText: '离开未保存的系统依赖配置？',
      })
      await pendingDialog.waitFor()
      record('390: unsaved policy edits have the correct, visible confirmation title',
        await pendingDialog.getByText('离开未保存的系统依赖配置？').isVisible())
      await screenshot(page, 'unsaved-confirm-390')
      await pendingDialog.getByRole('button', { name: '放弃修改并切换' }).click()
      await page.locator('[data-xdrive-system-dependencies-overview]').waitFor()
      record('390: explicit discard returns to overview', await noOverflow(page))
    } else {
      await page.locator('[data-xdrive-system-dependency-overview-card="database"]').click()
      await page.locator('[data-xdrive-system-dependency-detail]').waitFor()
      record('desktop: local service navigation is visible',
        await page.locator('nav[aria-label="系统依赖页内导航"]').isVisible())
      record('desktop: database detail fits the document', await noOverflow(page))
      await screenshot(page, 'database-1280')
      await page.evaluate(() => { window.__xdriveSystemDependenciesFixture.swapServer() })
      await page.waitForFunction(() =>
        !document.body.textContent.includes('PostgreSQL A'))
      record('desktop: switch to unresolved Server cannot paint previous Server state',
        !(await page.locator('body').innerText()).includes('PostgreSQL A'))
      await page.waitForFunction(() => window.__xdriveSystemDependenciesFixture.readsB > 0)
      await page.evaluate(() => { window.__xdriveSystemDependenciesFixture.releaseB() })
      await page.locator('[data-xdrive-system-dependency-unreported]').waitFor()
      record('desktop: missing new Server status stays explicitly unreported',
        (await page.locator('[data-xdrive-system-dependency-unreported]').innerText())
          .includes('状态未报告'))
    }
    summary.widths.push(width)
  } finally {
    await context.close()
  }
}
async function main() {
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'system-dependencies-real-chromium.tsx')],
    outfile: path.join(tempDir, 'bundle.js'),
    nodePaths: [path.join(root, 'desktop/node_modules')],
    define: { 'process.env.NODE_ENV': '"production"' },
    bundle: true, jsx: 'automatic', logLevel: 'silent',
  })
  const bundle = fs.readFileSync(path.join(tempDir, 'bundle.js'))
  server = http.createServer((req, res) => {
    const route = new URL(req.url || '/', 'http://127.0.0.1').pathname
    if (req.method !== 'GET') return serve(res, 405, 'text/plain', 'read-only fixture')
    if (route === '/') return serve(res, 200, 'text/html; charset=utf-8', html)
    if (route === '/bundle.js') return serve(res, 200, 'text/javascript', bundle)
    return serve(res, 404, 'text/plain', 'not found')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const exe = process.env.XDRIVE_BROWSER_EXECUTABLE
  assert(exe && fs.existsSync(exe), 'real Chromium executable required')
  browser = await chromium.launch({ executablePath: exe, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'] })
  summary.realChromium = true
  summary.browserVersion = browser.version()
  for (const width of [320, 390, 1280]) {
    await checkWidth(width, server.address().port)
  }
  record('all browser requests are limited to the loopback fixture', summary.externalRequests === 0)
  record('real React/MUI mounts without page exceptions', summary.pageErrors.length === 0)
  summary.mountedSharedMUI = true
  summary.passed = true
}
main().catch(error => {
  summary.error = String(error && error.message || error).slice(0,500)
  process.exitCode = 1
}).finally(async () => {
  if (browser) await browser.close()
  if (server) await new Promise(resolve => server.close(resolve))
  fs.writeFileSync(path.join(resultDir,'summary.json'), JSON.stringify(summary,null,2) + '\n')
  console.log(JSON.stringify({
    sourceCommit: summary.sourceCommit, passed: summary.passed,
    widths: summary.widths, checks: summary.checks.length, error: summary.error,
  }))
  fs.rmSync(tempDir, { recursive:true, force:true })
})

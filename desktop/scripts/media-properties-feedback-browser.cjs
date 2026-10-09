const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { createRequire } = require('node:module')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const argument = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback
const repo = path.resolve(argument('source-root', process.env.XDRIVE_FILE_EXPLORER_SOURCE_ROOT || path.join(__dirname, '../..')))
const out = path.resolve(argument('output-dir', path.join(require('node:os').tmpdir(), 'xdrive-media-properties-feedback')))
const selectedCase = argument('case', 'all')
if (!['all', 'baseline', 'short'].includes(selectedCase)) throw new Error('case must be all, baseline, or short')
const requireRepo = createRequire(path.join(repo, 'desktop/package.json'))
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const fixture = path.join(__dirname, 'media-properties-gallery-browser.tsx')
const files = [
  'ui/shared/src/mui/MediaGalleryDetails.tsx', 'ui/shared/src/mui/MediaGalleryInspector.tsx',
  'ui/shared/src/mui/MediaGallery.tsx', 'ui/shared/src/mui/StatusAlert.tsx',
  'ui/shared/src/mui/theme.ts', 'desktop/scripts/media-properties-gallery-browser.tsx',
  'desktop/scripts/media-properties-fixtures.cjs',
]
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
async function main() {
  fs.mkdirSync(out, { recursive: true })
  const results = {
    startedAt: new Date().toISOString(),
    sourceRoot: repo,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    sourceHashes: Object.fromEntries(files.map(file => [file, hash(path.join(repo, file))])),
    fixtureHashes: { cjs: hash(__filename), tsx: hash(fixture), goldens: hash(path.join(__dirname, 'media-properties-fixtures.cjs')) },
    selectedCase,
    probeHash: hash(__filename),
    boundary: 'Unchanged M09 actual Gallery -> Inspector -> shared Details fixture; only its existing mutation transport is held/settled. Trusted touch or mouse enters Properties and saves. This is shared renderer/callback acceptance, not Server persistence or native certification.',
    acceptance: [
      'Compact Save targets have at least 44px actual width and height after scrolling into view.',
      'While a transport is held, its editor visibly reports saving (text, accessible status, progress, or aria-busy), rather than only disabling unchanged controls.',
      'A successful save visibly acknowledges completion; error feedback preserves the draft and allows retry.',
    ],
    checks: [], observations: [], errors: [],
  }
  await requireRepo('esbuild').build({
    entryPoints: [fixture], bundle: true, outfile: path.join(out, 'bundle.js'), jsx: 'automatic',
    nodePaths: [path.join(repo, 'desktop/node_modules')],
    alias: { '@probe/gallery': path.join(repo, 'ui/shared/src/mui/MediaGallery.tsx'), '@probe/theme': path.join(repo, 'ui/shared/src/mui/AppearanceThemeProvider.tsx') },
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
  })
  results.bundleHash = hash(path.join(out, 'bundle.js'))
  const server = http.createServer((request, response) => {
    const route = new URL(request.url, 'http://localhost').pathname
    if (route === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript'); response.end(fs.readFileSync(path.join(out, 'bundle.js')))
    } else if (route === '/') {
      response.setHeader('Content-Type', 'text/html')
      response.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;min-height:100%}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>')
    } else if (route === '/favicon.ico') { response.writeHead(204); response.end() }
    else { results.errors.push({ kind: 'unknown-request', url: request.url }); response.writeHead(404); response.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  const check = (name, passed, actual) => results.checks.push({ name, passed, actual })
  try {
    for (const config of selectedCase === 'short' ? [] : [{ width: 390, height: 844, touch: true }, { width: 700, height: 844, touch: false }]) {
      const browser = await chromium.launch({ headless: true, executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || '/tmp/chromium', args: JSON.parse(process.env.XDRIVE_BROWSER_ARGS || '["--no-sandbox","--single-process","--no-zygote"]') })
      results.browserVersion = browser.version()
      try {
        const page = await browser.newPage({ viewport: { width: config.width, height: config.height }, hasTouch: config.touch, isMobile: config.touch, timezoneId: 'UTC' })
        page.setDefaultTimeout(5000)
        page.on('pageerror', error => results.errors.push({ kind: 'page', message: error.message }))
        page.on('console', message => { if (message.type() === 'error') results.errors.push({ kind: 'console', message: message.text() }) })
        page.on('requestfailed', request => results.errors.push({ kind: 'request', url: request.url(), message: request.failure()?.errorText }))
        await page.goto(url)
        const tile = page.locator('[data-xdrive-media-tile][data-xdrive-media-index="0"]')
        await tile.waitFor()
        if (config.touch) await tile.getByRole('button', { name: '查看属性', exact: true }).tap()
        else {
          await tile.click({ button: 'right' })
          await page.getByRole('menuitem', { name: '属性', exact: true }).click()
          await page.locator('[data-xdrive-gallery-media-context-menu]').waitFor({ state: 'hidden' })
        }
        const panel = page.locator('[data-xdrive-media-details-drawer] .MuiDrawer-paper')
        await panel.getByText('Item-101.jpg', { exact: true }).first().waitFor()
        check(`${config.width}: actual Gallery opens current Properties`, await panel.count() === 1, { name: await panel.getByText('Item-101.jpg', { exact: true }).first().textContent(), touch: config.touch })
        for (const [field, label, saveName] of [['tags', '标签', '保存标签'], ['people', '人物', '保存人物'], ['description', '描述', '保存描述']]) {
          const input = panel.getByRole('textbox', { name: label, exact: true })
          const save = panel.getByRole('button', { name: saveName, exact: true })
          await input.fill(`${field}-current-draft`)
          await save.scrollIntoViewIfNeeded()
          const geometry = await save.evaluate(element => {
            const rect = element.getBoundingClientRect()
            let left = Math.max(rect.left, 0), right = Math.min(rect.right, innerWidth)
            let top = Math.max(rect.top, 0), bottom = Math.min(rect.bottom, innerHeight)
            for (let parent = element.parentElement; parent; parent = parent.parentElement) {
              const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect()
              if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right) }
              if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom) }
              // A viewport-fixed Drawer does not inherit the background body's short layout box.
              if (style.position === 'fixed') break
            }
            const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
            return { width: rect.width, height: rect.height, visibleWidth: right - left, visibleHeight: bottom - top, receivesPoint: hit === element || element.contains(hit) }
          })
          check(`${config.width}: ${field} Save actual target is 44px`, geometry.width >= 43.9 && geometry.height >= 43.9 && geometry.visibleWidth >= 43.9 && geometry.visibleHeight >= 43.9 && geometry.receivesPoint, geometry)
          if (!config.touch) continue
          await save.tap()
          await page.waitForFunction(() => Boolean(window.galleryPropertiesProbe.pending))
          const snapshot = async () => ({
            text: await panel.innerText(), buttonText: await save.innerText(), disabled: await save.isDisabled(), inputDisabled: await input.isDisabled(),
            statuses: await panel.locator('[role="status"], [role="progressbar"], [aria-live], [aria-busy="true"]').allTextContents(),
            requests: await page.evaluate(() => window.galleryPropertiesProbe.requests),
          })
          const pending = await snapshot()
          check(`${config.width}: ${field} pending keeps exactly one current-target request`, pending.disabled && pending.inputDisabled && pending.requests.at(-1)?.field === field && pending.requests.at(-1)?.id === 101 && pending.requests.filter(request => request.field === field).length === 1, pending.requests)
          check(`${config.width}: ${field} pending visibly reports saving`, /正在保存|保存中|提交中|正在提交/.test(pending.text) || pending.statuses.length > 0, { buttonText: pending.buttonText, statuses: pending.statuses, disabled: pending.disabled })
          if (field === 'description') {
            await page.screenshot({ path: path.join(out, '390-description-pending.png'), fullPage: true })
            await page.evaluate(() => window.galleryPropertiesProbe.settle('error'))
            await panel.getByRole('alert').filter({ hasText: 'A-save-failed' }).waitFor()
            const failed = { draft: await input.inputValue(), disabled: await save.isDisabled(), error: await panel.getByRole('alert').innerText() }
            check('390: rejected description preserves its draft and exposes retryable error', failed.draft === 'description-current-draft' && !failed.disabled && failed.error.includes('A-save-failed'), failed)
            await save.tap()
            await page.waitForFunction(() => Boolean(window.galleryPropertiesProbe.pending))
          }
          await page.evaluate(() => window.galleryPropertiesProbe.settle('success'))
          await page.waitForFunction(label => {
            const input = [...document.querySelectorAll('input,textarea')].find(input => [...(input.labels || [])].some(node => node.textContent.startsWith(label)))
            return input && !input.disabled && input.value === 'A-normalized'
          }, label)
          const done = await snapshot()
          check(`${config.width}: ${field} successful normalized value is retained`, await input.inputValue() === 'A-normalized' && !done.disabled, { value: await input.inputValue(), disabled: done.disabled })
          check(`${config.width}: ${field} success visibly acknowledges completion`, /已保存|保存成功|更新成功|已更新/.test(done.text), { buttonText: done.buttonText, statuses: done.statuses })
          results.observations.push({ width: config.width, field, geometry, pending, done })
          if (field === 'description') await page.screenshot({ path: path.join(out, '390-description-saved.png'), fullPage: true })
        }
        await page.screenshot({ path: path.join(out, `${config.width}-properties-editing.png`), fullPage: true })
      } catch (error) { results.errors.push({ kind: 'scenario', width: config.width, message: String(error) }) }
      finally { await browser.close() }
    }
    if (selectedCase !== 'baseline') {
      for (const config of [{ width: 900, height: 844, touch: false }, { width: 844, height: 390, touch: true }]) {
        const browser = await chromium.launch({ headless: true, executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || '/tmp/chromium', args: JSON.parse(process.env.XDRIVE_BROWSER_ARGS || '["--no-sandbox","--single-process","--no-zygote"]') })
        try {
          const page = await browser.newPage({ viewport: { width: config.width, height: 844 }, hasTouch: config.touch, isMobile: config.touch, timezoneId: 'UTC' })
          page.setDefaultTimeout(5000)
          page.on('pageerror', error => results.errors.push({ kind: 'page', message: error.message }))
          page.on('console', message => { if (message.type() === 'error') results.errors.push({ kind: 'console', message: message.text() }) })
          page.on('requestfailed', request => results.errors.push({ kind: 'request', url: request.url(), message: request.failure()?.errorText }))
          await page.goto(url)
          const tile = page.locator('[data-xdrive-media-tile][data-xdrive-media-index="0"]')
          if (config.touch) await tile.getByRole('button', { name: '查看属性', exact: true }).tap()
          else {
            await tile.click({ button: 'right' })
            await page.getByRole('menuitem', { name: '属性', exact: true }).click()
            await page.locator('[data-xdrive-gallery-media-context-menu]').waitFor({ state: 'hidden' })
          }
          const panel = page.locator('[data-xdrive-media-details-drawer] .MuiDrawer-paper, [data-xdrive-media-inspector]')
          await panel.getByText('Item-101.jpg', { exact: true }).first().waitFor()
          const input = panel.getByRole('textbox', { name: '描述', exact: true })
          const save = panel.getByRole('button', { name: '保存描述', exact: true })
          const geometry = async locator => locator.evaluate(element => {
            const rect = element.getBoundingClientRect()
            let left = Math.max(rect.left, 0), right = Math.min(rect.right, innerWidth)
            let top = Math.max(rect.top, 0), bottom = Math.min(rect.bottom, innerHeight)
            for (let parent = element.parentElement; parent; parent = parent.parentElement) {
              const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect()
              if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right) }
              if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom) }
              if (style.position === 'fixed') break
            }
            const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, visibleWidth: Math.max(0, right - left), visibleHeight: Math.max(0, bottom - top), receivesPoint: hit === element || element.contains(hit) }
          })
          if (!config.touch) {
            await save.scrollIntoViewIfNeeded()
            const bounds = await geometry(save)
            check('900: desktop Description Save keeps existing density', Math.abs(bounds.height - 36.5) < 0.5 && bounds.receivesPoint, bounds)
            continue
          }
          await page.setViewportSize({ width: config.width, height: config.height })
          await page.evaluate(() => { document.documentElement.style.fontSize = '32px' })
          const scrollHost = panel.locator(':scope > .MuiBox-root').last()
          const wheel = []
          const reveal = async locator => {
            for (let count = 0; count < 8; count += 1) {
              const bounds = await geometry(locator)
              if (bounds.visibleHeight >= bounds.height - 0.5 && bounds.visibleWidth >= bounds.width - 0.5) return bounds
              const host = await scrollHost.boundingBox()
              const before = await scrollHost.evaluate(element => element.scrollTop)
              const delta = bounds.y < host.y ? -64 : 64
              await page.mouse.move(host.x + host.width - 14, host.y + host.height / 2)
              await page.mouse.wheel(0, delta)
              await page.waitForTimeout(80)
              wheel.push({ before, after: await scrollHost.evaluate(element => element.scrollTop), delta })
            }
            return geometry(locator)
          }
          await input.fill('Large text local draft')
          await save.scrollIntoViewIfNeeded()
          const saveBounds = await geometry(save)
          check('844x390 text200: Save remains a fully reachable 44px target', saveBounds.width >= 43.9 && saveBounds.height >= 43.9 && saveBounds.visibleWidth >= 43.9 && saveBounds.visibleHeight >= 43.9 && saveBounds.receivesPoint, saveBounds)
          await save.tap()
          await page.waitForFunction(() => Boolean(window.galleryPropertiesProbe.pending))
          const saving = panel.getByRole('status').filter({ hasText: '正在保存描述' })
          await saving.waitFor()
          // Move away through real user scrolling before checking the return path.
          // Save activation can already leave this short status line fully visible.
          const hostBounds = await scrollHost.boundingBox()
          const beforeWheel = await scrollHost.evaluate(element => element.scrollTop)
          await page.mouse.move(hostBounds.x + hostBounds.width - 14, hostBounds.y + hostBounds.height / 2)
          await page.mouse.wheel(0, -192)
          await page.waitForTimeout(80)
          wheel.push({ before: beforeWheel, after: await scrollHost.evaluate(element => element.scrollTop), delta: -192 })
          const savingBounds = await reveal(saving)
          check('844x390 text200: user wheel reveals nonempty polite saving feedback', savingBounds.visibleHeight >= savingBounds.height - 0.5 && savingBounds.visibleWidth >= savingBounds.width - 0.5 && await saving.getAttribute('aria-live') === 'polite' && wheel.some(event => event.before !== event.after), { bounds: savingBounds, text: await saving.innerText(), live: await saving.getAttribute('aria-live'), wheel: structuredClone(wheel) })
          await page.evaluate(() => window.galleryPropertiesProbe.settle('success'))
          const saved = panel.getByRole('status').filter({ hasText: '描述已保存' })
          await saved.waitFor()
          const savedBounds = await reveal(saved)
          check('844x390 text200: accepted normalized value and saved feedback remain readable', await input.inputValue() === 'A-normalized' && savedBounds.visibleHeight >= savedBounds.height - 0.5 && savedBounds.visibleWidth >= savedBounds.width - 0.5, { bounds: savedBounds, text: await saved.innerText(), value: await input.inputValue() })
          await input.fill('Next large text draft')
          const edited = panel.getByRole('status').filter({ hasText: '描述有未保存的更改' })
          await edited.waitFor()
          const editedBounds = await reveal(edited)
          const requests = await page.evaluate(() => window.galleryPropertiesProbe.requests)
          check('844x390 text200: next edit replaces saved feedback without another request', editedBounds.visibleHeight >= editedBounds.height - 0.5 && editedBounds.visibleWidth >= editedBounds.width - 0.5 && await saved.count() === 0 && requests.length === 1, { bounds: editedBounds, text: await edited.innerText(), requests })
          const close = panel.getByRole('button', { name: '关闭属性', exact: true })
          const closeBounds = await geometry(close)
          check('844x390 text200: existing Close remains visible and 44px', closeBounds.width >= 43.9 && closeBounds.height >= 43.9 && closeBounds.visibleWidth >= 43.9 && closeBounds.visibleHeight >= 43.9 && closeBounds.receivesPoint, closeBounds)
          results.observations.push({ kind: 'short-text200', viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, rootText: getComputedStyle(document.documentElement).fontSize })), saveBounds, savingBounds, savedBounds, editedBounds, closeBounds, wheel })
          await page.screenshot({ path: path.join(out, '844x390-text200-feedback.png'), fullPage: true })
          await close.tap()
          await panel.waitFor({ state: 'hidden' })
          check('844x390 text200: existing native Close exits Properties', await panel.count() === 0, { panelCount: await panel.count() })
        } catch (error) { results.errors.push({ kind: 'scenario', width: config.width, message: String(error) }) }
        finally { await browser.close() }
      }
    }
  } finally {
    await new Promise(resolve => server.close(resolve))
    results.finishedAt = new Date().toISOString()
    results.passed = results.checks.filter(check => check.passed).length
    results.failed = results.checks.filter(check => !check.passed).length
    results.sourceHashMatch = files.every(file => results.sourceHashes[file] === hash(path.join(repo, file)))
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n')
    process.stdout.write(JSON.stringify({ output: out, passed: results.passed, failed: results.failed, errors: results.errors, sourceHashMatch: results.sourceHashMatch }, null, 2) + '\n')
    if (results.failed || results.errors.length || !results.sourceHashMatch) process.exitCode = 1
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { createRequire } = require('node:module')
const { createHash } = require('node:crypto')
const { isDeepStrictEqual } = require('node:util')
const { execFileSync } = require('node:child_process')
const goldens = require('./media-properties-fixtures.cjs')
const argument = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback
const repo = path.resolve(argument('source-root', process.env.XDRIVE_FILE_EXPLORER_SOURCE_ROOT || path.join(__dirname, '../..')))
const out = path.resolve(argument('output-dir', path.join(require('node:os').tmpdir(), 'xdrive-media-properties-gallery')))
const requireRepo = createRequire(path.join(repo, 'desktop/package.json'))
const esbuild = requireRepo('esbuild')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const sourceFiles = ['MediaGallery.tsx', 'MediaGalleryDetails.tsx', 'MediaGalleryInspector.tsx', 'MediaGalleryViewer.tsx', 'AppearanceThemeProvider.tsx', 'FilePreviewImage.tsx', 'FilePreviewSurface.tsx']
const fixture = path.join(__dirname, 'media-properties-gallery-browser.tsx')
async function main() {
  fs.mkdirSync(out, { recursive: true })
  const results = {
    startedAt: new Date().toISOString(), sourceRoot: repo,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    sourceHashes: Object.fromEntries(sourceFiles.map(file => [file, hash(path.join(repo, 'ui/shared/src/mui', file))])),
    fixtureHashes: { cjs: hash(__filename), tsx: hash(fixture), goldens: hash(path.join(__dirname, 'media-properties-fixtures.cjs')) },
    boundary: 'Real Gallery tile context menu -> nonmodal Inspector -> shared Details; only mutation/thumbnail transport is controlled. No Server writes.',
    viewport: { width: 1440, height: 1000 }, timeZone: 'UTC', checks: [], errors: [], observations: [], parity: {},
  }
  await esbuild.build({
    entryPoints: [fixture], bundle: true, outfile: path.join(out, 'bundle.js'), jsx: 'automatic',
    nodePaths: [path.join(repo, 'desktop/node_modules')],
    alias: { '@probe/gallery': path.join(repo, 'ui/shared/src/mui/MediaGallery.tsx'), '@probe/theme': path.join(repo, 'ui/shared/src/mui/AppearanceThemeProvider.tsx') },
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
  })
  results.bundleHash = hash(path.join(out, 'bundle.js'))
  const server = http.createServer((request, response) => {
    if (new URL(request.url, 'http://localhost').pathname === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript'); response.end(fs.readFileSync(path.join(out, 'bundle.js')))
    } else {
      response.setHeader('Content-Type', 'text/html')
      response.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;min-height:100%}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || '/tmp/chromium',
    args: JSON.parse(process.env.XDRIVE_BROWSER_ARGS || '["--no-sandbox","--single-process","--no-zygote"]'),
  })
  results.browserVersion = browser.version()
  const check = (name, passed, actual) => results.checks.push({ name, passed, actual })
  try {
    const page = await browser.newPage({ viewport: results.viewport, timezoneId: results.timeZone })
    page.on('pageerror', error => results.errors.push({ kind: 'page', message: error.message }))
    page.on('console', message => { if (message.type() === 'error') results.errors.push({ kind: 'console', message: message.text() }) })
    page.on('requestfailed', request => results.errors.push({ kind: 'request', url: request.url(), message: request.failure()?.errorText }))
    const url = `http://127.0.0.1:${server.address().port}`
    const inspector = page.locator('[data-xdrive-media-inspector]')
    async function openProperties(index, id, name = `Item-${id}.jpg`) {
      const tile = page.locator(`[data-xdrive-media-tile][data-xdrive-media-index="${index}"]`)
      await tile.waitFor()
      await tile.click({ button: 'right' })
      await page.getByRole('menuitem', { name: '属性', exact: true }).click()
      await page.locator('[data-xdrive-gallery-media-context-menu]').waitFor({ state: 'hidden' })
      await inspector.getByText(name, { exact: true }).first().waitFor()
    }
    async function settle(mode) {
      await page.evaluate(async mode => {
        window.galleryPropertiesProbe.settle(mode)
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      }, mode)
    }
    for (const [field, label, button, mode] of [
      ['tags', '标签', '保存标签', 'success'], ['people', '人物', '保存人物', 'success'],
      ['description', '描述', '保存描述', 'success'], ['description', '描述', '保存描述', 'error'],
    ]) {
      const key = `${field}-${mode}`
      try {
        await page.goto(url)
        await openProperties(0, 101)
        const input = inspector.getByRole('textbox', { name: label, exact: true })
        await input.click()
        await input.fill('A-draft')
        const originalInput = await input.elementHandle()
        await inspector.getByRole('button', { name: button, exact: true }).click()
        await page.waitForFunction(() => Boolean(window.galleryPropertiesProbe.pending))
        const requests = await page.evaluate(() => window.galleryPropertiesProbe.requests)
        check(`${key}: real A save targets A only`, requests.length === 1 && requests[0].id === 101 && requests[0].field === field, requests)
        await openProperties(1, 202)
        await page.waitForFunction(label => {
          const panel = document.querySelector('[data-xdrive-media-inspector]')
          return Array.from(panel.querySelectorAll('input,textarea')).some(input => input.labels && Array.from(input.labels).some(labelNode => labelNode.textContent.startsWith(label)) && !input.disabled && input.value.startsWith('B-'))
        }, label)
        const sameMountedInput = await input.evaluate((current, original) => current === original, originalInput)
        await input.click()
        await input.fill('B-unsaved-draft')
        check(`${key}: actual Gallery B Properties is editable while A is pending`, await input.inputValue() === 'B-unsaved-draft' && await inspector.count() === 1, { sameMountedInput, header: await inspector.getByText('Item-202.jpg', { exact: true }).first().textContent() })
        await settle(mode)
        const actualValue = await input.inputValue()
        const staleErrorCount = await inspector.getByText('A-save-failed', { exact: true }).count()
        const currentName = await inspector.getByText('Item-202.jpg', { exact: true }).first().textContent()
        const currentRequests = await page.evaluate(() => window.galleryPropertiesProbe.requests)
        const observed = { field, mode, sameMountedInput, actualValue, expectedValue: 'B-unsaved-draft', staleErrorCount, currentName, requests: currentRequests }
        results.observations.push(observed)
        check(`${key}: late A completion cannot change B editor or feedback`, actualValue === 'B-unsaved-draft' && staleErrorCount === 0 && currentName === 'Item-202.jpg' && currentRequests.length === 1, observed)
        await page.screenshot({ path: path.join(out, `${key}.png`), fullPage: true })
      } catch (error) {
        results.errors.push({ kind: 'scenario', key, message: String(error) })
        await page.screenshot({ path: path.join(out, `${key}-scenario-error.png`), fullPage: true }).catch(() => {})
      }
    }
    await page.goto(url)
    await openProperties(0, 101)
    const controlInput = inspector.getByRole('textbox', { name: '描述', exact: true })
    await controlInput.fill('A-control')
    await inspector.getByRole('button', { name: '保存描述', exact: true }).click()
    await page.waitForFunction(() => Boolean(window.galleryPropertiesProbe.pending))
    await settle('success')
    check('control: an unchanged A accepts its normalized save', await controlInput.inputValue() === 'A-normalized', { value: await controlInput.inputValue(), requests: await page.evaluate(() => window.galleryPropertiesProbe.requests) })
    const renderedRows = locator => locator.evaluate(section => [...section.querySelectorAll('div')]
      .filter(element => element.children.length === 2 && [...element.children].every(child => child.classList.contains('MuiTypography-root')))
      .map(element => [...element.children].map(child => child.textContent)))
    for (const kind of ['still', 'video', 'live']) {
      try {
        const item = goldens.items[kind]
        const expected = goldens.expected[kind]
        await page.goto(`${url}?golden=${kind}`)
        await openProperties(0, item.node.id, item.node.name)
        const fileSection = inspector.locator('[data-xdrive-media-details-file-resources]')
        await fileSection.waitFor()
        const info = await renderedRows(inspector.locator('[data-xdrive-media-details-info]'))
        const allFiles = await renderedRows(fileSection)
        const files = allFiles.slice(0, expected.files.length)
        const resources = allFiles.slice(expected.files.length)
        results.parity[kind] = { nodeID: item.node.id, revision: item.node.revision, info, files, resources }
        for (const field of ['info', 'files', 'resources']) {
          check(`${kind}: shared golden canonical ${field} and order`, isDeepStrictEqual(results.parity[kind][field], expected[field]), { actual: results.parity[kind][field], expected: expected[field] })
        }
        await fileSection.scrollIntoViewIfNeeded()
        await page.screenshot({ path: path.join(out, `golden-${kind}.png`), fullPage: true })
      } catch (error) {
        results.errors.push({ kind: 'scenario', key: `golden-${kind}`, message: String(error) })
        await page.screenshot({ path: path.join(out, `golden-${kind}-scenario-error.png`), fullPage: true }).catch(() => {})
      }
    }
    try {
      await page.goto(`${url}?raw-revision`)
      await page.locator('[data-xdrive-media-tile]').first().waitFor({ timeout: 5000 })
      await page.getByRole('button', { name: '所有照片', exact: true }).click()
      await openProperties(0, 101, 'Revision-source.dng')
      await page.waitForFunction(() => window.galleryPropertiesProbe.previewRequests.length > 0, null, { timeout: 5000 })
      const originalInput = await inspector.getByRole('textbox', { name: '描述', exact: true }).elementHandle()
      const initial = await page.evaluate(() => ({ ranges: window.galleryPropertiesProbe.rangeRequests, previews: window.galleryPropertiesProbe.previewRequests }))
      check('RAW Properties: initial selected revision7 reaches its preview loader', initial.previews.at(-1)?.revision === 7, initial)
      await page.evaluate(() => window.galleryPropertiesProbe.advancePreviewRevision())
      await page.getByRole('button', { name: '刷新图库', exact: true }).click()
      await page.waitForFunction(() => window.galleryPropertiesProbe.rangeRequests.some(request => request.revision === 8), null, { timeout: 5000 })
      await openProperties(0, 101, 'Revision-source.dng')
      await inspector.getByText('200 × 100', { exact: true }).waitFor({ timeout: 5000 })
      await page.waitForFunction(count => window.galleryPropertiesProbe.previewRequests.length > count, initial.previews.length, { timeout: 5000 })
      const sameMountedInput = await inspector.getByRole('textbox', { name: '描述', exact: true }).evaluate((current, original) => current === original, originalInput)
      const observed = await page.evaluate(() => ({ ranges: window.galleryPropertiesProbe.rangeRequests, previews: window.galleryPropertiesProbe.previewRequests }))
      results.previewRevision = { sameMountedInput, ...observed }
      check('RAW Properties: real Refresh reaches same mounted Node/name with revision8 metadata', sameMountedInput && observed.ranges.at(-1)?.revision === 8 && await inspector.getByText('200 × 100', { exact: true }).count() === 1, results.previewRevision)
      const current = observed.previews.at(-1)
      check('RAW Properties: refreshed same-Node preview uses the current revision8', current?.nodeID === 101 && current?.fileName === 'Revision-source.dng' && current?.revision === 8, observed.previews)
      await page.screenshot({ path: path.join(out, 'raw-revision-refresh.png'), fullPage: true })
    } catch (error) {
      results.errors.push({ kind: 'scenario', key: 'raw-revision', message: String(error) })
      await page.screenshot({ path: path.join(out, 'raw-revision-scenario-error.png'), fullPage: true }).catch(() => {})
    }
  } finally {
    await browser.close()
    await new Promise(resolve => server.close(resolve))
    results.finishedAt = new Date().toISOString()
    results.passed = results.checks.filter(value => value.passed).length
    results.failed = results.checks.filter(value => !value.passed).length
    results.sourceHashMatch = sourceFiles.every(file => results.sourceHashes[file] === hash(path.join(repo, 'ui/shared/src/mui', file)))
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n')
    process.stdout.write(JSON.stringify({ output: out, passed: results.passed, failed: results.failed, errors: results.errors, sourceHashMatch: results.sourceHashMatch, observations: results.observations }, null, 2) + '\n')
    if (results.failed || results.errors.length || !results.sourceHashMatch) process.exitCode = 1
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

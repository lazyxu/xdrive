#!/usr/bin/env node
// Real Files media Properties acceptance, with shared canonical MediaItem goldens.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { createRequire } = require('node:module')
const repoRoot = path.resolve(__dirname, '../..')
const options = {}
for (const argument of process.argv.slice(2)) {
  const match = /^--(source-root|output-dir)=(.+)$/.exec(argument)
  if (!match) throw new Error(`Unknown argument: ${argument}`)
  options[match[1]] = match[2]
}
if (!options['output-dir']) throw new Error('Supply --output-dir=/path for evidence.')
const repo = path.resolve(options['source-root'] || repoRoot)
const output = path.resolve(options['output-dir'])
const dependencies = createRequire(path.join(repoRoot, 'desktop/package.json'))
const { build } = dependencies('esbuild')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright')
const goldens = require('./media-properties-fixtures.cjs')
const result = { checks: [], errors: [], samples: {}, parity: {}, sourceRoot: repo, limitations: ['Controlled platform responses; no DB-backed on-demand indexing or physical/native device run.'] }
const check = (name, actual, expected = true) => {
  try { assert.deepEqual(actual, expected); result.checks.push({ name, passed: true }) }
  catch { result.checks.push({ name, passed: false, actual, expected }); process.stdout.write(`FAIL ${name}: ${JSON.stringify(actual)}\n`) }
}
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
async function main() {
  fs.mkdirSync(output, { recursive: true })
  const aliases = { __FILE_EXPLORER__: 'mui/FileExplorer.tsx', __WORKSPACE__: 'mui/FileExplorerWorkspaceController.ts', __THEME__: 'mui/AppearanceThemeProvider.tsx' }
  try { result.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { result.sourceCommit = fs.existsSync(path.join(repo, 'source-revision.txt')) ? fs.readFileSync(path.join(repo, 'source-revision.txt'), 'utf8').trim() : null }
  result.sourceHashes = Object.fromEntries([...Object.values(aliases), 'mui/MediaGalleryInspector.tsx', 'mui/MediaGalleryDetails.tsx', 'mui/FileExplorerPropertiesController.ts', 'mui/FilePropertiesDialog.tsx', 'mui/FileExplorerNavigation.ts', 'mui/FileExplorerSearch.ts'].map(file => [file, hash(path.join(repo, 'ui/shared/src', file))]))
  result.fixtureHashes = Object.fromEntries(['file-explorer-media-properties-browser.cjs', 'file-explorer-media-properties-browser.tsx', 'media-properties-fixtures.cjs'].map(file => [file, hash(path.join(__dirname, file))]))
  await build({ entryPoints: [path.join(__dirname, 'file-explorer-media-properties-browser.tsx')], bundle: true, outfile: path.join(output, 'bundle.js'), jsx: 'automatic', nodePaths: [path.join(repoRoot, 'desktop/node_modules')], alias: Object.fromEntries(Object.entries(aliases).map(([key, file]) => [key, path.join(repo, 'ui/shared/src', file)])), define: { 'process.env.NODE_ENV': '"production"' } })
  result.bundleHash = hash(path.join(output, 'bundle.js'))
  const server = http.createServer((req, res) => {
    const route = new URL(req.url, 'http://localhost').pathname
    res.setHeader('Cache-Control', 'no-store')
    if (route === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script src="/bundle.js"></script></body></html>') }
    else if (route === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(output, 'bundle.js'))) }
    else if (route === '/favicon.ico') { res.statusCode = 204; res.end() }
    else { res.statusCode = 404; res.end(); result.errors.push(`Unexpected transport request ${route}`) }
  })
  let browser
  let currentPage
  const peek = page => page.evaluate(() => {
    const h = window.filesPropertiesHarness
    return { state: h.state, requests: h.requests, selected: h.selected, events: h.events, errors: h.errors, pending: [...h.pending.keys()] }
  })
  const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const modes = (page, media, stats = 'correct') => page.evaluate(([media, stats]) => window.filesPropertiesHarness.setModes(media, stats), [media, stats])
  const mediaInspector = page => page.locator('[data-xdrive-media-details-drawer], [data-xdrive-media-details-viewer-drawer]')
  const filesSection = page => page.locator('[data-xdrive-media-details-file-resources]')
  const names = { 101: 'photo-A.jpg', 202: 'photo-B.jpg', 303: 'clip.mp4', 404: 'capture.livp', 505: 'ordinary.txt', 606: 'folder' }
  const row = (page, id) => page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: names[id] })
  const close = async page => {
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[data-xdrive-media-details-file-resources]') && ![...document.querySelectorAll('[role="dialog"]')].some(el => el.getAttribute('aria-label') === '文件属性'))
    await settle(page)
  }
  const open = async (page, id, name) => {
    const more = page.getByRole('button', { name: `更多操作：${name}`, exact: true })
    if (await more.count()) await more.click()
    else await row(page, id).click({ button: 'right' })
    const action = page.getByRole('button', { name: '属性', exact: true })
    if (await action.count()) await action.click()
    else await page.getByRole('menuitem', { name: /^属性/ }).click()
    await settle(page)
  }
  const releaseAll = async (page, owner, outcome = 'correct') => page.evaluate(([owner, outcome]) => {
    const h = window.filesPropertiesHarness
    for (const [sequence, value] of [...h.pending]) if (!owner || value.entry.owner === owner) h.release(sequence, outcome)
  }, [owner, outcome])
  const field = async (page, label) => filesSection(page).getByText(label, { exact: true }).locator('..').innerText()
  const renderedRows = locator => locator.evaluate(section => [...section.querySelectorAll('div')]
    .filter(element => element.children.length === 2 && [...element.children].every(child => child.classList.contains('MuiTypography-root')))
    .map(element => [...element.children].map(child => child.textContent)))
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    browser = await chromium.launch({ headless: true, executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || undefined, args: process.env.XDRIVE_BROWSER_ARGS ? JSON.parse(process.env.XDRIVE_BROWSER_ARGS) : undefined })
    result.browserVersion = browser.version()
    const url = `http://127.0.0.1:${server.address().port}/`
    const pageFor = async (width = 390, height = 844, supported = true, golden = '') => {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 900, isMobile: width < 900, timezoneId: 'UTC', deviceScaleFactor: 1 })
      const page = await context.newPage(); page.setDefaultTimeout(3500); currentPage = page
      page.on('pageerror', error => result.errors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()) })
      await page.goto(`${url}?supported=${supported}&golden=${golden}`)
      await page.locator('[data-xdrive-file-explorer-item]').first().waitFor(); await settle(page)
      return page
    }
    const attempt = async (name, run) => {
      try { await run() }
      catch (error) { result.checks.push({ name, passed: false, error: String(error.message || error).split('\n').slice(0, 5).join('\n') }); process.stdout.write(`FAIL ${name}: ${String(error.message || error).split('\n')[0]}\n`) }
      finally {
        if (currentPage && !currentPage.isClosed()) {
          result.samples[name] = await peek(currentPage)
          result.samples[name].visibleText = await currentPage.locator('body').innerText()
          await currentPage.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' })
          await currentPage.close(); currentPage = null
        }
      }
    }
    for (const kind of ['still', 'video', 'live']) {
      await attempt(`a1-shared-golden-${kind}`, async () => {
        const item = goldens.items[kind]
        const expected = goldens.expected[kind]
        const page = await pageFor(390, 844, true, kind)
        await open(page, item.node.id, item.node.name); await filesSection(page).waitFor()
        const info = await renderedRows(page.locator('[data-xdrive-media-details-info]'))
        const files = (await renderedRows(filesSection(page))).slice(0, expected.files.length)
        const resourcesHeader = page.getByText('资产资源', { exact: true })
        const resources = await resourcesHeader.count() ? await renderedRows(resourcesHeader.locator('..')) : []
        result.parity[kind] = { nodeID: item.node.id, revision: item.node.revision, info, files, resources }
        check(`${kind}: shared golden canonical information and order`, info, expected.info)
        check(`${kind}: shared golden canonical file fields and order`, files, expected.files)
        check(`${kind}: shared golden canonical resource fields and order`, resources, expected.resources)
        const calls = (await peek(page)).requests.filter(request => request.kind === 'media')
        check(`${kind}: shared golden uses one lazy selected identity lookup`, calls.map(request => request.items.map(item => ({ id: item.id, revision: item.revision }))), [[{ id: item.node.id, revision: item.node.revision }]])
        await filesSection(page).scrollIntoViewIfNeeded()
      })
    }
    for (const [width, height] of [[390, 844], [844, 390], [1300, 900]]) {
      await attempt(`a2-context-${width}`, async () => {
        const page = await pageFor(width, height)
        check(`${width}: no canonical media or stats read before Properties`, (await peek(page)).requests.length, 0)
        await row(page, 101).click(); await settle(page)
        check(`${width}: selecting/opening a file does not eagerly read canonical media`, (await peek(page)).requests.filter(r => r.kind === 'media').length, 0)
        await open(page, 101, 'photo-A.jpg'); await filesSection(page).waitFor()
        check(`${width}: selected file ID retained`, (await field(page, 'ID')).includes('101'))
        check(`${width}: selected revision retained`, (await field(page, 'Revision')).includes('7'))
        check(`${width}: SHA retained`, (await field(page, 'SHA-256')).includes('101-authoritative-sha256'))
        check(`${width}: authoritative long path retained`, (await field(page, '位置')).includes(await page.evaluate(() => window.filesPropertiesHarness.longPath + 'photo-A.jpg')))
        check(`${width}: custom ReactNode context retained`, await filesSection(page).locator('[data-fixture-file-context]').innerText(), 'Project-Artemis-101')
        check(`${width}: source response retained`, (await field(page, '来源')).includes('session-a 相机备份 (filesystem)'))
        check(`${width}: availability retained`, (await field(page, '可用性')).includes('始终保留在此设备上'))
        const info = await page.locator('[data-xdrive-media-details-info]').innerText()
        check(`${width}: unknown capture time is honest`, info.includes('未记录'))
        check(`${width}: zero GPS survives`, info.includes('0.000000, 0.000000'))
        check(`${width}: Files media properties are read only`, await mediaInspector(page).locator('input, textarea').count(), 0)
        check(`${width}: opening Properties creates no media player`, await mediaInspector(page).locator('video, audio, canvas').count(), 0)
        check(`${width}: opening Properties requests no original or motion`, (await peek(page)).events.filter(e => ['preview', 'motion'].includes(e.type)).length, 0)
        await filesSection(page).scrollIntoViewIfNeeded()
      })
    }
    for (const [id, name] of [[303, 'clip.mp4'], [404, 'capture.livp']]) {
      await attempt(`a2-media-${id}`, async () => {
        const page = await pageFor(); await open(page, id, name); await filesSection(page).waitFor()
        check(`${name}: canonical media lookup is eligible`, (await peek(page)).requests.filter(r => r.kind === 'media').length, 1)
        check(`${name}: selected Node size is not resource sum`, (await field(page, '大小')).includes('1.2 KiB'))
        if (id === 404) { check('LIVP resource count retained', (await field(page, '资源数')).includes('2')); check('LIVP resource names rendered', (await filesSection(page).innerText()).includes('motion.mov')) }
      })
    }
    for (const [id, name, supported] of [[505, 'ordinary.txt', true], [606, 'folder', true], [101, 'photo-A.jpg', false]]) {
      await attempt(`a2-regular-${id}`, async () => {
        const page = await pageFor(390, 844, supported); await open(page, id, name)
        const dialog = page.getByRole('dialog'); await dialog.waitFor()
        check(`${name}/${supported}: no unsupported canonical media read`, (await peek(page)).requests.filter(r => r.kind === 'media').length, 0)
        check(`${name}/${supported}: file identity remains in normal Properties`, (await dialog.innerText()).includes(String(id)))
        if (id === 606) check('folder recursive statistics remain', (await dialog.innerText()).includes('12 个文件 · 3 个文件夹'))
      })
    }
    await attempt('a2-local-multiple-files', async () => {
      const page = await pageFor(1300, 900)
      await row(page, 101).click(); await row(page, 202).click({ modifiers: ['Control'] })
      check('multi-file selection is real renderer state', (await peek(page)).selected.map(Number).sort(), [101, 202])
      await open(page, 101, 'photo-A.jpg')
      const dialog = page.getByRole('dialog'); await dialog.waitFor()
      const text = await dialog.innerText()
      check('multi-file Properties retains aggregate count', text.includes('2 个文件 · 0 个文件夹'))
      check('multi-file size remains the local selected sum', text.includes('2.4 KiB'))
      check('pure multi-file Properties makes no canonical media or recursive stats request', (await peek(page)).requests.length, 0)
    })
    for (const mode of ['wrong-id', 'wrong-revision', '404', 'index-error', 'partial']) {
      await attempt(`a3-${mode}`, async () => {
        const page = await pageFor(); await modes(page, mode); await open(page, 101, 'photo-A.jpg')
        if (mode === 'partial') {
          await filesSection(page).waitFor()
          check('partial metadata remains in canonical Inspector', (await mediaInspector(page).innerText()).includes('部分媒体元数据未能解析：fixture-partial-metadata'))
          check('partial metadata retains selected file context', (await field(page, 'ID')).includes('101'))
        } else {
          const dialog = page.getByRole('dialog'); await dialog.waitFor()
          const text = await dialog.innerText()
          check(`${mode}: fallback keeps selected filename`, text.includes('photo-A.jpg'))
          check(`${mode}: rejected MediaItem never displays`, !text.includes('WRONG-'))
          check(`${mode}: fallback exposes the lookup error`, text.includes(mode === 'wrong-id' ? '未找到当前文件的媒体信息' : mode === 'wrong-revision' ? '文件版本已改变' : mode === '404' ? '404: file is not indexed media' : '媒体索引暂时失败'))
          check(`${mode}: fallback retains custom file context`, text.includes('Project-Artemis-101'))
          check(`${mode}: fallback retains authoritative source`, text.includes('session-a 相机备份 (filesystem)'))
        }
      })
    }
    await attempt('a3-reopen-new-revision', async () => {
      const page = await pageFor(); await open(page, 101, 'photo-A.jpg'); await filesSection(page).waitFor()
      await page.evaluate(() => window.filesPropertiesHarness.replaceRevision(101, 8)); await settle(page)
      check('open Properties keeps its selected revision snapshot', (await field(page, 'Revision')).includes('7'))
      await close(page); await open(page, 101, 'photo-A.jpg'); await filesSection(page).waitFor()
      check('reopened Properties obtains the newly selected revision', (await field(page, 'Revision')).includes('8'))
      check('new revision triggers a fresh canonical lookup', (await peek(page)).requests.filter(r => r.kind === 'media').map(r => r.items[0].revision), [7, 8])
    })
    for (const replacement of ['close', 'next-item', 'directory', 'session', 'unmount']) {
      await attempt(`a4-${replacement}`, async () => {
        const page = await pageFor(); await modes(page, 'hold', 'hold'); await open(page, 101, 'photo-A.jpg')
        await page.getByText('正在加载媒体属性…', { exact: true }).waitFor()
        check(`${replacement}: loading names the selected file`, (await mediaInspector(page).innerText()).includes('photo-A.jpg'))
        const old = (await peek(page)).requests.filter(r => ['media', 'stats'].includes(r.kind)).map(r => r.sequence)
        if (replacement === 'close' || replacement === 'next-item') await close(page)
        else if (replacement === 'directory') await page.evaluate(() => window.filesPropertiesHarness.navigate())
        else if (replacement === 'session') await page.evaluate(() => window.filesPropertiesHarness.setOwner('session-b'))
        else await page.evaluate(() => window.filesPropertiesHarness.unmount())
        await settle(page)
        check(`${replacement}: superseded media and stats signals abort`, (await peek(page)).requests.filter(r => old.includes(r.sequence)).every(r => r.aborted))
        await modes(page, 'correct', 'correct')
        if (replacement === 'next-item') { await open(page, 202, 'photo-B.jpg'); await filesSection(page).waitFor() }
        if (replacement === 'session') { await open(page, 101, 'photo-A.jpg'); await filesSection(page).waitFor() }
        await releaseAll(page, 'session-a', replacement === 'next-item' ? 'correct' : 'reject-old'); await settle(page)
        const text = await page.locator('body').innerText()
        check(`${replacement}: old failure does not become current feedback`, !text.includes('OLD-REQUEST-ERROR-NEVER-SHOW'))
        check(`${replacement}: intentional cancellation has no failure toast`, (await peek(page)).errors, [])
        if (replacement === 'next-item') check('late A success cannot replace B media', (await field(page, 'ID')).includes('202'))
        else if (replacement === 'session') check('same-ID/revision new owner retains its source', (await field(page, '来源')).includes('session-b 相机备份 (filesystem)'))
        else check(`${replacement}: late result cannot reopen the dismissed overlay`, await filesSection(page).count(), 0)
      })
    }
  } finally {
    if (currentPage && !currentPage.isClosed()) await currentPage.close()
    if (browser) await browser.close()
    await new Promise(resolve => server.close(resolve))
    result.summary = { total: result.checks.length, passed: result.checks.filter(x => x.passed).length, failed: result.checks.filter(x => !x.passed).length, errors: result.errors.length }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n')
    process.stdout.write(JSON.stringify(result.summary) + '\n')
    process.exitCode = result.summary.failed || result.summary.errors ? 1 : 0
  }
}
main().catch(error => { process.stderr.write(String(error.stack || error) + '\n'); process.exitCode = 1 })

#!/usr/bin/env node
// Gallery Places acceptance: actual shared GalleryPage + MUI, raw facet transport.
// The original 30 assertions are preserved; paint and changed pointer controls are separate cases.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { createRequire } = require('node:module')
const repoRoot = path.resolve(__dirname, '../..')
const dependencyRoot = path.join(repoRoot, 'desktop/node_modules')
const requireRepo = createRequire(path.join(repoRoot, 'desktop/package.json'))
const esbuild = requireRepo('esbuild')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright')
const opts = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--(source-root|output-dir|case)=(.+)$/.exec(arg)
  if (!match) throw new Error('Unknown option: ' + arg)
  return [match[1], match[2]]
}))
const repo = path.resolve(opts['source-root'] || repoRoot)
const out = path.resolve(opts['output-dir'] || path.join(require('node:os').tmpdir(), 'xdrive-gallery-places'))
const selectedCase = opts.case || 'all'
if (!['all', 'core', 'paint', 'controls'].includes(selectedCase)) throw new Error('Unknown case: ' + selectedCase)
const fixture = path.join(__dirname, 'gallery-places-browser.tsx')
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const sourceFiles = ['MediaGallery.tsx', 'MediaGalleryPlacesMap.tsx', 'MediaGalleryPlacesMapModel.ts',
  'MediaGalleryNavigation.tsx', 'MediaGalleryFilters.tsx', 'WorkspaceContent.tsx', 'AppearanceThemeProvider.tsx', 'theme.ts', 'usePointerDrag.ts']
const hashes = () => Object.fromEntries(sourceFiles.map(file => [file, hash(path.join(repo, 'ui/shared/src/mui', file))]))
const result = { startedAt: new Date().toISOString(), sourceRoot: repo,
  sourceCommit: fs.existsSync(path.join(repo, 'SOURCE_COMMIT')) ? fs.readFileSync(path.join(repo, 'SOURCE_COMMIT'), 'utf8').trim() : execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  selectedCase,
  sourceHashes: hashes(), fixtureHashes: { cjs: hash(__filename), tsx: hash(fixture) },
  samples: {}, checks: [], errors: [],
  boundary: 'Actual shared GalleryPage, map and MUI; raw three-facet and one-item range fixture. Trusted Chromium mouse/touch/keyboard events. No physical device, OS keyboard, native pinch, 1000-facet performance or backend execution claim.' }
const check = (name, passed, actual) => result.checks.push({ name, passed: Boolean(passed), actual })
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const map = page => page.locator('[data-xdrive-gallery-places-map]')
const single = page => map(page).getByRole('button', { name: '零点 · 1 个项目', exact: true })
const cluster = page => map(page).getByRole('button', { name: '2 个地点 · 8 个项目', exact: true })
const projection = page => map(page).locator('svg[role="group"] .xdrive-map-grid').evaluateAll(nodes => nodes.map(node => ({
  x1: node.getAttribute('x1'), y1: node.getAttribute('y1'), x2: node.getAttribute('x2'), y2: node.getAttribute('y2'),
})))
const measure = locator => locator.evaluate(el => {
  const r = el.getBoundingClientRect(); let left = 0, top = 0, right = innerWidth, bottom = innerHeight
  for (let p = el.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p), q = p.getBoundingClientRect();
    if (/auto|scroll|hidden|clip/.test(s.overflowX)) { left = Math.max(left, q.left); right = Math.min(right, q.right) }
    if (/auto|scroll|hidden|clip/.test(s.overflowY)) { top = Math.max(top, q.top); bottom = Math.min(bottom, q.bottom) } }
  const x = (Math.max(left, r.left) + Math.min(right, r.right)) / 2, y = (Math.max(top, r.top) + Math.min(bottom, r.bottom)) / 2
  return { rect: r.toJSON(), visibleWidth: Math.max(0, Math.min(right, r.right) - Math.max(left, r.left)),
    visibleHeight: Math.max(0, Math.min(bottom, r.bottom) - Math.max(top, r.top)), hit: el.contains(document.elementFromPoint(x, y)) }
})
const enter = async (page, scenario, activate) => {
  await page.goto(`http://127.0.0.1:${server.address().port}/?scenario=${scenario}`)
  await page.locator('[data-xdrive-media-tile]').first().waitFor()
  await activate(page.locator('[data-xdrive-gallery-section="places"]'))
  await page.waitForFunction(() => window.placesProbe.calls.some(call => call.kind === 'places' && call.limit === 1000))
  await settle(page)
}
const requests = page => page.evaluate(() => structuredClone(window.placesProbe.calls))
async function interactive(page, profile, sample, activate) {
  await enter(page, 'interactive', activate); await single(page).waitFor(); await single(page).scrollIntoViewIfNeeded(); await settle(page)
  const initial = await projection(page)
  sample.zero = await measure(single(page))
  check(profile.name + ': zero-coordinate grid cell is rendered as its actual Place', sample.zero.hit && sample.zero.visibleHeight > 0, sample.zero)
  sample.controls = {}
  for (const name of ['缩小地点地图', '显示所有地点', '放大地点地图']) {
    const control = page.getByRole('button', { name, exact: true }); await control.scrollIntoViewIfNeeded(); sample.controls[name] = await measure(control)
  }
  check(profile.name + ': compact zoom/reset actual controls have 44px targets', Object.values(sample.controls).every(box => box.rect.width >= 44 && box.rect.height >= 44), sample.controls)
  await single(page).scrollIntoViewIfNeeded(); await settle(page)
  sample.beforeNative = await requests(page)
  await activate(single(page)); await settle(page)
  sample.nativeSingle = { calls: await requests(page), mapPresent: await map(page).count(), events: await page.evaluate(() => window.placesProbe.events.splice(0)) }
  const opened = sample.nativeSingle.calls.some(call => call.kind === 'range' && call.query.place === 'place:0:0')
  check(profile.name + ': native single marker opens its authoritative Place filter', opened, sample.nativeSingle)
  if (opened) { await activate(page.getByRole('button', { name: '返回上一级', exact: true })); await single(page).waitFor() }
  await single(page).focus(); await page.keyboard.press('Enter'); await map(page).waitFor({ state: 'detached' }); await page.locator('[data-xdrive-media-tile]').first().waitFor()
  sample.keyboardCalls = await requests(page)
  check(profile.name + ': keyboard marker enters the same Place filter', sample.keyboardCalls.some(call => call.kind === 'range' && call.query.place === 'place:0:0' && call.query.has_location === true), sample.keyboardCalls)
  const back = page.getByRole('button', { name: '返回上一级', exact: true }); await back.scrollIntoViewIfNeeded(); sample.back = await measure(back)
  await activate(back); await single(page).waitFor(); await settle(page)
  check(profile.name + ': Back reaches the Places index and clears only the Place choice', await page.locator('[data-xdrive-gallery-section="places"][aria-current="page"]').count() === 1 && !(await requests(page)).at(-1)?.query?.place, await requests(page))
  await cluster(page).scrollIntoViewIfNeeded(); const beforeCluster = await projection(page); const callCount = (await requests(page)).length
  await activate(cluster(page)); await settle(page)
  sample.nativeCluster = { before: beforeCluster, after: await projection(page), callsBefore: callCount, callsAfter: (await requests(page)).length,
    events: await page.evaluate(() => window.placesProbe.events.splice(0)) }
  check(profile.name + ': native multi-place cluster zooms without querying photos', JSON.stringify(sample.nativeCluster.before) !== JSON.stringify(sample.nativeCluster.after) && callCount === sample.nativeCluster.callsAfter, sample.nativeCluster)
  if (await cluster(page).count()) { await cluster(page).focus(); await page.keyboard.press('Enter'); await settle(page) }
  sample.keyboardCluster = await projection(page)
  check(profile.name + ': keyboard multi-place cluster zooms without querying photos', JSON.stringify(beforeCluster) !== JSON.stringify(sample.keyboardCluster) && callCount === (await requests(page)).length, sample.keyboardCluster)
  await activate(page.getByRole('button', { name: '显示所有地点', exact: true })); await single(page).waitFor(); await settle(page)
  check(profile.name + ': reset returns the original fitted projection', JSON.stringify(initial) === JSON.stringify(await projection(page)), await projection(page))
  await activate(page.getByRole('button', { name: '缩小地点地图', exact: true })); await settle(page)
  sample.zoomed = await projection(page)
  check(profile.name + ': zoom button changes projection without a media query', JSON.stringify(initial) !== JSON.stringify(sample.zoomed) && callCount === (await requests(page)).length, sample.zoomed)
  const listCard = page.getByRole('button', { name: '零点 1 个项目 · 本地 GPS', exact: true })
  await listCard.scrollIntoViewIfNeeded(); await activate(listCard); await map(page).waitFor({ state: 'detached' }); await page.locator('[data-xdrive-media-tile]').first().waitFor()
  sample.listCalls = await requests(page)
  check(profile.name + ': place list opens the same filter as the map keyboard control', sample.listCalls.some(call => call.kind === 'range' && call.query.place === 'place:0:0'), sample.listCalls)
  await activate(page.getByRole('button', { name: '返回上一级', exact: true })); await single(page).waitFor(); await settle(page)
  sample.returned = await projection(page)
  check(profile.name + ': Place return preserves the chosen map zoom and center', JSON.stringify(sample.zoomed) === JSON.stringify(sample.returned), { before: sample.zoomed, after: sample.returned, initial })
  sample.finalCalls = await requests(page)
  check(profile.name + ': navigation remains bounded and uses existing local facets/ranges', !sample.finalCalls.some(call => call.kind === 'dense') && sample.finalCalls.filter(call => call.kind === 'range').every(call => call.limit <= 200) && sample.finalCalls.some(call => call.kind === 'places' && call.limit === 24) && sample.finalCalls.some(call => call.kind === 'places' && call.limit === 1000), sample.finalCalls)
  await map(page).scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(out, profile.name + '-map.png') })
}
async function states(page, profile, sample, activate) {
  await enter(page, 'delayed', activate)
  await page.waitForFunction(() => typeof window.placesProbe.resolvePlaces === 'function')
  sample.pending = { empty: await page.getByText('没有带地点信息的照片', { exact: true }).count(), map: await map(page).count(), text: await page.locator('main').innerText() }
  check('state: unresolved Places read does not claim a no-GPS library', sample.pending.empty === 0, sample.pending)
  await page.evaluate(() => window.placesProbe.resolvePlaces()); await single(page).waitFor()
  check('state: delayed successful facets become the same Places map', await map(page).count() === 1, await requests(page))
  await enter(page, 'error', activate); await page.getByText('地点读取失败：fixture 503', { exact: true }).waitFor()
  sample.failure = { empty: await page.getByText('没有带地点信息的照片', { exact: true }).count(), error: await page.getByText('地点读取失败：fixture 503', { exact: true }).count(), text: await page.locator('main').innerText() }
  check('state: failed Places read shows its actual error', sample.failure.error === 1, sample.failure)
  check('state: failed Places read does not claim a no-GPS library', sample.failure.empty === 0, sample.failure)
  await activate(page.getByRole('button', { name: '刷新图库', exact: true })); await single(page).waitFor()
  check('state: existing Refresh retries failed Places read and clears error', await page.getByText('地点读取失败：fixture 503', { exact: true }).count() === 0, await requests(page))
  await enter(page, 'empty', activate); await page.getByText('没有带地点信息的照片', { exact: true }).waitFor()
  check('state: successful empty facets show the no-GPS explanation', await map(page).count() === 0 && (await page.evaluate(() => window.placesProbe.errors.length)) === 0, await requests(page))
}
async function paint(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: 'UTC' })
  page.on('pageerror', error => result.errors.push({ profile: 'paint', kind: 'page', message: error.message }))
  await enter(page, 'interactive', locator => locator.tap())
  await map(page).locator('.xdrive-map-count').first().waitFor()
  const actual = await map(page).locator('.xdrive-map-cluster-focus').evaluateAll(groups => groups.map(group => {
    const count = group.querySelector('.xdrive-map-count'), circle = group.querySelector('circle')
    return { label: group.getAttribute('aria-label'), text: count.textContent,
      countFill: getComputedStyle(count).fill, countFont: getComputedStyle(count).fontSize,
      markerFill: getComputedStyle(circle).fill, circleBounds: circle.getBoundingClientRect().toJSON() }
  }))
  result.samples.paint = actual
  check('Rendered numeric count has different paint from its marker fill',
    actual.length > 0 && actual.every(value => value.countFill !== value.markerFill), actual)
  await map(page).scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(out, 'count-paint.png') })
}

// Only the touched map's existing native pan/reset and cancellation paths.
// Physical pinch, device keyboards and geographic performance are not claimed.
async function pointerControls(browser) {
  for (const profile of [{ name: 'pan-fine-700', width: 700, height: 390, touch: false }, { name: 'pan-touch-390', width: 390, height: 844, touch: true }]) {
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, hasTouch: profile.touch, isMobile: profile.touch, timezoneId: 'UTC' })
    const page = await context.newPage(); page.setDefaultTimeout(4000)
    page.on('pageerror', error => result.errors.push({ profile: profile.name, kind: 'page', message: error.message }))
    const activate = locator => profile.touch ? locator.tap() : locator.click()
    const sample = result.samples[profile.name] = {}
    try {
      await enter(page, 'interactive', activate); await single(page).waitFor()
      const svg = map(page).locator('svg[role="group"]')
      await svg.scrollIntoViewIfNeeded(); await settle(page)
      const point = await svg.evaluate(element => {
        const rect = element.getBoundingClientRect()
        let left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right)
        let top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom)
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent), box = parent.getBoundingClientRect()
          if (/auto|scroll|hidden|clip/.test(style.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right) }
          if (/auto|scroll|hidden|clip/.test(style.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom) }
        }
        return { x: left + (right - left) * .32, y: top + (bottom - top) * .6 }
      })
      const cdp = profile.touch ? await context.newCDPSession(page) : null
      const down = async () => {
        if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: point.x, y: point.y }] })
        else { await page.mouse.move(point.x, point.y); await page.mouse.down() }
      }
      const move = async offset => {
        if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: point.x + offset, y: point.y + 12 }] })
        else await page.mouse.move(point.x + offset, point.y + 12, { steps: 4 })
        await settle(page)
      }
      const up = async () => {
        if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        else await page.mouse.up()
        await settle(page)
      }
      const initial = await projection(page), calls = (await requests(page)).length
      await down(); await move(45); await up()
      sample.pan = { before: initial, after: await projection(page), events: await page.evaluate(() => window.placesProbe.events.splice(0)) }
      check(profile.name + ': trusted background drag pans without querying media',
        JSON.stringify(initial) !== JSON.stringify(sample.pan.after) && calls === (await requests(page)).length
          && sample.pan.events.some(event => event.type === 'pointerdown' && event.trusted), sample.pan)
      await down(); await move(45)
      const atEscape = await projection(page)
      await page.keyboard.press('Escape'); await move(80); await up()
      sample.cancel = { atEscape, after: await projection(page), calls: await requests(page) }
      check(profile.name + ': Escape stops the held pan without opening a Place',
        JSON.stringify(atEscape) === JSON.stringify(sample.cancel.after) && calls === sample.cancel.calls.length && await map(page).count() === 1, sample.cancel)
      await activate(page.getByRole('button', { name: '显示所有地点', exact: true })); await settle(page)
      check(profile.name + ': explicit reset restores the same fitted map after pan/cancel',
        JSON.stringify(initial) === JSON.stringify(await projection(page)), await projection(page))
    } catch (error) { result.errors.push({ profile: profile.name, kind: 'scenario', message: String(error) }) }
  }
  const page = await browser.newPage({ viewport: { width: 900, height: 700 }, timezoneId: 'UTC' })
  await enter(page, 'interactive', locator => locator.click()); await single(page).waitFor()
  const controls = {}
  for (const name of ['缩小地点地图', '显示所有地点', '放大地点地图']) controls[name] = await measure(page.getByRole('button', { name, exact: true }))
  result.samples.wideDensity = controls
  check('wide-900: existing 30px map chrome density is retained',
    Object.values(controls).every(box => box.rect.width === 30 && box.rect.height === 30 && box.hit), controls)
}

let server
async function main() {
  fs.mkdirSync(out, { recursive: true }); fs.copyFileSync(__filename, path.join(out, path.basename(__filename))); fs.copyFileSync(fixture, path.join(out, path.basename(fixture)))
  await esbuild.build({ entryPoints: [fixture], bundle: true, outfile: path.join(out, 'bundle.js'), jsx: 'automatic', nodePaths: [dependencyRoot],
    alias: { '@probe/gallery': path.join(repo, 'ui/shared/src/mui/MediaGallery.tsx'), '@probe/content': path.join(repo, 'ui/shared/src/mui/WorkspaceContent.tsx'), '@probe/theme': path.join(repo, 'ui/shared/src/mui/AppearanceThemeProvider.tsx') },
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
  result.bundleHash = hash(path.join(out, 'bundle.js'))
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/bundle.js')) { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(out, 'bundle.js'))) }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({ executablePath: process.env.XDRIVE_CHROMIUM_EXECUTABLE || undefined, headless: true, args: JSON.parse(process.env.XDRIVE_CHROMIUM_ARGS || '[]') })
  result.browser = browser.version()
  try {
    for (const profile of (selectedCase === 'all' || selectedCase === 'core') ? [{ name: 'fine-700', width: 700, height: 390, touch: false }, { name: 'touch-390', width: 390, height: 844, touch: true }] : []) {
      const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, hasTouch: profile.touch, isMobile: profile.touch, timezoneId: 'UTC' })
      const page = await context.newPage(); page.setDefaultTimeout(4000)
      page.on('pageerror', error => result.errors.push({ profile: profile.name, kind: 'page', message: error.message }))
      page.on('console', message => { if (message.type() === 'error') result.errors.push({ profile: profile.name, kind: 'console', message: message.text() }) })
      page.on('request', request => { if (!request.url().startsWith(`http://127.0.0.1:${server.address().port}/`)) result.errors.push({ profile: profile.name, kind: 'external-request', url: request.url() }) })
      const activate = locator => profile.touch ? locator.tap() : locator.click()
      const sample = result.samples[profile.name] = { profile }
      try {
        await interactive(page, profile, sample, activate)
        check(profile.name + ': Place Back has an actual44px reachable target',
          sample.back.rect.width >= 44 && sample.back.rect.height >= 44 &&
          sample.back.visibleWidth >= 43.9 && sample.back.visibleHeight >= 43.9 && sample.back.hit,
          sample.back)
        if (profile.touch) await states(page, profile, sample, activate)
      }
      catch (error) { result.errors.push({ profile: profile.name, kind: 'scenario', message: String(error) }); await page.screenshot({ path: path.join(out, profile.name + '-scenario-error.png') }).catch(() => {}) }
    }
    if (selectedCase === 'all' || selectedCase === 'paint') await paint(browser)
    if (selectedCase === 'all' || selectedCase === 'controls') await pointerControls(browser)
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
  result.finishedAt = new Date().toISOString(); result.sourceHashMatch = JSON.stringify(result.sourceHashes) === JSON.stringify(hashes())
  result.passed = result.checks.filter(value => value.passed).length; result.failed = result.checks.length - result.passed
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ out, passed: result.passed, failed: result.failed, errors: result.errors, sourceHashMatch: result.sourceHashMatch }, null, 2))
  if (result.failed || result.errors.length || !result.sourceHashMatch) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })

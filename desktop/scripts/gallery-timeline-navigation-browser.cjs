#!/usr/bin/env node
// Real shared GalleryPage/MUI timeline controls, sparse indexed dates and native hit targets.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const esbuild = require('esbuild')
const options = {}
for (const argument of process.argv.slice(2)) {
  const match = /^--(source-root|output-dir|case)=(.+)$/.exec(argument)
  if (!match) throw new Error(`Unknown argument: ${argument}`)
  options[match[1]] = match[2]
}
if (!options['output-dir']) throw new Error('Supply --output-dir=/path for evidence.')
if (options.case && !['all', 'baseline', 'day', 'target'].includes(options.case)) throw new Error('Use --case=all|baseline|day|target.')
const repoRoot = path.resolve(__dirname, '../..')
const repo = path.resolve(options['source-root'] || repoRoot)
const out = path.resolve(options['output-dir'])
const fixture = path.join(__dirname, 'gallery-timeline-navigation-browser.tsx')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright')
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const files = ['MediaGalleryTimelineNavigation.ts', 'MediaGallery.tsx', 'MediaGalleryVirtualTimeline.ts', 'MediaGalleryVirtualGrid.ts', 'MediaGalleryFilters.tsx', 'MediaGalleryNavigation.tsx', 'WorkspaceContent.tsx', 'AppearanceThemeProvider.tsx', 'theme.ts']
const hashes = () => Object.fromEntries(files.map(file => [file, hash(path.join(repo, 'ui/shared/src/mui', file))]))
const result = {
  sourceRoot: repo,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim()),
  startedAt: new Date().toISOString(), sourceHashes: hashes(),
  fixtureHashes: { cjs: hash(__filename), tsx: hash(fixture) }, checks: [], samples: {}, errors: [],
  boundary: 'Actual shared GalleryPage + MUI, 360 raw indexed logical items and bounded Server-like ranges. Native click/tap/wheel and real date input; no physical-device, OS calendar/keyboard, routed Viewer-return, or100k renderer performance claim.',
}
const check = (name, passed, actual) => result.checks.push({ name, passed: Boolean(passed), actual })
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const measure = locator => locator.evaluate(el => {
  const r = el.getBoundingClientRect(); let left = 0, top = 0, right = innerWidth, bottom = innerHeight
  for (let p = el.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p), q = p.getBoundingClientRect(); if (/auto|scroll|hidden|clip/.test(s.overflowX)) { left = Math.max(left, q.left); right = Math.min(right, q.right) } if (/auto|scroll|hidden|clip/.test(s.overflowY)) { top = Math.max(top, q.top); bottom = Math.min(bottom, q.bottom) } }
  const x = (Math.max(left, r.left) + Math.min(right, r.right)) / 2, y = (Math.max(top, r.top) + Math.min(bottom, r.bottom)) / 2
  return { rect: r.toJSON(), visibleWidth: Math.max(0, Math.min(right, r.right) - Math.max(left, r.left)), visibleHeight: Math.max(0, Math.min(bottom, r.bottom) - Math.max(top, r.top)), hit: el.contains(document.elementFromPoint(x, y)) }
})

async function runBaseline(page, profile, sample, activate) {
    await page.goto('http://127.0.0.1:' + server.address().port + '/?profile=' + profile.name); await page.locator('[data-xdrive-media-tile]').first().waitFor()
    if (profile.font) { await page.evaluate(font => { document.documentElement.style.fontSize = 16 * font + 'px' }, profile.font); await settle(page) }
    sample.scales = {}
    for (const value of ['year', 'month', 'day', 'all']) { const control = page.locator('[data-xdrive-gallery-time-scale="' + value + '"]'); await control.scrollIntoViewIfNeeded(); sample.scales[value] = await measure(control) }
    check(profile.name + ': time-scale controls have 44px visible targets', Object.values(sample.scales).every(box => box.rect.width >= 44 && box.rect.height >= 44 && box.visibleWidth >= 44 && box.visibleHeight >= 44 && box.hit), sample.scales)
    await activate(page.locator('[data-xdrive-gallery-time-scale="month"]')); await settle(page)
    const jump = page.locator('[data-xdrive-gallery-timeline-jump]'), jumpOwner = jump.locator('.MuiInputBase-root'); await jump.scrollIntoViewIfNeeded(); sample.jump = await measure(jumpOwner)
    check(profile.name + ': date-jump control has a 44px visible target', sample.jump.rect.height >= 44 && sample.jump.visibleHeight >= 44 && sample.jump.hit, sample.jump)
    await page.screenshot({ path: path.join(out, profile.name + '-controls.png') })
    const slider = page.getByRole('slider', { name: '缩略图密度', exact: true }); await slider.scrollIntoViewIfNeeded(); sample.densityOwner = await measure(page.locator('.MuiSlider-root'))
    const densityBefore = Number(await slider.inputValue()); await page.evaluate(() => { window.__m13Timeline = document.querySelector('[data-xdrive-media-gallery-virtual-timeline]') }); await slider.press('ArrowRight'); await settle(page)
    sample.density = { before: densityBefore, after: Number(await slider.inputValue()), sameTimeline: await page.evaluate(() => window.__m13Timeline === document.querySelector('[data-xdrive-media-gallery-virtual-timeline]')) }
    check(profile.name + ': native density input updates the same Timeline owner', sample.density.after > sample.density.before && sample.density.sameTimeline, sample.density)
    await activate(page.locator('[data-xdrive-gallery-time-scale="year"]')); await settle(page); const yearDensity = Number(await slider.inputValue()); await activate(page.locator('[data-xdrive-gallery-time-scale="month"]')); await settle(page)
    check(profile.name + ': per-scale density memory remains independent', yearDensity === 96 && Number(await slider.inputValue()) === sample.density.after, { yearDensity, monthDensity: Number(await slider.inputValue()) })
    await activate(jump.getByRole('combobox')); await activate(page.getByRole('option', { name: '2025年12月', exact: true })); await page.locator('[role="listbox"]').waitFor({ state: 'detached' })
    await page.waitForFunction(() => { const el = document.querySelector('[data-xdrive-media-tile][data-xdrive-media-index="240"]'); if (!el) return false; const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight })
    await settle(page)
    sample.jumpResult = await page.evaluate(() => ({ visibleIndexes: [...document.querySelectorAll('[data-xdrive-media-tile]')].filter(el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight }).map(el => Number(el.getAttribute('data-xdrive-media-index'))), dates: [...document.querySelectorAll('[data-xdrive-gallery-sticky-date]')].filter(el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight }).map(el => el.textContent), mainScroll: document.querySelector('main').scrollTop }))
    check(profile.name + ': native date jump reaches Server logical group index240', sample.jumpResult.visibleIndexes.includes(240), sample.jumpResult)
    sample.dateCue = await page.evaluate(() => { const header = [...document.querySelectorAll('[data-xdrive-gallery-sticky-date]')].find(el => el.textContent.includes('2025年12月')); const tile = document.querySelector('[data-xdrive-media-tile][data-xdrive-media-index="240"]'); const text = header?.querySelector('.MuiTypography-root'); return { header: header?.getBoundingClientRect().toJSON(), text: text?.getBoundingClientRect().toJSON(), tile: tile?.getBoundingClientRect().toJSON(), label: text?.textContent } })
    // Sticky date headers intentionally overlay the wall; visibility, not separation from every tile, is the existing cue contract.
    check(profile.name + ': current-date cue remains visible after the settled jump', sample.dateCue.label === '2025年12月' && sample.dateCue.text.top >= -.5 && sample.dateCue.text.bottom <= profile.height + .5 && sample.dateCue.text.right <= profile.width + .5, sample.dateCue)
    await page.screenshot({ path: path.join(out, profile.name + '-jump-date.png') })
    sample.transport = await page.evaluate(() => window.timelineProbe)
    const ranges = sample.transport.calls.filter(call => call.kind === 'range'), firstQuery = JSON.stringify(ranges[0].query)
    check(profile.name + ': display changes preserve bounded range query ownership', !sample.transport.calls.some(call => call.kind === 'dense') && ranges.every(call => call.limit <= 200 && JSON.stringify(call.query) === firstQuery) && sample.transport.errors.length === 0 && sample.transport.viewers.length === 0, sample.transport)
}

async function runDay(page, profile, sample, activate) {
    await page.goto('http://127.0.0.1:' + server.address().port + '/?profile=indexed-day-' + profile.name); await page.locator('[data-xdrive-media-tile]').first().waitFor()
    if (profile.font) { await page.evaluate(font => { document.documentElement.style.fontSize = 16 * font + 'px' }, profile.font); await settle(page) }
    await activate(page.locator('[data-xdrive-gallery-time-scale="day"]')); await settle(page)
    const dateField = page.locator('[data-xdrive-gallery-timeline-day-jump]'), input = dateField.locator('input[type="date"]'), cue = page.locator('[data-xdrive-gallery-timeline-current-date]'), returnButton = page.locator('[data-xdrive-gallery-timeline-return]')
    const visible = () => page.evaluate(() => [...document.querySelectorAll('[data-xdrive-media-tile]')].filter(el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight }).map(el => Number(el.getAttribute('data-xdrive-media-index'))))
    const waitVisible = index => page.waitForFunction(value => { const el = document.querySelector('[data-xdrive-media-tile][data-xdrive-media-index="' + value + '"]'); if (!el) return false; const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight }, index)
    await dateField.scrollIntoViewIfNeeded(); await settle(page); sample.input = await measure(dateField.locator('.MuiInputBase-root'))
    sample.input.type = await input.getAttribute('type'); sample.input.enabled = await input.isEnabled()
    check(profile.name + ': real indexed Day input is enabled with a visible 44px owner', sample.input.type === 'date' && sample.input.enabled && sample.input.rect.width >= 44 && sample.input.rect.height >= 44 && sample.input.visibleWidth >= 44 && sample.input.visibleHeight >= 44 && sample.input.hit, sample.input)
    await page.evaluate(() => { window.__m13DayTimeline = document.querySelector('[data-xdrive-media-gallery-virtual-timeline]') })
    await input.fill('2026-09-08'); await waitVisible(120); await settle(page)
    sample.exact = { input: await input.inputValue(), cue: await cue.textContent(), visibleIndexes: await visible(), returnOffered: await returnButton.count(), sameTimeline: await page.evaluate(() => window.__m13DayTimeline === document.querySelector('[data-xdrive-media-gallery-virtual-timeline]')), mainScroll: await page.locator('main').evaluate(el => el.scrollTop) }
    check(profile.name + ': real date edit jumps to exact indexed day120 and reports that date', sample.exact.input === '2026-09-08' && sample.exact.cue === '当前浏览：2026年9月8日' && sample.exact.visibleIndexes.includes(120) && sample.exact.returnOffered === 1 && sample.exact.sameTimeline, sample.exact)
    await page.screenshot({ path: path.join(out, profile.name + '-exact-day.png') })
    await page.mouse.move(profile.width / 2, Math.min(profile.height - 30, 180)); await page.mouse.wheel(0, -Math.floor(sample.exact.mainScroll / 2))
    await page.waitForFunction(() => document.querySelector('[data-xdrive-gallery-timeline-current-date]')?.textContent === '当前浏览：2026年10月9日'); await settle(page)
    sample.wheel = { cue: await cue.textContent(), visibleIndexes: await visible(), mainScroll: await page.locator('main').evaluate(el => el.scrollTop), inputKind: 'Chromium native wheel; not an OS touch/date-picker certification' }
    check(profile.name + ': native wall scroll updates current date from the visible group', sample.wheel.visibleIndexes.length > 0 && sample.wheel.visibleIndexes[0] < 120 && sample.wheel.cue === '当前浏览：2026年10月9日' && sample.wheel.mainScroll < sample.exact.mainScroll, sample.wheel)
    await returnButton.scrollIntoViewIfNeeded(); await settle(page); sample.returnTarget = await measure(returnButton); await activate(returnButton); await waitVisible(0); await settle(page)
    sample.returned = { input: await input.inputValue(), cue: await cue.textContent(), visibleIndexes: await visible(), returnActions: await returnButton.count(), sameTimeline: await page.evaluate(() => window.__m13DayTimeline === document.querySelector('[data-xdrive-media-gallery-virtual-timeline]')) }
    check(profile.name + ': visible 44px Return restores the prior logical anchor in the same Timeline', sample.returnTarget.rect.height >= 44 && sample.returnTarget.visibleHeight >= 44 && sample.returnTarget.hit && sample.returned.visibleIndexes.includes(0) && sample.returned.cue === '当前浏览：2026年10月9日' && sample.returned.input === '' && sample.returned.returnActions === 0 && sample.returned.sameTimeline, { target: sample.returnTarget, returned: sample.returned })
    await dateField.scrollIntoViewIfNeeded(); await input.fill('2026-09-09'); await waitVisible(120); await settle(page)
    sample.nearest = { input: await input.inputValue(), cue: await cue.textContent(), visibleIndexes: await visible(), feedback: await page.getByText('所选日期没有照片，已定位至2026年9月8日', { exact: true }).textContent() }
    check(profile.name + ': empty requested day reports the actual nearest indexed date', sample.nearest.input === '2026-09-08' && sample.nearest.cue === '当前浏览：2026年9月8日' && sample.nearest.visibleIndexes.includes(120) && sample.nearest.feedback === '所选日期没有照片，已定位至2026年9月8日', sample.nearest)
    sample.transport = await page.evaluate(() => window.timelineProbe)
    const ranges = sample.transport.calls.filter(call => call.kind === 'range'), expectedQuery = JSON.stringify({ time_zone: 'UTC', sort_by: 'captured', sort_dir: 'desc' })
    check(profile.name + ': indexed day and return preserve bounded original Server range queries', ranges.length > 0 && !sample.transport.calls.some(call => call.kind === 'dense') && ranges.every(call => {
      const { fold_duplicates, ...query } = call.query
      return call.limit <= 200 && (fold_duplicates === undefined || fold_duplicates === false) && JSON.stringify(query) === expectedQuery
    }) && sample.transport.errors.length === 0 && sample.transport.viewers.length === 0, sample.transport)
}

async function runTarget(page, profile, sample, activate) {
  await page.goto('http://127.0.0.1:' + server.address().port + '/?profile=target-' + profile.name)
  await page.locator('[data-xdrive-media-tile]').first().waitFor()
  await activate(page.locator('[data-xdrive-gallery-time-scale="month"]'))
  const jump = page.locator('[data-xdrive-gallery-timeline-jump]')
  const combo = jump.getByRole('combobox')
  await combo.scrollIntoViewIfNeeded(); await settle(page)
  sample.owner = await measure(jump.locator('.MuiInputBase-root'))
  sample.interactive = await measure(combo)
  const compact = profile.width < 900
  check(profile.name + ': actual year/month combobox has the required compact target or unchanged wide density',
    sample.interactive.rect.width >= 44 && sample.interactive.visibleWidth >= 44 && sample.interactive.hit &&
    (compact ? sample.interactive.rect.height >= 44 && sample.interactive.visibleHeight >= 44 : sample.interactive.rect.height === 40 && sample.owner.rect.height === 40),
    { compact, wrapper: sample.owner, interactive: sample.interactive })
  sample.edges = []
  for (const edge of ['top', 'bottom']) {
    await combo.scrollIntoViewIfNeeded(); await settle(page)
    const box = await combo.boundingBox()
    const point = { x: box.x + box.width / 2, y: edge === 'top' ? box.y + 1 : box.y + box.height - 1 }
    const hit = await combo.evaluate((el, p) => el.contains(document.elementFromPoint(p.x, p.y)), point)
    if (profile.touch) await page.touchscreen.tap(point.x, point.y)
    else await page.mouse.click(point.x, point.y)
    const opened = await page.waitForFunction(() => document.querySelector('[data-xdrive-gallery-timeline-jump] [role="combobox"]')?.getAttribute('aria-expanded') === 'true', undefined, { timeout: 800 }).then(() => true, () => false)
    const indexedOptionPresent = await page.getByRole('option', { name: '2025年12月', exact: true }).count() === 1
    if (opened) { await page.keyboard.press('Escape'); await page.locator('[role="listbox"]').waitFor({ state: 'detached' }) }
    await settle(page)
    sample.edges.push({ edge, point, hit, opened, indexedOptionPresent, focusReturned: await combo.evaluate(el => document.activeElement === el) })
  }
  check(profile.name + ': native top and bottom combobox edges open the indexed menu and Escape returns focus', sample.edges.every(edge => edge.hit && edge.opened && edge.indexedOptionPresent && edge.focusReturned), sample.edges)
  await page.screenshot({ path: path.join(out, profile.name + '-interactive-target.png') })
}

let server
async function main() {
  fs.mkdirSync(out, { recursive: true })
  fs.copyFileSync(__filename, path.join(out, path.basename(__filename)))
  fs.copyFileSync(fixture, path.join(out, path.basename(fixture)))
  await esbuild.build({
    entryPoints: [fixture], bundle: true, outfile: path.join(out, 'bundle.js'), jsx: 'automatic',
    nodePaths: [path.join(repoRoot, 'desktop/node_modules')],
    alias: { '@probe/gallery': path.join(repo, 'ui/shared/src/mui/MediaGallery.tsx'), '@probe/content': path.join(repo, 'ui/shared/src/mui/WorkspaceContent.tsx'), '@probe/theme': path.join(repo, 'ui/shared/src/mui/AppearanceThemeProvider.tsx') },
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
  })
  result.bundleHash = hash(path.join(out, 'bundle.js'))
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/bundle.js')) { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(out, 'bundle.js'))) }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({
    executablePath: process.env.XDRIVE_CHROMIUM_EXECUTABLE || undefined,
    headless: true, args: JSON.parse(process.env.XDRIVE_CHROMIUM_ARGS || '[]'),
  })
  result.browser = browser.version()
  const profiles = [
    { name: 'fine-700', width: 700, height: 390, touch: false },
    { name: 'touch-390', width: 390, height: 844, touch: true },
    { name: 'touch-390-text200', width: 390, height: 844, touch: true, font: 2 },
  ]
  const cases = [
    { name: 'baseline', run: runBaseline, profiles },
    { name: 'day', run: runDay, profiles },
    { name: 'target', run: runTarget, profiles: [profiles[0], profiles[1], { name: 'fine-900', width: 900, height: 700, touch: false }] },
  ]
  try {
    for (const scenario of cases) {
      if (options.case && options.case !== 'all' && options.case !== scenario.name) continue
      for (const profile of scenario.profiles) {
        const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, hasTouch: profile.touch, isMobile: profile.touch, timezoneId: 'UTC' })
        const page = await context.newPage(); page.setDefaultTimeout(4500)
        const sampleKey = scenario.name === 'baseline' ? profile.name : scenario.name + '-' + profile.name
        const sample = result.samples[sampleKey] = { profile, scenario: scenario.name }
        page.on('pageerror', error => result.errors.push({ profile: sampleKey, kind: 'page', message: error.message }))
        page.on('console', message => { if (message.type() === 'error') result.errors.push({ profile: sampleKey, kind: 'console', message: message.text() }) })
        const activate = locator => profile.touch ? locator.tap() : locator.click()
        try { await scenario.run(page, profile, sample, activate) }
        catch (error) { result.errors.push({ profile: sampleKey, kind: 'scenario', message: String(error) }); await page.screenshot({ path: path.join(out, sampleKey + '-scenario-error.png') }).catch(() => {}) }
        // browser.close() owns all contexts; closing individual contexts exits single-process Chromium.
      }
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
  result.finishedAt = new Date().toISOString()
  result.sourceHashMatch = JSON.stringify(result.sourceHashes) === JSON.stringify(hashes())
  result.passed = result.checks.filter(check => check.passed).length
  result.failed = result.checks.length - result.passed
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ passed: result.passed, failed: result.failed, errors: result.errors, sourceHashMatch: result.sourceHashMatch, out }, null, 2))
  if (result.failed || result.errors.length || !result.sourceHashMatch) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })

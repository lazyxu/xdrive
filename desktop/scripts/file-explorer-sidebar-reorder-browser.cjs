const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { createRequire } = require('node:module')
const { execFileSync } = require('node:child_process')
const argument = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback
const repoRoot = path.resolve(__dirname, '../..')
const repo = path.resolve(argument('source-root', process.env.XDRIVE_FILE_EXPLORER_SOURCE_ROOT || repoRoot))
const out = path.resolve(argument('output-dir', path.join(require('node:os').tmpdir(), 'xdrive-sidebar-reorder')))
const projectRequire = createRequire(path.join(repoRoot, 'desktop/package.json'))
const { build } = projectRequire('esbuild')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const fixture = path.join(__dirname, 'file-explorer-sidebar-reorder-browser.tsx')
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const aliases = {
  '@probe/navigation': 'FileExplorerNavigationPane.tsx', '@probe/quick-access': 'FileExplorerQuickAccessController.ts',
  '@probe/organization': 'FileExplorerOrganizationController.ts', '@probe/theme': 'AppearanceThemeProvider.tsx',
  '@probe/pointer-drag': 'usePointerDrag.ts',
}
const result = { startedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  sourceHashes: Object.fromEntries(Object.values(aliases).map(file => [file, hash(path.join(repo, 'ui/shared/src/mui', file))])),
  fixtureHashes: { cjs: hash(__filename), tsx: hash(fixture) }, checks: [], errors: [], samples: {},
  boundary: 'Real NavigationPane + real QuickAccess/Organization hooks, controlled list/order transport. Trusted Chromium protocol touch input and native mouse drag; no physical-device or real Server claim.',
}
const check = (name, actual, expected = true) => {
  try { assert.deepEqual(actual, expected); result.checks.push({ name, passed: true, actual }) }
  catch { result.checks.push({ name, passed: false, actual, expected }) }
}
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const read = page => page.evaluate(() => {
  const p = window.sidebarReorderProbe
  const root = document.querySelector('[data-xdrive-file-explorer-navigation-tree]')
  return { state: p.state, calls: p.calls, activations: p.activations, events: p.events, errors: p.errors,
    scrollTop: root?.scrollTop, documentScrollTop: document.scrollingElement?.scrollTop,
    status: document.querySelector('[data-xdrive-sidebar-order-status]')?.textContent || '',
    targets: [...document.querySelectorAll('[data-xdrive-sidebar-order-target]')].map(row => ({ id: Number(row.dataset.xdriveSidebarOrderId), edge: row.dataset.xdriveSidebarOrderTarget })),
    capturedIDs: [...new Set(p.events.map(event => event.pointerID).filter(id => id > 0))].filter(id => root?.hasPointerCapture(id)),
    menuCount: document.querySelectorAll('[role="menu"]').length,
    focusedLabel: document.activeElement?.getAttribute('aria-label'),
    coarse: matchMedia('(pointer: coarse)').matches, width: innerWidth }
})
const labels = { quick: ['Zulu 项目', 'Alpha 资料', 'Mike 照片'], saved: ['Alpha 规则', 'Bravo 规则', 'Charlie 规则'] }
const ordered = { quick: [13, 11, 12], saved: [203, 201, 202] }
const section = (page, kind) => page.getByRole('navigation', { name: kind === 'quick' ? '快速访问' : '智能文件夹', exact: true })
const row = (page, kind, index) => section(page, kind).getByRole('button', { name: labels[kind][index], exact: true })
const handle = (page, kind, id) => section(page, kind).locator(`[data-xdrive-sidebar-order-handle="${id}"]`)
const orderRow = (page, kind, id) => section(page, kind).locator(`[data-xdrive-sidebar-order-id="${id}"]`)
const initialIDs = { quick: [11, 12, 13], saved: [201, 202, 203] }
const writes = (observed, kind) => observed.calls.filter(call => call.kind === `reorder-${kind}`).map(call => call.ids)
const idle = observed => ({ status: observed.status, targets: observed.targets, capturedIDs: observed.capturedIDs, menuCount: observed.menuCount })
const idleExpected = { status: '', targets: [], capturedIDs: [], menuCount: 0 }
async function menuReady(page) {
  await page.getByRole('menu').waitFor()
  await page.waitForFunction(() => {
    const paper = document.querySelector('[role="menu"]')?.closest('.MuiPaper-root')
    if (!paper) return false
    const style = getComputedStyle(paper), transform = new DOMMatrix(style.transform)
    return Number(style.opacity) >= 0.999 && transform.a >= 0.9999 && transform.d >= 0.9999
  })
}
async function menuClosed(page) {
  // Wait for MUI's exit transition to remove the portal/backdrop, not merely
  // for its accessible role to become hidden before the next native touch.
  await page.locator('[role="menu"]').waitFor({ state: 'detached' })
  await settle(page)
}
async function pointAt(locator, edge = 'middle') {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Pointer target is not mounted')
  return { x: box.x + box.width / 2, y: box.y + (edge === 'before' ? 8 : edge === 'after' ? box.height - 8 : box.height / 2) }
}
async function touch(page, locator) {
  await locator.scrollIntoViewIfNeeded()
  const cdp = await page.context().newCDPSession(page)
  const start = await pointAt(locator)
  const point = p => ({ ...p, id: 1, radiusX: 2, radiusY: 2, force: 1 })
  let current = start
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(start)] })
  return {
    start, cdp,
    async move(next, steps = 5) {
      const prior = current
      for (let step = 1; step <= steps; step += 1) {
        current = { x: prior.x + (next.x - prior.x) * step / steps, y: prior.y + (next.y - prior.y) * step / steps }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(current)] })
        await page.waitForTimeout(20)
      }
      await settle(page)
    },
    async second() { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(current), { ...point(current), x: current.x + 25, id: 2 }] }); await settle(page) },
    async end() { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await settle(page); await cdp.detach() },
    async cancel() { await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await settle(page); await cdp.detach() },
  }
}
async function targetGeometry(locator) {
  return locator.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return { width: rect.width, height: rect.height, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      visibleHit: rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth && Boolean(hit && element.contains(hit)) }
  })
}
async function main() {
  fs.mkdirSync(out, { recursive: true })
  await build({ entryPoints: [fixture], bundle: true, outfile: path.join(out, 'bundle.js'), jsx: 'automatic', nodePaths: [path.join(repoRoot, 'desktop/node_modules')],
    alias: Object.fromEntries(Object.entries(aliases).map(([name, file]) => [name, path.join(repo, 'ui/shared/src/mui', file)])), define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
  result.bundleHash = hash(path.join(out, 'bundle.js'))
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    if (pathname === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(fs.readFileSync(path.join(out, 'bundle.js'))) }
    else if (pathname === '/favicon.ico') { response.statusCode = 204; response.end() }
    else if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;min-height:100%}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>') }
    else { response.statusCode = 404; response.end(); result.errors.push({ kind: 'request', pathname }) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({ headless: true, executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || '/tmp/chromium', args: JSON.parse(process.env.XDRIVE_BROWSER_ARGS || '["--no-sandbox","--single-process","--no-zygote"]') })
  result.browserVersion = browser.version()
  const url = `http://127.0.0.1:${server.address().port}/`
  async function run(profile, name, action) {
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height || 844 }, hasTouch: profile.touch, isMobile: profile.touch, timezoneId: 'UTC' })
    const page = await context.newPage(); page.setDefaultTimeout(4000)
    page.on('pageerror', error => result.errors.push({ name, kind: 'page', message: error.message }))
    page.on('console', message => { if (message.type() === 'error') result.errors.push({ name, kind: 'console', message: message.text() }) })
    page.on('requestfailed', request => result.errors.push({ name, kind: 'request', message: request.failure()?.errorText }))
    try {
      const scenarioURL = new URL(profile.query || '', url)
      // This single-process Chromium shares local storage across its contexts.
      // Each scenario owns its preference key, including the name-sort case.
      scenarioURL.searchParams.set('case', name)
      await page.goto(scenarioURL.href)
      await page.waitForFunction(() => {
        const p = window.sidebarReorderProbe
        return p?.state?.quick.length === p?.names.quick.length && p?.state?.saved.length === p?.names.saved.length
      })
      if (profile.font) { await page.evaluate(font => { document.documentElement.style.fontSize = `${16 * font}px` }, profile.font); await settle(page) }
      await action(page)
    } catch (error) { result.errors.push({ name, kind: 'scenario', message: String(error) }) }
    finally {
      result.samples[name] = await read(page).catch(() => null)
      await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true }).catch(() => {})
      // The supplied single-process Chromium terminates on the first isolated
      // context disposal; retain contexts until browser.close, as existing runners do.
      await page.close()
    }
  }
  try {
    for (const width of [899, 1100]) for (const kind of ['quick', 'saved']) {
      const name = `${kind}-native-mouse-${width}`
      await run({ width, touch: false }, name, async page => {
        await row(page, kind, 2).dragTo(row(page, kind, 0))
        await settle(page)
        const observed = await read(page)
        const writes = observed.calls.filter(call => call.kind === `reorder-${kind}`)
        check(`${name}: native HTML drag emits one complete ordered transport`, writes.map(call => call.ids), [ordered[kind]])
        check(`${name}: real controller displays acknowledged order`, observed.state[kind], ordered[kind])
        check(`${name}: native drag has trusted dragstart/drop and no navigation`, {
          dragstart: observed.events.some(event => event.type === 'dragstart' && event.trusted),
          drop: observed.events.some(event => event.type === 'drop' && event.trusted), activations: observed.activations,
        }, { dragstart: true, drop: true, activations: [] })
      })
    }
    for (const width of [390, 700]) for (const kind of ['quick', 'saved']) {
      const name = `${kind}-touch-${width}`
      await run({ width, touch: true }, name, async page => {
        const source = row(page, kind, 2)
        const target = row(page, kind, 0)
        await source.scrollIntoViewIfNeeded()
        const sourceBox = await source.boundingBox(), targetBox = await target.boundingBox()
        const handle = section(page, kind).getByRole('button', { name: /拖动|重排/ })
        check(`${name}: an explicit touch reorder handle is discoverable`, await handle.count() > 0)
        const actualSource = await handle.count() ? handle.last() : source
        const start = await actualSource.boundingBox()
        const cdp = await page.context().newCDPSession(page)
        const first = { x: start.x + start.width / 2, y: start.y + start.height / 2 }
        const last = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...first, id: 1, radiusX: 2, radiusY: 2, force: 1 }] })
        await page.waitForTimeout(550)
        for (let step = 1; step <= 10; step += 1) {
          const ratio = step / 10
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: first.x + (last.x - first.x) * ratio, y: first.y + (last.y - first.y) * ratio, id: 1, radiusX: 2, radiusY: 2, force: 1 }] })
          await page.waitForTimeout(24)
        }
        result.samples[`${name}-before-release`] = await page.evaluate(point => ({
          status: document.querySelector('[data-xdrive-sidebar-order-status]')?.textContent,
          target: document.elementFromPoint(point.x, point.y)?.closest('[data-xdrive-sidebar-order-id]')?.getAttribute('data-xdrive-sidebar-order-id'),
          pointOwner: document.elementFromPoint(point.x, point.y)?.textContent?.slice(0, 120),
          rows: [...document.querySelectorAll('[data-xdrive-sidebar-order-id]')].map(row => ({ id: row.getAttribute('data-xdrive-sidebar-order-id'), y: row.getBoundingClientRect().y, height: row.getBoundingClientRect().height, target: row.getAttribute('data-xdrive-sidebar-order-target') })),
        }), last)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await settle(page)
        const observed = await read(page)
        const writes = observed.calls.filter(call => call.kind === `reorder-${kind}`)
        check(`${name}: advertised touch reorder reaches the complete existing callback`, writes.map(call => call.ids), [ordered[kind]])
        check(`${name}: browser received trusted touch input without row activation`, {
          touch: observed.events.some(event => event.type === 'pointerdown' && event.pointerType === 'touch' && event.trusted), activations: observed.activations,
        }, { touch: true, activations: [] })
        result.samples[`${name}-geometry`] = { sourceBox, targetBox, handleCount: await handle.count(), inputSource: await handle.count() ? 'explicit-handle' : 'current-html-draggable-row' }
        await cdp.detach()
      })
    }
    for (const width of [390, 700, 899]) for (const kind of ['quick', 'saved']) {
      const name = `${kind}-fallback-${width}`
      await run({ width, touch: width < 899 }, name, async page => {
        const orderingHandle = section(page, kind).getByRole('button', { name: `拖动或调整顺序 ${labels[kind][1]}`, exact: true })
        if (await orderingHandle.count()) await orderingHandle.click()
        else if (kind === 'saved') await page.getByRole('button', { name: `智能文件夹 ${labels.saved[1]} 选项`, exact: true }).click()
        else await page.getByRole('button', { name: '排序和自定义侧边栏', exact: true }).click()
        await page.getByRole('menu').waitFor()
        await page.waitForFunction(() => {
          const paper = document.querySelector('[role="menu"]')?.closest('.MuiPaper-root')
          if (!paper) return false
          const style = getComputedStyle(paper), transform = new DOMMatrix(style.transform)
          return Number(style.opacity) >= 0.999 && transform.a >= 0.9999 && transform.d >= 0.9999
        })
        const menuItems = await page.getByRole('menuitem').allTextContents()
        const controls = await page.getByRole('button').allTextContents()
        const up = page.getByRole('menuitem', { name: /上移|向上移动/ }).or(section(page, kind).getByRole('button', { name: /上移|向上移动/ }))
        const down = page.getByRole('menuitem', { name: /下移|向下移动/ }).or(section(page, kind).getByRole('button', { name: /下移|向下移动/ }))
        check(`${name}: item order has discoverable non-drag Up and Down controls`, { up: await up.count() > 0, down: await down.count() > 0 }, { up: true, down: true })
        const observed = await read(page)
        check(`${name}: opening existing options does not activate or mutate an item`, {
          activations: observed.activations, mutations: observed.calls.filter(call => call.kind.startsWith('reorder-') || call.kind === 'unpin'),
        }, { activations: [], mutations: [] })
        result.samples[`${name}-menu`] = { menuItems, controls }
      })
    }
    // The original 36 checks above are deliberately unchanged. The following
    // cases exercise the new owner's semantics through trusted browser input.
    for (const width of [390, 700, 899]) for (const kind of ['quick', 'saved']) {
      const name = `${kind}-tap-keyboard-order-${width}`
      await run({ width, touch: width === 390 }, name, async page => {
        const ids = initialIDs[kind], middle = handle(page, kind, ids[1])
        const geometry = await targetGeometry(middle)
        check(`${name}: combined handle is a visible 44px target`, geometry.width >= 44 && geometry.height >= 44 && geometry.visibleHit)
        if (width === 390) { const contact = await touch(page, middle); await contact.end() }
        else { await middle.focus(); await page.keyboard.press('Enter') }
        await menuReady(page)
        check(`${name}: plain native tap or Enter opens the menu without mutation`, writes(await read(page), kind), [])
        const upGeometry = await targetGeometry(page.getByRole('menuitem', { name: '上移', exact: true }))
        const downGeometry = await targetGeometry(page.getByRole('menuitem', { name: '下移', exact: true }))
        check(`${name}: both fallback actions are visible 44px targets`, [upGeometry, downGeometry].every(rect => rect.width >= 44 && rect.height >= 44 && rect.visibleHit))
        await page.getByRole('menuitem', { name: '上移', exact: true }).click()
        await menuClosed(page)
        await page.waitForFunction(id => document.activeElement?.getAttribute('data-xdrive-sidebar-order-handle') === String(id), ids[1])
        check(`${name}: Up emits the complete order and keeps source focus`, { payloads: writes(await read(page), kind), focus: await middle.evaluate(element => document.activeElement === element) },
          { payloads: [[ids[1], ids[0], ids[2]]], focus: true })
        await page.keyboard.press('Space'); await menuReady(page)
        check(`${name}: first-item Up boundary is explained and disabled`, await page.getByRole('menuitem', { name: '上移（已是第一项）', exact: true }).isDisabled())
        await page.getByRole('menuitem', { name: '下移', exact: true }).click(); await menuClosed(page)
        check(`${name}: Down returns the identical complete order`, { payloads: writes(await read(page), kind), order: (await read(page)).state[kind] },
          { payloads: [[ids[1], ids[0], ids[2]], ids], order: ids })
        await handle(page, kind, ids[2]).focus(); await page.keyboard.press('Enter'); await menuReady(page)
        check(`${name}: last-item Down boundary is explained and disabled`, await page.getByRole('menuitem', { name: '下移（已是最后一项）', exact: true }).isDisabled())
        await page.keyboard.press('Escape'); await menuClosed(page)
        await page.waitForFunction(id => document.activeElement?.getAttribute('data-xdrive-sidebar-order-handle') === String(id), ids[2])
        check(`${name}: Escape returns focus without navigation or an extra order`, { count: writes(await read(page), kind).length, activations: (await read(page)).activations }, { count: 2, activations: [] })
        result.samples[`${name}-geometry`] = { handle: geometry, up: upGeometry, down: downGeometry }
      })
    }
    for (const kind of ['quick', 'saved']) {
      const name = `${kind}-minor-drag-no-trailing-menu`
      await run({ width: 390, touch: true }, name, async page => {
        const middle = handle(page, kind, initialIDs[kind][1])
        const contact = await touch(page, middle)
        await contact.move({ x: contact.start.x + 9, y: contact.start.y }, 1)
        check(`${name}: a trusted 9px move crosses the actual threshold`, (await read(page)).status.length > 0)
        await contact.end(); await page.waitForTimeout(125)
        check(`${name}: self drop clears capture and consumes only its release activation`, { ...idle(await read(page)), writes: writes(await read(page), kind), activations: (await read(page)).activations },
          { ...idleExpected, writes: [], activations: [] })
        const next = await touch(page, middle); await next.end(); await menuReady(page)
        check(`${name}: the next distinct native tap still opens ordering`, (await read(page)).menuCount, 1)
      })
      for (const edge of ['before', 'after']) {
        const name = `${kind}-insertion-${edge}`
        await run({ width: 390, touch: true }, name, async page => {
          const ids = initialIDs[kind], sourceID = edge === 'before' ? ids[2] : ids[0], targetID = edge === 'before' ? ids[0] : ids[2]
          const contact = await touch(page, handle(page, kind, sourceID))
          await contact.move(await pointAt(orderRow(page, kind, targetID), edge))
          check(`${name}: mounted target shows the precise insertion edge`, (await read(page)).targets, [{ id: targetID, edge }])
          await contact.end()
          const expected = edge === 'before' ? [ids[2], ids[0], ids[1]] : [ids[1], ids[2], ids[0]]
          check(`${name}: release sends one complete immutable section order`, { payloads: writes(await read(page), kind), order: (await read(page)).state[kind] }, { payloads: [expected], order: expected })
          check(`${name}: release leaves no active UI or navigation`, { ...idle(await read(page)), activations: (await read(page)).activations }, { ...idleExpected, activations: [] })
        })
      }
      for (const destination of ['outside', 'other-section']) {
        const name = `${kind}-invalid-${destination}`
        await run({ width: 390, touch: true }, name, async page => {
          const contact = await touch(page, handle(page, kind, initialIDs[kind][2]))
          const other = kind === 'quick' ? 'saved' : 'quick'
          await contact.move(destination === 'outside' ? { x: 385, y: 200 } : await pointAt(orderRow(page, other, initialIDs[other][0])))
          check(`${name}: invalid mounted target is not advertised`, (await read(page)).targets, [])
          await contact.end()
          const observed = await read(page)
          check(`${name}: no order, activation, capture, or highlight remains`, { ...idle(observed), orders: observed.calls.filter(call => call.kind.startsWith('reorder-')), activations: observed.activations },
            { ...idleExpected, orders: [], activations: [] })
        })
      }
    }
    for (const reason of ['escape', 'cancel-button', 'pointercancel', 'second-pointer', 'lost-capture', 'path-change', 'lifecycle-change', 'server-order-change', 'unmount']) {
      const name = `quick-cancel-${reason}`
      await run({ width: 390, touch: true }, name, async page => {
        const contact = await touch(page, handle(page, 'quick', 13))
        await contact.move(await pointAt(orderRow(page, 'quick', 11), 'before'))
        check(`${name}: the real owner was active before cancellation`, (await read(page)).targets, [{ id: 11, edge: 'before' }])
        if (reason === 'escape') await page.keyboard.press('Escape')
        else if (reason === 'cancel-button') { await page.getByRole('button', { name: '取消拖动', exact: true }).focus(); await page.keyboard.press('Enter') }
        else if (reason === 'second-pointer') await contact.second()
        else if (reason === 'lost-capture') await page.evaluate(() => {
          const p = window.sidebarReorderProbe, id = [...p.events].reverse().find(event => event.type === 'pointerdown' && event.pointerType === 'touch').pointerID
          document.querySelector('[data-xdrive-file-explorer-navigation-tree]').releasePointerCapture(id)
        })
        else if (reason === 'path-change') await page.evaluate(() => window.sidebarReorderProbe.changePath())
        else if (reason === 'lifecycle-change') await page.evaluate(() => window.sidebarReorderProbe.changeScope())
        else if (reason === 'server-order-change') await page.evaluate(() => window.sidebarReorderProbe.refreshOrderFromServer('quick'))
        else if (reason === 'unmount') await page.evaluate(() => window.sidebarReorderProbe.setMounted(false))
        if (reason === 'pointercancel') await contact.cancel()
        else { await settle(page); await contact.end() }
        await page.waitForTimeout(80)
        const observed = await read(page)
        check(`${name}: held contact release cannot mutate or activate after cancellation`, { ...idle(observed), writes: writes(observed, 'quick'), activations: observed.activations },
          { ...idleExpected, writes: [], activations: [] })
        if (reason === 'server-order-change') check(`${name}: refreshed authoritative server order stays intact`, observed.state.quick, [13, 12, 11])
        if (reason !== 'unmount') {
          const next = await touch(page, handle(page, 'quick', 12)); await next.end(); await menuReady(page)
          check(`${name}: a new distinct contact can still use the fallback`, (await read(page)).menuCount, 1)
        }
      })
    }
    await run({ width: 700, touch: true }, 'quick-name-sort-explanation', async page => {
      await page.getByRole('button', { name: '排序和自定义侧边栏', exact: true }).click(); await menuReady(page)
      await page.getByRole('menuitem', { name: '按名称排序', exact: true }).click()
      await page.keyboard.press('Escape'); await menuClosed(page)
      check('quick-name-sort-explanation: rows use the existing name preference', await section(page, 'quick').locator('[data-xdrive-sidebar-order-id]').evaluateAll(rows => rows.map(row => Number(row.dataset.xdriveSidebarOrderId))), [12, 13, 11])
      const contact = await touch(page, handle(page, 'quick', 12)); await contact.end(); await menuReady(page)
      check('quick-name-sort-explanation: manual order has a visible reason and explicit switch', {
        reason: await page.getByRole('menu').getByText('当前按名称排序；切换为手动排序后可调整顺序。', { exact: true }).isVisible(),
        upDisabled: await page.getByRole('menuitem', { name: /上移/ }).isDisabled(), downDisabled: await page.getByRole('menuitem', { name: /下移/ }).isDisabled(),
        switch: await page.getByRole('menuitem', { name: '切换为手动排序', exact: true }).isVisible(),
      }, { reason: true, upDisabled: true, downDisabled: true, switch: true })
      await page.getByRole('menuitem', { name: '切换为手动排序', exact: true }).click(); await menuClosed(page)
      check('quick-name-sort-explanation: switching preference itself sends no order and restores manual rows', {
        writes: writes(await read(page), 'quick'), rows: await section(page, 'quick').locator('[data-xdrive-sidebar-order-id]').evaluateAll(rows => rows.map(row => Number(row.dataset.xdriveSidebarOrderId))),
      }, { writes: [], rows: [11, 12, 13] })
    })
    for (const kind of ['quick', 'saved']) {
      const name = `${kind}-persistence-failure-and-retry`
      await run({ width: 390, touch: true }, name, async page => {
        const ids = initialIDs[kind]
        await page.evaluate(kind => { window.sidebarReorderProbe.failNextOrder = kind }, kind)
        await handle(page, kind, ids[1]).click(); await menuReady(page)
        await page.getByRole('menuitem', { name: '上移', exact: true }).click(); await menuClosed(page)
        await page.waitForFunction(() => window.sidebarReorderProbe.errors.length > 0)
        check(`${name}: existing controller restores acknowledged order and reports the failure`, { order: (await read(page)).state[kind], errors: (await read(page)).errors },
          { order: ids, errors: [kind === 'quick' ? 'Quick Access order persistence failed' : 'Saved-search order persistence failed'] })
        await handle(page, kind, ids[1]).click(); await menuReady(page)
        await page.getByRole('menuitem', { name: '上移', exact: true }).click(); await menuClosed(page)
        check(`${name}: retry emits exactly the same full order once more`, { payloads: writes(await read(page), kind), order: (await read(page)).state[kind] },
          { payloads: [[ids[1], ids[0], ids[2]], [ids[1], ids[0], ids[2]]], order: [ids[1], ids[0], ids[2]] })
      })
    }
    for (const kind of ['quick', 'saved']) {
      const name = `${kind}-short-200-percent-menu`
      await run({ width: 360, height: 390, touch: true, font: 2, query: '?long' }, name, async page => {
        const middle = handle(page, kind, initialIDs[kind][1])
        const contact = await touch(page, middle); await contact.end(); await menuReady(page)
        const longName = await page.evaluate(kind => window.sidebarReorderProbe.names[kind][1].name, kind)
        const text = page.getByRole('menu').getByText(longName, { exact: true })
        await text.scrollIntoViewIfNeeded()
        const textGeometry = await text.evaluate(element => {
          const rect = element.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(element)
          return { text: element.textContent, rect: { left: rect.left, right: rect.right, height: rect.height }, lines: [...range.getClientRects()].map(line => ({ left: line.left, right: line.right })) }
        })
        check(`${name}: full valid long name wraps inside the viewport`, textGeometry.text === longName && textGeometry.lines.every(line => line.left >= 0 && line.right <= 360))
        const geometry = []
        for (const action of ['上移', '下移']) {
          const control = page.getByRole('menuitem', { name: action, exact: true }); await control.scrollIntoViewIfNeeded()
          geometry.push(await targetGeometry(control))
        }
        check(`${name}: both 200% actions are readable and remain 44px hittable`, geometry.every(rect => rect.width >= 44 && rect.height >= 44 && rect.visibleHit))
        await page.screenshot({ path: path.join(out, `${name}-open.png`), fullPage: true })
        await page.keyboard.press('Escape'); await menuClosed(page)
        await page.waitForFunction(id => document.activeElement?.getAttribute('data-xdrive-sidebar-order-handle') === String(id), initialIDs[kind][1])
        check(`${name}: close returns to the same source without mutation`, { writes: writes(await read(page), kind), focus: await middle.evaluate(element => document.activeElement === element) }, { writes: [], focus: true })
        result.samples[`${name}-geometry`] = { text: textGeometry, controls: geometry }
      })
    }
    for (const kind of ['quick', 'saved']) {
      const name = `${kind}-stationary-edge-autoscroll`
      await run({ width: 390, height: 500, touch: true, query: `?${kind}Count=28` }, name, async page => {
        const sourceID = initialIDs[kind][0], contact = await touch(page, handle(page, kind, sourceID))
        const before = await read(page)
        await contact.move({ x: 180, y: 492 })
        await page.waitForFunction(start => document.querySelector('[data-xdrive-file-explorer-navigation-tree]').scrollTop > start + 450, before.scrollTop)
        const edge = await read(page)
        check(`${name}: stationary finger scrolls the same owner while the document stays fixed`, edge.scrollTop > before.scrollTop + 450 && edge.documentScrollTop === before.documentScrollTop)
        await contact.move({ x: 180, y: 250 })
        const middleScroll = (await read(page)).scrollTop
        await page.waitForTimeout(120)
        check(`${name}: leaving the edge stops its animation`, (await read(page)).scrollTop, middleScroll)
        const target = await page.evaluate(({ kind, sourceID }) => {
          const section = kind === 'quick' ? 'quickAccess' : 'savedSearches'
          const candidates = [...document.querySelectorAll(`[data-xdrive-sidebar-order-section="${section}"]`)].filter(row => {
            const rect = row.getBoundingClientRect()
            return Number(row.dataset.xdriveSidebarOrderId) !== sourceID && rect.top > 100 && rect.bottom < 430
          })
          const row = candidates.at(-1), rect = row?.getBoundingClientRect()
          return row && { id: Number(row.dataset.xdriveSidebarOrderId), point: { x: rect.x + rect.width / 2, y: rect.bottom - 8 } }
        }, { kind, sourceID })
        if (!target) throw new Error('Autoscroll did not expose a later mounted row')
        await contact.move(target.point)
        check(`${name}: later mounted target is re-hit-tested at the insertion edge`, (await read(page)).targets, [{ id: target.id, edge: 'after' }])
        await page.screenshot({ path: path.join(out, `${name}-active.png`), fullPage: true })
        await contact.move({ x: 385, y: 492 })
        const outsideScroll = (await read(page)).scrollTop
        await page.waitForTimeout(120)
        check(`${name}: outside the owner stops scrolling and clears the target`, { scrollTop: (await read(page)).scrollTop, targets: (await read(page)).targets }, { scrollTop: outsideScroll, targets: [] })
        // Leaving through the edge may scroll during intermediate touch moves.
        // Aim at the observed row's current geometry when re-entering the owner.
        await contact.move(await pointAt(orderRow(page, kind, target.id), 'after')); await contact.end()
        const expected = before.state[kind].filter(id => id !== sourceID)
        expected.splice(expected.indexOf(target.id) + 1, 0, sourceID)
        check(`${name}: release sends the full 28-ID order once after scrolling`, writes(await read(page), kind), [expected])
        check(`${name}: final release leaves no capture, highlight, or navigation`, { ...idle(await read(page)), activations: (await read(page)).activations }, { ...idleExpected, activations: [] })
        result.samples[`${name}-scroll`] = { before: before.scrollTop, edge: edge.scrollTop, middleScroll, outsideScroll, target }
      })
    }
  } catch (error) {
    result.errors.push({ kind: 'harness', message: String(error) })
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve))
    result.finishedAt = new Date().toISOString()
    result.passed = result.checks.filter(check => check.passed).length
    result.failed = result.checks.filter(check => !check.passed).length
    result.sourceHashMatch = Object.entries(result.sourceHashes).every(([file, value]) => value === hash(path.join(repo, 'ui/shared/src/mui', file)))
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n')
    process.stdout.write(JSON.stringify({ output: out, passed: result.passed, failed: result.failed, errors: result.errors, sourceHashMatch: result.sourceHashMatch }, null, 2) + '\n')
    if (result.failed || result.errors.length || !result.sourceHashMatch) process.exitCode = 1
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

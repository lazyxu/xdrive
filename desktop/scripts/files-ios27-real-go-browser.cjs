#!/usr/bin/env node
'use strict'

// F-iOS27-09I-A: built production Web (Mobile + Wide) against actual Gin,
// isolated PostgreSQL17 and Local CAS. No browser route fulfils /api/v1.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')

const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const match = /^--([^=]+)=(.+)$/.exec(value)
  assert(match, 'expected --key=value arguments')
  return [match[1], match[2]]
}))
assert(args.ready && args['output-dir'], 'require private ready file and result output directory')
const fixture = JSON.parse(fs.readFileSync(args.ready, 'utf8'))
assert(fixture.postgresql && fixture.real_gin && fixture.intercepted_api === false)
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.url), 'must use the locally bound real Go fixture')
const root = path.resolve(__dirname, '../..')
const output = path.resolve(args['output-dir'])
fs.mkdirSync(output, { recursive: true })
const hash = file => createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')
const results = {
  phase: 'F-iOS27-09I-D6', actualGoServer: true, postgresql17: true,
  interceptedAPI: false, physicalIOS27: false, fixtureOwnedNode: fixture.node_id,
  initialRevision: fixture.node_revision, widths: [], patches: [], copyQueues: [], mutationQueues: [], batchDeletes: [], batchDestinations: [], tapUndoRedo: [], folderCreates: [],
  foreignOwner: [], screenshots: [], errors: [],
  sourceSHA256: Object.fromEntries([
    'web/src/WebFileExplorer.tsx', 'web/src/MobileFiles.tsx', 'web/src/api.ts',
    'ui/shared/src/mui/FileExplorerNavigation.ts',
    'ui/shared/src/mui/VirtualCollectionController.ts',
  ].map(file => [file, hash(file)])),
}
let browser
let page
const apiPath = '/api/v1/nodes/' + fixture.node_id
const resultPath = path.join(output, 'results.json')
function check(condition, message, evidence) {
  assert(condition, message + (evidence === undefined ? '' : ': ' + JSON.stringify(evidence)))
}
async function renamed(input, submit, targetName, expectedStatus, expectedRevision, owner) {
  await input.fill(targetName)
  const [response] = await Promise.all([
    page.waitForResponse(r => {
      const url = new URL(r.url())
      return url.pathname === apiPath && r.request().method() === 'PATCH'
    }),
    submit(),
  ])
  const body = response.request().postDataJSON()
  const revisionHeader = response.request().headers()['if-match']
  const sample = {
    owner, nodeID: fixture.node_id, expectedStatus, actualStatus: response.status(),
    name: body.name, ifMatch: revisionHeader, expectedRevision,
  }
  results.patches.push(sample)
  check(response.status() === expectedStatus, 'actual Gin rename response', sample)
  check(body.name === targetName, 'real Web submitted the exact draft', sample)
  check(revisionHeader === '"' + expectedRevision + '"', 'actual Node revision header', sample)
  if (expectedStatus !== 200) {
    check(await input.inputValue() === targetName, 'failed rename must preserve draft', sample)
  }
  return response
}
async function screenshot(name) {
  const file = name + '.png'
  await page.screenshot({ path: path.join(output, file), fullPage: false })
  results.screenshots.push(file)
}
// F09I-B: compare real Copy-to submissions, without implying worker/CAS completion.
async function queueCopyFromUI(owner, width, targetID) {
  const mobile = width < 900
  await page.setViewportSize({ width, height: mobile ? 812 : 700 })
  await page.goto(fixture.url + '/#/app/files?dir=' + fixture.root_id,
    { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const row = page.locator(mobile ? '[data-mobile-files-item]' : '[data-xdrive-file-explorer-item]')
    .filter({ hasText: 'wide-accepted.txt' }).first()
  await row.waitFor()
  await row.click({ button: 'right' })
  if (mobile) {
    await page.locator('[data-mobile-files-context-selection-action="copy-to"]').click()
  } else {
    await page.getByRole('menuitem', { name: '复制到…', exact: true }).first().click()
  }
  const dialog = page.locator('[data-xdrive-file-explorer-destination-dialog]')
  await dialog.waitFor()
  await dialog.locator('[data-xdrive-file-explorer-destination-directory="' + targetID + '"]').click()
  const submit = dialog.getByRole('button', { name: '复制到这里', exact: true })
  const [response] = await Promise.all([
    page.waitForResponse(r =>
      new URL(r.url()).pathname === '/api/v1/file-operations' &&
      r.request().method() === 'POST'),
    submit.click(),
  ])
  const posted = response.request().postDataJSON()
  const queued = await response.json()
  const sample = {
    owner, width, targetID, status: response.status(), type: posted.type,
    parentID: posted.parent_id, item: posted.items?.[0],
    operationID: queued.id, queuedType: queued.type, queuedParentID: queued.parent_id,
  }
  check(response.status() === 202 && posted.type === 'copy' && queued.type === 'copy',
    'actual Gin queued-copy response and operation type', sample)
  check(posted.parent_id === targetID && queued.parent_id === targetID &&
    posted.items?.length === 1 && posted.items[0].id === fixture.node_id &&
    posted.items[0].revision === fixture.node_revision + 2,
    'Mobile and Wide UI must send the same Node ID/revision through shared operation API', sample)
  check(typeof queued.id === 'string' && queued.id.length > 0,
    'real Server must persist an operation ID', sample)
  results.copyQueues.push(sample)
  await dialog.waitFor({ state: 'hidden' })
  await screenshot(mobile ? 'live-go-mobile-copy-queued' : 'live-go-wide-copy-queued')
}

// F09I-C: both layouts must submit real Move-to and confirmed Delete through
// the one existing Web operation controller. Do not infer background completion.
async function queueMutationFromUI(kind, owner, width, sourceName, sourceID, revision, targetID) {
  const mobile = width < 900
  await page.setViewportSize({ width, height: mobile ? 812 : 700 })
  await page.goto(fixture.url + '/#/app/files?dir=' + fixture.root_id,
    { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const host = page.locator('[data-xdrive-file-explorer-scroll-host]').first()
  await host.waitFor()
  await host.evaluate(el => { el.scrollTop = 0 })
  const row = page.locator(mobile ? '[data-mobile-files-item]' : '[data-xdrive-file-explorer-item]')
    .filter({ hasText: sourceName }).first()
  // Search only the actual bounded virtual viewport by scrolling it, never
  // materialize all rows just to reach the selected test Node.
  for (let step = 0; step < 20 && (await row.count()) === 0; step++) {
    await host.evaluate(el => { el.scrollTop += Math.max(100, el.clientHeight * 0.7) })
    await page.waitForTimeout(70)
  }
  await row.waitFor()
  if (!mobile && kind === 'delete') {
    // Wide FileExplorer deliberately offers "删除所选项目" instead of the
    // single-file "删除" item when an earlier selection has been restored.
    // Use the real unmodified left-click selection controller to choose
    // exactly this file before exercising its individual Delete contract.
    await row.click()
    check((await row.getAttribute('aria-selected')) === 'true',
      'Wide Delete must first genuinely select its exact source row', { owner, sourceID })
  }
  await row.click({ button: 'right' })
  const responsePromise = () => page.waitForResponse(r =>
    new URL(r.url()).pathname === '/api/v1/file-operations' &&
    r.request().method() === 'POST')
  let response
  if (kind === 'move') {
    if (mobile) {
      await page.locator('[data-mobile-files-context-selection-action="move-to"]').click()
    } else {
      await page.getByRole('menuitem', { name: '移动到…', exact: true }).first().click()
    }
    const dialog = page.locator('[data-xdrive-file-explorer-destination-dialog]')
    await dialog.waitFor()
    await dialog.locator('[data-xdrive-file-explorer-destination-directory="' + targetID + '"]').click()
    const [accepted] = await Promise.all([
      responsePromise(), dialog.getByRole('button', { name: '移动到这里', exact: true }).click(),
    ])
    response = accepted
    await dialog.waitFor({ state: 'hidden' })
  } else {
    const deleteItem = mobile
      ? page.locator('[data-mobile-files-context-action="delete"]')
      : page.getByRole('menuitem').filter({ has: page.getByText('删除', { exact: true }) }).first()
    try {
      await deleteItem.waitFor()
    } catch (error) {
      results.errors.push('single-item delete menu entry not reachable')
      results.deleteMenuDiagnostic = {
        owner, sourceName, sourceID,
        menuEntries: await page.getByRole('menuitem').allInnerTexts(),
        selectedRows: await page.locator('[data-xdrive-file-explorer-item][aria-selected="true"]')
          .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-xdrive-file-explorer-item-id'))),
      }
      await screenshot('live-go-' + (mobile ? 'mobile-' : 'wide-') + 'delete-missing-menu')
      throw error
    }
    await deleteItem.click()
    // MUI 7 Dialog forwards the generic aria-label to its *Modal root*,
    // while the actual role="dialog" Paper is named via the dynamic
    // DialogTitle (aria-labelledby). Neither generic-name nor attribute
    // selectors identify the accessible Dialog Paper. Select the real role
    // by this exact source-specific confirmation text, then verify title.
    const expectedTitle = '将“' + sourceName + '”移到回收站？'
    const dialog = page.getByRole('dialog').filter({ hasText: expectedTitle })
    try {
      await dialog.waitFor()
    } catch (error) {
      results.errors.push('delete confirmation not visible after actual UI menu click')
      results.deleteDialogDiagnostic = await page.locator('[role="dialog"]').evaluateAll(nodes =>
        nodes.map(node => ({
          label: node.getAttribute('aria-label'),
          labelledBy: node.getAttribute('aria-labelledby'),
          visible: Boolean(node.getClientRects().length),
          title: node.querySelector('.MuiDialogTitle-root')?.textContent?.trim() || '',
        })))
      await screenshot('live-go-' + (mobile ? 'mobile-' : 'wide-') + 'delete-missing-dialog')
      throw error
    }
    const title = await dialog.locator('.MuiDialogTitle-root').innerText()
    check(title.includes(expectedTitle),
      'real shared delete confirmation title must name the exact source',
      { owner, sourceName, title })
    const [accepted] = await Promise.all([
      responsePromise(), dialog.getByRole('button', { name: '移到回收站', exact: true }).click(),
    ])
    response = accepted
    await dialog.waitFor({ state: 'hidden' })
  }
  const posted = response.request().postDataJSON()
  const queued = await response.json()
  const sample = {
    kind, owner, width, sourceID, revision, targetID,
    status: response.status(), postedType: posted.type, queuedType: queued.type,
    items: posted.items, parentID: posted.parent_id, queuedParentID: queued.parent_id,
    operationID: queued.id,
  }
  check(response.status() === 202 && posted.type === kind && queued.type === kind,
    'real Gin mutation response and type must match both UIs', sample)
  check(posted.items?.length === 1 && posted.items[0].id === sourceID &&
    posted.items[0].revision === revision && queued.total_items === 1,
    'source Node ID/revision must remain exact through shared queued mutation API', sample)
  check(kind === 'move'
    ? posted.parent_id === targetID && queued.parent_id === targetID
    : posted.parent_id == null && queued.parent_id == null,
    'Move destination/absence of Delete target must match exact server contract', sample)
  check(typeof queued.id === 'string' && queued.id.length > 0,
    'real PostgreSQL operation must have a durable ID', sample)
  results.mutationQueues.push(sample)
  await screenshot('live-go-' + (mobile ? 'mobile-' : 'wide-') + kind + '-queued')
}

// F09I-D1: 2-item batches must come from each real layout's native
// multi-select affordance, not fabricated fetch() mutation bodies.
async function findBatchRow(mobile, host, name) {
  const row = page.locator(mobile
    ? '[data-mobile-files-item]' : '[data-xdrive-file-explorer-item]')
    .filter({ hasText: name }).first()
  await host.evaluate(el => { el.scrollTop = 0 })
  for (let step = 0; step < 25 && (await row.count()) === 0; step++) {
    await host.evaluate(el => { el.scrollTop += Math.max(100, el.clientHeight * 0.65) })
    await page.waitForTimeout(70)
  }
  await row.waitFor()
  await row.scrollIntoViewIfNeeded()
  return row
}

async function queueBatchDeleteFromUI(owner, width, nodes) {
  check(Array.isArray(nodes) && nodes.length === 2 &&
    new Set(nodes.map(node => node.id)).size === 2,
    'native fixture must supply two distinct real CAS Nodes', nodes)
  const mobile = width < 900
  await page.setViewportSize({ width, height: mobile ? 812 : 700 })
  await page.goto(fixture.url + '/#/app/files?dir=' + fixture.root_id,
    { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const host = page.locator('[data-xdrive-file-explorer-scroll-host]').first()
  await host.waitFor()

  if (mobile) {
    await page.getByRole('button', { name: '文件操作菜单' }).click()
    await page.locator('[data-mobile-files-more-menu]')
      .getByRole('menuitem', { name: '选择', exact: true }).click()
    for (const node of nodes) {
      const row = await findBatchRow(true, host, node.name)
      await row.click()
      check((await row.getAttribute('aria-pressed')) === 'true',
        'Mobile real multi-select row must be checked before submitting', node)
    }
    await page.getByRole('button', { name: '删除已选' }).click()
  } else {
    const first = await findBatchRow(false, host, nodes[0].name)
    await first.click()
    const second = await findBatchRow(false, host, nodes[1].name)
    await second.click({ modifiers: ['Control'] })
    for (const node of nodes) {
      const row = await findBatchRow(false, host, node.name)
      check((await row.getAttribute('aria-selected')) === 'true',
        'Wide Web must keep both Ctrl-selected file IDs', node)
    }
    const context = await findBatchRow(false, host, nodes[0].name)
    await context.click({ button: 'right' })
    // The shared Web context distinguishes 2-item Delete from single
    // Delete. The visible label is exact even if a shortcut suffix exists.
    await page.getByRole('menuitem')
      .filter({ has: page.getByText('删除所选项目', { exact: true }) })
      .first().click()
  }

  const expectedTitle = '将所选 2 个项目移到回收站？'
  const dialog = page.getByRole('dialog').filter({ hasText: expectedTitle })
  await dialog.waitFor()
  check((await dialog.locator('.MuiDialogTitle-root').innerText()).includes(expectedTitle),
    'shared batch delete must show the real 2-item confirmation title', { owner, nodes })

  const [response] = await Promise.all([
    page.waitForResponse(r =>
      new URL(r.url()).pathname === '/api/v1/file-operations' &&
      r.request().method() === 'POST'),
    dialog.getByRole('button', { name: '移到回收站', exact: true }).click(),
  ])
  const posted = response.request().postDataJSON()
  const queued = await response.json()
  const sourceRevisions = new Map(nodes.map(node => [Number(node.id), Number(node.revision)]))
  const validRefs = Array.isArray(posted.items) && posted.items.length === 2 &&
    new Set(posted.items.map(item => Number(item.id))).size === 2 &&
    posted.items.every(item =>
      sourceRevisions.get(Number(item.id)) === Number(item.revision))
  const sample = { owner, width, sourceIDs: nodes.map(node => node.id),
    postedItems: posted.items, operationID: queued.id, status: response.status(),
    type: posted.type, queuedType: queued.type, totalItems: queued.total_items,
    parentID: posted.parent_id, queuedParentID: queued.parent_id }
  check(response.status() === 202 && posted.type === 'delete' && queued.type === 'delete' &&
    queued.total_items === 2 && posted.parent_id == null && queued.parent_id == null &&
    validRefs && typeof queued.id === 'string' && queued.id.length > 0,
    'Mobile/Wide must queue exactly the two checked Node revisions using one API', sample)
  results.batchDeletes.push(sample)
  await dialog.waitFor({ state: 'hidden' })
  await screenshot(mobile ? 'live-go-mobile-batch-delete-queued' : 'live-go-wide-batch-delete-queued')
}

// F09I-D2: actual 2-file selection in both UIs, one shared destination
// picker and real Gin-backed FileOperation; never construct a synthetic POST.
async function queueBatchDestinationFromUI(kind, owner, width, nodes, targetID) {
  check(['copy', 'move'].includes(kind) && Array.isArray(nodes) && nodes.length === 2 &&
    new Set(nodes.map(node => Number(node.id))).size === 2,
    'batch destination requires two independent CAS Nodes', { kind, nodes })
  const mobile = width < 900
  await page.setViewportSize({ width, height: mobile ? 812 : 700 })
  await page.goto(fixture.url + '/#/app/files?dir=' + fixture.batch_source_id,
    { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const host = page.locator('[data-xdrive-file-explorer-scroll-host]').first()
  await host.waitFor()
  if (mobile) {
    await page.getByRole('button', { name: '文件操作菜单' }).click()
    await page.locator('[data-mobile-files-more-menu]')
      .getByRole('menuitem', { name: '选择', exact: true }).click()
    for (const node of nodes) {
      const row = await findBatchRow(true, host, node.name)
      await row.click()
      check((await row.getAttribute('aria-pressed')) === 'true',
        'Mobile must actually select both source rows', { kind, node })
    }
    if (kind === 'move') {
      await page.getByRole('button', { name: '移动已选' }).click()
    } else {
      await page.getByRole('button', { name: '更多已选操作' }).click()
      await page.locator('[data-mobile-files-selection-menu]')
        .getByRole('menuitem', { name: '复制到…', exact: true }).click()
    }
  } else {
    const first = await findBatchRow(false, host, nodes[0].name)
    await first.click()
    const second = await findBatchRow(false, host, nodes[1].name)
    await second.click({ modifiers: ['Control'] })
    for (const node of nodes) {
      const row = await findBatchRow(false, host, node.name)
      check((await row.getAttribute('aria-selected')) === 'true',
        'Wide Web must keep both Ctrl-selected source rows', { kind, node })
    }
    const context = await findBatchRow(false, host, nodes[0].name)
    await context.click({ button: 'right' })
    await page.getByRole('menuitem', {
      name: kind === 'copy' ? '复制到…' : '移动到…', exact: true,
    }).first().click()
  }
  const dialog = page.locator('[data-xdrive-file-explorer-destination-dialog]')
  await dialog.waitFor()
  // This real picker starts in the nested source folder; the target lives in
  // its parent root. Navigate with the existing breadcrumb before selecting.
  const breadcrumbButtons = dialog.locator('[aria-label="目标文件夹路径"] button')
  check((await breadcrumbButtons.count()) >= 2 &&
    (await breadcrumbButtons.last().isDisabled()) &&
    (await breadcrumbButtons.first().isEnabled()),
    'nested destination picker must expose a usable root ancestor crumb',
    { kind, owner, width })
  await breadcrumbButtons.first().click()
  const target = dialog.locator(
    '[data-xdrive-file-explorer-destination-directory="' + targetID + '"]')
  await target.waitFor()
  await target.click()
  const submit = dialog.getByRole('button', {
    name: kind === 'copy' ? '复制到这里' : '移动到这里', exact: true,
  })
  const [response] = await Promise.all([
    page.waitForResponse(r =>
      new URL(r.url()).pathname === '/api/v1/file-operations' &&
      r.request().method() === 'POST'),
    submit.click(),
  ])
  const posted = response.request().postDataJSON()
  const queued = await response.json()
  const revisions = new Map(nodes.map(node => [Number(node.id), Number(node.revision)]))
  const validSources = Array.isArray(posted.items) && posted.items.length === 2 &&
    new Set(posted.items.map(item => Number(item.id))).size === 2 &&
    posted.items.every(item => revisions.get(Number(item.id)) === Number(item.revision))
  const sample = {
    kind, owner, width, targetID, sourceIDs: nodes.map(node => node.id),
    requestItems: posted.items, status: response.status(), operationID: queued.id,
    requestType: posted.type, queuedType: queued.type,
    parentID: posted.parent_id, queuedParentID: queued.parent_id,
    queuedTotalItems: queued.total_items,
  }
  check(response.status() === 202 && posted.type === kind && queued.type === kind &&
    posted.parent_id === targetID && queued.parent_id === targetID &&
    queued.total_items === 2 && validSources &&
    typeof queued.id === 'string' && queued.id.length > 0,
    'one genuine Mobile/Wide batch destination POST must persist', sample)
  results.batchDestinations.push(sample)
  await dialog.waitFor({ state: 'hidden' })
  await screenshot('live-go-' + (mobile ? 'mobile-' : 'wide-') +
    '-batch-' + kind + '-queued')
}



// F09I-D6: one authentic shared folder-creation dialog on Mobile and Wide.
// No /api/v1 interception: both must hit the same live Gin/PostgreSQL route.
async function createRealFoldersFromBothLayouts() {
  const urlPath = '/api/v1/nodes/' + fixture.root_id + '/directories'
  for (const spec of [
    { surface: 'Mobile', width: 375, height: 812,
      collision: 'mobile-copy-target', name: 'ios27-mobile-created' },
    { surface: 'Wide', width: 1600, height: 900,
      collision: 'wide-copy-target', name: 'ios27-wide-created' },
  ]) {
    await page.setViewportSize({ width: spec.width, height: spec.height })
    await page.goto(fixture.url + '/#/app/files?dir=' + fixture.root_id,
      { waitUntil: 'domcontentloaded' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('[data-xdrive-file-explorer-scroll-host]').first().waitFor()
    if (spec.surface === 'Mobile') {
      await page.getByRole('button', { name: '文件操作菜单' }).click()
      await page.locator('[data-mobile-files-more-menu]')
        .getByRole('menuitem', { name: '新建文件夹', exact: true }).click()
    } else {
      await page.getByRole('button', { name: '新建文件夹', exact: true }).first().click()
    }
    const dialog = page.getByRole('dialog', { name: '新建文件夹', exact: true })
    // Retain an actual DOM screenshot even when the named-dialog assertion fails.
    await screenshot('live-go-' + spec.surface.toLowerCase() + '-folder-dialog-open')
    try {
      await dialog.waitFor()
    } catch (error) {
      // A genuine UI failure should report what the browser actually mounted;
      // do not weaken the named-role or real-server acceptance gate.
      const observed = await page.evaluate(() => ({
        location: location.hash,
        dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).map(el => ({
          name: el.getAttribute('aria-label'),
          labelledBy: el.getAttribute('aria-labelledby'),
          text: (el.textContent || '').slice(0, 140),
          visible: el.getBoundingClientRect().height > 0,
          computed: { display: getComputedStyle(el).display,
            visibility: getComputedStyle(el).visibility,
            opacity: getComputedStyle(el).opacity },
          ancestorChain: Array.from((function* () {
            for (let node = el, depth = 0; node && depth < 9; node = node.parentElement, depth += 1) {
              yield { tag: node.tagName, class: String(node.className || '').slice(0, 90),
                role: node.getAttribute('role'), ariaHidden: node.getAttribute('aria-hidden'),
                inert: node.hasAttribute('inert'), cssVisibility: getComputedStyle(node).visibility,
                cssDisplay: getComputedStyle(node).display }
            }
          })()),
        })),
        activeElement: {
          tag: document.activeElement?.tagName,
          outerHTML: document.activeElement?.outerHTML.slice(0, 350),
        },
        modalRoots: Array.from(document.querySelectorAll('.MuiModal-root')).map(el => ({
          class: String(el.className || '').slice(0, 120),
          ariaHidden: el.getAttribute('aria-hidden'),
          visibility: getComputedStyle(el).visibility,
          zIndex: getComputedStyle(el).zIndex,
        })),
        menus: Array.from(document.querySelectorAll('[data-mobile-files-more-menu]')).map(el => ({
          visible: el.getBoundingClientRect().height > 0,
          selected: Array.from(el.querySelectorAll('[role="menuitem"]'))
            .filter(item => item.getAttribute('aria-selected') === 'true')
            .map(item => (item.textContent || '').trim()),
        })),
      }))
      await screenshot('live-go-' + spec.surface.toLowerCase() + '-folder-dialog-failed')
      throw new Error('real shared create-folder dialog not visible after UI action: ' +
        JSON.stringify(observed) + '; exact visible=' + await dialog.count() +
        ', hidden-included=' + await page.getByRole('dialog', { name: '新建文件夹', exact: true, includeHidden: true }).count() +
        '; original: ' + String(error))
    }
    // Native accessibility-name acceptance, not a CSS visibility proxy:
    // the MUI Paper's label must point to exactly one text-only DOM node,
    // never the DialogTitle wrapper that also contains "关闭弹窗".
    const labelEvidence = await page.evaluate(() => {
      const paper = document.querySelector('.MuiDialog-paper[role="dialog"]')
      const labelID = paper?.getAttribute('aria-labelledby') ?? null
      const targets = labelID ? Array.from(document.querySelectorAll('[id]'))
        .filter(el => el.id === labelID) : []
      return { labelID, targetCount: targets.length,
        labelText: targets.map(el => (el.textContent || '').trim()),
        paperLabel: paper?.getAttribute('aria-label') ?? null }
    })
    check(labelEvidence.targetCount === 1 &&
      labelEvidence.labelText[0] === '新建文件夹' &&
      labelEvidence.paperLabel === '新建文件夹',
      'real MUI Paper must have a unique exact text-only accessible label', labelEvidence)
    const input = dialog.getByRole('textbox', { name: '文件夹名称' })
    const submit = dialog.getByRole('button', { name: '创建', exact: true })
    if (spec.surface === 'Mobile') {
      const size = await submit.evaluate(el => {
        const r = el.getBoundingClientRect()
        return { width: r.width, height: r.height }
      })
      check(size.height >= 44 && size.width >= 44,
        'Mobile folder submit must be at least a 44 CSS px touch target', size)
    }
    await input.fill(spec.collision)
    const [duplicate] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === urlPath &&
        r.request().method() === 'POST'),
      submit.click(),
    ])
    const collidedBody = duplicate.request().postDataJSON()
    check(duplicate.status() === 409 && collidedBody.name === spec.collision,
      'genuine duplicate-name PostgreSQL 409', { spec, status: duplicate.status(), collidedBody })
    await dialog.getByRole('alert').waitFor()
    check(await dialog.isVisible() && await input.inputValue() === spec.collision,
      '409 must retain the editable draft in the same dialog', spec)
    await screenshot('live-go-' + spec.surface.toLowerCase() + '-folder-409')
    await input.fill(spec.name)
    const [created] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === urlPath &&
        r.request().method() === 'POST'),
      submit.click(),
    ])
    const posted = created.request().postDataJSON()
    const node = created.status() === 201 ? await created.json() : null
    const sample = { surface: spec.surface, width: spec.width,
      conflict: duplicate.status(), status: created.status(), name: posted.name,
      id: node?.id, revision: node?.revision, parentID: node?.parent_id, type: node?.type }
    check(created.status() === 201 && posted.name === spec.name &&
      node?.type === 'dir' && node?.name === spec.name &&
      node?.parent_id === fixture.root_id &&
      Number.isSafeInteger(node?.id) && node.id > 0,
      'real folder create response must preserve parent, Node and name', sample)
    await dialog.waitFor({ state: 'hidden' })
    await page.locator(spec.surface === 'Mobile'
      ? '[data-mobile-files-item]' : '[data-xdrive-file-explorer-item]')
      .filter({ hasText: spec.name }).first().waitFor()
    results.folderCreates.push(sample)
    await screenshot('live-go-' + spec.surface.toLowerCase() + '-folder-201')
  }
  check(results.folderCreates.length === 2 &&
    new Set(results.folderCreates.map(x => x.id)).size === 2,
    'both layouts must create independent real folders', results.folderCreates)
  const denied = await page.evaluate(async ({ token, rootID }) => {
    const response = await fetch('/api/v1/nodes/' + rootID + '/directories', {
      method: 'POST', headers: {
        Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
      }, body: JSON.stringify({ name: 'ios27-foreign-forbidden' }),
    })
    return response.status
  }, { token: fixture.foreign_token, rootID: fixture.root_id })
  check(denied === 404, 'foreign owner cannot create within original root', denied)
  results.foreignOwner.push({ method: 'POST nodes/:id/directories', status: denied })
}

// F09I-D5: actual Mobile More and Wide toolbar Undo/Redo clicks. The private
// test-only endpoints only synchronize/run real Go Worker tasks; every
// business HTTP POST comes from the original React Web controller.
async function tapRealUndoRedoFromBothLayouts() {
  const stage = await fetch(fixture.url + '/__test/files/execute', { method: 'POST' })
  check(stage.status === 204, 'real Gin Worker verification prerequisite failed', stage.status)
  for (const spec of [
    { width: 375, height: 812, surface: 'Mobile' },
    { width: 1600, height: 900, surface: 'Wide' },
  ]) {
    await page.setViewportSize({ width: spec.width, height: spec.height })
    await page.goto(fixture.url + '/#/app/files?dir=' + fixture.root_id,
      { waitUntil: 'domcontentloaded' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('[data-xdrive-file-explorer-scroll-host]').first().waitFor()
    let previousUndoID = null
    for (const action of ['undo', 'redo']) {
      let item
      if (spec.surface === 'Mobile') {
        await page.getByRole('button', { name: '文件操作菜单' }).click()
        item = page.locator('[data-mobile-files-more-menu]')
          .getByRole('menuitem', { name: action === 'undo' ? '撤销' : '重做', exact: true })
      } else {
        item = page.getByRole('button', {
          name: action === 'undo' ? '撤销' : '重做', exact: true,
        }).first()
      }
      await item.waitFor({ state: 'visible' })
      // Existing FileOperation lifecycle loads completed tasks asynchronously.
      for (let poll = 0; poll < 50 && !(await item.isEnabled()); poll++) {
        await page.waitForTimeout(100)
      }
      check(await item.isEnabled(), spec.surface + ' ' + action + ' never enabled from real task history')
      const [response] = await Promise.all([
        page.waitForResponse(r =>
          /^\/api\/v1\/file-operations\/[^/]+\/(undo|redo)$/.test(new URL(r.url()).pathname) &&
          new URL(r.url()).pathname.endsWith('/' + action) &&
          r.request().method() === 'POST'),
        item.click(),
      ])
      const queued = await response.json()
      const sample = {
        surface: spec.surface, width: spec.width, action,
        status: response.status(), type: queued.type, id: queued.id,
        undoOfID: queued.undo_of_id, redoOfID: queued.redo_of_id,
      }
      check(response.status() === 202 && queued.type === action &&
        queued.status === 'queued' && typeof queued.id === 'string' && queued.id.length > 0,
        'real UI ' + spec.surface + ' ' + action + ' must create authenticated task', sample)
      if (action === 'redo') {
        check(queued.redo_of_id === previousUndoID,
          'real UI Redo must reference preceding clicked Undo operation', sample)
      } else {
        check(typeof queued.undo_of_id === 'string' && queued.undo_of_id.length > 0,
          'real UI Undo must point to an existing completed operation', sample)
        previousUndoID = queued.id
      }
      const workerResponse = await fetch(fixture.url + '/__test/files/process-next',
        { method: 'POST' })
      const result = workerResponse.status === 200
        ? await workerResponse.json() : await workerResponse.text()
      check(workerResponse.status === 200 && result.id === queued.id &&
        result.type === action && result.status === 'completed',
        'actual production Go Worker must finish exactly clicked UI task', { sample, result })
      results.tapUndoRedo.push(sample)
      await screenshot('live-go-' + spec.surface.toLowerCase() + '-tap-' + action)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.locator('[data-xdrive-file-explorer-scroll-host]').first().waitFor()
    }
  }
  check(results.tapUndoRedo.length === 4 &&
    new Set(results.tapUndoRedo.map(x => x.id)).size === 4,
    'real Mobile/Wide Undo/Redo actions must create four distinct tasks', results.tapUndoRedo)
}

async function main() {
  const launchArgs = process.env.XDRIVE_BROWSER_ARGS
    ? JSON.parse(process.env.XDRIVE_BROWSER_ARGS) : undefined
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || undefined,
    args: launchArgs,
  })
  results.browserVersion = browser.version()
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: false,
    deviceScaleFactor: 1, serviceWorkers: 'block', timezoneId: 'UTC',
  })
  await context.addInitScript(({ origin, token, username }) => {
    if (location.origin !== origin) return
    localStorage.setItem('xdrive.access_token', token)
    localStorage.setItem('xdrive.access_expires_at', String(Date.now() + 3600000))
    localStorage.setItem('xdrive.username', username)
  }, { origin: fixture.url, token: fixture.token, username: fixture.username })
  // This callback may reject external URLs, but MUST NOT manufacture any
  // application HTTP response. All /api/v1 calls reach Server.Router.
  await context.route('**/*', route => {
    const requestURL = new URL(route.request().url())
    if (requestURL.origin !== fixture.url) {
      results.errors.push('attempted external URL origin')
      return route.abort('blockedbyclient')
    }
    return route.continue()
  })
  page = await context.newPage()
  page.on('pageerror', error => results.errors.push('JS: ' + error.message))
  page.on('response', response => {
    if (response.status() >= 500) {
      results.errors.push('Go HTTP ' + response.status() + ' ' + new URL(response.url()).pathname)
    }
  })
  page.setDefaultTimeout(12000)

  for (const viewport of [
    { width: 375, height: 812 }, { width: 390, height: 844 },
    { width: 899, height: 700 }, { width: 900, height: 700 },
  ]) {
    await page.setViewportSize(viewport)
    // Navigating to the same hash after the previous viewport can reuse the
    // mounted SPA workspace without issuing another GET. Establish the route,
    // then arm the real-Gin response listener BEFORE a guaranteed reload.
    await page.goto(fixture.url + '/#/app/files?dir=' + fixture.root_id,
      { waitUntil: 'domcontentloaded' })
    const rootPath = '/api/v1/nodes/' + fixture.root_id + '/children'
    const listResponse = page.waitForResponse(r =>
      new URL(r.url()).pathname === rootPath && r.request().method() === 'GET' && r.status() === 200)
    await page.reload({ waitUntil: 'domcontentloaded' })
    // Consume this reload's real response body before any later navigation,
    // or Chromium may evict it even when the Server returned HTTP 200.
    const response = await listResponse
    const data = await response.json()
    const items = Array.isArray(data.items) ? data.items : data
    check(Array.isArray(items), 'actual Go directory list must contain Nodes')
    const nodes = items.map(item => item.node || item)
    check(nodes.some(node => node.id === fixture.node_id &&
      node.revision === fixture.node_revision && node.name === 'document-001.txt'),
    'four widths must read the same PostgreSQL Node ID and revision', nodes)
    const mobile = viewport.width < 900
    const rows = page.locator(mobile ? '[data-mobile-files-item]' : '[data-xdrive-file-explorer-item]')
    await rows.filter({ hasText: 'document-001.txt' }).first().waitFor()
    const scrollOwners = await page.locator('[data-xdrive-file-explorer-scroll-host]').count()
    // xDrive has two existing chrome owners: the 52px mobile App title
    // and the separately retained wide Web AppBar. Do not demand the mobile
    // DOM selector at 900px or replace the wide layout to satisfy a test.
    const titlebar = page.locator(mobile
      ? '[data-xdrive-mobile-app-header]'
      : '[data-xdrive-workspace-background] .MuiAppBar-root')
    const headerHeight = await titlebar.first().evaluate(el => el.getBoundingClientRect().height)
    check(scrollOwners === 1 &&
      (mobile ? Math.abs(headerHeight - 52) <= 1 : headerHeight >= 48),
      'keep one virtual scroll owner and the existing responsive App titlebar',
      { viewport, mobile, scrollOwners, headerHeight })
    check(page.url().endsWith('/files?dir=' + fixture.root_id),
      'Server root must remain canonical after session restore', page.url())
    results.widths.push({ ...viewport, mobile, nodeID: fixture.node_id,
      revision: fixture.node_revision, oneScrollOwner: true, headerHeight })
    await screenshot('live-go-files-' + viewport.width)
  }

  // Real owner isolation, from the same browser network stack. The back end
  // deliberately returns owner-scoped 404, not a synthetic fixture 403.
  for (const method of ['GET', 'PATCH']) {
    const denied = await page.evaluate(async ({ url, token, method }) => {
      const response = await fetch(url, {
        method, headers: { Authorization: 'Bearer ' + token,
          ...(method === 'PATCH' ? { 'If-Match': '"1"', 'Content-Type': 'application/json' } : {}) },
        ...(method === 'PATCH' ? { body: JSON.stringify({ name: 'foreign-rewrite.txt' }) } : {}),
      })
      return response.status
    }, { url: apiPath, token: fixture.foreign_token, method })
    check(denied === 404, 'real PostgreSQL foreign-owner Node must be invisible', { method, denied })
    results.foreignOwner.push({ method, status: denied })
  }

  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto(fixture.url + '/#/app/files?dir=' + fixture.root_id,
    { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const mobileRow = page.locator('[data-mobile-files-item]')
    .filter({ hasText: 'document-001.txt' }).first()
  await mobileRow.waitFor()
  await mobileRow.click({ button: 'right' })
  await page.locator('[data-mobile-files-item-rename]').click()
  const dialog = page.getByRole('dialog', { name: /^重命名/ })
  await dialog.waitFor()
  const mobileInput = dialog.getByRole('textbox', { name: '名称', exact: true })
  const mobileSubmit = () => dialog.getByRole('button', { name: '保存', exact: true }).click()
  await renamed(mobileInput, mobileSubmit, 'occupied.txt', 409, fixture.node_revision, 'Mobile Web')
  await screenshot('live-go-mobile-409')
  await renamed(mobileInput, mobileSubmit, 'mobile-accepted.txt', 200, fixture.node_revision, 'Mobile Web')
  await dialog.waitFor({ state: 'hidden' })
  await page.locator('[data-mobile-files-item]')
    .filter({ hasText: 'mobile-accepted.txt' }).first().waitFor()
  await screenshot('live-go-mobile-200')

  await page.setViewportSize({ width: 900, height: 700 })
  await page.goto(fixture.url + '/#/app/files?dir=' + fixture.root_id,
    { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const wideRow = page.locator('[data-xdrive-file-explorer-item]')
    .filter({ hasText: 'mobile-accepted.txt' }).first()
  await wideRow.waitFor()
  await wideRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: /重命名/ }).first().click()
  const wideInput = page.getByRole('textbox', {
    name: '重命名 mobile-accepted.txt', exact: true,
  })
  await wideInput.waitFor()
  const wideSubmit = () => wideInput.press('Enter')
  await renamed(wideInput, wideSubmit, 'occupied.txt', 409, fixture.node_revision + 1, 'Wide Web')
  await screenshot('live-go-wide-409')
  await renamed(wideInput, wideSubmit, 'wide-accepted.txt', 200, fixture.node_revision + 1, 'Wide Web')
  await page.locator('[data-xdrive-file-explorer-item]')
    .filter({ hasText: 'wide-accepted.txt' }).first().waitFor()
  await screenshot('live-go-wide-200')
  check(results.patches.map(item => item.actualStatus).join(',') === '409,200,409,200',
    'real Server conflict/retry matrix must be exact', results.patches)
  await queueCopyFromUI('Mobile Web', 375, fixture.mobile_copy_target_id)
  await queueCopyFromUI('Wide Web', 900, fixture.wide_copy_target_id)
  check(results.copyQueues.length === 2, 'both actual layouts must queue a copy', results.copyQueues)
  // Owner B has its own valid destination but no authority over Owner A's source.
  const foreignCopy = await page.evaluate(async ({ token, parentID, sourceID, revision }) => {
    const response = await fetch('/api/v1/file-operations', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'copy', parent_id: parentID,
        items: [{ id: sourceID, revision }] }),
    })
    return response.status
  }, { token: fixture.foreign_token, parentID: fixture.foreign_root_id,
    sourceID: fixture.node_id, revision: fixture.node_revision + 2 })
  check(foreignCopy === 404, 'real Server must deny foreign-source queued copy', foreignCopy)
  results.foreignOwner.push({ method: 'POST file-operations/copy', status: foreignCopy })
  // Independent files avoid conflicting queued Move intents on one source.
  await queueMutationFromUI('move', 'Mobile Web', 375, 'a-mobile-move.txt',
    fixture.mobile_move_id, fixture.mobile_move_revision, fixture.mobile_move_target_id)
  await queueMutationFromUI('move', 'Wide Web', 900, 'b-wide-move.txt',
    fixture.wide_move_id, fixture.wide_move_revision, fixture.wide_move_target_id)
  await queueMutationFromUI('delete', 'Mobile Web', 375, 'c-mobile-delete.txt',
    fixture.mobile_delete_id, fixture.mobile_delete_revision)
  await queueMutationFromUI('delete', 'Wide Web', 900, 'd-wide-delete.txt',
    fixture.wide_delete_id, fixture.wide_delete_revision)
  check(results.mutationQueues.length === 4 &&
    new Set(results.mutationQueues.map(item => item.operationID)).size === 4,
    'four distinct real UI Move/Delete operations must be durably queued', results.mutationQueues)
  await queueBatchDeleteFromUI('Mobile Web', 375, fixture.mobile_batch_delete_nodes)
  await queueBatchDeleteFromUI('Wide Web', 900, fixture.wide_batch_delete_nodes)
  check(results.batchDeletes.length === 2 &&
    new Set(results.batchDeletes.map(item => item.operationID)).size === 2,
    'two layouts must queue different persistent multi-file Delete tasks', results.batchDeletes)
  for (const spec of [
    { kind: 'copy', owner: 'Mobile Web', width: 375,
      nodes: fixture.mobile_batch_copy_nodes, targetID: fixture.mobile_copy_target_id },
    { kind: 'copy', owner: 'Wide Web', width: 900,
      nodes: fixture.wide_batch_copy_nodes, targetID: fixture.wide_copy_target_id },
    { kind: 'move', owner: 'Mobile Web', width: 375,
      nodes: fixture.mobile_batch_move_nodes, targetID: fixture.mobile_move_target_id },
    { kind: 'move', owner: 'Wide Web', width: 900,
      nodes: fixture.wide_batch_move_nodes, targetID: fixture.wide_move_target_id },
  ]) {
    await queueBatchDestinationFromUI(spec.kind, spec.owner, spec.width, spec.nodes, spec.targetID)
  }
  check(results.batchDestinations.length === 4 &&
    new Set(results.batchDestinations.map(item => item.operationID)).size === 4,
    'four independent real 2-source Mobile/Wide Copy/Move queues required', results.batchDestinations)
  for (const spec of [
    { type: 'move', sourceID: fixture.mobile_move_id,
      revision: fixture.mobile_move_revision, parentID: fixture.foreign_root_id },
    { type: 'delete', sourceID: fixture.mobile_delete_id,
      revision: fixture.mobile_delete_revision },
  ]) {
    const denied = await page.evaluate(async ({ token, spec }) => {
      const response = await fetch('/api/v1/file-operations', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: spec.type,
          ...(spec.parentID ? { parent_id: spec.parentID } : {}),
          items: [{ id: spec.sourceID, revision: spec.revision }] }),
      })
      return response.status
    }, { token: fixture.foreign_token, spec })
    check(denied === 404, 'real Gin must reject foreign-source Move/Delete', { spec, denied })
    results.foreignOwner.push({ method: 'POST file-operations/' + spec.type, status: denied })
  }
  const foreignBatch = await page.evaluate(async ({ token, nodes }) => {
    const response = await fetch('/api/v1/file-operations', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'delete',
        items: nodes.map(node => ({ id: node.id, revision: node.revision })) }),
    })
    return response.status
  }, { token: fixture.foreign_token, nodes: fixture.mobile_batch_delete_nodes })
  check(foreignBatch === 404, 'real Gin must reject both foreign-owned batch Delete refs', foreignBatch)
  results.foreignOwner.push({ method: 'POST file-operations/delete-batch', status: foreignBatch })
  // Owner B chooses its own valid destination but cannot access owner A Nodes.
  for (const spec of [
    { kind: 'copy', nodes: fixture.mobile_batch_copy_nodes },
    { kind: 'move', nodes: fixture.mobile_batch_move_nodes },
  ]) {
    const denied = await page.evaluate(async ({ token, parentID, kind, nodes }) => {
      const response = await fetch('/api/v1/file-operations', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: kind, parent_id: parentID,
          items: nodes.map(node => ({ id: node.id, revision: node.revision })) }),
      })
      return response.status
    }, { token: fixture.foreign_token, parentID: fixture.foreign_root_id,
      kind: spec.kind, nodes: spec.nodes })
    check(denied === 404, 'real Gin must reject foreign 2-source batch destination',
      { kind: spec.kind, denied })
    results.foreignOwner.push({ method: 'POST file-operations/' + spec.kind + '-batch', status: denied })
  }
  await createRealFoldersFromBothLayouts()
  await tapRealUndoRedoFromBothLayouts()
  check(results.errors.length === 0, 'unexpected native browser or real Go API errors', results.errors)
  results.passed = true
}

;(async () => {
  try {
    await main()
  } catch (error) {
    results.passed = false
    results.failure = error.stack || String(error)
    process.exitCode = 1
  } finally {
    if (browser) await browser.close().catch(() => {})
    // Always release the native Gin fixture; it independently verifies its
    // persisted final Node identity and revisions before returning success.
    try {
      const stop = await fetch(fixture.url + '/__test/files/finish', { method: 'POST' })
      check(stop.status === 204, 'real fixture stop did not acknowledge')
    } catch (error) {
      results.errors.push('fixture stop failed: ' + String(error))
      process.exitCode = 1
    }
    fs.writeFileSync(resultPath, JSON.stringify(results, null, 2) + '\n')
    console.log('IOS27_FILES_REAL_GO_RESULT ' + JSON.stringify({
      passed: Boolean(results.passed), widths: results.widths.length,
      patches: results.patches.length, copyQueues: results.copyQueues.length,
      mutationQueues: results.mutationQueues.length, batchDeletes: results.batchDeletes.length,
      batchDestinations: results.batchDestinations.length,
      tapUndoRedo: results.tapUndoRedo.length, folderCreates: results.folderCreates.length,
      actualGoServer: true, postgresql17: true,
      failure: results.failure || null, errors: results.errors,
    }))
  }
})()

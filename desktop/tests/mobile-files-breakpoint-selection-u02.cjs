'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root,'desktop/scripts/mobile-web-app-browser.cjs'),'utf8')
const workflow = fs.readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8')

test('U02 original-production Chrome branch asserts selected Node survives 899→900→899', () => {
  for(const x of [
    'async function filesU02BreakpointSelectedNodeAcceptance(origin)',
    "startsWith('test/mobile-files-ios27-real-chrome-u02-')",
    'await filesU02BreakpointSelectedNodeAcceptance(origin)',
    'getAttribute(\'aria-pressed\')',
    'getAttribute(\'aria-selected\')',
    'data-xdrive-mobile-selection-toolbar',
    "await page.setViewportSize({width:900,height:700})",
    "page.getByRole('menuitem',{name:'详细信息',exact:true}).click()",
    "await page.setViewportSize({width:899,height:700})",
    'serverFixtureIntercepted:true',
  ]) assert(source.includes(x),'missing original-browser U02 contract: '+x)
  assert(workflow.includes("startsWith(github.head_ref, 'test/mobile-files-ios27-real-chrome-')"))
  assert(workflow.includes('Verify real Chrome Files 375/390/899/900px shared API parity'))
})

test('U02 minimal fix lifts only selection identity to the same Web workspace', () => {
  const web = fs.readFileSync(path.join(root, 'web/src/WebFileExplorer.tsx'), 'utf8')
  const mobile = fs.readFileSync(path.join(root, 'web/src/MobileFiles.tsx'), 'utf8')
  for (const token of ['responsiveSelectionScope', 'currentResponsiveSelection',
    'onMobileResponsiveSelectionChange', 'onWideResponsiveSelectionChange',
    'selectedIDs={currentResponsiveSelection?.ids ?? []}',
    'initialSelectedItems={currentResponsiveSelection?.items ?? []}']) {
    assert(web.includes(token), token)
  }
  assert(web.includes("useMediaQuery('(max-width:899.95px)')"))
  assert(mobile.includes('useState(Boolean(props.initialSelectedItems?.length))'))
  assert(mobile.includes('const lastResetSelectionScopeRef = useRef(selectionScopeKey)'))
  assert(!mobile.includes('fetch('))
})

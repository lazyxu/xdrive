import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = dirname(fileURLToPath(import.meta.url))
const read = path => readFileSync(resolve(here, path), 'utf8')
const portalSource = read('../../ui/shared/src/mui/MobileHeaderPortal.tsx')
const headerSource = read('../../ui/shared/src/mui/MobileAppHeader.tsx')
const workspaceSource = read('../../ui/shared/src/mui/WorkspaceSurface.tsx')
const appSource = read('../src/App.tsx')
const filesSource = read('../src/MobileFiles.tsx')
const gallerySource = read('../../ui/shared/src/mui/MobileGalleryChrome.tsx')

const compiled = ts.transpileModule(portalSource, {
  fileName: 'MobileHeaderPortal.tsx',
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
  reportDiagnostics: true,
})
assert.equal(compiled.diagnostics?.length ?? 0, 0, 'real portal module transpiles')
const current = { host: null, open: false }
const jsx = (type, props) => ({ type, props: props ?? {} })
const mui = new Proxy({}, { get: (_target, key) => String(key) })
const stubReact = {
  createContext: initial => ({ initial }),
  useContext: context => current.host ?? context.initial,
  useState: initial => [current.open, next => { current.open =
    typeof next === 'function' ? next(current.open) : next }],
}
const modules = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  modules, modules.exports, id => {
    if (id === 'react') return stubReact
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
    if (id === 'react-dom') return { createPortal: (children, target) =>
      ({ type: 'portal', props: { children, target } }) }
    if (id === '@mui/material') return mui
    if (id.startsWith('@mui/icons-material/')) return { __esModule: true, default: () => null }
    throw Error('Unexpected dependency: ' + id)
  },
)
const { XDriveMobileHeaderNavigation: navigation,
  XDriveMobileHeaderPageActions: actions } = modules.exports
const local = navigation({ children: 'local bar' })
assert.equal(local.type, 'Fragment', 'standalone host keeps its original chrome')
current.host = { mode: 'hidden', navigationTarget: null, actionsTarget: null }
assert.equal(navigation({ children: 'L1 bar' }), null,
  'map focus/fullscreen must not reveal old L1 page header')
current.host = { mode: 'global', navigationTarget: null, actionsTarget: null }
assert.equal(navigation({ children: 'loading bar' }), null,
  'lazy page must not render a second row while global target is uncommitted')
const parentNode = { owner: 'verified-owner-header' }
current.host.navigationTarget = parentNode
const portaled = navigation({ children: 'real page bar' })
assert.equal(portaled.type, 'portal')
assert.equal(portaled.props.target, parentNode)
assert.equal(portaled.props.children, 'real page bar')
current.host = { mode: 'shell', navigationTarget: parentNode, actionsTarget: null }
assert.equal(navigation({ children: 'standalone fallback' }).type, 'Fragment')
assert.equal(actions({ title: '任务', actions: 'Refresh' }), null)
current.host.actionsTarget = { owner: 'verified-owner-actions' }
const rendered = actions({ title: '任务', actions: 'Refresh' })
assert.equal(rendered.type, 'portal')
assert.equal(rendered.props.target, current.host.actionsTarget)
const find = (node, predicate) => {
  if (node == null) return null
  if (Array.isArray(node)) return node.map(x => find(x, predicate)).find(Boolean) ?? null
  if (predicate(node)) return node
  return find(node.props?.children, predicate)
}
const menu = find(rendered, x => x.type === 'IconButton' &&
  x.props['data-xdrive-mobile-page-actions-trigger'] !== undefined)
assert.ok(menu, 'real shared-page actions need accessible header entry')
assert.match(menu.props['aria-label'], /任务/)
menu.props.onClick()
assert.equal(current.open, true, 'action picker is not inert')
const expanded = actions({ title: '任务', actions: 'Refresh' })
const drawer = find(expanded, x => x.type === 'Drawer')
assert.equal(drawer.props.open, true)
drawer.props.onClose()
assert.equal(current.open, false)
const sheet = find(expanded, x => x.props?.['data-xdrive-mobile-page-action-sheet'] !== undefined)
assert.ok(sheet, 'original page actions stay mounted in the actual bottom sheet')
sheet.props.onClickCapture()
assert.equal(current.open, false)

// Verify the actual Files/Gallery top rows are descendants of the header
// portal, not two independent fixed/sticky rows left in the scroll viewport.
function headerOwned(source, fileName, dataAttribute) {
  const ast = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  let found = 0
  function visit(node) {
    if (ts.isJsxOpeningElement(node) &&
      node.attributes.properties.some(p => ts.isJsxAttribute(p) &&
        p.name.getText(ast) === dataAttribute)) {
      found++
      let parent = node.parent
      let withinPortal = false
      while (parent) {
        if (ts.isJsxElement(parent) &&
          parent.openingElement.tagName.getText(ast) === 'XDriveMobileHeaderNavigation') {
          withinPortal = true
          break
        }
        parent = parent.parent
      }
      assert.equal(withinPortal, true,
        fileName + ': real page header must be in the shared portal')
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(found, 1, fileName + ': exactly one page-level navigation row')
}
headerOwned(filesSource, 'MobileFiles.tsx', 'data-mobile-files-navigation-bar')
headerOwned(gallerySource, 'MobileGalleryChrome.tsx', 'data-xdrive-mobile-gallery-actions')

assert.match(headerSource, /data-xdrive-mobile-app-header/)
assert.match(headerSource, /minHeight: 'calc\(52px \+ env\(safe-area-inset-top\)\)'/)
assert.match(headerSource, /data-xdrive-mobile-header-page-slot/)
assert.match(headerSource, /data-xdrive-mobile-header-page-actions/)
assert.match(headerSource, /data-xdrive-mobile-header-fallback/)
assert.match(appSource, /XDriveMobileHeaderPortalContext.Provider/)
assert.match(appSource, /pageNavigation=\{mobileHeaderMode === 'global'\}/)
assert.match(appSource, /navigationSlotRef=\{setMobilePageHeaderTarget\}/)
assert.match(appSource, /actionsSlotRef=\{setMobilePageActionsTarget\}/)
assert.match(appSource, /viewerActive \|\| mobileMapFocused \|\| mobileManualFocused \? 'hidden'/)
assert.match(workspaceSource, /showPageHeader && !mobileShell/)
assert.match(workspaceSource, /XDriveMobileHeaderPageActions title=\{title\} actions=\{pageActions\}/,
  'all generic Web Mobile workspace pages use global header action entry')
assert.match(filesSource, /managedHeader \|\| \(compactTitleVisible && !savedResumePending\)/,
  'Files title must remain visible in single mobile 52px navigation row')
assert.match(gallerySource, /data-xdrive-mobile-gallery-more-select/)
assert.match(gallerySource, /data-xdrive-mobile-gallery-more-sort/)
assert.match(gallerySource, /data-xdrive-mobile-gallery-more-filter/)
assert.match(gallerySource, /sx=\{narrowManagedHeader \? \{ display: 'none' \} : undefined\}/)
assert.match(appSource, /compactWorkspace \? \{ px: 0, py: 0 \}/,
  'wide iPad in five-slot mode cannot retain old desktop page padding')

// Other native Hosts already use one real route-local header: do not mount a
// second Web toolbar or claim a fake iOS custom 52px screen on their behalf.
const android = read('../../android/app/src/main/java/com/tfluid/xdrive/DriveApp.kt')
const ios = read('../../ios/XDriveIOS/NativePhotosDashboard.swift')
const dsm = read('../../ui/shared/src/mui/XDriveApp.tsx')
assert.match(android, /Scaffold\(modifier = Modifier\.imePadding\(\),/)
assert.match(android, /topBar = \{/)
assert.match(android, /statusBarsPadding\(\)\.fillMaxWidth\(\)\.height\(52\.dp\)/)
assert.match(ios, /TabView\(selection: \$tab\)/)
assert.match(ios, /NavigationStack \{/)
assert.match(dsm, /XDriveWorkspaceFrame/)
console.log('Unified Web Mobile 52px header: genuine portal controls, native host audit, route/L2/L3 and action picker passed')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(here, '../src/webMobileNavigationLayout.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
})
assert.equal(compiled.diagnostics?.length ?? 0, 0)
const layout = await import('data:text/javascript;base64,' +
  Buffer.from(compiled.outputText).toString('base64'))
const mobile = layout.xDriveWebCompactNavigation

const windowsDesktop = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0',
  platform: 'Win32', maxTouchPoints: 0, touchOnly: false,
}
const windowsTouchLaptop = { ...windowsDesktop, maxTouchPoints: 10 }
const androidTablet = {
  userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36',
  platform: 'Linux armv8l', maxTouchPoints: 10, touchOnly: true,
}
const androidTabletWithMouse = { ...androidTablet, touchOnly: false }
const iphoneLandscape = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
  platform: 'iPhone', maxTouchPoints: 5, touchOnly: true,
}
const ipadDesktopSite = {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1',
  platform: 'MacIntel', maxTouchPoints: 5, touchOnly: false,
}
const macDesktop = {
  userAgent: ipadDesktopSite.userAgent, platform: 'MacIntel',
  maxTouchPoints: 0, touchOnly: false,
}
const windowsTablet = { ...windowsDesktop, maxTouchPoints: 10, touchOnly: true }

for (const device of [windowsDesktop, windowsTouchLaptop, macDesktop]) {
  assert.equal(mobile(false, device), false,
    'wide desktop including a Windows touch laptop keeps the side navigation')
  assert.equal(mobile(true, device), true,
    'narrow desktop retains its existing compact responsive fallback')
}
for (const device of [androidTablet, androidTabletWithMouse, iphoneLandscape,
  ipadDesktopSite, windowsTablet]) {
  assert.equal(mobile(false, device), true,
    'wide portrait or landscape phone/tablet keeps five fixed tabs')
  assert.equal(mobile(true, device), true, 'narrow mobile stays compact')
}
assert.equal(mobile(false, { userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0)', platform: 'iPad' }), true)
assert.equal(mobile(false, { userAgent: 'Mozilla/5.0 (Linux; Android 15)', touchOnly: false }), true,
  'Android desktop-site request must not silently become desktop layout')
assert.equal(mobile(false, { ...windowsDesktop, touchOnly: false, maxTouchPoints: 1 }), false)

const app = readFileSync(resolve(here, '../src/App.tsx'), 'utf8')
const runtime = readFileSync(resolve(here, '../src/webAppRuntime.ts'), 'utf8')
assert.match(app, /useMediaQuery\(XDRIVE_WEB_NARROW_QUERY\)/)
assert.match(app, /useMediaQuery\(XDRIVE_WEB_TOUCH_ONLY_QUERY\)/)
assert.match(app, /const compactWorkspace = xDriveWebCompactNavigation\(compactWidth, \{/)
assert.match(app, /sidebar=\{compactWorkspace \? null : \(/,
  'tablet and phone cannot render the desktop sidebar')
assert.match(app, /\{compactWorkspace && !viewerActive && !mobileMapFocused && !mobileManualFocused \? \(/,
  'ordinary tablet pages retain the five-slot bar; L2/L3 still hide it')
assert.match(app, /display: compactWorkspace \? 'none' : 'flex'/,
  'desktop top app bar must use the exact same switch as the mobile header')
assert.doesNotMatch(app, /display: \{ xs: 'none', md: 'flex' \}/,
  'CSS-only md desktop header must not appear over a wide mobile header')
assert.match(runtime, /xDriveWebBrowserCompactNavigation\(\)/,
  'Gallery-first cold start must share the phone/tablet layout classifier')
const files = readFileSync(resolve(here, '../src/WebFileExplorer.tsx'), 'utf8')
const sharedGallery = readFileSync(resolve(here, '../../ui/shared/src/mui/MediaGallery.tsx'), 'utf8')
assert.match(app, /mobileWebChrome=\{placesEmbedRequested \? compactWidth : compactWorkspace\}/,
  'wide tablet Gallery must use the same shell layout; desktop map guest keeps its width policy')
assert.match(app, /compactNavigation=\{compactWorkspace\}/,
  'wide tablet Files must use the same shell layout')
assert.match(files, /const compactMobile = compactNavigation \?\? narrowFilesViewport/,
  'Files use explicit shell mode while other entry points retain responsive fallback')
assert.match(sharedGallery, /const mobileGalleryViewport = mobileWebChrome/,
  'Gallery route controller cannot switch to desktop at tablet widths')
assert.match(sharedGallery, /const compactGallery = mobileWebChrome/,
  'Gallery visual chrome cannot switch to desktop at tablet widths')
assert.doesNotMatch(sharedGallery,
  /useMediaQuery\('\(max-width:899\.95px\)'\) && mobileWebChrome/,
  'no width-only Gallery path may conflict with the shared mobile shell')
console.log('Web phone/tablet portrait/landscape five-slot, Files/Gallery parity, desktop sidebar, top bar and startup contracts passed')

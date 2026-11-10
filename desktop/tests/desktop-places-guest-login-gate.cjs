'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

function loadAdmission() {
  const filename = 'ui/shared/src/desktop-places-embed-admission.ts'
  const compiled = ts.transpileModule(read(filename), {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  assert.deepEqual((compiled.diagnostics || [])
    .filter(d => d.category === ts.DiagnosticCategory.Error), [])
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports, name => { throw Error('unexpected map helper import: ' + name) })
  return module.exports
}

const admission = loadAdmission()

test('reserved Desktop Places URL never falls through to ordinary Web credential login', () => {
  const requested = admission.xDriveDesktopPlacesEmbedIntent
  assert.equal(requested(''), false)
  assert.equal(requested('?section=places'), false)
  assert.equal(requested('?desktop_places_embed=1'), true)
  assert.equal(requested('?desktop_places_embed=0'), true)
  assert.equal(requested('?desktop_places_embed=1&desktop_places_embed=0'), true)
  assert.equal(requested('?desktop_places_embed=1&places_map_mode=isolated'), true)

  const web = read('web/src/App.tsx')
  const start = web.indexOf('function App({')
  const initial = web.slice(web.indexOf('function initialSession()'), start)
  assert.match(initial, /xDriveDesktopPlacesEmbedIntent\(window\.location\.search\)/)
  assert.match(initial, /return \{accessToken:'', refreshToken:'', accessExpiresAt:0, browserSession:true\}/)
  const app = web.slice(start)
  const deny = app.indexOf('if (xDriveDesktopPlacesEmbedIntent(window.location.search) &&')
  const share = app.indexOf('if (publicShareToken) {')
  const login = app.indexOf('if (!session.accessToken) {')
  assert.ok(deny >= 0 && deny < share && share < login,
    'fail-closed map error must render BEFORE public share and regular login form')
  assert.match(app.slice(deny, share), /!xDriveTrustedDesktopPlacesBridge\(\)/)
  assert.match(app.slice(deny, share), /return <XDriveDesktopPlacesAuthUnavailable/)
  assert.match(app.slice(deny, share), /请更新 Server Web 页面与 Desktop 客户端/)
  const helper = web.slice(web.indexOf('function XDriveDesktopPlacesAuthUnavailable('), start)
  assert.match(helper, /data-xdrive-desktop-places-auth-denied/)
  assert.match(helper, /<XDriveBrandLockup iconSrc=\{xDriveBrandIcon\} variant="large"/)
  assert.match(helper, /重试地图会话/)
  assert.match(app, /if \(!session\.accessToken && xDriveTrustedDesktopPlacesBridge\(\)\) \{[\s\S]*?return <XDriveDesktopPlacesAuthUnavailable/)
  assert.equal((web.match(/<XDriveBrandLockup\b[^>]*\/>/g)||[]).length,5,
    'both embedded map error paths must reuse one branded view, not duplicate its JSX')
  assert.match(app, /xDriveDesktopPlacesEmbedIntent\(window\.location\.search\)\s*\? Boolean\(xDriveTrustedDesktopPlacesBridge\(\)\)/)
  assert.match(app, /const placesEmbedRequested=xDriveDesktopPlacesEmbedIntent\(window\.location\.search\)/)
  assert.match(app, /if \(!session\.accessToken && xDriveTrustedDesktopPlacesBridge\(\)\)/)
  assert.match(app, /placesEmbedRequested && !placesEmbedBridge/)
  assert.match(app, /placesEmbedStatus==='denied'/)
  assert.match(app, /data-xdrive-desktop-places-web-page/)
})

test('actual guest DOM must be a map-only page, never HTTP 200 login or Owner-denied page', () => {
  const probe = admission.XDRIVE_DESKTOP_PLACES_GUEST_PROBE
  const pageSelector = '[data-xdrive-desktop-places-web-page]'
  const sdkSelector = '[data-xdrive-baidu-isolated-photo-map]'
  const unavailableSelector = '[data-xdrive-baidu-map-unavailable]'
  const run = (selectors, sdkPhase = null, errorCode = null) => {
    const set = new Set(selectors)
    const page = {querySelector: selector => {
      if (selector === sdkSelector && sdkPhase !== null)
        return {getAttribute: key =>
          key === 'data-xdrive-places-sdk-phase' ? sdkPhase : null}
      if (selector === unavailableSelector && set.has(unavailableSelector))
        return {getAttribute: key => key === 'data-xdrive-baidu-map-error-code'
          ? errorCode : null}
      return null
    }}
    const document = {querySelector: selector =>
      selector === pageSelector && set.has(pageSelector) ? page :
        set.has(selector) ? {} : null}
    return new Function('document', 'return ' + probe)(document)
  }
  assert.equal(run([]), 'pending')
  assert.equal(run([pageSelector]), 'pending',
    'React map root alone must not expose black/empty guest')
  assert.equal(run([pageSelector], 'loading'), 'pending')
  assert.equal(run([pageSelector], 'ready'), 'ready')
  assert.equal(run([pageSelector], 'unavailable'), 'unavailable')
  assert.equal(run([pageSelector, unavailableSelector], 'ready'), 'unavailable')
  assert.equal(run([pageSelector, unavailableSelector], 'ready', 'session_denied'),
    'unavailable:session_denied')
  assert.equal(admission.xDriveDesktopPlacesGuestFailureCode('unavailable:session_denied'),
    'session_denied')
  assert.equal(admission.xDriveDesktopPlacesGuestFailureCode('unavailable:child_handshake_timeout'),
    'child_handshake_timeout')
  assert.equal(admission.xDriveDesktopPlacesGuestProbeState('unavailable:session_denied'),
    'unavailable')
  assert.equal(run(['#web-login-username']), 'login')
  assert.equal(run(['#web-login-password']), 'login')
  assert.equal(run(['[data-xdrive-desktop-places-auth-denied]']), 'denied')
  assert.equal(run(['#web-login-username', '[data-xdrive-desktop-places-web-page]']), 'login')
  assert.equal(run(['[data-xdrive-desktop-places-auth-denied]', '[data-xdrive-desktop-places-web-page]']), 'denied')
  for (const state of ['pending', 'ready', 'login', 'denied', 'unavailable']) {
    assert.equal(admission.xDriveDesktopPlacesGuestProbeState(state), state)
  }
  for (const state of [true, {}, undefined, 'untrusted', 'map']) {
    assert.equal(admission.xDriveDesktopPlacesGuestProbeState(state), 'pending')
  }
})

test('Desktop hides unverified guest, detects late login transitions and keeps shared map modes', () => {
  const map = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const mode = read('ui/shared/src/media-gallery-places-map-mode.ts')
  // The real WebView may throw synchronously before DOM-ready. The guarded
  // helper is exercised by gallery-places-webview-dom-ready-probe.cjs.
  assert.match(map, /xDriveStartDesktopPlacesGuestProbe\(\s*guest\s*,\s*XDRIVE_DESKTOP_PLACES_GUEST_PROBE\s*\)/)
  assert.match(map, /if\(state==='login'\)/)
  assert.match(map, /else if\(state==='denied'\)/)
  assert.match(map, /visibility:guestReady\?'visible':'hidden'/)
  assert.match(map, /data-xdrive-desktop-places-awaiting-guest/)
  assert.match(map, /guest\.addEventListener\('did-start-navigation',navigating\)/)
  assert.match(map, /guest\.addEventListener\('did-finish-load',loaded\)/)
  assert.match(map, /if\(!mapMounted && Date\.now\(\)-navigationStartedAt>20_000\)/)
  assert.match(map, /setEmbedGuestReady\(null\)/)
  assert.match(map, /setEmbedPrepared\(\{key:embedIdentity,state:'denied'\}\)/)
  assert.match(map, /onClick=\{\(\) => setEmbedRetry\(n=>n\+1\)\}/)
  assert.match(map, /mode=\{mapMode === 'prototype' \? 'inline' : 'isolated'\}/)
  assert.match(mode, /if \(selections\.length === 0\) return 'prototype'/)
  assert.doesNotMatch(map, /setDesktopFallback|GPS 备用地图|OwnerGPSOverview/)
})

'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')
const compiled = ts.transpileModule(read('desktop/src/main/baidu_map_secure_view.cts'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const moduleFixture = { exports: {} }
new Function('module', 'exports', 'require', compiled)(
  moduleFixture, moduleFixture.exports,
  () => { throw new Error('Policy must not have runtime imports') },
)
const {
  xDriveResolveSecureBaiduMapTarget: target,
  xDriveBaiduMapNavigationAllowed: navigate,
  xDriveBaiduMapResourceAllowed: resource,
} = moduleFixture.exports

test('A3c17 exact root HTTPS Server only, including certificate-capable HTTPS IP', () => {
  assert.deepEqual(target('https://gallery.example/'), {
    origin: 'https://gallery.example',
    url: 'https://gallery.example/?places_map_mode=isolated#/app/gallery?section=places',
  })
  assert.deepEqual(target('https://10.1.2.3:8443/'), {
    origin: 'https://10.1.2.3:8443',
    url: 'https://10.1.2.3:8443/?places_map_mode=isolated#/app/gallery?section=places',
  })
  for (const bad of [undefined, null, 1, '', ' https://gallery.example/',
    'http://gallery.example/', 'file:///app/index.html',
    'https://gallery.example/path', 'https://gallery.example/?a=1',
    'https://gallery.example/#fragment',
    'https://user:password@gallery.example/']) {
    assert.equal(target(bad), null)
  }
})

test('A3c17 permits one Origin and no unreviewed external map/CDN egress', () => {
  const o = 'https://gallery.example'
  for (const url of [o + '/?places_map_mode=isolated#/app/gallery?section=places',
    o + '/?places_map_mode=isolated#/app/media-viewer?node=42',
    o + '/index.html?places_map_mode=isolated#/app/gallery?section=places']) {
    assert.equal(navigate(url, o), true)
  }
  for (const url of ['https://evil.example/',
    'https://gallery.example.evil.test/',
    'http://gallery.example/', 'file:///app/index.html',
    o + '/api/v1/auth/login', o + '/?credential=x',
    o + '/#/app/gallery?section=places',
    o + '/?places_map_mode=prototype#/app/gallery?section=places',
    'https://user:pass@gallery.example/']) {
    assert.equal(navigate(url, o), false)
  }
  assert.equal(resource(o + '/_BMapService/api?v=4.0', o), true)
  assert.equal(resource(o + '/api/v1/media/places/baidu-jsapi/session', o), true)
  assert.equal(resource('blob:' + o + '/opaque', o), true)
  assert.equal(resource('data:image/png;base64,AA==', o), true)
  for (const url of ['https://api.map.baidu.com/api?v=4.0&ak=secret',
    'https://cdn.example/font.woff', 'http://gallery.example/api',
    'file:///tmp/secrets', 'blob:https://evil.example/opaque']) {
    assert.equal(resource(url, o), false)
  }
})

test('A3c17 Desktop Gallery launches only the sandboxed independent HTTPS dynamic map', () => {
  const main = read('desktop/src/main/index.cts')
  const preload = read('desktop/src/preload/index.cts')
  const globals = read('desktop/src/renderer/global.d.ts')
  const desktopApp = read('desktop/src/renderer/App.tsx')
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const places = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const webApp = read('web/src/App.tsx')
  assert.match(main, /win\.loadFile\(path\.join\(__dirname, '\.\.', 'renderer', 'index\.html'\)\)/)
  assert.match(main, /randomUUID\(\)/)
  assert.match(main, /contextIsolation: true, nodeIntegration: false/)
  assert.match(main, /sandbox: true, webSecurity: true, webviewTag: false/)
  assert.match(main, /setPermissionRequestHandler/)
  assert.match(main, /setPermissionCheckHandler/)
  assert.match(main, /webRequest\.onBeforeRequest/)
  assert.match(main, /xDriveBaiduMapNavigationAllowed/)
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/)
  assert.match(main, /event\.sender !== mainWindow\.webContents/)
  assert.match(main, /closeSecureBaiduMapWindow\(\)/)
  assert.match(main, /'登录已过期'/)
  assert.match(main, /'账户已禁用'/)
  assert.match(preload, /openBaiduMapSecure: \(scope: unknown\) => ipcRenderer\.invoke\('desktop:open-baidu-map-secure',scope\)/)
  assert.match(globals, /openBaiduMapSecure:/)
  assert.match(desktopApp, /onOpenSecureDesktopMap:\s*\(scope\) => \{/)
  assert.match(desktopApp, /window\.xdriveDesktop\.openBaiduMapSecure\(scope\)/)
  // Electron file pages never load the unisolated SDK. Web may opt into the old
  // same-document prototype, but the Desktop action is always an HTTPS Child.
  assert.match(desktopApp, /galleryPage:\s*\{/)
  assert.match(read('ui/shared/src/mui/XDriveAppPageOutlet.tsx'), /<XDriveMediaGalleryPage/)
  assert.match(places, /const hasMapPorts = Boolean\(/)
  assert.match(places, /activation_state === 'authorized_signed_release'/)
  assert.match(places, /XDriveMediaGalleryBaiduIsolatedPhotoSurface/)
  assert.match(places, /在独立 HTTPS 安全窗口打开动态地图/)
  assert.doesNotMatch(places, /BaiduStaticMap/)
  assert.match(places, /const desktopOnly = Boolean\(onOpenSecureDesktopMap\)/)
  assert.match(places, /const mapMode = desktopOnly \? 'isolated'/)
  assert.match(places, /mode=\{mapMode === 'prototype' \? 'inline' : 'isolated'\}/)
  assert.doesNotMatch(places, /XDriveMediaGalleryBaiduPrototypeMap/)
  assert.match(gallery, /onOpenSecureDesktopMap=\{onOpenSecureDesktopMap\}/)
  // A validated map-scope handoff still has priority over the retained
  // Viewer Gallery section. Neither change may weaken the isolated-child
  // map boundary or open the ordinary unrestricted Library by default.
  assert.match(webApp, /initialSection=\{webMapScopeOwnerReady \? 'places' :\s*xDriveMobileGallerySectionForViewer\(/)
  assert.match(webApp, /route, appView, mobileOwnerScope, retainedGallerySectionRef\.current,/)
  assert.match(webApp,/webMapScopeHandoff\.state!=='none' && !webMapScopeOwnerReady/)
  assert.doesNotMatch(main, /BaiduBrowserAK|BMapSecurityConfig|allowRunningInsecureContent: true/)
  assert.doesNotMatch(preload, /mintBaiduJSAPI4Session/)
  const policy = read('internal/baidumapjsapi/resource_policy.go')
  assert.match(policy, /reviewedJSAPI4ChildResourceCount = 1/)
  assert.match(policy, /return ErrGateClosed/)
})

test('A3c21 isolated HTTPS Electron map forbids executable and unbounded data URLs', () => {
  const origin = 'https://gallery.example'
  for (const accepted of [
    'data:image/png;base64,AA==',
    'data:image/png;base64,sAAA',
    'data:image/jpeg;base64,AA==',
    'data:image/webp;base64,AA==',
    'data:image/gif;base64,AA==',
  ]) assert.equal(resource(accepted, origin), true, accepted)
  for (const denied of [
    'data:text/html,<script>alert(1)</script>',
    'data:text/javascript,alert(1)',
    'data:application/javascript;base64,YWxlcnQoMSk=',
    'data:application/wasm;base64,AA==',
    'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Lz48L3N2Zz4=',
    'data:image/png,AA==',
    'data:image/png;charset=UTF-8;base64,AA==',
    'data:image/png;base64,',
    'data:image/png;base64,!!!',
    'data:image/png;base64,AA==?script=1',
    'data:image/png;base64,AA==#fragment',
    'data:image/png;base64,%41A==',
    'data:image/png;base64,' + 'A'.repeat(1_398_104),
    'data:image/png;base64,' + 'A'.repeat(1_398_108),
  ]) assert.equal(resource(denied, origin), false, denied.slice(0, 120))
})

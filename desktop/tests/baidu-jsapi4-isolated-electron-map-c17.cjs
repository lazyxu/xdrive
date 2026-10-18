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
    url: 'https://gallery.example/#/app/gallery?section=places',
  })
  assert.deepEqual(target('https://10.1.2.3:8443/'), {
    origin: 'https://10.1.2.3:8443',
    url: 'https://10.1.2.3:8443/#/app/gallery?section=places',
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
  for (const url of [o + '/#/app/gallery?section=places',
    o + '/#/app/media-viewer?node=42',
    o + '/index.html#/app/gallery?section=places']) {
    assert.equal(navigate(url, o), true)
  }
  for (const url of ['https://evil.example/',
    'https://gallery.example.evil.test/',
    'http://gallery.example/', 'file:///app/index.html',
    o + '/api/v1/auth/login', o + '/?credential=x',
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

test('A3c17 Desktop segregates file Renderer and HTTPS Map with no token IPC', () => {
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
  assert.match(preload, /openBaiduMapSecure: \(\) => ipcRenderer\.invoke\('desktop:open-baidu-map-secure'\)/)
  assert.match(globals, /openBaiduMapSecure:/)
  assert.match(desktopApp, /onOpenSecureDesktopMap=/)
  assert.match(gallery, /onOpenSecureDesktopMap=\{onOpenSecureDesktopMap\}/)
  assert.match(places, /在独立安全窗口打开地图/)
  assert.match(webApp, /initialSection=\{route\.app === 'gallery'/)
  assert.doesNotMatch(main, /BaiduBrowserAK|BMapSecurityConfig|allowRunningInsecureContent: true/)
  assert.doesNotMatch(preload, /mintBaiduJSAPI4Session/)
  const policy = read('internal/baidumapjsapi/resource_policy.go')
  assert.match(policy, /reviewedJSAPI4ChildResourceCount = 0/)
  assert.match(policy, /return ErrGateClosed/)
})

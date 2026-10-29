'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const targets = {
  page: 'ui/shared/src/mui/ServiceDependenciesPage.tsx',
  baidu: 'ui/shared/src/mui/BaiduServerAPIDetail.tsx',
  browser: 'ui/shared/src/mui/BaiduJSAPIDesiredPanel.tsx',
  core: 'ui/shared/src/mui/CoreDependencyDetail.tsx',
  caddy: 'ui/shared/src/mui/CaddyDetailV1.tsx',
}
const text = Object.fromEntries(Object.entries(targets).map(([id, file]) => [id, read(file)]))

test('all 11 dependency routes and global analysis policy share one responsive detail owner', () => {
  const nav = read('ui/shared/src/system-dependencies-navigation.ts')
  for (const name of [
    'database', 'storage', 'background-worker', 'caddy', 'media-worker',
    'photo-face', 'photo-smart', 'photo-semantic', 'photo-creative',
    'baidu-map', 'geonames',
  ]) {
    assert.ok(nav.includes("'" + name + "'"), 'missing canonical dependency ' + name)
  }
  assert.match(text.page, /data-xdrive-system-dependency-detail\s+sx=\{\{\s*width: '100%', minWidth: 0\s*\}\}/)
  assert.match(text.page, /data-xdrive-flat-dependency-section=\{sectionTab\}\s+sx=\{\{\s*width: '100%', minWidth: 0/)
  assert.match(text.page, /selectedPage === 'photo-auto'/)
  // All the paths used by real Web, Electron Desktop and DSM remain the
  // existing single React/MUI component tree: never fork platform UI.
  assert.match(read('web/src/App.tsx'), /adminServices: serverAdminVerified \? \{/)
  assert.match(read('web/src/browserWorkspaceHost.ts'), /adminServicesPage: ports\.adminServices/)
  // Desktop and DSM route through the same Host outlet; the page itself
  // remains the sole shared XDriveServiceDependenciesPage implementation.
  // Do not require each Host App to import its page directly.
  const desktop = read('desktop/src/renderer/App.tsx')
  const synology = read('web/src/synology.tsx')
  const routeContent = read('ui/shared/src/mui/XDriveAppRouteContent.tsx')
  const sharedApp = read('ui/shared/src/mui/XDriveApp.tsx')
  const outlet = read('ui/shared/src/mui/XDriveAppPageOutlet.tsx')
  // Both Hosts now mount the same route/content frame. Assert the actual
  // dispatch path instead of the removed Desktop-inline outlet syntax.
  assert.match(desktop, /<XDriveApp\b/)
  assert.match(synology, /<XDriveApp\b/)
  assert.doesNotMatch(desktop + synology, /<XDriveAppRouteContent\b/)
  assert.match(sharedApp, /<XDriveAppRouteContent[\s\S]*?host=\{host\}[\s\S]*?view=\{view\}/)
  assert.match(routeContent, /xDriveIsSharedHostPageRoute\(view\)/)
  assert.match(routeContent, /<XDriveAppPageOutlet[\s\S]*host=\{host\}[\s\S]*view=\{view\}/)
  assert.match(outlet, /xDriveWorkspaceRouteRequiresAdmin\(view\) && host\.adminRoleVerified !== true/)
  assert.match(outlet, /case 'admin-services':/)
  assert.match(outlet, /<XDriveServiceDependenciesPage \{\.\.\.services\.adminServicesPage\} \/>/)
})

test('Caddy, PostgreSQL, storage, Worker and Baidu Server all fill the same detail column', () => {
  for (const [kind, id] of [
    ['core', 'data-xdrive-core-dependency-flat'],
    ['caddy', 'data-xdrive-caddy-v1-detail'],
    ['baidu', 'data-xdrive-baidu-server-flat'],
  ]) {
    const source = text[kind]
    assert.ok(source.includes(id), kind + ' retains the canonical detail and anchors')
    assert.match(source, /sx=\{\{\s*width: '100%', minWidth: 0\s*\}\}/,
      kind + ' no longer centers a narrower child pane')
    assert.doesNotMatch(source, /maxWidth:\s*1120|mx:\s*'auto'/,
      kind + ' must not shift its cards inside the parent content column')
  }
})

test('Caddy atomic HTTPS and AliDNS editors use the same 12px vertical rhythm', () => {
  const detail = text.caddy
  const https = read('ui/shared/src/mui/CaddyHTTPSDesiredPanel.tsx')
  const dns = read('ui/shared/src/mui/CaddyAliDNSPanel.tsx')
  assert.match(detail, /data-xdrive-caddy-v1-config sx=\{\{ scrollMarginTop: 72, mt: 1\.5 \}\}/)
  assert.match(detail, /<Stack spacing=\{1\.5\}>/)
  assert.match(https, /mt: atomicMode \? 0 : 1\.5/)
  assert.match(dns, /mt: atomicMode \? 0 : 1\.5/)
  assert.match(detail, /data-xdrive-caddy-v11-atomic-save/)
})

test('Baidu Server and Browser AK are independent controls but one vertical card stack', () => {
  assert.match(text.page,
    /data-xdrive-baidu-jsapi-separate sx=\{\{ width: '100%', minWidth: 0 \}\}/)
  assert.doesNotMatch(text.page, /动态地图 JSAPI 4\.0（独立 Browser AK）/,
    'duplicate outer heading creates a different vertical gap')
  assert.match(text.baidu, /dependency-baidu-map-status-header/)
  assert.match(text.baidu, /dependency-baidu-map-config-header/)
  assert.match(text.baidu, /mt:\s*1\.5/)
  assert.match(text.browser, /data-xdrive-baidu-jsapi4-admin/)
  assert.match(text.browser, /sx=\{\{\s*mt:\s*1\.5/)
  assert.match(text.page, /<XDriveBaiduServerAPIDetail/)
  assert.match(text.page, /<XDriveBaiduJSAPIDesiredPanel/)
  assert.match(text.baidu, /XDriveSensitiveField label="Server AK"/)
  assert.match(text.browser, /XDriveSensitiveField label="Browser AK"/)
})

test('all edited shared React/MUI modules transpile without JSX syntax errors', () => {
  for (const filename of [
    ...Object.values(targets),
    'ui/shared/src/mui/CaddyHTTPSDesiredPanel.tsx',
    'ui/shared/src/mui/CaddyAliDNSPanel.tsx',
  ]) {
    const output = ts.transpileModule(read(filename), {
      fileName: filename, reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    })
    const errors = (output.diagnostics || [])
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    assert.deepEqual(errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
      [], filename)
  }
})

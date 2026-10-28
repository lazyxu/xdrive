'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const content = read('ui/shared/src/mui/XDriveAppRouteContent.tsx')
const app = read('ui/shared/src/mui/XDriveApp.tsx')
const outlet = read('ui/shared/src/mui/XDriveAppPageOutlet.tsx')
const routes = read('ui/shared/src/mui/WorkspaceRoute.ts')
const desktop = read('desktop/src/renderer/App.tsx')
const synology = read('web/src/synology.tsx')
const index = read('ui/shared/src/mui/index.tsx')

test('Desktop and DSM mount one shared route content frame, not separate page routers', () => {
  for (const host of [desktop, synology]) {
    assert.match(host, /<XDriveApp\b/)
    assert.equal((host.match(/<XDriveAppRouteContent\b/g) || []).length, 0,
      'Hosts must not assemble their own route content frames')
    assert.doesNotMatch(host, /<XDriveAppPageOutlet\b/)
    assert.doesNotMatch(host, /<XDriveWorkspaceContent\b/)
  }
  assert.equal((app.match(/<XDriveAppRouteContent\b/g) || []).length, 1)
  assert.match(app, /onNavigate=\{onNavigate\}/)
  assert.match(app, /\{overlays\}/)
  assert.ok(app.indexOf('<XDriveAppRouteContent') < app.indexOf('{overlays}'),
    'dialog overlays must stay outside the page scroll region')
  assert.match(index, /export \* from '\.\/XDriveAppRouteContent'/)
  assert.equal((content.match(/<XDriveAppPageOutlet\b/g) || []).length, 1)
  assert.equal((content.match(/<XDriveWorkspaceContent\b/g) || []).length, 1)
})

test('both Hosts use Files viewport presentation without DSM page padding', () => {
  assert.match(content, /const presentation = xDriveWorkspacePresentation\(view\)/)
  assert.match(content, /presentation=\{presentation\}/)
  assert.match(content, /responsive=\{host\.platform === 'synology'\}/)
  assert.match(content, /sx=\{presentation === 'files' \? undefined : pageSx\}/)
  assert.match(synology, /pageSx=\{\{ p: \{ xs: 2, md: '34px 40px 48px' \} \}\}/)
  assert.doesNotMatch(synology, /presentation="page"/)
  assert.match(routes, /return view === 'files' \? 'files' : 'page'/)
})

test('migrated routes use shared outlet, while legacy Desktop Files retains its controller', () => {
  assert.match(content, /xDriveIsSharedHostPageRoute\(view\)/)
  assert.match(content, /view === 'files' && host\.platform === 'synology'/)
  assert.match(app, /onNavigate=\{onNavigate\}/)
  assert.match(synology, /onNavigate=\{\(key\) => \{/)
  assert.match(synology, /overlays=\{/)
  assert.match(desktop, /overlays=\{<>/)
  assert.match(synology, /revision=\{pageRevision\}/)
  assert.match(desktop, /<DesktopFilesPage\b/)
  assert.doesNotMatch(desktop, /<XDriveAppRouteContent\b/)
  assert.match(app, /<XDriveAppRouteContent/)
  assert.match(app, /revision=\{revision\}/)
  assert.match(app, /pageSx=\{pageSx\}/)
  assert.match(outlet, /xDriveWorkspaceRouteRequiresAdmin\(view\) && host\.adminRoleVerified !== true/)
  assert.match(outlet, /<XDriveSynologyOwnerFilesPage\b/)
  assert.doesNotMatch(content, /window\.xdriveDesktop|fetch\s*\(|backup\.cgi/)
})

test('DSM Owner Files retains a bounded virtual scroll viewport inside the shared Files frame', () => {
  const files = read('ui/shared/src/mui/SynologyOwnerFilesPage.tsx')
  const surface = read('ui/shared/src/mui/WorkspaceSurface.tsx')
  const explorer = read('ui/shared/src/mui/FileExplorer.tsx')
  assert.match(files, /<XDriveFilesWorkspacePage>/)
  assert.equal(files.includes('<XDriveWorkspaceSurface'), false,
    'DSM must not add a second Files page frame or duplicate header')
  assert.match(files, /<Stack spacing=\{1\.5\} sx=\{\{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' \}\}/)
  assert.match(surface, /fillHeight \? \{/)
  assert.match(surface, /height: '100%'/)
  assert.match(surface, /flexDirection: 'column'/)
  assert.match(explorer, /data-xdrive-file-explorer-scroll-host/)
  assert.match(explorer, /flex: presentation === 'workspace' \? 1 : undefined/)
})

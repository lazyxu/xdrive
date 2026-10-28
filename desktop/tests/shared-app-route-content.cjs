'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const content = read('ui/shared/src/mui/XDriveAppRouteContent.tsx')
const outlet = read('ui/shared/src/mui/XDriveAppPageOutlet.tsx')
const routes = read('ui/shared/src/mui/WorkspaceRoute.ts')
const desktop = read('desktop/src/renderer/App.tsx')
const synology = read('web/src/synology.tsx')
const index = read('ui/shared/src/mui/index.tsx')

test('Desktop and DSM mount one shared route content frame, not separate page routers', () => {
  for (const host of [desktop, synology]) {
    assert.match(host, /<XDriveApp\b/)
    assert.equal((host.match(/<XDriveAppRouteContent\b/g) || []).length, 1)
    assert.doesNotMatch(host, /<XDriveAppPageOutlet\b/)
    assert.doesNotMatch(host, /<XDriveWorkspaceContent\b/)
  }
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
  assert.match(synology, /onNavigate=\{navigate\}/)
  assert.match(synology, /revision=\{pageRevision\}/)
  assert.match(desktop, /<DesktopFilesPage\b/)
  assert.match(desktop, /<XDriveAppRouteContent host=\{workspaceHost\} view=\{view\}>/)
  assert.match(outlet, /xDriveWorkspaceRouteRequiresAdmin\(view\) && host\.adminRoleVerified !== true/)
  assert.match(outlet, /<XDriveSynologyOwnerFilesPage\b/)
  assert.doesNotMatch(content, /window\.xdriveDesktop|fetch\s*\(|backup\.cgi/)
})

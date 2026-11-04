import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const route = read('ui/shared/src/mui/WorkspaceRoute.ts')
const compiled = ts.transpileModule(route, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
})
assert.equal(compiled.diagnostics?.length ?? 0, 0, 'Notes workspace route transpiles')
const registry = await import('data:text/javascript;base64,' +
  Buffer.from(compiled.outputText).toString('base64'))
assert.equal(registry.xDriveIsWorkspaceAppRoute('notes'), true,
  'Desktop, DSM and Web must admit the same Notes workspace route')
assert.equal(registry.xDriveWorkspaceNavigationAllowed('notes', false), true,
  'Notes is an Owner feature and must not require admin status')
assert.equal(registry.xDriveWorkspaceRouteRequiresAdmin('notes'), false)

const titles = read('ui/shared/src/mui/WorkspaceRouteTitles.ts')
const namespace = read('internal/api/notes_namespace.go')
assert.match(namespace, /const notesRootDirectory = "@笔记"/)
assert.match(namespace, /const notesMineDirectory = "我的笔记"/)
assert.match(titles, /notes: '笔记'/)
const shared = read('ui/shared/src/mui/XDriveAppPageOutlet.tsx')
assert.match(shared, /case 'notes':/)
assert.match(shared, /if \(services\.notesPage\) page = <XDriveNotesPage port=\{services\.notesPage\} \/>/)
const host = read('ui/shared/src/mui/WorkspaceHostAdapter.ts')
assert.match(host, /readonly notesPage\?: XDriveNotesDataPort/)
const hostSections = read('ui/shared/src/mui/WorkspaceHostSections.tsx')
assert.match(hostSections, /showNotes = false/)
assert.match(hostSections, /key: 'notes'/)
assert.match(hostSections, /xDriveWorkspaceRouteTitle\('notes'\)/)
const coreSidebar = read('ui/shared/src/mui/WorkspaceNavigation.tsx')
assert.doesNotMatch(coreSidebar, /key: 'notes'/,
  'Unverified Desktop or DSM Hosts must not expose a Notes core route')

const ids = read('ui/shared/src/web-app.ts')
assert.match(ids, /'notes',/)
assert.match(ids, /notes: Record<string, never>/)
assert.match(ids, /case 'notes':/)
const app = read('web/src/webApps.ts')
assert.match(app, /notes: \{ id: 'notes', title: xDriveWorkspaceRouteTitle\('notes'\)/)
assert.match(app, /workspaceKey: 'notes', sidebar: true/)
const groups = read('web/src/mobileLauncherSections.ts')
assert.match(groups, /keys: \['files', 'notes', 'shares'/)
const launcher = read('web/src/MobileFiveSlotNavigation.tsx')
assert.match(launcher, /case 'notes': return <NotesRoundedIcon/)
const browserHost = read('web/src/browserWorkspaceHost.ts')
assert.match(browserHost, /notes\?: NonNullable<XDriveWorkspaceHostServices\['notesPage'\]>/)
assert.match(browserHost, /ports\.notes \? \{ notesPage: ports\.notes \}/)

const web = read('web/src/App.tsx')
assert.match(web, /createXDriveWebNotesPort\(api, /)
assert.match(web, /mobileOwnerScope\s*\n\s*\? createXDriveWebNotesPort/,
  'Only an authenticated matching Owner /me may create a Notes API port')
assert.match(web, /notes: notesPort,/)
assert.match(web, /showNotes: Boolean\(notesPort\)/)
assert.match(web, /appView === 'notes' \|\| appView === 'shares'/)
assert.match(web, /<XDriveAppPageOutlet host=\{browserWorkspaceHost\} view=\{appView\}/)
assert.doesNotMatch(web, /appView === 'notes' \? <iframe/i,
  'Do not introduce a second Notes UI or WKWebView-like route')
console.log('Notes shared workspace, Web All launcher, and authenticated Owner host routing: PASS')

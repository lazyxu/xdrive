const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const webApp = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'App.tsx'), 'utf8')

test('Web AppBar keeps global chrome compact while admin tools live in the sidebar', () => {
  const appStart = webApp.indexOf('<AppBar position="static" elevation={1}>', webApp.indexOf('className="app-shell"'))
  const appEnd = webApp.indexOf('</AppBar>', appStart)
  assert.notEqual(appStart, -1, 'missing Web AppBar')
  assert.notEqual(appEnd, -1, 'missing Web AppBar end')
  const appBar = webApp.slice(appStart, appEnd)

  assert.ok(appBar.includes('WebAccountMenu'), 'Web AppBar must retain the account menu')
  assert.equal(appBar.includes('用户管理'), false, 'User Management should not remain in the AppBar')
  assert.equal(appBar.includes('审计日志'), false, 'Audit should not remain in the AppBar')
  assert.equal(appBar.includes('全局存储'), false, 'Global Storage should not remain in the AppBar')

  const asideStart = webApp.indexOf('component="aside"')
  const asideEnd = webApp.indexOf('<Box component="main"', asideStart)
  assert.notEqual(asideStart, -1, 'missing Web sidebar')
  assert.notEqual(asideEnd, -1, 'missing Web main content after sidebar')
  const sidebar = webApp.slice(asideStart, asideEnd)

  assert.ok(sidebar.includes("profile?.role === 'admin'"), 'admin navigation must remain role-gated')
  assert.ok(sidebar.includes('aria-label="管理员功能"'), 'missing admin navigation landmark')
  for (const label of ['管理', '用户管理', '审计日志', '全局存储']) {
    assert.ok(sidebar.includes(label), `missing admin sidebar label: ${label}`)
  }
  assert.ok(sidebar.includes('ManageAccountsRoundedIcon'), 'missing User Management icon')
  assert.ok(sidebar.includes('AssessmentRoundedIcon'), 'missing Audit icon')
  assert.ok(sidebar.includes("setStorageStatsScope('global')"), 'Global Storage action must preserve the existing modal behavior')
})


test('Web first-class workspaces share the same page chrome', () => {
  assert.ok(webApp.includes("import WorkspaceSurface from './WorkspaceSurface'"), 'Web app should reuse the shared Web workspace surface')
  assert.equal((webApp.match(/<WorkspaceSurface presentation="page"/g) || []).length, 2, 'Files and Gallery should both use WorkspaceSurface page chrome')
  assert.ok(webApp.includes('<WorkspaceSurface presentation="page" title="文件">'), 'Files page title must use workspace page chrome')
  assert.ok(webApp.includes('<WorkspaceSurface presentation="page" title="图库">'), 'Gallery page title must use workspace page chrome')
  assert.ok(webApp.includes('<ExternalSourcesPanel') && webApp.includes('presentation="page"'), 'External Sources should remain a first-class page')
  assert.ok(webApp.includes('<StorageStatsModal') && webApp.includes('scope="self"'), 'Storage should remain a first-class page')
})

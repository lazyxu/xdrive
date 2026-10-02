const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const shared = read('ui', 'shared', 'src', 'mui', 'SidebarNav.tsx')
const web = read('web', 'src', 'App.tsx')
const desktop = read('desktop', 'src', 'renderer', 'App.tsx')

test('core workspace navigation labels, icons and order live in shared MUI', () => {
  assert.ok(shared.includes("export type XDriveCoreWorkspaceKey = 'files' | 'gallery' | 'sources' | 'transfers' | 'storage'"))
  assert.ok(shared.includes('export function XDriveCoreWorkspaceNavItems'))
  const labels = ['primary="文件"', 'primary="图库"', 'primary="同步文件夹"', 'primary="传输"', 'primary="存储"']
  let cursor = -1
  for (const label of labels) {
    const next = shared.indexOf(label)
    assert.ok(next > cursor, `shared core navigation order missing or changed: ${label}`)
    cursor = next
  }
  for (const icon of ['FolderRoundedIcon', 'PhotoLibraryRoundedIcon', 'CloudSyncRoundedIcon', 'SwapVertRoundedIcon', 'StorageRoundedIcon']) {
    assert.ok(shared.includes(icon), `shared core navigation icon missing: ${icon}`)
  }
  assert.ok(shared.includes('badge={transferBadge}'), 'shared transfer destination must own the transfer badge slot')
})

test('Web and Desktop consume shared core navigation without duplicating its labels', () => {
  assert.equal((web.match(/<XDriveCoreWorkspaceNavItems\b/g) || []).length, 1)
  assert.equal((desktop.match(/<XDriveCoreWorkspaceNavItems\b/g) || []).length, 1)
  for (const label of ['primary="文件"', 'primary="图库"', 'primary="同步文件夹"', 'primary="传输"', 'primary="存储"']) {
    assert.equal(web.includes(label), false, `Web must not duplicate core nav label: ${label}`)
    assert.equal(desktop.includes(label), false, `Desktop must not duplicate core nav label: ${label}`)
  }
  assert.ok(web.includes('primary="全局存储"'), 'Web admin storage remains platform-specific')
  assert.ok(desktop.includes('primary="概览"'), 'Desktop overview remains platform-specific')
  assert.ok(desktop.includes('primary="冲突"'), 'Desktop conflicts remain platform-specific')
  assert.ok(desktop.includes('primary="诊断"'), 'Desktop diagnostics remain platform-specific')
  assert.ok(desktop.includes("if (destination === 'files') setView('cloud')"), 'Desktop must adapt shared Files to its cloud view')
  assert.ok(desktop.includes("else if (destination === 'storage') setView('files')"), 'Desktop must adapt shared Storage to its local view key')
})

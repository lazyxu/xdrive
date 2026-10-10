const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const model = read('ui', 'shared', 'src', 'web-app.ts')
const explorer = read('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
const gallery = read('ui', 'shared', 'src', 'mui', 'MediaGallery.tsx')
const webExplorer = read('web', 'src', 'WebFileExplorer.tsx')
const app = read('web', 'src', 'App.tsx')
const fallback = read('web', 'src', 'WebUnsupportedFileDialog.tsx')
const desktop = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')

test('Web App Registry includes all current first-party programs', () => {
  for (const id of [
    'overview', 'files', 'gallery', 'sync-folders', 'device-backup', 'remote-pull', 'tasks',
    'local-storage', 'cloud-storage', 'preview', 'media-viewer',
    'text-viewer', 'pdf-viewer', 'audio-player',
    'admin-users', 'admin-audit', 'admin-storage',
  ]) {
    assert.ok(model.includes(`'${id}'`), 'missing Web App id: ' + id)
  }
})

test('unsupported Web Open is explicit and never silently becomes Download', () => {
  assert.ok(app.includes('setUnsupportedOpenNode(node)'))
  assert.ok(app.includes('<WebUnsupportedFileDialog'))
  for (const token of [
    '无可用的 Web 打开程序',
    '文件不会被自动下载',
    'startIcon={<InfoOutlinedIcon />}',
    'startIcon={<ShareRoundedIcon />}',
    'startIcon={<DownloadRoundedIcon />}',
    '属性',
    '分享',
    '下载',
    '<XDriveFilePropertiesDialog',
    '<XDriveShareDialog',
  ]) {
    assert.ok(fallback.includes(token), 'unsupported-file fallback missing: ' + token)
  }
})

test('Desktop Quick Look keeps Open after ordinary Desktop Open becomes system-native', () => {
  assert.ok(desktop.includes("onOpen: node.type === 'file'"))
  assert.ok(desktop.includes('void openLocalNode(node)'))
  assert.equal(desktop.includes('onSystemOpen: node.type'), false)
  assert.ok(
    explorer.includes("['open', 'system-open', 'download', 'share']"),
    'Quick Look must accept ordinary Open as the native Desktop open action',
  )
})

test('Web browser-tab action remains adjacent to Open rather than after Delete', () => {
  for (const token of [
    "id: 'open-browser-tab'",
    'const insertionIndex = standardItems.findIndex',
    "entry.id !== 'open' && entry.id !== 'open-new-tab'",
    'standardItems.slice(0, index)',
    'standardItems.slice(index)',
  ]) {
    assert.ok(webExplorer.includes(token), 'browser-tab menu ordering missing: ' + token)
  }
})

test('Gallery deep-link section is applied once per route value', () => {
  for (const token of [
    'routeSectionAppliedRef',
    "const nextSection = initialSection ?? 'library'",
    'routeSectionAppliedRef.current === nextSection',
    'routeSectionAppliedRef.current = nextSection',
  ]) {
    assert.ok(gallery.includes(token), 'Gallery route section guard missing: ' + token)
  }
})

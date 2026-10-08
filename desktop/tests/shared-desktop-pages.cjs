const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')
const overview = read('desktop', 'src', 'renderer', 'DesktopOverviewPage.tsx')
const sharedHome = read('ui', 'shared', 'src', 'mui', 'HomePage.tsx')
const conflicts = read('desktop', 'src', 'renderer', 'DesktopConflictsPage.tsx')
const styles = read('desktop', 'src', 'renderer', 'styles.css')
const metrics = read('ui', 'shared', 'src', 'mui', 'MetricCards.tsx')

test('Desktop home prioritizes user work and actions over diagnostic internals', () => {
  assert.ok(metrics.includes('sx?: SxProps<Theme>'))
  assert.ok(metrics.includes('...(Array.isArray(sx) ? sx : sx ? [sx] : [])'))
  assert.ok(overview.includes('<XDriveHomePage'))
  assert.ok(sharedHome.includes('title="主页"'))
  assert.equal((sharedHome.match(/<XDriveMetricCard\b/g) || []).length, 4)
  for (const token of [
    'title="快捷操作"',
    "itemSection('最近使用'",
    "itemSection('收藏'",
    '打开 xDrive 文件夹',
    '上传文件',
    '上传文件夹',
    '新建文件夹',
    '云端文件',
    '图库',
    '传输',
    'title="最近活动"',
  ]) assert.ok(sharedHome.includes(token), `shared Home missing: ${token}`)
  for (const token of [
    'cloudFileRecent(6)',
    'cloudFileFavorites()',
    'openPath(relativePath)',
    '本地磁盘空间不足',
    'getLocalDiskSpace()',
    'failedTransfer',
    'failedOperation',
    'failedBackgroundTask',
  ]) assert.ok(overview.includes(token), `Desktop Home adapter missing: ${token}`)
  for (const diagnostic of ['IPC ', 'title="Agent"', '修订号', '桌面桥接']) {
    assert.equal(overview.includes(diagnostic), false, `Desktop home must not expose diagnostic chrome: ${diagnostic}`)
  }
  assert.ok(sharedHome.includes('<Paper variant="outlined"'))
  for (const legacy of ['status-grid', 'status-card', 'status-dot', 'system-card']) {
    assert.equal(overview.includes(legacy), false)
    assert.equal(styles.includes(`.${legacy}`), false)
  }
})

test('Desktop conflicts uses standard MUI surfaces instead of bespoke conflict-row CSS', () => {
  for (const token of [
    "import { Box, Paper, Stack, Typography } from '@mui/material'",
    '<Stack spacing={1.25} sx={{ mt: 2.25 }}>',
    'variant="outlined"',
    "flexDirection: { xs: 'column', md: 'row' }",
    "overflowWrap: 'anywhere'",
    'useFlexGap',
  ]) assert.ok(conflicts.includes(token), `missing: ${token}`)
  for (const legacy of ['conflict-list', 'conflict-row', 'conflict-copy', 'row-actions']) {
    assert.equal(conflicts.includes(legacy), false)
    assert.equal(styles.includes(`.${legacy}`), false)
  }
  assert.ok(conflicts.includes('<XDriveStatePanel message="没有未解决的冲突。" />'))
})


test('Desktop home delegates file creation actions back to FileExplorer', () => {
  const app = read('desktop', 'src', 'renderer', 'App.tsx')
  const explorer = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
  for (const token of [
    'requestCloudFileAction',
    'actionIntent: cloudFileActionIntent',
    'onActionIntentConsumed',
  ]) assert.ok(app.includes(token), 'Desktop App missing delegated file action: ' + token)
  for (const token of [
    "actionIntent.action === 'upload-files'",
    "actionIntent.action === 'upload-folder'",
    'setCreateOpen(true)',
    'folderUploadInputRef.current?.click()',
    'void uploadFiles()',
  ]) assert.ok(explorer.includes(token), 'FileExplorer action intent missing: ' + token)
  assert.equal(
    overview.includes('cloudUploadFile(') || overview.includes('cloudCreateDirectory('),
    false,
    'Home must not duplicate FileExplorer upload/create transport logic',
  )
})

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const source = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'BackgroundTaskCenter.tsx'), 'utf8')

test('global background tasks switch from table to cards below the shared 900px boundary', () => {
  for (const token of [
    "useMediaQuery('(max-width:899.95px)')",
    'data-xdrive-background-task-mobile-list',
    'aria-label="全局后台任务"',
    'ownerLabel={',
    'data-xdrive-background-task-owner',
  ]) {
    assert.ok(source.includes(token), 'mobile global-task contract missing: ' + token)
  }
})

test('desktop global background task table remains available', () => {
  for (const token of [
    '<XDriveTableSurface>',
    '<Table size="small" aria-label="全局后台任务">',
    '<TableCell>用户</TableCell>',
    '<TableCell>运维信息</TableCell>',
    '<BackgroundTaskControls',
  ]) {
    assert.ok(source.includes(token), 'desktop global-task table contract missing: ' + token)
  }
})

test('mobile global task cards keep focus, controls and operational metadata through shared item rendering', () => {
  for (const token of [
    'focused={task.id === focusedTaskID}',
    'onControl={onControl}',
    '<BackgroundTaskOperationalMetadata task={task} />',
    'data-xdrive-background-task-id={task.id}',
  ]) {
    assert.ok(source.includes(token), 'shared mobile task-card behavior missing: ' + token)
  }
})

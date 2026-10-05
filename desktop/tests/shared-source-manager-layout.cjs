const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const sourceManager = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8')
const sourceDialogs = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManagerDialogs.tsx'), 'utf8')
const webStyles = fs.readFileSync(path.join(repo, 'web', 'src', 'styles.css'), 'utf8')

test('shared SourceManager owns list spacing without Web-only legacy CSS', () => {
  assert.ok(sourceManager.includes('<Stack spacing={1.75}>'), 'shared SourceManager should own the 14px list gap')
  assert.equal(sourceManager.includes('className="external-source-list"'), false, 'shared SourceManager must not depend on Web list CSS')

  for (const selector of [
    '.external-source-list',
    '.external-source-card-header',
    '.external-source-card-meta',
    '.external-source-subtitle',
    '.external-source-time',
    '.external-source-stats',
    '.external-source-empty',
    '.external-source-actions',
  ]) {
    assert.equal(webStyles.includes(selector), false, `Web must not retain legacy Source CSS: ${selector}`)
  }
})


test('SourceManager delegates secondary dialogs to an internal shared module', () => {
  for (const component of [
    'XDriveSourceFailedItemsDialog',
    'XDriveSourceDeleteConfirmDialog',
    'XDriveSourceClearCredentialDialog',
    'XDriveSourceErrorDialog',
  ]) {
    assert.ok(sourceManager.includes(`<${component}`), `SourceManager must render ${component}`)
    assert.ok(sourceDialogs.includes(`export function ${component}`), `missing internal Source dialog component: ${component}`)
  }

  for (const token of [
    'XDriveDialogTitle',
    'XDriveDialogContent',
    'XDriveDialogActions',
    'XDriveSourceFailureItem',
    'formatSize(item.size)',
    '已经同步到 xDrive 的文件会保留，不会删除',
    '该 Pull 同步文件夹会自动暂停',
    'whiteSpace: \'pre-wrap\'',
  ]) {
    assert.ok(sourceDialogs.includes(token), `SourceManagerDialogs missing: ${token}`)
  }

  assert.equal(sourceManager.includes('DialogContentText'), false, 'secondary confirmation copy must not remain in SourceManager')
  assert.equal(sourceManager.includes('title="失败文件"'), false, 'failed-item dialog chrome must not remain inline')
  assert.equal(sourceManager.includes('title="删除同步文件夹？"'), false, 'delete dialog chrome must not remain inline')
  assert.equal(sourceManager.includes("title={errorDialog?.title ?? '操作失败'}"), false, 'error dialog chrome must not remain inline')
})

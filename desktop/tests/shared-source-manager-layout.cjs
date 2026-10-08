const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const sourceManager = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8')
const sourceDialogs = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManagerDialogs.tsx'), 'utf8')
const sourceDetails = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManagerDetailsDialog.tsx'), 'utf8')
const sourceCreate = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManagerCreateDialog.tsx'), 'utf8')
const sourceSettings = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManagerSettingsDialog.tsx'), 'utf8')
const sourceList = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManagerListPage.tsx'), 'utf8')
const webStyles = fs.readFileSync(path.join(repo, 'web', 'src', 'styles.css'), 'utf8')

test('shared SourceManager list page owns list spacing without Web-only legacy CSS', () => {
  assert.ok(sourceManager.includes('<XDriveSourceManagerListPage'), 'SourceManager must delegate the list page')
  assert.ok(sourceList.includes('<Stack spacing={1.75}>'), 'shared Source list page should own the 14px list gap')
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
    'formatBytes(item.size)',
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


test('SourceManager delegates the read-only detail workspace to an internal module', () => {
  assert.ok(sourceManager.includes('<XDriveSourceDetailsDialog'), 'SourceManager must delegate the details dialog')
  assert.ok(sourceDetails.includes('export function XDriveSourceDetailsDialog'), 'missing SourceManager details module')
  for (const token of [
    'XDriveDescriptionGrid',
    'XDriveSourceCollectionSummary',
    'XDriveSourceCollectionItem',
    'XDriveSourceRunSummary',
    'XDriveSourceRunProgress',
    'XDriveSourceFailureItem',
    'XDrivePaginationControls',
    'collectionPageSize',
    'historyPageSize',
    'runFailurePageSize',
    '复制运行 ID',
    '相册与集合',
    '同步历史',
    '下一次扫描会自动重试',
  ]) {
    assert.ok(sourceDetails.includes(token), `SourceManagerDetailsDialog missing: ${token}`)
  }
  assert.equal(sourceManager.includes('open={!!selected}'), false, 'details dialog shell must not remain inline')
  assert.equal(sourceManager.includes('<XDriveSourceRunSummary'), false, 'run-history presentation must not remain inline')
  assert.equal(sourceManager.includes('<XDriveSourceCollectionSummary'), false, 'collection presentation must not remain inline')
})


test('SourceManager keeps pagination request policy in the parent controller', () => {
  for (const token of [
    'SOURCE_HISTORY_PAGE_SIZE = 20',
    'SOURCE_RUN_FAILURE_PAGE_SIZE = 20',
    'SOURCE_COLLECTION_ITEM_PAGE_SIZE = 50',
    'collectionPageSize={SOURCE_COLLECTION_ITEM_PAGE_SIZE}',
    'historyPageSize={SOURCE_HISTORY_PAGE_SIZE}',
    'runFailurePageSize={SOURCE_RUN_FAILURE_PAGE_SIZE}',
  ]) {
    assert.ok(sourceManager.includes(token), `SourceManager pagination policy missing: ${token}`)
  }
  assert.equal(sourceDetails.includes('export const SOURCE_HISTORY_PAGE_SIZE'), false, 'details UI must not define history request size')
  assert.equal(sourceDetails.includes('export const SOURCE_RUN_FAILURE_PAGE_SIZE'), false, 'details UI must not define failure request size')
  assert.equal(sourceDetails.includes('export const SOURCE_COLLECTION_ITEM_PAGE_SIZE'), false, 'details UI must not define collection request size')
})


test('SourceManager delegates the create dialog to an internal presentation module', () => {
  assert.ok(sourceManager.includes('<XDriveSourceCreateDialog'), 'SourceManager must delegate the create dialog')
  for (const token of [
    'export function XDriveSourceCreateDialog',
    'XDriveSourcePresetField',
    'XDriveSourceNameField',
    'XDriveSourceRunModeField',
    'XDriveSourceSyncModeField',
    'XDriveSourceScheduleFields',
    'XDriveSourceIgnoreRulesField',
    'XDriveSourceCookieField',
    'XDriveSynologyDsmCredentialFields',
    'XDriveSynologyPhotoSpacesField',
    'XDriveSynologyFileRootsField',
    'XDriveYikeCookieHelp',
    '固定逻辑目录',
    '目标文件夹',
    'Synology DSM 连接',
  ]) {
    assert.ok(sourceCreate.includes(token), `SourceManagerCreateDialog missing: ${token}`)
  }

  assert.equal(/adapter\./.test(sourceCreate), false, 'create dialog presentation must not call the Source adapter')
  assert.equal(/use(?:State|Effect)\(/.test(sourceCreate), false, 'create dialog presentation must not own async/state orchestration')
  assert.equal(sourceManager.includes('<Dialog\n        open={createOpen}'), false, 'raw create Dialog shell must not remain inline')
  assert.equal(sourceManager.includes('title="添加同步文件夹"'), false, 'create Dialog title must not remain inline')
  assert.equal(sourceManager.includes('<XDriveSourcePresetField'), false, 'create preset field must not remain inline')
  assert.equal(sourceManager.includes('固定逻辑目录：{yikeManagedTargetLabel}'), false, 'create target presentation must not remain inline')
})


test('SourceManager delegates the settings dialog to an internal presentation module', () => {
  assert.ok(sourceManager.includes('<XDriveSourceSettingsDialog'), 'SourceManager must delegate the settings dialog')
  for (const token of [
    'export function XDriveSourceSettingsDialog',
    'XDriveSourceNameField',
    'XDriveSourceRunModeField',
    'XDriveSourceSyncModeField',
    'XDriveSourceStatusField',
    'XDriveSourceTargetField',
    'XDriveSourceScheduleFields',
    'XDriveSourceIgnoreRulesField',
    'XDriveStoredCredentialField',
    'XDriveSourceCookieField',
    'XDriveSynologyDsmCredentialFields',
    'XDriveSynologyPhotoSpacesField',
    'XDriveSynologyFileRootsField',
    'XDriveYikeCookieHelp',
    '一刻相册凭据',
    'Synology DSM 凭据',
    '保存设置',
  ]) {
    assert.ok(sourceSettings.includes(token), `SourceManagerSettingsDialog missing: ${token}`)
  }

  assert.equal(/adapter\./.test(sourceSettings), false, 'settings dialog presentation must not call the Source adapter')
  assert.equal(/use(?:State|Effect)\(/.test(sourceSettings), false, 'settings dialog presentation must not own async/state orchestration')
  assert.equal(sourceManager.includes('<Dialog\n        open={!!setting}'), false, 'raw settings Dialog shell must not remain inline')
  assert.equal(sourceManager.includes('<XDriveSourceStatusField'), false, 'settings status field must not remain inline')
  assert.equal(sourceManager.includes('title="一刻相册凭据"'), false, 'settings credential presentation must not remain inline')
  assert.ok(sourceManager.includes('adapter.sourceBrowseDirectories(settingsSourceID'), 'File Station browse transport must remain in the parent controller')
})


test('SourceManager delegates the list page to an internal presentation module', () => {
  for (const token of [
    'export function XDriveSourceManagerListPage',
    'XDriveWorkspaceSurface',
    'XDriveSourceSummaryCard',
    'XDriveSourceKindIcon',
    'XDriveStatePanel',
    'externalSourceCardView',
    'externalSourceTriggerActionLabel',
    'formatExternalSourceTime',
    '添加同步文件夹',
    '查看最近错误',
    'DSM 配置',
    '正在取消…',
  ]) {
    assert.ok(sourceList.includes(token), `SourceManagerListPage missing: ${token}`)
  }

  assert.equal(/adapter\./.test(sourceList), false, 'list page presentation must not call the Source adapter')
  assert.equal(/use(?:State|Effect)\(/.test(sourceList), false, 'list page presentation must not own async/state orchestration')
  assert.equal(sourceManager.includes('<XDriveWorkspaceSurface'), false, 'workspace page chrome must not remain inline')
  assert.equal(sourceManager.includes('<XDriveSourceSummaryCard'), false, 'source summary cards must not remain inline')
  assert.equal(sourceManager.includes('externalSourceCardView(row)'), false, 'list view-model mapping must not remain inline')
})


test('long Source dialogs reuse the shared compact-touch full-screen contract', () => {
  const dialogTitle = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'DialogTitle.tsx'), 'utf8')
  assert.ok(dialogTitle.includes('export function useXDriveCompactTouchDialog()'))

  for (const [name, source] of [
    ['create', sourceCreate],
    ['settings', sourceSettings],
    ['details', sourceDetails],
  ]) {
    assert.ok(source.includes('useXDriveCompactTouchDialog()'), name + ' Source dialog must consume shared compact Dialog hook')
    assert.ok(source.includes('fullScreen={compactTouch}'), name + ' Source dialog must become full-screen on compact touch')
    assert.ok(source.includes('slotProps={{ paper: dialogPaper }}'), name + ' Source dialog must use responsive paper props')
  }

  assert.ok(sourceDialogs.includes('const { compactTouch, dialogPaper } = useXDriveCompactTouchDialog()'))
  assert.ok(sourceDialogs.includes('fullScreen={compactTouch}'), 'failed-items Source dialog must become full-screen on compact touch')
  assert.ok(sourceDialogs.includes('slotProps={{ paper: dialogPaper }}'))

  assert.ok(sourceDialogs.includes('title="删除同步文件夹？"'))
  assert.ok(sourceDialogs.includes('title={`清除已保存的${credentialLabel}？`}'))
  assert.equal(
    (sourceDialogs.match(/fullScreen=\{compactTouch\}/g) || []).length,
    1,
    'short Source confirmation/error dialogs must remain ordinary modals',
  )
})

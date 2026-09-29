const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8')
const synologyGuide = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SynologyDsmGuideDialog.tsx'), 'utf8')
const dialogTitle = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'DialogTitle.tsx'), 'utf8')
const dialogActions = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'DialogActions.tsx'), 'utf8')
const sharedActionButton = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'ActionButton.tsx'), 'utf8')
const sharedStatePanel = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'StatePanel.tsx'), 'utf8')
const sharedStatusBadge = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'StatusBadge.tsx'), 'utf8')
const sharedStatusAlert = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'StatusAlert.tsx'), 'utf8')
const sharedShareStatusBadge = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'ShareStatusBadge.tsx'), 'utf8')
const sharedYikeCookieHelp = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'YikeCookieHelp.tsx'), 'utf8')
const sharedExternalSources = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'external-sources.ts'), 'utf8')
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8')
const main = fs.readFileSync(path.join(root, 'src', 'main', 'index.cts'), 'utf8')
const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8')

test('desktop renderer default export is the full App root, not a helper component', () => {
  assert.match(renderer, /export default function App\(\)/)
  assert.equal(renderer.includes('export default function YikeCookieHelpGuide()'), false)
})

test('desktop GUI defaults to Chinese', () => {
  for (const text of [
    '概览',
    '云端文件',
    '外部来源',
    '立即扫描',
    '来源设置',
    '保存设置',
    '添加外部来源',
    '目标文件夹',
    '添加来源',
    '传输中心',
    '存储策略',
    '冲突副本',
    '客户端诊断',
    '客户端设置',
    '客户端更新',
    '更新来源',
    'GitHub',
    'GitLab',
    '关闭窗口时最小化到系统托盘',
    '手动检查',
    '自动检查',
    '有更新自动下载',
    '自动更新',
    '检查更新',
    '下载更新',
    '创建分享链接',
  ]) {
    assert.ok(renderer.includes(text), `missing Chinese desktop label: ${text}`)
  }

  for (const text of [
    '打开 xDrive 桌面版',
    '设置',
    '打开 xDrive 文件夹',
    '立即同步',
    '暂停同步',
    '退出 xDrive 桌面版',
    '客户端更新',
    '检查更新',
    '关闭 xDrive 桌面版',
    '最小化到托盘',
    '选择 xDrive 同步文件夹',
  ]) {
    assert.ok(main.includes(text), `missing Chinese desktop system label: ${text}`)
  }

  for (const text of ['群晖 DSM 配置', 'DSM 操作示意图', '上一步', '下一步', '完成']) {
    assert.ok(synologyGuide.includes(text), `missing Chinese Synology guide label: ${text}`)
  }

  assert.match(html, /<html lang="zh-CN">/)
  assert.match(html, /<title>xDrive 桌面版<\/title>/)
})

test('desktop auth uses one full-body frame instead of a floating card', () => {
  assert.ok(renderer.includes('className="auth-panel auth-panel-form"'), 'login/password forms must use the shared auth content surface')
  assert.ok(styles.includes('.center-shell { width: calc(100% - 40px); height: calc(100% - 40px); min-height: 0; margin: 20px; overflow: auto; display: grid; place-items: center; padding: 24px; border: 1px solid var(--border-strong); border-radius: 14px; background: transparent; }'), 'auth shell must own the single visible frame')
  assert.ok(styles.includes('.auth-panel { width: min(520px,100%); border: 0; border-radius: 0; padding: 0; background: transparent; box-shadow: none; }'), 'auth content must stay borderless inside the single frame')
  assert.ok(styles.includes('.auth-panel-form .auth-form { padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }'), 'nested auth form surface must stay transparent and borderless')
  assert.ok(styles.includes('.center-shell { width: calc(100% - 24px); height: calc(100% - 24px); margin: 12px; padding: 18px; }'), 'compact auth frame spacing is missing')
  assert.equal(styles.includes('radial-gradient(circle at 20% 10%'), false, 'auth shell should not add a second decorative surface')
  assert.equal(styles.includes('box-shadow: 0 20px 55px'), false, 'auth surface should not retain the old floating-card shadow')
})

test('desktop custom titlebar owns the single shared application icon', () => {
  assert.ok(renderer.includes("import xDriveBrandIcon from '../../../assets/icon/master/xdrive-icon-master.svg'"), 'missing shared desktop brand icon import')
  assert.equal((renderer.match(/src=\{xDriveBrandIcon\}/g) || []).length, 1, 'desktop should render the shared icon only once in the custom titlebar')
  assert.ok(renderer.includes('desktop-titlebar-icon'), 'missing custom titlebar brand icon')
  assert.equal(renderer.includes('<div className="brand-mark">x</div>'), false, 'legacy text x brand mark remains')
})

test('desktop keeps sync controls global instead of repeating page status actions', () => {
  const start = renderer.indexOf('<header className="topbar">')
  const end = renderer.indexOf('</header>', start)
  assert.notEqual(start, -1, 'missing desktop topbar')
  assert.notEqual(end, -1, 'missing desktop topbar end')
  const topbar = renderer.slice(start, end)

  assert.ok(topbar.includes('<h1>{viewLabel(view)}</h1>'), 'topbar should show the current page title')
  assert.equal(topbar.includes('{headline}'), false, 'topbar should not repeat sync status as the page title')
  assert.ok(topbar.includes('ariaLabel="同步状态"'), 'missing global sync status capsule')
  assert.ok(topbar.includes('aria-label="立即同步"'), 'missing global sync shortcut')
  assert.ok(topbar.includes('aria-label="更多同步操作"'), 'missing global sync overflow menu')
  assert.ok(renderer.includes('打开同步文件夹'), 'missing global open-folder action')
  assert.ok(renderer.includes('同步已暂停；此设备不会继续后台同步。'), 'missing paused-sync exception banner')
  assert.ok(renderer.includes('发现 {status.conflict_count || 0} 个同步冲突'), 'missing conflict exception banner')
  assert.ok(renderer.includes('同步异常：{status.last_error}'), 'missing sync-error exception banner')
})

test('desktop gates CfAPI-only storage controls by platform', () => {
  assert.ok(renderer.includes("const storagePoliciesSupported = info?.platform === 'win32'"), 'missing Windows storage capability gate')
  assert.ok(renderer.includes('Linux FUSE 模式不提供 Windows CfAPI'), 'missing Linux FUSE storage explanation')
  assert.ok(renderer.includes('FUSE 按需访问'), 'missing Linux read-only storage state')
  assert.ok(renderer.includes("storagePoliciesSupported ? '管理存储' : '查看存储'"), 'missing platform-aware storage action')
})

test('desktop external sources expose safe source deletion', () => {
  assert.ok(renderer.includes('删除来源'), 'missing source delete action')
  assert.ok(renderer.includes('已同步到 xDrive'), 'missing non-destructive delete confirmation prefix')
  assert.ok(renderer.includes('文件会保留，不会删除'), 'missing non-destructive delete confirmation result')
  assert.ok(renderer.includes('window.xdriveDesktop.agent.deleteSource'), 'missing renderer delete bridge call')
})

test('desktop transient management surfaces use modal dialogs', () => {
  for (const openProp of [
    'open={sourceCreateOpen}',
    'open={editingSourceID === row.source.id}',
    'open={cloudTrashOpen}',
    'open={!!cloudHistoryNode}',
    'open={!!cloudShareNode}',
  ]) {
    assert.ok(renderer.includes(openProp), `missing modal dialog state: ${openProp}`)
  }

  for (const label of ['添加外部来源', '来源设置', '回收站', '版本历史', '分享文件']) {
    assert.ok(renderer.includes(`aria-label="${label}"`), `missing modal dialog label: ${label}`)
  }

  assert.ok(renderer.includes('source-create modal-form-surface'), 'source creation must use the modal form surface')
  assert.ok(renderer.includes('source-settings modal-form-surface'), 'source settings must use the modal form surface')
  assert.equal(renderer.includes('cloud-subpanel modal-subpanel'), false, 'legacy cloud modal panel wrapper remains')
})

test('desktop dialogs share one title, paper, content, and action treatment', () => {
  assert.ok(renderer.includes('XDriveDialogTitle') && renderer.includes('xDriveDialogPaperProps'), 'App is not using the cross-client dialog chrome')
  assert.ok(synologyGuide.includes("from './DialogTitle'") && synologyGuide.includes('XDriveDialogTitle'), 'Synology guide is not using the cross-client dialog title')
  assert.ok(synologyGuide.includes('<XDriveDialogTitle'), 'Synology guide is not rendering the cross-client dialog title')
  assert.ok(dialogTitle.includes('aria-label="关闭弹窗"'), 'shared dialog title is missing the close control')
  assert.ok(dialogTitle.includes('export const xDriveDialogPaperProps'), 'shared dialog paper contract is missing')
  assert.ok(dialogTitle.includes("maxHeight: { xs: '92vh', sm: '84vh' }"), 'shared dialog viewport bounds are missing')
  assert.equal(styles.includes('.desktop-dialog-title'), false, 'legacy desktop dialog title CSS remains')
  assert.equal(styles.includes('.desktop-dialog-paper'), false, 'legacy desktop dialog paper CSS remains')
  assert.ok(dialogActions.includes('export function XDriveDialogActions({'), 'shared dialog actions component is missing')
  assert.ok(dialogActions.includes("bgcolor: 'action.hover'"), 'shared dialog actions surface styling is missing')
  assert.ok(dialogActions.includes("flexWrap: { xs: 'wrap', sm: 'nowrap' }"), 'shared dialog actions responsive wrapping is missing')
  assert.ok(dialogActions.includes('export function XDriveDialogActionSpacer()'), 'shared dialog action spacer is missing')
  assert.equal((renderer.match(/<XDriveDialogActions>/g) || []).length, 8, 'desktop dialogs are not all using the shared action bar')
  assert.ok(renderer.includes('<XDriveDialogActionSpacer />'), 'desktop destructive/settings dialog lost its shared action spacer')
  assert.equal(styles.includes('.desktop-dialog-actions'), false, 'legacy desktop dialog action CSS remains')
  assert.equal(styles.includes('.desktop-dialog-action-spacer'), false, 'legacy desktop dialog action spacer CSS remains')
  assert.ok(renderer.includes('form="source-create-form"'), 'source create primary action is not in DialogActions')
  assert.ok(renderer.includes('form={`source-settings-form-${row.source.id}`}'), 'source settings primary action is not in DialogActions')
  assert.equal(renderer.includes('source-create-heading'), false, 'legacy source create panel heading remains inside the dialog')
  assert.equal(renderer.includes('source-settings-heading'), false, 'legacy source settings panel heading remains inside the dialog')
})

test('desktop transient feedback uses one non-layout-shifting Snackbar', () => {
  assert.ok(renderer.includes('<Snackbar'), 'missing shared Snackbar feedback surface')
  assert.ok(renderer.includes("autoHideDuration={error ? null : 4000}"), 'success/error feedback lifetime contract is missing')
  assert.ok(renderer.includes("severity={error ? 'error' : 'success'}"), 'Snackbar does not distinguish error and success feedback')
  assert.equal(renderer.includes('className="alert error"'), false, 'legacy inline error feedback remains')
  assert.equal(renderer.includes('className="alert success"'), false, 'legacy inline success feedback remains')
  assert.equal(renderer.includes('className="alert warning"'), false, 'legacy alert panels remain')
  assert.equal(styles.includes('.alert.error'), false, 'legacy alert CSS remains')
})

test('desktop page actions use the cross-client MUI action component', () => {
  assert.ok(renderer.includes("from '@xdrive/ui/mui'"), 'desktop is not importing shared MUI primitives')
  assert.ok(renderer.includes('XDriveActionButton') && renderer.includes('XDriveStatePanel'), 'desktop shared MUI primitives are incomplete')
  assert.equal(renderer.includes('function DesktopActionButton({'), false, 'desktop still owns a local action button implementation')
  assert.ok(sharedActionButton.includes('export function XDriveActionButton({'), 'shared action button is missing')
  assert.ok(sharedActionButton.includes('<CircularProgress size={compact ? 12 : 14}'), 'shared action button does not expose a loading spinner')
  for (const label of ['重试连接', '添加来源', '回收站', '运行诊断', '检查更新', '保存设置', '退出登录']) {
    assert.ok(renderer.includes(label), `missing standardized action label: ${label}`)
  }
  assert.ok(renderer.includes('intent="primary"'), 'primary page action hierarchy is missing')
  assert.ok(renderer.includes('intent="danger"'), 'danger page action hierarchy is missing')
  assert.equal(renderer.includes('update-error'), false, 'legacy update error surface remains')
  assert.equal(renderer.includes('update-message'), false, 'legacy update message surface remains')
  assert.equal(renderer.includes('update-unavailable'), false, 'legacy update availability surface remains')
  assert.equal(renderer.includes('className="primary"'), false, 'legacy primary row button remains')
  assert.equal(renderer.includes('className="secondary"'), false, 'legacy secondary row button remains')
  assert.equal(renderer.includes('className="danger"'), false, 'legacy danger row button remains')
})

test('desktop persistent sync states use the cross-client MUI status alert', () => {
  assert.ok(sharedStatusAlert.includes('export function XDriveStatusAlert({'), 'shared status alert is missing')
  assert.ok(sharedStatusAlert.includes("if (tone === 'bad') return 'error'"), 'shared alert bad tone mapping is missing')
  assert.equal((renderer.match(/<XDriveStatusAlert/g) || []).length >= 3, true, 'desktop persistent sync states are not using shared status alerts')
  assert.ok(renderer.includes('tone="bad"'), 'sync-error state is not mapped to the bad tone')
  assert.ok(renderer.includes('同步已暂停；此设备不会继续后台同步。'), 'paused status alert content is missing')
  assert.ok(renderer.includes('发现 {status.conflict_count || 0} 个同步冲突'), 'conflict status alert content is missing')
})

test('desktop global sync and diagnostic statuses use the cross-client MUI badge', () => {
  assert.ok(sharedStatusBadge.includes("export type XDriveStatusTone = 'neutral' | 'good' | 'warning' | 'bad' | 'busy'"), 'shared status tone contract is missing')
  assert.ok(sharedStatusBadge.includes('aria-label={ariaLabel}'), 'shared status badge is missing accessible labels')
  assert.ok(sharedStatusBadge.includes('onClick={onClick}'), 'shared status badge is missing interactive status support')
  assert.ok(renderer.includes('tone={globalSyncState.tone}'), 'global sync status does not use the shared status badge')
  assert.ok(renderer.includes('ariaLabel="同步状态"'), 'global sync status lost its accessible label')
  assert.ok(renderer.includes("check.status === 'PASS' ? 'good' : check.status === 'WARN' ? 'warning' : 'bad'"), 'diagnostic status does not map into shared tones')
  assert.equal(renderer.includes('diagnostic-badge'), false, 'legacy diagnostic badge remains')
  assert.equal(styles.includes('.diagnostic-badge'), false, 'legacy diagnostic badge CSS remains')
})

test('desktop cloud shares use the cross-client MUI share status badge', () => {
  assert.ok(sharedShareStatusBadge.includes('export function XDriveShareStatusBadge({ status }'), 'shared share status badge is missing')
  for (const label of ['有效', '已过期', '已达上限', '已撤销']) {
    assert.ok(sharedShareStatusBadge.includes(label), `shared share status badge is missing label: ${label}`)
  }
  assert.ok(renderer.includes('<XDriveShareStatusBadge status={share.status} />'), 'desktop cloud share status is not shared')
  assert.equal(renderer.includes('function shareStatusLabel('), false, 'desktop still owns a share status label mapper')
})

test('desktop external-source run history uses shared status tones', () => {
  assert.ok(renderer.includes('tone={historyDetail.statusTone} label={historyDetail.statusLabel}'), 'run history does not use the shared status tone')
  assert.equal(renderer.includes('· {historyDetail.statusLabel}'), false, 'run history still renders an untyped status label inline')
})

test('desktop external-source status uses the cross-client MUI badge', () => {
  assert.ok(sharedStatusBadge.includes('export function XDriveStatusBadge({'), 'shared status badge is missing')
  assert.ok(renderer.includes('<XDriveStatusBadge tone={card.state.tone} label={card.state.label} />'), 'desktop source cards do not use the shared status badge')
  assert.equal(renderer.includes('function desktopSourceTone('), false, 'desktop still owns a source tone mapper')
  assert.equal(renderer.includes('className="source-state"'), false, 'legacy desktop source state wrapper remains')
})

test('desktop empty and loading states use the cross-client MUI state panel', () => {
  assert.ok(sharedStatePanel.includes('export function XDriveStatePanel({'), 'shared state panel is missing')
  assert.ok(renderer.includes('<XDriveStatePanel loading message="正在加载设置…" />'), 'settings loading state is not shared')
  assert.ok(renderer.includes('message="尚未添加外部来源。"'), 'source empty state is not shared')
  assert.equal(renderer.includes('className="empty-state"'), false, 'legacy desktop empty-state remains')
  assert.equal(renderer.includes('className="cloud-empty"'), false, 'legacy cloud empty-state remains')
  assert.equal(renderer.includes('className="cache-unavailable"'), false, 'legacy cache unavailable state remains')
  assert.equal(styles.includes('.empty-state'), false, 'legacy empty-state CSS remains')
  assert.equal(styles.includes('.cloud-empty'), false, 'legacy cloud-empty CSS remains')
})

test('desktop uses app-native confirmation dialogs instead of browser confirms', () => {
  assert.equal(renderer.includes('window.confirm'), false, 'browser-native confirmation dialog remains in the desktop renderer')
  assert.ok(renderer.includes('type ConfirmDialogState ='), 'missing reusable confirmation dialog state')
  assert.ok(renderer.includes('aria-label="确认操作"'), 'missing reusable confirmation dialog')
  for (const label of [
    '清除凭据',
    '安装并重启',
    '永久删除',
    '恢复版本',
    '保留服务器版本',
    '保留本地版本',
    '退出登录',
  ]) {
    assert.ok(renderer.includes(label), `missing confirmation action label: ${label}`)
  }
})

test('desktop external sources expose Synology Push and Pull without duplicating the UI framework', () => {
  assert.ok(renderer.includes("value={sourceCreatePreset}"), 'source creation does not use the shared create preset')
  assert.ok(renderer.includes('externalSourceCreateOptions.map'), 'missing shared source create options')
  assert.ok(sharedExternalSources.includes("label: '群晖 Photos · Push'"), 'missing Synology Push label')
  assert.ok(sharedExternalSources.includes("label: '群晖 Photos · Pull'"), 'missing Synology Pull label')
  assert.ok(renderer.includes('DSM 地址'), 'missing DSM base URL field')
  assert.ok(renderer.includes('DSM 用户名'), 'missing DSM username field')
  assert.ok(renderer.includes('DSM 密码'), 'missing DSM password field')
  assert.ok(renderer.includes('同步空间'), 'missing Synology Photos space selector')
  assert.ok(renderer.includes('synologyPhotoSpaceOptions.map'), 'Synology space selector is not driven by shared options')
  assert.ok(renderer.includes('getSourceConnectorConfig'), 'missing Synology connector-config read path')
  assert.ok(renderer.includes('setSourceConnectorConfig'), 'missing Synology connector-config write path')
  assert.ok(renderer.includes("card.connector.manualTriggerExecutor === 'source_agent'"), 'DSM source-agent guide is not limited to Push sources')
  assert.ok(renderer.includes("sourceCreateProfile.credential === 'synology_dsm'"), 'Synology Pull credential UI is not profile-driven')
  assert.ok(renderer.includes('externalSourceCredentialLabel'), 'credential actions are not connector-neutral')
})

test('desktop Yike source exposes connection testing and V1 recovery UX', () => {
  assert.ok(renderer.includes('testSourceCredential'), 'missing candidate Cookie test')
  assert.ok(renderer.includes('testStoredSourceCredential'), 'missing stored Cookie test')
  assert.ok(renderer.includes('测试连接'), 'missing Yike connection test action')
  assert.ok(renderer.includes('XDriveYikeCookieHelp'), 'missing shared Yike Cookie acquisition guide')
  assert.equal(renderer.includes('function YikeCookieHelpGuide()'), false, 'desktop still owns a local Yike Cookie help implementation')
  assert.ok(sharedYikeCookieHelp.includes("variant: 'accordion' | 'dialog'"), 'shared Yike Cookie help does not support both clients')
  assert.ok(renderer.includes('yikeConnectorNotice'), 'missing Yike private-API notice')
  assert.ok(renderer.includes('yikeManagedTargetLabel'), 'missing Yike managed target label')
  assert.ok(renderer.includes('固定逻辑目录'), 'missing Yike managed target explanation')
  assert.ok(sharedYikeCookieHelp.includes('如何获取 Cookie？'), 'missing compact Yike Cookie help action')
  assert.ok(sharedYikeCookieHelp.includes('点击展开'), 'missing Web expandable Yike Cookie help affordance')
  assert.ok(dialogTitle.includes("maxHeight: { xs: '92vh', sm: '84vh' }"), 'shared dialog paper must stay viewport-bounded')
  assert.equal(renderer.includes('<Accordion'), false, 'Yike Cookie help must not expand inline')
  assert.ok(renderer.includes('立即重试'), 'missing Yike failed-item retry action')
  assert.ok(renderer.includes('已自动撤销'), 'missing Yike create rollback feedback')
  assert.ok(renderer.includes('自动回滚也失败'), 'missing Source rollback failure fallback')
})

test('desktop external sources expose per-Source scheduling', () => {
  for (const text of ['调度方式', '固定间隔', 'Cron', '仅手动', 'Cron 表达式', '运行间隔', 'IANA 时区']) {
    assert.ok(renderer.includes(text), `missing Source schedule UI label: ${text}`)
  }
  assert.ok(renderer.includes('schedule_type: sourceCreateScheduleType'), 'missing create schedule payload')
  assert.ok(renderer.includes('schedule_type: sourceEditScheduleType'), 'missing update schedule payload')
  assert.ok(renderer.includes('detail.scheduleLabel'), 'missing Source schedule detail label')
  assert.ok(main.includes('schedule_expression'), 'Electron main does not forward Source schedule fields')
  assert.ok(main.includes("value.schedule_type !== 'manual'"), 'Electron main does not accept manual-only Source schedules')
})

test('desktop external sources expose live progress and cooperative cancellation', () => {
  assert.ok(renderer.includes('LinearProgress'), 'missing Source live progress bar')
  assert.ok(renderer.includes('当前文件：'), 'missing active Source file label')
  assert.ok(renderer.includes('正在取消…'), 'missing Source cancellation state')
  assert.ok(renderer.includes('cancelSourceRun'), 'missing renderer Source cancel bridge call')
  assert.ok(renderer.includes('loadSources(true)'), 'missing silent Source progress refresh')
})

test('desktop cloud quota hides server disk wording for limited quotas', () => {
  assert.ok(renderer.includes('可用空间'), 'missing cloud available-space label')
  assert.ok(renderer.includes("cloudQuota.quota_bytes > 0 ? '用户配额限制' : '服务器磁盘可用'"), 'missing quota-aware disk visibility')
})

test('desktop external sources expose per-file failures', () => {
  assert.ok(renderer.includes('getSourceItems'), 'missing Source item query')
  assert.ok(renderer.includes('查看失败项'), 'missing per-file failure action')
  assert.ok(renderer.includes('下一次扫描会自动重试'), 'missing retry guidance')
  assert.ok(renderer.includes('getSourceRunFailures'), 'missing historical Source failure query')
  assert.ok(renderer.includes('本次失败文件'), 'missing historical per-run failure section')
  assert.ok(renderer.includes('没有可恢复的逐文件失败快照'), 'missing legacy history fallback')
})

test('desktop GUI does not regress to key English labels', () => {
  for (const text of [
    'AGENT CONNECTION',
    '>Overview</button>',
    '>Cloud files</button>',
    'TRANSFER CENTER',
    'STORAGE POLICIES',
    'CONFLICT COPIES',
    'CLIENT SETTINGS',
    'Share —',
    'Expires after',
    'Maximum downloads',
    'Password (optional)',
  ]) {
    assert.equal(renderer.includes(text), false, `English desktop GUI label returned: ${text}`)
  }

  for (const text of [
    'Open xDrive Desktop',
    'Open xDrive Folder',
    'Sync Now',
    'Resume Sync',
    'Pause Sync',
    'Quit xDrive Desktop',
    'Choose xDrive sync folder',
  ]) {
    assert.equal(main.includes(text), false, `English desktop system label returned: ${text}`)
  }
})


test('desktop auth forms use MUI controls without legacy CSS overriding MUI internals', () => {
  assert.ok(renderer.includes('className="auth-panel auth-panel-form"'), 'auth forms must use the dedicated MUI form surface')
  assert.ok(renderer.includes('className="auth-folder-row"'), 'sync-folder input and browse action need one aligned row')
  assert.ok(renderer.includes('className="auth-options"'), 'remember/auto-login controls need one aligned option row')
  assert.ok(renderer.includes('className="auth-security-note"'), 'credential-storage explanation needs a dedicated feedback surface')
  assert.ok(renderer.includes('<XDriveActionButton\n              className="auth-submit"'), 'auth submit actions should use the shared MUI action button')
  assert.equal(renderer.includes('<label>当前密码<input'), false, 'password-change form must not keep native label/input markup')
  assert.equal(styles.includes('.auth-panel label,'), false, 'legacy auth label CSS must not override MUI InputLabel')
  assert.equal(styles.includes('.auth-panel input,'), false, 'legacy auth input CSS must not override MUI InputBase')
  assert.ok(styles.includes('.auth-folder-button.MuiButton-root { min-width: 76px; height: 40px; }'), 'browse button must align to compact TextField height')
  assert.ok(styles.includes('.auth-options .auth-option.MuiFormControlLabel-root { margin: 0; }'), 'checkbox labels must not inherit detached margins')
})

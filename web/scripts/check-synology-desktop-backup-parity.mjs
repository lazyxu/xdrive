#!/usr/bin/env node
// Source-level Desktop/DSM view parity; NOT a physical DSM acceptance test.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (filename) => fs.readFileSync(path.join(root, filename), 'utf8')
const desktop = read('ui/shared/src/mui/DeviceBackupPage.tsx')
const nas = read('ui/shared/src/mui/SynologyBackupLocalPanel.tsx')
const common = read('ui/shared/src/mui/DeviceBackupFolderSummary.tsx')
const schedule = read('ui/shared/src/mui/DeviceBackupLocalScheduleDialog.tsx')
const cgi = read('internal/synologyui/gateway.go')
const cgiRouting = read('internal/synologyui/cgi.go')
const agentRead = read('internal/localbackupipc/remote_backup.go')
const dsmEntry = read('web/src/synology.tsx')
const sharedHome = read('ui/shared/src/mui/HomePage.tsx')
const nasHome = read('ui/shared/src/mui/SynologyHomeOverview.tsx')
const desktopShell = read('desktop/src/renderer/App.tsx')
const sidebar = read('ui/shared/src/mui/WorkspaceSidebar.tsx')
const nav = read('ui/shared/src/mui/WorkspaceNavigation.tsx')
const diag = read('ui/shared/src/mui/DiagnosticsPage.tsx')
const muiExports = read('ui/shared/src/mui/index.tsx')
const deskDiag = read('desktop/src/renderer/DesktopDiagnosticsPage.tsx')
const nasDiag = read('ui/shared/src/mui/SynologyDiagnosticsPanel.tsx')
const nasAdapter = read('ui/shared/src/synology-backup-adapter.ts')
const browserStorage = read('ui/shared/src/synology-browser-storage.ts')
const ownerQuotaIPC = read('internal/localbackupipc/owner_quota.go')
const ownerFileIPC = read('internal/localbackupipc/owner_files.go')
const ownerMediaIPC = read('internal/localbackupipc/owner_media_range.go')
const ownerServerRange = read('internal/client/owner_media_range.go')
const synologyMediaPreview = read('ui/shared/src/synology-media-preview.ts')
const sharedQuickLook = read('ui/shared/src/mui/FileQuickLookDialog.tsx')
const sharedFileExplorer = read('ui/shared/src/mui/FileExplorer.tsx')
const synologyFiles = read('ui/shared/src/mui/SynologyOwnerFilesPage.tsx')
const backupOnly = read('cmd/xdrive-agent/desktop_ipc_runtime_mode.go')
const cloudStoragePage = read('ui/shared/src/mui/CloudStoragePage.tsx')
const taskPage = read('ui/shared/src/mui/TaskCenterPage.tsx')
const taskSection = read('ui/shared/src/mui/SynologyLocalTaskSection.tsx')
const taskStatus = read('ui/shared/src/synology-task-status.ts')
const localStoragePage = read('ui/shared/src/mui/LocalStoragePage.tsx')
const sharedCard = read('ui/shared/src/mui/DeviceBackupDeviceCard.tsx')
const folderCard = read('ui/shared/src/mui/DeviceBackupFolderAccordion.tsx')
const localActions = read('ui/shared/src/mui/DeviceBackupLocalPrimaryActions.tsx')
const sharedHistory = read('ui/shared/src/mui/DeviceBackupHistoryList.tsx')
for (const [name, source] of [['Desktop', desktop], ['DSM', nas]]) {
  for (const contract of [
    '<XDriveWorkspaceSurface',
    '<XDriveDeviceBackupFolderAccordion',
    '<XDriveDeviceBackupLocalPrimaryActions',
    '<XDriveDeviceBackupLocalCommonBatchDialog',
    '<XDriveDeviceBackupLocalScheduleDialog',
    'data-xdrive-device-backup-overview',
    '<XDriveDeviceBackupDeviceCard',
    '<XDriveDeviceBackupHistoryList',
  ]) {
    if (!source.includes(contract)) {
      throw new Error(name + ' lost shared backup UI contract: ' + contract)
    }
  }
}
if (!ownerMediaIPC.includes('cloud-media-range-read') ||
    !ownerMediaIPC.includes('ValidateOwnerMediaRange') ||
    !ownerServerRange.includes('StatusPartialContent') ||
    !ownerServerRange.includes('If-Range') ||
    !ownerServerRange.includes('X-Content-SHA256') ||
    !backupOnly.includes('"GET /v1/cloud/media-range"') ||
    !cgiRouting.includes('"cloud-media-range"') ||
    !cgi.includes('reader.OwnerFileMediaRange(ctx, nodeID, revision, offset, length)') ||
    !nasAdapter.includes("'/v1/cloud-media-range?node_id='") ||
    !synologyFiles.includes('loadPreviewURL={loadMediaPreview}') ||
    !synologyFiles.includes('<XDriveFileQuickLookDialog') ||
    !sharedQuickLook.includes('export function XDriveFileQuickLookDialog') ||
    !synologyMediaPreview.includes("globalThis.crypto.subtle.digest('SHA-256'") ||
    !synologyMediaPreview.includes('matchesSignature(range.data, mime)') ||
    !ownerFileIPC.includes('cloud-files-read') ||
    !ownerFileIPC.includes('"/v1/cloud/root"') ||
    !ownerFileIPC.includes('"/v1/cloud/children?"') ||
    !backupOnly.includes('"GET /v1/cloud/root"') ||
    !backupOnly.includes('"GET /v1/cloud/children"') ||
    backupOnly.includes('"POST /v1/cloud/children":') ||
    !cgiRouting.includes('"cloud-root", "cloud-children"') ||
    !cgi.includes('reader.OwnerFileRoot(ctx)') ||
    !cgi.includes('reader.OwnerFilePage(ctx, parent, limit, sort, order, cursor)') ||
    !muiExports.includes("export * from './SynologyOwnerFilesPage'") ||
    !sharedFileExplorer.includes('export function XDriveFileExplorer({') ||
    !synologyFiles.includes('<XDriveFileExplorer') ||
    !synologyFiles.includes('searchEnabled={false}') ||
    !synologyFiles.includes('forceVirtualization') ||
    !synologyFiles.includes('onOpenItem={item =>') ||
    !dsmEntry.includes('<XDriveSynologyOwnerFilesPage key={pageRevision} client={local}') ||
    !ownerQuotaIPC.includes('cloud-quota-read') ||
    !ownerQuotaIPC.includes('"/v1/cloud/quota"') ||
    !backupOnly.includes('"GET /v1/cloud/quota"') ||
    backupOnly.includes('"GET /v1/cloud/storage-stats":') ||
    !cgiRouting.includes('"cloud-quota"') ||
    !cgi.includes('reader.OwnerQuota(ctx)') ||
    !cloudStoragePage.includes('clearOnRefresh = false') ||
    !cloudStoragePage.includes('activeRequest.current?.abort()') ||
    !nasAdapter.includes("'/v1/cloud-quota'") ||
    !nasAdapter.includes('createXDriveSynologyCloudStorageDataSource') ||
    !dsmEntry.includes('<XDriveCloudStoragePage key={pageRevision} source={ownerCloudStorage}') ||
    !dsmEntry.includes('clearOnRefresh') ||
    !agentRead.includes('device-backup-read') ||
    !agentRead.includes('"/v1/device-backups"') ||
    !agentRead.includes('"/v1/device-backups/runs?"') ||
    !agentRead.includes('DeviceBackupOverviewPage(ctx context.Context') ||
    !agentRead.includes('DeviceBackupFoldersPage(ctx context.Context') ||
    !cgi.includes('pager.DeviceBackupOverviewPage(ctx, limit, cursor)') ||
    !cgi.includes('pager.DeviceBackupFoldersPage(ctx, deviceID, limit, afterSourceID)') ||
    !nasAdapter.includes('listPage: (limit, afterDeviceID) => client.ownerDevicesPage') ||
    !nasAdapter.includes('client.ownerFoldersPage(deviceID, limit, afterSourceID)') ||
    !cgi.includes('agent.(OwnerDeviceBackupReader)') ||
    !cgi.includes('reader.DeviceBackupRuns(ctx, id, limit, offset)') ||
    !cgiRouting.includes('"device-backups", "device-backup-runs"') ||
    !schedule.includes('actions.save(sourceID, loaded.revision, proposal)') ||
    !localActions.includes('配置本机同步计划') ||
    !folderCard.includes('<XDriveDeviceBackupFolderSummary') ||
    !folderCard.includes('onExpandedChange(isOpen)') ||
    !muiExports.includes("export * from './DeviceBackupFolderAccordion'") ||
    !muiExports.includes("export * from './DeviceBackupLocalPrimaryActions'") ||
    !desktop.includes('verifiedLocalDeviceID === device.id && !device.revoked') ||
    !nas.includes('onRun={() => setActiveID(item.source_id)}') ||
    !nas.includes('onSchedule={() => setScheduleID(item.source_id)}') ||
    !common.includes('targetUnavailableLabel') ||
    !nas.includes('Synology DSM') ||
    !cgi.includes('AuthenticateDSM') ||
    /window\.xdriveDesktop|ipcRenderer|localStorage|sessionStorage/.test(nas)) {
  throw new Error('DSM attempted an independent/Desktop-privileged backup frontend')
}
// The entire NAS app must now mount the same shell, sidebar and content
// components as Desktop, without making unsupported pages clickable.
for (const shared of ['XDriveWorkspaceShell', 'XDriveWorkspaceSidebar',
  'XDriveWorkspaceContent']) {
  if (!dsmEntry.includes('<' + shared) || !desktopShell.includes('<' + shared)) {
    throw new Error('DSM and Desktop do not share workspace component: ' + shared)
  }
}
if (!dsmEntry.includes("coreKeys={['files', 'device-backup', 'transfers', 'local-storage', 'cloud-storage']}") ||
    !dsmEntry.includes("compactPrimaryKeys={['overview', 'files', 'device-backup', 'transfers']}") ||
    !dsmEntry.includes('<XDriveHomePage key={pageRevision} localBackupClient={local}') ||
    !sharedHome.includes('export function XDriveHomePage(props:') ||
    !sharedHome.includes('<XDriveSynologyHomeOverview') ||
    !nasHome.includes('void client.list(abort.signal)') ||
    !nasHome.includes('client.ownerQuota(abort.signal)') ||
    !nasHome.includes("quotaLoading ? '读取中' : '未检测'") ||
    !nasHome.includes('formatBytes(quota.physical_used_bytes)') ||
    !sharedHome.includes('onOpenCloudStorage={props.onOpenCloudStorage}') ||
    !dsmEntry.includes("onOpenCloudStorage={() => setSelected('cloud-storage')}") ||
    !nasHome.includes('云端账号配额') ||
    !nasHome.includes('value="未检测"') ||
    !muiExports.includes("export * from './SynologyHomeOverview'") ||
    !sidebar.includes('primaryKeys: compactPrimaryKeys') ||
    !nav.includes('primaryKeys ??') ||
    !dsmEntry.includes('<XDriveTaskCenterPage') ||
    !dsmEntry.includes('localBackupClient={local}') ||
    !taskPage.includes('<XDriveSynologyLocalTaskSection') ||
    !taskSection.includes('client.inspect(selectedID, abort.signal)') ||
    !taskSection.includes('xDriveValidateSynologyLocalBatch(selectedID, snapshot)') ||
    !taskStatus.includes('retirement_safe !== false') ||
    !taskStatus.includes('current_cas_verified !== false') ||
    !muiExports.includes("export * from './SynologyLocalTaskSection'") ||
    !dsmEntry.includes('showLocalStorage') ||
    !dsmEntry.includes('<XDriveLocalStoragePage') ||
    !dsmEntry.includes('source={browserStorage}') ||
    !muiExports.includes("export * from '../synology-browser-storage'") ||
    !browserStorage.includes('navigator.storage.estimate()') ||
    !browserStorage.includes('clear_supported: false') ||
    !browserStorage.includes('不代表 NAS 硬盘') ||
    !localStoragePage.includes('browser.usage_scope_label') ||
    !sidebar.includes('coreKeys={coreKeys}') ||
    !nav.includes('coreKeys === undefined || coreKeys.includes(item.key)') ||
    dsmEntry.includes('window.xdriveDesktop') ||
    dsmEntry.includes('localStorage')) {
  throw new Error('DSM navigation advertised unavailable pages or bypassed scoped adapters')
}
if (!desktop.includes('verifiedLocalDeviceID === device.id && !device.revoked') ||
    !cgi.includes('agent.ReadSchedule(ctx, id)') ||
    !cgi.includes('agent.SaveSchedule(ctx, id, spec.Revision')) {
  throw new Error('Lost verified local ownership checks while aligning backup UI')
}
if (!desktop.includes('function XDriveDeviceBackupServerPage') ||
    !desktop.includes('export function XDriveDeviceBackupPage(') ||
    !desktop.includes('<XDriveSynologyBackupLocalPanel client={props.localBackupClient}') ||
    !dsmEntry.includes('<XDriveDeviceBackupPage key={pageRevision} localBackupClient={local} source={ownerBackupRead}') ||
    !dsmEntry.includes('createXDriveSynologyOwnerBackupSource(local)') ||
    !desktop.includes('账号设备（只读）') ||
    !desktop.includes('<XDriveDeviceBackupServerPage source={props.source} />') ||
    !nasAdapter.includes("'/v1/device-backups'") ||
    !nasAdapter.includes("'/v1/device-backup-runs'") ||
    dsmEntry.includes('<XDriveSynologyBackupLocalPanel') ||
    !muiExports.includes('xDriveDiagnosticsSidebarDestination, xDriveSettingsSidebarDestination') ||
    !muiExports.includes("export * from './DeviceBackupDeviceCard'") ||
    !muiExports.includes("export * from './DeviceBackupHistoryList'") ||
    !sharedCard.includes('XDriveDeviceBackupDeviceCard') ||
    !sharedHistory.includes('data-xdrive-device-backup-history-list') ||
    !sharedHistory.includes("kind: 'server'") ||
    !sharedHistory.includes("kind: 'local-receipt'") ||
    !dsmEntry.includes('<XDriveSettingsDialog') ||
    !dsmEntry.includes('appearance={appearance}') ||
    !dsmEntry.includes('xDriveSettingsSidebarDestination()') ||
    !deskDiag.includes('XDriveDiagnosticsPage as DesktopDiagnosticsPage') ||
    !nasDiag.includes('<XDriveDiagnosticsPage') ||
    !dsmEntry.includes('<XDriveSynologyDiagnosticsPanel') ||
    !dsmEntry.includes("coreKeys={['files', 'device-backup', 'transfers', 'local-storage', 'cloud-storage']}") ||
    !nav.includes('xDriveDiagnosticsSidebarDestination') ||
    !diag.includes('scopeNotice') ||
    !nasAdapter.includes('await api.list(signal)') ||
    !nasAdapter.includes('headers, body, signal,') ||
    !taskSection.includes('client.inspect(selectedID, abort.signal)') ||
    !taskSection.includes('abort.abort()') ||
    !taskSection.includes("document.visibilityState === 'visible'") ||
    !nasHome.includes('client.list(abort.signal)') ||
    !nas.includes('client.history(id, abort.signal)') ||
    !nasDiag.includes('client.diagnostics(abort.signal)') ||
    !nasAdapter.includes("'/v1/bootstrap'") ||
    nasDiag.includes('window.xdriveDesktop')) {
  throw new Error('DSM diagnostics must share the Desktop page with authenticated and scoped checks')
}
console.log('DSM/Desktop share canonical FileExplorer, Owner-authorized DeviceBackup, quota, TaskCenter and storage UI.')

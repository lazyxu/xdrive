#!/usr/bin/env node
import './test-xdrive-host-routes.mjs'
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
const hostSections = read('ui/shared/src/mui/WorkspaceHostSections.tsx')
const sharedHome = read('ui/shared/src/mui/HomePage.tsx')
const nasHome = read('ui/shared/src/mui/SynologyHomeOverview.tsx')
const desktopShell = read('desktop/src/renderer/App.tsx')
const appShell = read('ui/shared/src/mui/XDriveApp.tsx')
const appPageOutlet = read('ui/shared/src/mui/XDriveAppPageOutlet.tsx')
const appRouteContent = read('ui/shared/src/mui/XDriveAppRouteContent.tsx')
const hostContract = read('ui/shared/src/mui/WorkspaceHostAdapter.ts')
const routeRegistry = read('ui/shared/src/mui/WorkspaceRoute.ts')
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
const ownerThumbIPC = read('internal/localbackupipc/owner_thumbnail.go')
const ownerThumbServer = read('internal/client/owner_thumbnail.go')
const ownerThumbAdapter = read('ui/shared/src/synology-owner-thumbnail.ts')
const verifiedOwnerDownload = read('ui/shared/src/synology-owner-download.ts')
const commonThumbnails = read('ui/shared/src/mui/FileExplorerThumbnail.tsx')
const ownerServerRange = read('internal/client/owner_media_range.go')
const synologyMediaPreview = read('ui/shared/src/synology-media-preview.ts')
const synologyMediaStream = read('ui/shared/src/synology-media-stream.ts')
const nativeStreamGateway = read('internal/synologyui/media_stream.go')
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
if (!verifiedOwnerDownload.includes('xDriveSynologyFetchVerifiedDownload') ||
    !verifiedOwnerDownload.includes('crypto.subtle.digest') ||
    !verifiedOwnerDownload.includes('XDRIVE_SYNOLOGY_OWNER_DOWNLOAD_MAX_BYTES = 32 << 20') ||
    !synologyFiles.includes('onDownloadItems={downloadSelectedFiles}') ||
    !synologyFiles.includes('getSelectionActionDisabledReason={(action, selected, count)') ||
    !synologyFiles.includes('download={readyDownload.filename}') ||
    !synologyFiles.includes('href={readyDownload.url}') ||
    !synologyFiles.includes('downloadAbort.current?.abort()') ||
    !ownerThumbIPC.includes('cloud-thumbnail-read') ||
    !ownerThumbIPC.includes('ValidateOwnerThumbnail') ||
    !ownerThumbServer.includes('MediaOwnerThumbnail') ||
    !ownerThumbServer.includes('revision=%s') ||
    !backupOnly.includes('"GET /v1/cloud/thumbnail"') ||
    !cgiRouting.includes('"cloud-thumbnail"') ||
    !cgi.includes('reader.OwnerFileThumbnail(ctx, nodeID, revision)') ||
    !nasAdapter.includes('ownerFileThumbnail: async (nodeID, revision, signal)') ||
    !synologyFiles.includes('loadThumbnail={loadOwnerThumbnail}') ||
    !synologyFiles.includes("interactionLifecycleKey={rootRevision + ':' + currentScopeKey}") ||
    !ownerThumbAdapter.includes('xDriveSynologyLoadOwnerThumbnail') ||
    !commonThumbnails.includes('fileThumbnailConcurrency = 6') ||
    !commonThumbnails.includes('disposeFileThumbnailCache') ||
    !nativeStreamGateway.includes('parseOwnerStreamRange') ||
    !nativeStreamGateway.includes('ownerStreamMaxResponseBytes = 1 << 20') ||
    !nativeStreamGateway.includes('localbackupipc.ValidateOwnerMediaRange') ||
    !cgiRouting.includes('"cloud-media-stream"') ||
    !cgi.includes('serveOwnerMediaStream(w, r, reader)') ||
    !nasAdapter.includes('ownerFileMediaStreamURL:') ||
    !synologyMediaStream.includes('xDriveSynologyLoadNativeMediaStream') ||
    !synologyFiles.includes('xDriveSynologyLoadNativeMediaStream(client, item, signal)') ||
    !sharedQuickLook.includes('export function XDriveFileQuickLookDialog') ||
    !ownerMediaIPC.includes('cloud-media-range-read') ||
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
    // Search control is shared and visible on DSM; with no authorized CGI
    // search route, Host must provide the true disabled reason instead.
    !synologyFiles.includes('searchEnabled') ||
    !synologyFiles.includes('unavailableActions={unavailableActions}') ||
    !dsmEntry.includes('filesUnavailableActions: {') ||
    !sharedFileExplorer.includes('searchUnavailableReason') ||
    !synologyFiles.includes('forceVirtualization') ||
    !synologyFiles.includes('onOpenItem={item =>') ||
    !appPageOutlet.includes('<XDriveSynologyOwnerFilesPage key={revision} client={local}') ||
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
    !appPageOutlet.includes('<XDriveCloudStoragePage key={revision} source={services.cloudStorage}') ||
    !appPageOutlet.includes("clearOnRefresh={host.platform === 'synology'}") ||
    !appPageOutlet.includes('clearOnRefresh') ||
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
// DSM and Desktop must both mount the canonical full application frame.
if (!dsmEntry.includes('<XDriveApp') || !desktopShell.includes('<XDriveApp') ||
    !dsmEntry.includes('<XDriveAppRouteContent') ||
    !desktopShell.includes('<XDriveAppRouteContent') ||
    !appRouteContent.includes('<XDriveWorkspaceContent') ||
    !appRouteContent.includes('presentation={presentation}') ||
    !appShell.includes('<XDriveWorkspaceShell') ||
    !appShell.includes('<XDriveWorkspaceSidebar') ||
    !appShell.includes('selected={view}') ||
    !appShell.includes('onSelect={onNavigate}') ||
    !appShell.includes('xDriveWorkspaceNavigationAllowed(destination, host.adminRoleVerified === true)') ||
    !appPageOutlet.includes('host.adminRoleVerified !== true') ||
    !appRouteContent.includes('<XDriveAppPageOutlet') ||
    !appRouteContent.includes('host={host}') ||
    !appRouteContent.includes('view={view}') ||
    !muiExports.includes("export * from './XDriveAppRouteContent'") ||
    !routeRegistry.includes('XDRIVE_APP_WORKSPACE_ROUTES') ||
    !routeRegistry.includes('xDriveWorkspaceRouteRequiresAdmin') ||
    !muiExports.includes("export * from './XDriveApp'")) {
  throw new Error('Desktop and DSM lost the canonical host-neutral xDrive application')
}
// Migrated Desktop pages must be mounted through exactly the same common
// UI outlet as DSM, with Desktop retaining ownership of real Agent operations.
if (!appRouteContent.includes('xDriveIsSharedHostPageRoute(view)') ||
    !desktopShell.includes('host={workspaceHost}') ||
    !desktopShell.includes('galleryPage: {') ||
    !desktopShell.includes('deviceBackupPage: {') ||
    !desktopShell.includes('taskCenterPage: {') ||
    !desktopShell.includes('remotePullPage:') ||
    !appPageOutlet.includes('<XDriveMediaGalleryPage {...services.galleryPage} />') ||
    !appPageOutlet.includes('<XDriveSourceManager {...services.remotePullPage} />') ||
    !appPageOutlet.includes('<XDriveTaskCenterPage') ||
    !routeRegistry.includes('XDRIVE_SHARED_HOST_PAGE_ROUTES') ||
    !desktopShell.includes("adminUsersPage: status?.role === 'admin'") ||
    !desktopShell.includes("adminAuditPage: status?.role === 'admin'") ||
    !desktopShell.includes("adminStoragePage: status?.role === 'admin'") ||
    !appPageOutlet.includes('<XDriveAdminUsersPage {...services.adminUsersPage} />') ||
    !appPageOutlet.includes('<XDriveAdminAuditPage {...services.adminAuditPage} />') ||
    !appPageOutlet.includes('<XDriveGlobalStorageStatsPage {...services.adminStoragePage} />')) {
  throw new Error('Desktop retained parallel page JSX for common Host-backed routes')
}
// DSM must keep every standard Desktop route visible, while rendering honest
// unavailable states for unimplemented transport capabilities, not fake data.
// Server Owner role remains authoritative for admin routes.
if (dsmEntry.includes('coreKeys=') ||
    !dsmEntry.includes("compactPrimaryKeys: ['overview', 'files', 'gallery', 'transfers']") ||
    !routeRegistry.includes('xDriveWorkspaceNavigationAllowed') ||
    dsmEntry.includes('pages: {') ||
    !hostContract.includes('readonly deviceBackups?: XDriveDeviceBackupDataSource') ||
    !hostContract.includes('readonly cloudStorage?: XDriveCloudStorageDataSource') ||
    !appPageOutlet.includes('if (!page)') ||
    !appPageOutlet.includes('此宿主尚未接通当前功能') ||
    /window\.xdriveDesktop|ipcRenderer/.test(appShell + appRouteContent + appPageOutlet)) {
  throw new Error('DSM full route registry or Host capability boundary is broken')
}
if (dsmEntry.includes('coreKeys=') ||
    !dsmEntry.includes("compactPrimaryKeys: ['overview', 'files', 'gallery', 'transfers']") ||
    !appPageOutlet.includes('<XDriveHomePage key={revision} localBackupClient={local}') ||
    !sharedHome.includes('export function XDriveHomePage(props:') ||
    !sharedHome.includes('<XDriveSynologyHomeOverview') ||
    !nasHome.includes('void client.list(abort.signal)') ||
    !nasHome.includes('client.ownerQuota(abort.signal)') ||
    !nasHome.includes("quotaLoading ? '读取中' : '未检测'") ||
    !nasHome.includes('formatBytes(quota.physical_used_bytes)') ||
    !sharedHome.includes('onOpenCloudStorage={props.onOpenCloudStorage}') ||
    !appPageOutlet.includes("onOpenCloudStorage={navigate('cloud-storage')}") ||
    !nasHome.includes('云端账号配额') ||
    !nasHome.includes('value="未检测"') ||
    !muiExports.includes("export * from './SynologyHomeOverview'") ||
    !sidebar.includes('primaryKeys: compactPrimaryKeys') ||
    !nav.includes('primaryKeys ??') ||
    !appPageOutlet.includes('<XDriveTaskCenterPage') ||
    !appPageOutlet.includes('localBackupClient={local}') ||
    !taskPage.includes('<XDriveSynologyLocalTaskSection') ||
    !taskSection.includes('client.inspect(selectedID, abort.signal)') ||
    !taskSection.includes('xDriveValidateSynologyLocalBatch(selectedID, snapshot)') ||
    !taskStatus.includes('retirement_safe !== false') ||
    !taskStatus.includes('current_cas_verified !== false') ||
    !muiExports.includes("export * from './SynologyLocalTaskSection'") ||
    !dsmEntry.includes('showLocalStorage: true') ||
    !dsmEntry.includes('sections: xDriveWorkspaceHostSections({') ||
    !desktopShell.includes('xDriveWorkspaceHostSections({') ||
    !appPageOutlet.includes('<XDriveLocalStoragePage') ||
    !appPageOutlet.includes('source={services.localStorage}') ||
    !muiExports.includes("export * from '../synology-browser-storage'") ||
    !browserStorage.includes('navigator.storage.estimate()') ||
    !browserStorage.includes('clear_supported: false') ||
    !browserStorage.includes('不代表 NAS 硬盘') ||
    !localStoragePage.includes('browser.usage_scope_label') ||
    !sidebar.includes('coreKeys={coreKeys}') ||
    !nav.includes('coreKeys === undefined || coreKeys.includes(item.key)') ||
    dsmEntry.includes('window.xdriveDesktop') ||
    dsmEntry.includes('window.localStorage')) {
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
    !appPageOutlet.includes('<XDriveDeviceBackupPage key={revision}') ||
    !appPageOutlet.includes('localBackupClient={local} source={services.deviceBackups}') ||
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
    !hostSections.includes('xDriveSettingsSidebarDestination()') ||
    !deskDiag.includes('XDriveDiagnosticsPage as DesktopDiagnosticsPage') ||
    !nasDiag.includes('<XDriveDiagnosticsPage') ||
    !appPageOutlet.includes('<XDriveSynologyDiagnosticsPanel') ||
    dsmEntry.includes('coreKeys=') ||
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

import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded'
import { Typography, useTheme } from '@mui/material'
import {
  XDriveAppearanceThemeProvider,
  XDriveWorkspaceShell,
  XDriveWorkspaceSidebar,
  XDriveWorkspaceContent,
  XDriveDeviceBackupPage,
  XDriveHomePage,
  XDriveSynologyDiagnosticsPanel,
  XDriveLocalStoragePage,
  XDriveCloudStoragePage,
  XDriveSynologyOwnerFilesPage,
  XDriveTaskCenterPage,
  XDriveSettingsDialog,
  xDriveDiagnosticsSidebarDestination,
  xDriveSettingsSidebarDestination,
  createXDriveSynologyBackupLocalClient,
  createXDriveSynologyOwnerBackupSource,
  createXDriveSynologyCloudStorageDataSource,
  createXDriveSynologyBrowserStorageSource,
} from '@xdrive/ui/mui'
import './styles.css'

// DSM is an authenticated platform host, not an independent xDrive frontend.
// Render the SAME shared workspace frame/Sidebar used by Desktop and Web.
// As more genuine DSM/Server adapters are implemented, add their corresponding
// shared pages to the capability-scoped route registry. No inert navigation.
const cgi = new URL('backup.cgi', window.location.href)
const local = createXDriveSynologyBackupLocalClient(cgi.href)
const ownerBackupRead = createXDriveSynologyOwnerBackupSource(local)
const ownerCloudStorage = createXDriveSynologyCloudStorageDataSource(local)
const browserStorage = createXDriveSynologyBrowserStorageSource()

function SynologyWorkspace({ appearance, onAppearanceChange }: {
  appearance: 'system' | 'light' | 'dark'
  onAppearanceChange: (value: 'system' | 'light' | 'dark') => void
}) {
  const theme = useTheme()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pageRevision, refreshPage] = useState(0)
  const [selected, setSelected] = useState<'overview' | 'files' | 'device-backup' | 'diagnostics' | 'local-storage' | 'cloud-storage' | 'transfers'>('overview')
  return (
    <XDriveWorkspaceShell responsive sx={{ height: '100dvh', minHeight: 0 }}>
      <XDriveWorkspaceSidebar
        selected={selected}
        coreKeys={['files', 'device-backup', 'transfers', 'local-storage', 'cloud-storage']}
        showLocalStorage
        compactPrimaryKeys={['overview', 'files', 'device-backup', 'transfers']}
        sections={[
          { key: 'overview', placement: 'before-core',
            items: [{ key: 'overview', label: '主页', icon: <DashboardRoundedIcon fontSize="small" /> }] },
          { key: 'diagnostics', placement: 'after-core', items: [xDriveDiagnosticsSidebarDestination()] },
          { key: 'settings', placement: 'bottom', items: [xDriveSettingsSidebarDestination()] },
        ]}
        appearance={theme.palette.mode}
        responsive
        ariaLabel="xDrive NAS 应用导航"
        navAriaLabel="NAS 已实现页面"
        onSelect={(key) => {
          // Only a real, locally authenticated route is presently available.
          // Reselect it to request a fresh owner-scoped Agent view.
          if (key === 'settings') { setSettingsOpen(true); return }
          if (key === 'overview' || key === 'files' || key === 'device-backup' || key === 'diagnostics' ||
            key === 'local-storage' || key === 'cloud-storage' || key === 'transfers') {
            if (key === selected) refreshPage((value) => value + 1)
            else { setSelected(key); refreshPage(0) }
          }
        }}
      />
      <XDriveWorkspaceContent presentation="page" responsive
        sx={{ p: { xs: 2, md: '34px 40px 48px' } }}>
        {selected === 'overview'
          ? <XDriveHomePage key={pageRevision} localBackupClient={local}
              onOpenBackup={() => setSelected('device-backup')}
              onOpenTasks={() => setSelected('transfers')}
              onOpenDiagnostics={() => setSelected('diagnostics')}
              onOpenCloudStorage={() => setSelected('cloud-storage')} />
          : selected === 'files'
            ? <XDriveSynologyOwnerFilesPage key={pageRevision} client={local} />
          : selected === 'device-backup'
            ? <XDriveDeviceBackupPage key={pageRevision} localBackupClient={local} source={ownerBackupRead} />
          : selected === 'diagnostics'
            ? <XDriveSynologyDiagnosticsPanel key={pageRevision} client={local} />
            : selected === 'transfers'
              ? <XDriveTaskCenterPage key={pageRevision} transfers={[]} operations={[]}
                  localBackupClient={local}
                  onOpenLocalBackup={() => setSelected('device-backup')} />
              : selected === 'cloud-storage'
                ? <XDriveCloudStoragePage key={pageRevision} source={ownerCloudStorage}
                    clearOnRefresh />
                : <XDriveLocalStoragePage key={pageRevision} source={browserStorage} />}
      </XDriveWorkspaceContent>
      <XDriveSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        appearance={appearance}
        onAppearanceChange={onAppearanceChange}
        subtitle="NAS 端与 Desktop 共用设置对话框；当前仅提供真实可用的外观控制。"
      >
        <Typography variant="body2" color="text.secondary">
          外观只在当前窗口生效，重新打开时跟随系统。套件、账号及备份配置请使用现有 DSM 或 xDrive 管理入口。
        </Typography>
      </XDriveSettingsDialog>
    </XDriveWorkspaceShell>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('DSM authenticated xDrive application root missing')
function SynologyApp() {
  const [appearance, setAppearance] = useState<'system' | 'light' | 'dark'>('system')
  return (
    <XDriveAppearanceThemeProvider appearance={appearance}>
      <SynologyWorkspace appearance={appearance} onAppearanceChange={setAppearance} />
    </XDriveAppearanceThemeProvider>
  )
}

ReactDOM.createRoot(root).render(
  <React.StrictMode><SynologyApp /></React.StrictMode>,
)

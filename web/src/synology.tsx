import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import { Typography, useTheme } from '@mui/material'
import {
  XDriveAppearanceThemeProvider,
  XDriveApp,
  XDriveAppPageOutlet,
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
  xDriveIsWorkspaceAppRoute,
  createXDriveSynologyBackupLocalClient,
  createXDriveSynologyOwnerBackupSource,
  createXDriveSynologyCloudStorageDataSource,
  createXDriveSynologyBrowserStorageSource,
} from '@xdrive/ui/mui'
import type { XDriveWorkspaceAppRoute, XDriveWorkspaceHostAdapter } from '@xdrive/ui/mui'
import './styles.css'

// DSM and Desktop mount the same application shell and navigation registry.
// The only differences are authenticated host capabilities, not page JSX.
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
  const [selected, setSelected] = useState<XDriveWorkspaceAppRoute>('overview')

  const host: XDriveWorkspaceHostAdapter = {
    platform: 'synology',
    // All pages live in the same application registry. Missing capabilities
    // render an honest state instead of disappearing from DSM navigation.
    pages: {
      overview: { render: () => (
        <XDriveHomePage key={pageRevision} localBackupClient={local}
          onOpenBackup={() => setSelected('device-backup')}
          onOpenTasks={() => setSelected('transfers')}
          onOpenDiagnostics={() => setSelected('diagnostics')}
          onOpenCloudStorage={() => setSelected('cloud-storage')} />
      ) },
      files: { render: () => <XDriveSynologyOwnerFilesPage key={pageRevision} client={local} /> },
      'device-backup': { render: () => (
        <XDriveDeviceBackupPage key={pageRevision} localBackupClient={local} source={ownerBackupRead} />
      ) },
      diagnostics: { render: () => <XDriveSynologyDiagnosticsPanel key={pageRevision} client={local} /> },
      transfers: { render: () => (
        <XDriveTaskCenterPage key={pageRevision} transfers={[]} operations={[]}
          localBackupClient={local}
          onOpenLocalBackup={() => setSelected('device-backup')} />
      ) },
      'cloud-storage': { render: () => (
        <XDriveCloudStoragePage key={pageRevision} source={ownerCloudStorage}
          clearOnRefresh />
      ) },
      'local-storage': { render: () => (
        <XDriveLocalStoragePage key={pageRevision} source={browserStorage} />
      ) },
    },
    unavailableMessage: () =>
      '此功能采用与 Desktop 相同的页面；DSM 对应的认证 Host API 尚未接通，不能执行操作。',
  }

  return (
    <XDriveApp
      host={host}
      view={selected}
      shellSx={{ height: '100dvh', minHeight: 0 }}
      sidebar={{
        ariaLabel: 'xDrive NAS 应用导航',
        navAriaLabel: 'xDrive 功能导航',
        appearance: theme.palette.mode,
        showLocalStorage: true,
        compactPrimaryKeys: ['overview', 'files', 'gallery', 'transfers'],
        sections: [
          {
            key: 'overview', placement: 'before-core',
            items: [{ key: 'overview', label: '主页', icon: <DashboardRoundedIcon fontSize="small" /> }],
          },
          {
            key: 'conflicts', placement: 'after-core',
            items: [{ key: 'conflicts', label: '冲突', icon: <WarningAmberRoundedIcon fontSize="small" /> }],
          },
          { key: 'diagnostics', placement: 'after-core', items: [xDriveDiagnosticsSidebarDestination()] },
          { key: 'settings', placement: 'bottom', items: [xDriveSettingsSidebarDestination()] },
        ],
      }}
      onNavigate={(key) => {
        if (key === 'settings') { setSettingsOpen(true); return }
        if (!xDriveIsWorkspaceAppRoute(key)) return
        if (key === selected) refreshPage((value) => value + 1)
        else { setSelected(key); refreshPage(0) }
      }}
    >
      <XDriveWorkspaceContent presentation="page" responsive
        sx={{ p: { xs: 2, md: '34px 40px 48px' } }}>
        <XDriveAppPageOutlet view={selected} host={host} />
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
    </XDriveApp>
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

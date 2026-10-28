import { xDriveEnterForegroundPage } from '../../ui/shared/src/mui/ViewerForegroundPriority'
import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Typography, useTheme } from '@mui/material'
import {
  XDriveAppearanceThemeProvider,
  XDriveApp, XDriveSettingsDialog,
  xDriveWorkspaceHostSections,
  xDriveIsWorkspaceAppRoute,
  xDriveWorkspaceNavigationAllowed,
} from '@xdrive/ui/mui'
import type { XDriveWorkspaceAppRoute } from '@xdrive/ui/mui'
import './styles.css'
import { createXDriveSynologyHost } from './synologyHost'

const host = createXDriveSynologyHost()

function SynologyWorkspace({ appearance, onAppearanceChange }: {
  appearance: 'system' | 'light' | 'dark'
  onAppearanceChange: (value: 'system' | 'light' | 'dark') => void
}) {
  const theme = useTheme()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pageRevision, refreshPage] = useState(0)
  const [selected, setSelected] = useState<XDriveWorkspaceAppRoute>('overview')

  const navigate = (next: XDriveWorkspaceAppRoute) => {
    // Apply the real canonical Server/Host role gate before page preemption.
    // Home/Task links and sidebar alike must not bypass privileged routes.
    if (!xDriveWorkspaceNavigationAllowed(next, host.adminRoleVerified === true)) return
    if (next === selected) {
      refreshPage((value) => value + 1)
      return
    }
    // Cancel only the previous page's disposable requests before this
    // newly authenticated DSM destination mounts its own reader pools.
    xDriveEnterForegroundPage('synology:' + next)
    setSelected(next)
    refreshPage(0)
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
        sections: xDriveWorkspaceHostSections({
          adminRoleVerified: host.adminRoleVerified === true,
        }),
      }}
      onNavigate={(key) => {
        if (key === 'settings') { setSettingsOpen(true); return }
        if (!xDriveIsWorkspaceAppRoute(key)) return
        navigate(key)
      }}
      revision={pageRevision}
      pageSx={{ p: { xs: 2, md: '34px 40px 48px' } }}
      overlays={
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
      }
    />
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

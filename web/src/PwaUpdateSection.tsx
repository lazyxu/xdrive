import { useState, useSyncExternalStore } from 'react'
import { Alert, Box, Button, Typography } from '@mui/material'
import {
  checkXDrivePwaUpdate, subscribeXDrivePwaUpdates, xDrivePwaUpdateSnapshot,
} from './pwaUpdates'

export default function XDrivePwaUpdateSection() {
  const state = useSyncExternalStore(subscribeXDrivePwaUpdates, xDrivePwaUpdateSnapshot)
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  return (
    <Box data-xdrive-pwa-update-status>
      <Typography variant="subtitle2" fontWeight={700}>版本与网络</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 1 }}>
        浏览器连接提示：{state.connectionHint === 'offline' ? '设备可能离线' :
          state.connectionHint === 'online' ? '设备显示联网（不代表 xDrive Server 可用）' : '网络状态未知'}。
        此提示不代表传输已经暂停、恢复或完成。
      </Typography>
      {state.phase === 'waiting' ? (
        <Alert severity="info" sx={{ mb: 1 }}>
          新版本已经准备好。为避免中断上传、下载、编辑和 Viewer，本应用不会强制激活或刷新。
          请结束正在执行的任务，再关闭所有 xDrive 窗口，然后重新打开应用。
        </Alert>
      ) : state.phase === 'error' ? (
        <Alert severity="warning" sx={{ mb: 1 }}>{state.lastError || '版本检查失败'}</Alert>
      ) : state.phase === 'checked' ? (
        <Alert severity="info" sx={{ mb: 1 }}>已检查更新。如果有新版完成安装准备，将提示安全的更新方式。</Alert>
      ) : state.phase === 'unsupported' ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          当前环境不可使用 Service Worker 版本检查，普通 Web 模式仍可正常运行。
        </Typography>
      ) : null}
      {state.otherWindowReportedUpdate ? (
        <Alert severity="info" sx={{ mb: 1 }}>
          此站点的另一窗口报告可能有新版本；请在当前窗口主动检查确认。
        </Alert>
      ) : null}
      {state.phase === 'waiting' && !instructionsOpen ? (
        <Button data-xdrive-pwa-update-instructions sx={{ minHeight: 44, mb: 1 }}
          onClick={() => setInstructionsOpen(true)}>查看安全更新步骤</Button>
      ) : null}
      {state.phase === 'waiting' && instructionsOpen ? (
        <Alert data-xdrive-pwa-update-confirmed severity="warning" sx={{ mb: 1 }}>
          更新步骤已确认。关闭前请核对：传输已结束、编辑内容已保存、其他 xDrive 窗口已退出。
          当前页面不会因该确认自动关闭、重载或中断任何任务。
        </Alert>
      ) : null}
      <Button data-xdrive-pwa-check-update variant="outlined" sx={{ minHeight: 44 }}
        disabled={state.phase === 'checking' || state.phase === 'unsupported'}
        onClick={() => { void checkXDrivePwaUpdate() }}>
        {state.phase === 'checking' ? '检查中…' : '检查新版本'}
      </Button>
    </Box>
  )
}

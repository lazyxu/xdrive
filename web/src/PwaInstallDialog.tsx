import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, Stack, Typography, useMediaQuery,
} from '@mui/material'
import {
  checkXDrivePwaAssets, requestXDrivePwaInstall,
  subscribeXDrivePwaInstall, xDrivePwaInstallSnapshot,
} from './pwaInstall'
import type { XDrivePwaAssetCheck, XDrivePwaPromptOutcome } from './pwaInstall'
import XDrivePwaUpdateSection from './PwaUpdateSection'

export default function XDrivePwaInstallDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const compact = useMediaQuery('(max-width:599.95px)')
  const state = useSyncExternalStore(subscribeXDrivePwaInstall, xDrivePwaInstallSnapshot)
  const [checks, setChecks] = useState<XDrivePwaAssetCheck[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [feedback, setFeedback] = useState<XDrivePwaPromptOutcome | null>(null)
  const generation = useRef(0)
  useEffect(() => () => { generation.current += 1 }, [])
  const inspect = () => {
    const id = ++generation.current
    setChecking(true)
    setChecks(null)
    void checkXDrivePwaAssets().then(result => {
      if (id === generation.current) setChecks(result)
    }).finally(() => { if (id === generation.current) setChecking(false) })
  }
  const install = () => {
    // Browser prompt must run in the originating click, not after an await.
    const id = generation.current
    void requestXDrivePwaInstall().then(outcome => {
      if (id === generation.current) setFeedback(outcome)
    })
  }
  const standalone = state.displayMode !== 'browser'
  const outcome = feedback ?? state.lastPromptOutcome
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={compact}
      aria-labelledby="xdrive-pwa-install-title" data-xdrive-pwa-install-dialog>
      <DialogTitle id="xdrive-pwa-install-title">安装与运行环境</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            安装后可像应用一样从主屏幕或桌面启动，继续使用相同的 xDrive Server 和文件管理器。
            不保证离线访问私人文件，也不保证锁屏后网页上传持续运行。
          </Typography>
          <Alert severity={standalone || state.installedEventObserved ? 'success' : 'info'}>
            {standalone ? '当前正在独立应用显示模式运行。' :
              state.installedEventObserved ? '本次浏览器会话观察到安装成功事件，可从系统图标启动。' :
                '当前正在浏览器中打开；尚不能断定是否已在系统安装。'}
          </Alert>
          <Box>
            <Typography variant="body2">当前显示模式：{state.displayMode}</Typography>
            <Typography variant="body2">安全上下文：{state.secureContext ? '是' : '否'}</Typography>
            <Typography variant="body2">Service Worker API：{state.serviceWorkerSupported ? '浏览器支持' : '不可用'}</Typography>
          </Box>
          {!state.secureContext ? (
            <Alert severity="warning">当前不是安全上下文。除本机开发环境外，请先为自建服务器配置可信 HTTPS。</Alert>
          ) : null}
          {state.promptAvailable && !standalone && state.secureContext ? (
            <Button data-xdrive-pwa-prompt variant="contained" sx={{ minHeight: 44 }} onClick={install}>
              安装 xDrive
            </Button>
          ) : null}
          {outcome === 'accepted' ? (
            <Alert severity="info">系统已接受安装请求；请以系统图标和实际独立窗口启动结果为准。</Alert>
          ) : outcome === 'dismissed' ? (
            <Alert severity="info">已取消安装。可稍后从浏览器菜单再次尝试。</Alert>
          ) : outcome === 'error' ? (
            <Alert severity="warning">系统安装提示不可用，请尝试浏览器自己的安装菜单。</Alert>
          ) : outcome === 'unknown' ? (
            <Alert severity="info">安装提示已打开，具体结果请通过系统应用图标确认。</Alert>
          ) : null}
          {!standalone ? (
            <Box>
              <Typography variant="subtitle2" fontWeight={700}>手动安装方式</Typography>
              {state.platformHint === 'ios' ? (
                <Typography variant="body2" sx={{ mt: 1 }}>
                  iPhone / iPad：在 Safari 打开本站 → 页面菜单或分享 → 添加到主屏幕 → 打开“作为 Web App 打开” → 添加。
                  如果没有该选项，请在分享菜单底部的“编辑操作”中查找。
                </Typography>
              ) : state.platformHint === 'android' ? (
                <Typography variant="body2" sx={{ mt: 1 }}>
                  Android：在 Chrome 等支持的浏览器菜单中选择“安装应用”或“添加到主屏幕”。
                  浏览器未提供安装入口时，请使用普通网页模式，不会影响文件操作。
                </Typography>
              ) : (
                <Typography variant="body2" sx={{ mt: 1 }}>
                  在 Chrome、Edge 或系统浏览器菜单中查找“安装此应用”或“添加到主屏幕”。
                  是否可安装以浏览器实际提供的入口为准。
                </Typography>
              )}
            </Box>
          ) : null}
          <Divider />
          <Box>
            <Typography variant="subtitle2" fontWeight={700}>自建部署诊断（只读）</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>
              点击后仅对本站公开的 Manifest、Service Worker、离线页和安装图标发起无凭据 HEAD 请求，
              并区分实际 HTTPS 与本机 HTTP 安全上下文；不读取账户文件、下载票据或服务器管理员设置。
            </Typography>
            <Button data-xdrive-pwa-check variant="outlined" disabled={checking} sx={{ minHeight: 44 }} onClick={inspect}>
              {checking ? '检测中…' : '检查安装环境'}
            </Button>
            {checks ? (
              <Stack spacing={1} sx={{ mt: 1.5 }} role="status" aria-live="polite">
                {checks.map(item => (
                  <Alert key={item.id} severity={item.state === 'pass' ? 'success' : item.state === 'warn' ? 'warning' : 'error'}>
                    <Typography variant="body2" fontWeight={700}>{item.label}</Typography>
                    <Typography variant="body2">{item.detail}</Typography>
                  </Alert>
                ))}
              </Stack>
            ) : null}
          </Box>
          <Divider />
          <XDrivePwaUpdateSection />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ pb: 'max(12px, env(safe-area-inset-bottom))' }}>
        <Button sx={{ minWidth: 80, minHeight: 44 }} onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}

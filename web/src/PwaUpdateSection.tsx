import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Alert, Box, Button, Typography } from '@mui/material'
import {
  checkXDrivePwaUpdate, subscribeXDrivePwaUpdates, xDrivePwaUpdateSnapshot,
} from './pwaUpdates'
import { xDriveProbePwaServer } from './pwaConnectivity'
import { subscribeXDrivePwaPeerActivity, xDrivePwaPeerActivitySnapshot } from './pwaPeerActivity'
import {
  subscribeXDrivePwaWindowActivity, xDrivePwaKnownWindowBlockers,
  xDrivePwaWindowActivitySnapshot,
} from './pwaWorkloadSafety'
import type { XDrivePwaReadinessResult } from './pwaConnectivity'

export default function XDrivePwaUpdateSection() {
  const state = useSyncExternalStore(subscribeXDrivePwaUpdates, xDrivePwaUpdateSnapshot)
  const currentWindow = useSyncExternalStore(subscribeXDrivePwaWindowActivity, xDrivePwaWindowActivitySnapshot)
  const windowBlockers = xDrivePwaKnownWindowBlockers(currentWindow)
  const peers = useSyncExternalStore(subscribeXDrivePwaPeerActivity, xDrivePwaPeerActivitySnapshot)
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [serverChecking, setServerChecking] = useState(false)
  const [serverResult, setServerResult] = useState<XDrivePwaReadinessResult | null>(null)
  const serverRequestRef = useRef<AbortController | null>(null)
  useEffect(() => () => {
    const owned = serverRequestRef.current
    serverRequestRef.current = null
    owned?.abort()
  }, [])
  const checkServer = () => {
    serverRequestRef.current?.abort()
    const controller = new AbortController()
    serverRequestRef.current = controller
    setServerChecking(true)
    setServerResult(null)
    void xDriveProbePwaServer({ signal: controller.signal }).then(result => {
      if (serverRequestRef.current === controller && !controller.signal.aborted) {
        setServerResult(result)
      }
    }).finally(() => {
      if (serverRequestRef.current === controller) {
        serverRequestRef.current = null
        setServerChecking(false)
      }
    })
  }
  const serverText = serverResult?.state === 'ready' ? 'xDrive Server 当前报告已就绪，仍不代表文件传输已完成。'
    : serverResult?.state === 'server-unavailable' ? 'xDrive Server 尚未就绪，可能正在启动或维护。'
      : serverResult?.state === 'rate-limited' ? '探测请求受到限流，请稍后由用户主动重试。'
        : serverResult?.state === 'access-blocked' ? '服务器或反向代理拒绝了匿名就绪检测，请检查部署配置。'
          : serverResult?.state === 'timed-out' ? '服务器连接检测超时，请检查网络与自建服务状态。'
            : serverResult?.state === 'network-unavailable' ? '无法访问服务器，请检查 DNS、TLS、网络或代理。'
              : serverResult?.state === 'unexpected-response' ? '服务器返回非预期状态（HTTP ' + serverResult.httpStatus + '）。'
                : null
  return (
    <Box data-xdrive-pwa-update-status>
      <Typography variant="subtitle2" fontWeight={700}>版本与网络</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 1 }}>
        浏览器连接提示：{state.connectionHint === 'offline' ? '设备可能离线' :
          state.connectionHint === 'online' ? '设备显示联网（不代表 xDrive Server 可用）' : '网络状态未知'}。
        此提示不代表传输已经暂停、恢复或完成。
      </Typography>
      {state.phase === 'checking' ? (
        <Alert data-xdrive-pwa-update-checking severity="info" sx={{ mb: 1 }}>
          正在检查新版本，最多等待 8 秒。超时仅结束当前页面等待；
          浏览器内部检查仍可能继续，不会自动激活、重载或取消文件任务。
        </Alert>
      ) : null}
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
      {state.phase === 'waiting' ? (
        <Alert data-xdrive-pwa-activity-guard severity="warning" role="status" sx={{ mb: 1 }}>
          <Typography variant="body2" fontWeight={700}>当前窗口的工作状态（只读）</Typography>
          <Typography variant="body2">
            {!currentWindow.observed ? '当前业务活动尚不可确认。'
              : windowBlockers.length > 0
                ? `检测到：${windowBlockers.join('、')}；请先完成或保存。`
                : '未检测到已接入的前台任务；不代表可以立即激活更新。'}
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            当前检测 Web/Mobile Web 前台传输、Viewer、媒体编辑/创意对话框与系统依赖草稿；
            无法证明其他窗口已经结束所有工作；其他编辑器草稿和浏览器接管的下载同样可能未被观察到。
            不会自动刷新或激活更新；请人工确认并关闭所有 xDrive 窗口后重新打开。
          </Typography>
        </Alert>
      ) : null}
      {state.phase === 'waiting' ? (
        <Alert data-xdrive-pwa-peer-activity severity="warning" role="status" sx={{ mb: 1 }}>
          <Typography variant="body2" fontWeight={700}>其他窗口的近期活动（只读提示）</Typography>
          <Typography variant="body2">
            {!peers.available
              ? '当前环境没有可用的跨窗口通信，其他窗口活动无法被完整证明。'
              : peers.knownPeerBusy
                ? '另一窗口近期报告有正在执行的前台操作；请先在所有窗口完成工作。'
                : peers.knownPeerUnknown
                  ? '另一窗口近期报告活动状态未确认，请逐个核实。'
                  : '没有观察到其他窗口的已知前台任务；其他窗口活动无法被完整证明。'}
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            页面冻结、进程回收、浏览器隔离或超时可能导致消息缺失。该提示不能授权一键激活、
            强制重载或取消任务，请手动关闭所有 xDrive 窗口后重新打开。
          </Typography>
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
      <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 2 }}>服务器实际连接</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>
        与浏览器 online/offline 提示不同，这项操作会显式查询 xDrive Server 的公开就绪接口。
        不传输登录凭据，也不会自动重放、重试或取消文件任务。
      </Typography>
      <Button data-xdrive-pwa-check-server variant="outlined" sx={{ minHeight: 44 }}
        disabled={serverChecking} onClick={checkServer}>
        {serverChecking ? '检测中…' : serverResult ? '重新检测服务器' : '检查服务器连接'}
      </Button>
      {serverText ? (
        <Alert severity={serverResult?.state === 'ready' ? 'success' : 'warning'}
          role="status" aria-live="polite" sx={{ mt: 1 }}>
          {serverText}
        </Alert>
      ) : null}
    </Box>
  )
}

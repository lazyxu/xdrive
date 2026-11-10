import { useCallback, useEffect, useState } from 'react'
import { Box, Link, Stack, Typography } from '@mui/material'
import type { XDriveReleaseBundlePort, XDriveReleaseBundleState } from '../release-bundles'
import { xDriveReleaseBundleDownloadSources } from '../release-bundles'
import { XDriveActionButton } from './ActionButton'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveStatusAlert } from './StatusAlert'

const labels: Record<string, string> = {
  ios: 'iOS IPA', android: 'Android APK（已签名）',
  windows: 'Windows EXE', linux: 'Linux', dsm: 'Synology SPK', cli: '备份 CLI',
}
const cacheStates: Record<string, string> = {
  pending: '等待缓存',
  verified: '已校验并缓存',
  missing_upstream: '上游未发布，可稍后重试',
  verification_failed: '校验失败，未缓存',
  retry_needed: '下载失败，可重试',
  unavailable: '本机暂不可用',
}
const states: Record<string, string> = {
  unavailable: '不可用', syncing: '正在后台同步',
  paused_for_server: '服务端依赖下载优先，安装包同步已暂停',
  retry_needed: '部分安装包未缓存，可重试（不影响服务端升级）',
  ready: '当前 Release Bundle 已缓存',
}

export function XDriveReleaseBundleCard({ port }: { port?: XDriveReleaseBundlePort }) {
  const [state, setState] = useState<XDriveReleaseBundleState | null>(null)
  const [error, setError] = useState('')
  const [retrying, setRetrying] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [pendingInstall, setPendingInstall] = useState<{ commit: string; filename: string; personalUnsigned: boolean } | null>(null)
  const refresh = useCallback(async () => {
    if (!port) return
    try {
      const result = await port.getState()
      setState(result)
      setError('')
    } catch {
      setError('暂时无法读取客户端安装包缓存状态，不影响服务端升级。')
    }
  }, [port])
  useEffect(() => {
    if (!port) return
    void refresh()
    const ticker = setInterval(() => { void refresh() }, 10000)
    return () => clearInterval(ticker)
  }, [port, refresh])
  const retry = async () => {
    if (!port?.retry || retrying) return
    setRetrying(true)
    try {
      await port.retry()
      await refresh()
    } catch {
      setError('重试请求未成功。服务端升级状态不受影响。')
    } finally {
      setRetrying(false)
    }
  }
  if (!port) return null
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }} data-xdrive-release-bundle>
      <Stack spacing={1.5}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1}>
          <Box>
            <Typography variant="subtitle1" fontWeight={700}>多平台 Release Bundle</Typography>
            <Typography variant="body2" color="text.secondary">
              {states[state?.state || 'unavailable']}。客户端可独立升级，不需要与服务端保持同一版本。
            </Typography>
          </Box>
          {port.retry ? <XDriveActionButton disabled={retrying || state?.state === 'syncing' || state?.state === 'paused_for_server'}
            loading={retrying} onClick={() => { void retry() }}>重试缓存</XDriveActionButton> : null}
        </Stack>
        {state?.commit ? <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
          完整 Git Commit：{state.commit}
          {state.server_version ? ` · Server 版本 ${state.server_version}` : ''}
        </Typography> : null}
        {state?.cached_commit && state.cached_commit !== state.commit ?
          <Typography variant="caption" color="text.secondary">
            新 Bundle 尚未缓存完毕；旧版 {state.cached_commit} 的已验证安装包仍在服务器。
          </Typography> : null}
        {state?.state === 'retry_needed' ?
          <XDriveStatusAlert tone="warning">客户端安装包缓存失败，可继续使用服务端并重试同步。</XDriveStatusAlert> : null}
        {error ? <XDriveStatusAlert tone="warning">{error}</XDriveStatusAlert> : null}
        {state?.artifacts?.length ? (
          <Typography variant="body2" color="text.secondary">
            {state.artifacts.filter((entry) => entry.cached).length} / {state.artifacts.length} 个安装包已校验缓存；
            其余安装包可独立重试或使用上游来源，不影响服务端状态。
          </Typography>
        ) : null}
        {(state?.artifacts ?? []).map((artifact) => {
          const sources = xDriveReleaseBundleDownloadSources(artifact)
          const personalUnsigned = port.platform === 'windows' && artifact.platform === 'windows' &&
            artifact.filename === 'xDriveSetup-amd64.exe' && state?.channel === 'master' &&
            artifact.install_mode === 'manual_test_only'
          return <Box key={artifact.filename} sx={{ borderTop: 1, borderColor: 'divider', pt: 1 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1}>
              <Typography variant="body2">{labels[artifact.platform] || artifact.platform} · {artifact.filename}</Typography>
              <Typography variant="caption" color="text.secondary">
                {cacheStates[artifact.cache_status] || (artifact.cached ? '已缓存' : '本机未缓存')} ·
                {(artifact.size / 1024 / 1024).toFixed(1)} MB
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere', display: 'block' }}>
              SHA-256：{artifact.sha256}
            </Typography>
            {artifact.install_mode === 'manual_test_only' ? (
              <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>
                {personalUnsigned
                  ? '私人 Windows Snapshot：没有 Authenticode 签名。只在本人确认后使用完整 Commit 和 SHA-256 校验执行，Windows 可能提示未知发布者。'
                  : '未签名测试包：不能直接安装或作为原生升级包；请使用平台签名流程完成测试。'}
              </Typography>
            ) : null}
            <Stack direction="row" spacing={2} flexWrap="wrap">
              {port.installCurrent && port.platform === artifact.platform &&
                state?.commit === artifact.build_commit &&
                (artifact.install_mode === 'manual' || personalUnsigned) && sources.length > 0 ? (
                <XDriveActionButton intent="primary" compact disabled={installing}
                  onClick={() => setPendingInstall({ commit: artifact.build_commit, filename: artifact.filename, personalUnsigned })}>
                  {personalUnsigned ? '安装私人未签名 Windows 版本（自愿）' : '自愿升级此设备到当前 Server Commit'}
                </XDriveActionButton>
              ) : null}
              {artifact.cached && port.downloadCached ? (
                <XDriveActionButton onClick={() => {
                  const transfer = port.downloadCached?.(artifact.filename)
                  if (transfer) void transfer.catch(() => {
                    setError('本机安装包下载失败，可改用 GitLab 或 GitHub。')
                  })
                }}>本机服务器下载（优先）</XDriveActionButton>
              ) : null}
              {sources.filter((url) => !url.startsWith('/api/')).map((url, index) => {
                const label = url.includes('gitlab') ? 'GitLab' : 'GitHub'
                return <Link key={url} href={url} target="_blank" rel="noopener noreferrer" fontSize="small">
                  {label}{index === 0 && !artifact.cached ? '（优先）' : ''}
                </Link>
              })}
            </Stack>
          </Box>
        })}
        <Typography variant="caption" color="text.secondary">
          以上按本机服务器、GitLab、GitHub 顺序列出下载来源；下载后应验证 SHA-256，
          安装前仍须满足平台签名和兼容性要求。Android 安装包仍须通过系统签名验证。
        </Typography>
      </Stack>
      <XDriveConfirmDialog
        open={pendingInstall !== null}
        title={pendingInstall?.personalUnsigned ? '确认安装未经签名的个人 Windows 构建？' : '确认将本机客户端升级到 Server 当前 Commit？'}
        description={pendingInstall?.personalUnsigned
          ? `仅供个人使用：没有 Authenticode 发布者签名，风险高于正式签名发行。目标 Commit：${pendingInstall.commit}。将独立核对 GitHub Bundle、完整 Commit、文件大小、SHA-256，安装后核对实际 Commit；仅更新本机。`
          : `仅升级当前设备，不会强制其他客户端升级。目标 Commit：${pendingInstall?.commit ?? '—'}。将独立校验公开发布的 Commit、SHA-256 与操作系统安装包签名。`}
        confirmLabel="验证并安装"
        confirmIntent="warning"
        loading={installing}
        onCancel={() => { if (!installing) setPendingInstall(null) }}
        onConfirm={() => {
          if (!pendingInstall || !port.installCurrent || installing) return
          if (state?.commit !== pendingInstall.commit) {
            setPendingInstall(null)
            setError('Server Commit 已变化，请刷新后重新选择。')
            return
          }
          setInstalling(true)
          void port.installCurrent(pendingInstall.commit, pendingInstall.filename, pendingInstall.personalUnsigned)
            .then(() => { setPendingInstall(null); setError('已提交本机更新，等待安装器完成版本与健康检查。') })
            .catch((reason: unknown) => {
              setError(reason instanceof Error ? reason.message : '当前 Server 版本安装失败。')
            })
            .finally(() => setInstalling(false))
        }}
      />
    </Box>
  )
}

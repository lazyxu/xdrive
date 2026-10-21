import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Divider, Stack, Typography } from '@mui/material'
import { ApiError } from './api'
import type { XDriveApi } from './api'
import {
  xDrivePwaClearOfflineMetadata,
  xDrivePwaObserveOfflinePurge,
  xDrivePwaReadOfflineDirectories,
  xDrivePwaReadRelaunchOwner,
  xDrivePwaVerifiedIdentityMatches,
} from './pwaOfflineDirectory'
import type {
  XDrivePwaOfflineDirectory,
  XDrivePwaOfflineOwner,
  XDrivePwaOfflineRead,
} from './pwaOfflineDirectory'

/**
 * P1-B2: historical metadata viewer only. This is deliberately NOT the
 * authenticated Owner FileExplorer, a download surface or an ACL substitute.
 * A local hint is an opt-in locator, never proof of a current session.
 */
export default function PwaOfflineDirectoryBrowser({
  api, hasSession, onExit,
}: {
  api: XDriveApi
  hasSession: boolean
  onExit: () => void
}) {
  const [owner, setOwner] = useState<XDrivePwaOfflineOwner | null>(null)
  const [saved, setSaved] = useState<XDrivePwaOfflineRead | null>(null)
  const [selectedID, setSelectedID] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [verification, setVerification] = useState<
    'unverified' | 'checking' | 'authorized' | 'unavailable' | 'purged' | 'purge-failed'
  >('unverified')
  const sequence = useRef(0)
  const validationController = useRef<AbortController | null>(null)

  useEffect(() => {
    let active = true
    const reset = () => {
      sequence.current += 1
      validationController.current?.abort()
      setOwner(null)
      setSaved(null)
      setSelectedID(null)
      setVerification('purged')
      setLoading(false)
    }
    const stop = xDrivePwaObserveOfflinePurge(reset)
    const readSequence = sequence.current
    void (async () => {
      try {
        const hint = await xDrivePwaReadRelaunchOwner()
        if (!active || readSequence !== sequence.current || !hint) return
        const read = await xDrivePwaReadOfflineDirectories(hint)
        if (!active || readSequence !== sequence.current) return
        if (read.consented && read.revalidated === false) {
          setOwner(hint)
          setSaved(read)
          setSelectedID(read.directories[0]?.id ?? null)
        }
      } catch {
        // Storage may be blocked or corrupted; never fall back to API caches.
        if (active) setVerification('unavailable')
      } finally {
        if (active) setLoading(false)
      }
    })()
    const markOnline = () => setOnline(true)
    const markOffline = () => {
      setOnline(false)
      sequence.current += 1
      validationController.current?.abort()
      setVerification('unverified')
    }
    window.addEventListener('online', markOnline)
    window.addEventListener('offline', markOffline)
    return () => {
      active = false
      sequence.current += 1
      validationController.current?.abort()
      stop()
      window.removeEventListener('online', markOnline)
      window.removeEventListener('offline', markOffline)
    }
  }, [])

  const selected = saved?.directories.find(directory => directory.id === selectedID) ?? null

  const verifySelected = useCallback(async () => {
    if (!online || !owner || !selected || !hasSession) return
    const current = ++sequence.current
    validationController.current?.abort()
    const controller = new AbortController()
    validationController.current = controller
    setVerification('checking')
    try {
      // /me must be fresh, authenticated and bound to the durable Server UUID.
      const me = await api.me(controller.signal)
      if (current !== sequence.current) return
      if (!xDrivePwaVerifiedIdentityMatches(owner, me)) {
        try {
          await xDrivePwaClearOfflineMetadata()
          if (current === sequence.current) {
            setOwner(null)
            setSaved(null)
            setVerification('purged')
          }
        } catch {
          if (current === sequence.current) {
            setOwner(null)
            setSaved(null)
            setVerification('purge-failed')
          }
        }
        return
      }
      // Check the selected directory itself, not merely login existence.
      // A bounded one-row Go Range enforces current Owner/ACL without loading
      // 100k media rows, thumbnails, files, or a FileExplorer instance.
      const node = await api.node(selected.id, controller.signal)
      if (current !== sequence.current) return
      if (node.type !== 'dir') {
        try {
          await xDrivePwaClearOfflineMetadata()
          if (current === sequence.current) {
            setOwner(null)
            setSaved(null)
            setVerification('purged')
          }
        } catch {
          if (current === sequence.current) {
            setOwner(null)
            setSaved(null)
            setVerification('purge-failed')
          }
        }
        return
      }
      await api.listRange(selected.id, 0, 1, 'name', 'asc', false, undefined, controller.signal)
      if (current === sequence.current) setVerification('authorized')
    } catch (error) {
      if (current !== sequence.current || controller.signal.aborted) return
      if (error instanceof ApiError && (error.status === 401 ||
          error.status === 403 || error.status === 404)) {
        try {
          await xDrivePwaClearOfflineMetadata()
          if (current === sequence.current) {
            setOwner(null)
            setSaved(null)
            setVerification('purged')
          }
        } catch {
          if (current === sequence.current) {
            setOwner(null)
            setSaved(null)
            setVerification('purge-failed')
          }
        }
      } else {
        // A transport outage is NOT an ACL revocation or a verified result.
        setVerification('unavailable')
      }
    } finally {
      if (validationController.current === controller) validationController.current = null
    }
  }, [api, hasSession, online, owner, selected])

  // No request while offline. On recovery, revalidate just one visible folder.
  useEffect(() => {
    setVerification('unverified')
    if (online && owner && selected && hasSession) void verifySelected()
    return () => { sequence.current += 1; validationController.current?.abort() }
  }, [verifySelected, online, owner?.instanceID, owner?.userID, selected?.id, hasSession])

  const choose = (directory: XDrivePwaOfflineDirectory) => {
    sequence.current += 1
    validationController.current?.abort()
    setSelectedID(directory.id)
    setVerification('unverified')
  }

  return (
    <Box data-xdrive-pwa-offline-browser sx={{
      minHeight: 0, height: '100vh', '@supports (height: 100dvh)': { height: '100dvh' },
      display: 'flex', flexDirection: 'column', bgcolor: 'background.default',
    }}>
      <Box sx={{
        flexShrink: 0, height: 52, px: 2, display: 'flex', alignItems: 'center',
        gap: 2, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper',
        pt: 'env(safe-area-inset-top)',
      }}>
        <Button onClick={onExit} data-xdrive-pwa-offline-exit sx={{ minHeight: 44 }}>返回</Button>
        <Typography variant="subtitle1" fontWeight={700}>离线目录摘要</Typography>
      </Box>
      <Box component="main" sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 2,
        pb: 'max(16px, env(safe-area-inset-bottom))' }}>
        <Alert severity="warning" data-xdrive-pwa-offline-historical sx={{ mb: 2 }}>
          以下内容仅为本设备先前主动授权保存的历史摘要，未经当前权限验证。
          不代表文件仍存在、内容完整或账号仍有访问权限；这里不能下载、预览、修改或上传。
        </Alert>
        {loading ? <Typography role="status">正在读取本设备的历史摘要…</Typography> : null}
        {!loading && (!owner || !saved?.directories.length) ? (
          <Alert severity="info" data-xdrive-pwa-offline-empty>
            {verification === 'purged'
              ? '离线摘要已清除或当前权限不匹配。请联网登录后重新授权。'
              : verification === 'purge-failed'
                ? '当前权限不匹配且无法确认本机缓存已清除。请手动清理此站点浏览器数据后再使用。'
                : '当前没有可用的已授权目录摘要。请联网登录，在设置中主动开启后访问目录。'}
          </Alert>
        ) : null}
        {owner && saved?.directories.length ? (
          <Stack spacing={2} data-xdrive-pwa-offline-historical-only>
            <Typography variant="body2" color="text.secondary">
              保存账号：{owner.username} · 仅本机、仅历史记录 · {online ? '网络可能可用' : '设备处于离线状态'}
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {saved.directories.map(directory => (
                <Button key={directory.id} data-xdrive-pwa-offline-folder
                  variant={selectedID === directory.id ? 'contained' : 'outlined'}
                  sx={{ minHeight: 44 }}
                  onClick={() => choose(directory)}>
                  {directory.name}
                </Button>
              ))}
            </Stack>
            {selected ? (
              <Box data-xdrive-pwa-offline-directory>
                <Typography variant="subtitle1" fontWeight={700}>{selected.name}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  保存于 {new Date(selected.capturedAt).toLocaleString()} ·
                  仅 {selected.capturedCount} 条历史摘要
                  {selected.totalCount === null ? '' : ` / 当时共 ${selected.totalCount} 条`}
                </Typography>
                <Divider />
                {selected.items.map(item => (
                  <Box key={item.id} data-xdrive-pwa-offline-item sx={{
                    py: 1.5, minHeight: 44, borderBottom: 1, borderColor: 'divider',
                  }}>
                    <Typography variant="body2">{item.type === 'dir' ? '📁 ' : '📄 '}{item.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {item.type === 'dir' ? '当时的文件夹' : '当时的文件'} · 仅元数据
                    </Typography>
                  </Box>
                ))}
              </Box>
            ) : null}
            <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1}>
              <Button data-xdrive-pwa-offline-verify
                disabled={!online || !hasSession || !selected || verification === 'checking'}
                onClick={() => { void verifySelected() }} variant="outlined">
                {verification === 'checking' ? '正在重新核验…' : '联网重新核验当前目录'}
              </Button>
              <Typography variant="caption" color="text.secondary">
                {verification === 'authorized'
                  ? '服务器已重新核验本目录访问权限；显示的文件名称仍是历史快照。'
                  : verification === 'unavailable'
                    ? '目前无法完成权限核验，仍只能作为历史摘要查看。'
                    : !hasSession
                      ? '尚无登录会话；必须联网登录才能核验。'
                      : '当前尚未获得有效的服务器目录权限证明。'}
              </Typography>
            </Stack>
          </Stack>
        ) : null}
      </Box>
    </Box>
  )
}

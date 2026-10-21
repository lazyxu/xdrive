import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, FormControlLabel, Switch, Typography } from '@mui/material'
import {
  xDrivePwaOfflineAvailable,
  xDrivePwaOfflineScopeKey,
  xDrivePwaReadOfflineDirectories,
  xDrivePwaSetOfflineConsent,
  xDrivePwaObserveOfflinePurge,
} from './pwaOfflineDirectory'
import type { XDrivePwaOfflineOwner, XDrivePwaOfflineRead } from './pwaOfflineDirectory'
import { xDriveHasPendingBrowserDownload, xDriveHasPendingBrowserUpload } from './pwaTransferSafety'
import { webTransferStore } from './transfers'

/**
 * P1-B1: explicit opt-in, never an offline permission grant.
 * The current owner MUST originate from successful, authenticated /me.
 */
export default function PwaOfflineDirectorySection({
  owner,
  onConsentChange,
}: {
  owner: XDrivePwaOfflineOwner | null
  onConsentChange?: (enabled: boolean) => void
}) {
  const key = useMemo(() => {
    if (!owner) return ''
    try { return xDrivePwaOfflineScopeKey(owner) }
    catch { return '' }
  }, [owner?.origin, owner?.instanceID, owner?.userID, owner?.username])
  const [snapshot, setSnapshot] = useState<XDrivePwaOfflineRead | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const available = xDrivePwaOfflineAvailable() && key !== ''

  useEffect(() => {
    const current = ++generation.current
    setSnapshot(null)
    setBusy(false)
    setError('')
    if (!available || !owner) return
    const stopWatching = xDrivePwaObserveOfflinePurge(() => {
      generation.current += 1
      setBusy(false)
      setSnapshot({ consented: false, revalidated: false, directories: [] })
      onConsentChange?.(false)
    })
    void xDrivePwaReadOfflineDirectories(owner).then(value => {
      if (current === generation.current) setSnapshot(value)
    }).catch(() => {
      if (current === generation.current) setError('无法读取此设备的目录离线设置。')
    })
    return () => { generation.current += 1; stopWatching() }
  }, [available, key])

  const changeConsent = (enabled: boolean) => {
    if (!owner || !available || busy) return
    const current = ++generation.current
    setBusy(true)
    setError('')
    void xDrivePwaSetOfflineConsent(owner, enabled)
      .then(() => xDrivePwaReadOfflineDirectories(owner))
      .then(value => {
        if (current !== generation.current) return
        setSnapshot(value)
        onConsentChange?.(value.consented)
      }).catch(() => {
        if (current === generation.current) setError('无法更新本设备的离线设置，请检查可用存储空间。')
      }).finally(() => {
        if (current === generation.current) setBusy(false)
      })
  }

  const directoryCount = snapshot?.directories.length ?? 0
  const fileCount = snapshot?.directories.reduce((sum, item) => sum + item.items.length, 0) ?? 0
  return (
    <Box data-xdrive-pwa-offline-settings>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>已访问目录的离线摘要（可选）</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        默认关闭。开启后，仅在联网且服务器已确认访问权限时保存少量已浏览目录名称和文件摘要；
        不缓存原图、视频、Live Photo、文件内容、缩略图或下载凭据。
      </Typography>
      <Alert severity="warning" sx={{ mb: 1 }}>
        本设备的其他使用者可能查看本地摘要。断网时它们属于历史数据，不能代表文件仍存在或当前账号仍有权限。
        关闭此选项会删除当前账号、当前服务端实例的摘要；退出账号会清理本站全部目录摘要。
      </Alert>
      {!available ? (
        <Alert severity="info" data-xdrive-pwa-offline-unavailable>
          当前未确认安全的本地 IndexedDB 或服务端实例身份，无法开启私人目录离线存储。
        </Alert>
      ) : (
        <>
          <FormControlLabel
            control={<Switch
              data-xdrive-pwa-offline-consent
              checked={snapshot?.consented === true}
              disabled={busy || snapshot === null}
              onChange={(_, checked) => changeConsent(checked)}
            />}
            label="允许在此设备保存已访问目录的只读摘要"
          />
          {snapshot?.consented ? (
            <>
              <Typography variant="body2" color="text.secondary" data-xdrive-pwa-offline-count>
                当前存有 {directoryCount} 个目录、{fileCount} 条摘要；
                每账号最多 10 个目录、200 条记录，最长保留 7 天。
                重新联网后必须由服务器再次验证；这不是离线修改或下载授权。
              </Typography>
              {directoryCount > 0 ? (
                <Button data-xdrive-pwa-offline-open-history variant="outlined"
                  sx={{ mt: 1, minHeight: 44 }}
                  onClick={() => {
                    const tasks = webTransferStore.snapshot()
                    if (xDriveHasPendingBrowserUpload(tasks) ||
                        xDriveHasPendingBrowserDownload(tasks)) {
                      setError('当前有浏览器上传或下载正在进行，请完成或取消后再打开历史目录。')
                      return
                    }
                    window.location.hash = '#/offline/files'
                  }}>
                  查看已保存的历史目录（只读）
                </Button>
              ) : null}
            </>
          ) : null}
        </>
      )}
      {error ? <Alert severity="error" sx={{ mt: 1 }} role="status">{error}</Alert> : null}
    </Box>
  )
}

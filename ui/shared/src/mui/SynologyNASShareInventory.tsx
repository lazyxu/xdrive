import { useEffect, useState } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import type { XDriveSynologyBackupLocalClient } from '../synology-backup-adapter'
import type { XDriveSynologyNASShare } from '../synology-nas-share-inventory'

// A read-only local directory access check inside the SAME shared Backup
// page. It cannot create Sources, send NAS paths, grant Roots or start Runner.
export function XDriveSynologyNASShareInventory({ client }: {
  client: XDriveSynologyBackupLocalClient
}) {
  const [open, setOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{
    owner: XDriveSynologyBackupLocalClient
    rows: XDriveSynologyNASShare[]
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setState(null)
    setError('')
    if (!open) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    let current = true
    setLoading(true)
    void client.nasShares(controller.signal).then(rows => {
      if (current && !controller.signal.aborted) setState({ owner: client, rows })
    }).catch(() => {
      if (current && !controller.signal.aborted)
        setError('无法验证本机共享目录读取权限；请检查 DSM 套件用户授权与 Agent。')
    }).finally(() => {
      if (current && !controller.signal.aborted) setLoading(false)
    })
    return () => {
      current = false
      controller.abort()
    }
  }, [client, open, revision])

  const rows = state?.owner === client ? state.rows : null
  return (
    <Box data-xdrive-dsm-nas-share-inventory sx={{
      border: 1, borderColor: 'divider', borderRadius: 1, p: 2,
    }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle2" fontWeight={700}>NAS 本地共享目录检查</Typography>
        <Typography variant="body2" color="text.secondary">
          检查 xdrivenas 套件用户当前可以列出的 /volumeN 一级共享目录。
          此检查不读取文件内容，也不等于已授权备份 Root；网页创建 Source 尚未接通。
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Button size="small" variant="outlined" onClick={() => setOpen(v => !v)}>
            {open ? '收起目录检查' : '检查可读共享目录'}
          </Button>
          {open ? (
            <Button size="small" disabled={loading} onClick={() => setRevision(v => v + 1)}>
              重新检查
            </Button>
          ) : null}
        </Stack>
        {open && loading ? <Typography role="status">正在检查本机目录…</Typography> : null}
        {open && error ? <Typography color="error.main" role="alert">{error}</Typography> : null}
        {open && rows ? (
          rows.length === 0 ? (
            <Typography color="text.secondary" role="status">
              没有发现套件用户可读取的普通共享目录；请在 DSM 中检查套件用户的读取权限。
            </Typography>
          ) : (
            <Stack spacing={0.5} data-xdrive-dsm-nas-share-results>
              {rows.map(share => (
                <Typography key={share.label} variant="body2">{share.label}</Typography>
              ))}
            </Stack>
          )
        ) : null}
      </Stack>
    </Box>
  )
}

import { useEffect, useMemo, useState } from 'react'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import { Card, InputAdornment, Stack, TextField, Typography } from '@mui/material'
import { XDriveActionButton, XDriveStatePanel, XDriveStatusAlert } from '@xdrive/ui/mui'
import { ApiError, XDriveApi } from './api'
import type { PublicShare } from '../../ui/shared/src'
import { formatSize } from '../../ui/shared/src'

export default function PublicShareView({ token }: { token: string }) {
  const api = useMemo(() => new XDriveApi(), [])
  const [share, setShare] = useState<PublicShare | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const result = await api.publicShare(token)
        if (active) setShare(result)
      } catch (err) {
        if (!active) return
        if (err instanceof ApiError && err.status === 410) {
          setError('此分享已过期、达到下载上限或已被撤销。')
        } else if (err instanceof ApiError && err.status === 404) {
          setError('此分享链接不存在。')
        } else {
          setError(err instanceof Error ? err.message : '无法加载此分享。')
        }
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [api, token])

  const download = async () => {
    if (!share) return
    setDownloading(true)
    setError('')
    try {
      await api.downloadPublicShare(token, password, share.name)
      setShare((current) => current ? { ...current, download_count: current.download_count + 1 } : current)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('分享密码错误。')
      } else if (err instanceof ApiError && err.status === 410) {
        setError('此分享已过期、达到下载上限或已被撤销。')
      } else {
        setError(err instanceof Error ? err.message : '下载失败。')
      }
    } finally {
      setDownloading(false)
    }
  }

  const exhausted = !!share && share.max_downloads > 0 && share.download_count >= share.max_downloads

  return (
    <div className="auth-shell">
      <Card className="auth-card" sx={{ p: 3, borderRadius: 2 }}>
        <div className="brand-lockup">
          <div className="brand-mark">x</div>
          <div>
            <Typography component="h1" variant="h5" fontWeight={700}>xDrive</Typography>
            <Typography variant="body2" color="text.secondary">安全文件分享</Typography>
          </div>
        </div>

        {loading && <XDriveStatePanel variant="plain" loading message="正在加载分享…" />}
        {error && <XDriveStatusAlert tone="bad" sx={{ mb: 2.25 }}>{error}</XDriveStatusAlert>}

        {share && (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.5} alignItems="flex-start">
              <InsertDriveFileRoundedIcon sx={{ fontSize: 28, mt: 0.5 }} />
              <div>
                <Typography component="h2" variant="h6" fontWeight={700}>{share.name}</Typography>
                <Typography variant="body2" color="text.secondary">{formatSize(share.size)}</Typography>
              </div>
            </Stack>

            <Typography variant="body2" color="text.secondary">
              {share.expires_at ? `过期时间 ${new Date(share.expires_at).toLocaleString()}` : '永不过期'}
              {' · '}
              {share.max_downloads > 0
                ? `剩余 ${Math.max(0, share.max_downloads - share.download_count)} / ${share.max_downloads} 次下载`
                : '不限下载次数'}
            </Typography>

            {share.requires_password && (
              <TextField
                fullWidth
                size="small"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void download()
                }}
                placeholder="分享密码"
                autoComplete="current-password"
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <LockRoundedIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  },
                }}
              />
            )}

            {exhausted && <XDriveStatusAlert tone="warning">此分享已达到下载上限。</XDriveStatusAlert>}

            <XDriveActionButton
              intent="primary"
              fullWidth
              startIcon={<DownloadRoundedIcon />}
              loading={downloading}
              loadingLabel="正在下载…"
              disabled={exhausted || (share.requires_password && !password)}
              onClick={() => void download()}
            >
              下载
            </XDriveActionButton>
          </Stack>
        )}
      </Card>
    </div>
  )
}

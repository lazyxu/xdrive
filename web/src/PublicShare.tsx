import { useEffect, useMemo, useRef, useState } from 'react'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import { Box, Button, InputAdornment, Stack, TextField, Typography } from '@mui/material'
import { XDriveActionButton, XDriveAuthPanel, XDriveAuthShell, XDriveBrandLockup, XDriveStatePanel, XDriveStatusAlert } from '@xdrive/ui/mui'
import { ApiError, XDriveApi } from './api'
import type { PublicShare, PublicShareChild } from '../../ui/shared/src'
import { formatBytes } from '../../ui/shared/src'
import xDriveBrandIcon from '../../assets/icon/master/xdrive-icon-master.svg'
import { useXDriveDeferredPendingLoading } from '../../ui/shared/src/mui/useDeferredLoading'

type FolderPath = { id: number; name: string }
type FolderPage = { path: FolderPath[]; items: PublicShareChild[]; cursor: number; next: number; history: number[] }

export default function PublicShareView({ token }: { token: string }) {
  const api = useMemo(() => new XDriveApi(), [])
  const [share, setShare] = useState<PublicShare | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [folder, setFolder] = useState<FolderPage | null>(null)
  const [folderError, setFolderError] = useState('')
  const [folderPending, setFolderPending] = useState(false)
  const pendingPage = useRef<AbortController | null>(null)
  // The network starts immediately; only sustained first reads reveal progress.
  const showFirstReadLoading = useXDriveDeferredPendingLoading(loading && !share && !error)
  const showFolderPending = useXDriveDeferredPendingLoading(folderPending)

  useEffect(() => {
    // Unmount must ALWAYS cancel an unused directory request, including in
    // no-DOM renderers. Browser-only visibility observation is optional.
    const hasDocument = typeof document !== 'undefined'
    const onVisibilityChange = () => {
      if (hasDocument && document.visibilityState === 'hidden') {
        pendingPage.current?.abort()
      }
    }
    if (hasDocument) document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      if (hasDocument) document.removeEventListener('visibilitychange', onVisibilityChange)
      pendingPage.current?.abort()
      pendingPage.current = null
    }
  }, [])

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

  const exhausted = !!share && share.max_downloads > 0 && share.download_count >= share.max_downloads
  const canDownload = !!share && !downloading && !exhausted && (!share.requires_password || Boolean(password))

  const loadFolder = async (path: FolderPath[], cursor = 0, back = false) => {
    if (!share || share.type !== 'dir' || !canDownload) return
    pendingPage.current?.abort()
    const controller = new AbortController()
    pendingPage.current = controller
    setFolderError('')
    setFolderPending(true)
    try {
      const page = await api.publicShareChildren(
        token, password, path.at(-1)?.id ?? 0, cursor, controller.signal,
      )
      if (pendingPage.current !== controller || controller.signal.aborted) return
      // Keep one server page in the DOM even for a 100k-child folder.
      // A short cursor history supports Back without retaining older Nodes.
      setFolder((old) => {
        let history: number[] = []
        if (old && old.path.at(-1)?.id === path.at(-1)?.id) {
          if (back) history = old.history.slice(0, -1)
          else if (cursor > 0) history = [...old.history, old.cursor]
        }
        return { path, items: page.items, cursor, next: page.next_cursor, history }
      })
    } catch (err) {
      if (pendingPage.current !== controller || controller.signal.aborted) return
      setFolderError(err instanceof ApiError && err.status === 401
        ? '分享密码错误。'
        : err instanceof ApiError && err.status === 410
          ? '此分享已过期或被撤销。'
          : err instanceof Error ? err.message : '无法打开此文件夹。')
    } finally {
      if (pendingPage.current === controller) {
        pendingPage.current = null
        setFolderPending(false)
      }
    }
  }

  const download = async (entry?: PublicShareChild) => {
    if (!share || !canDownload) return
    setDownloading(true)
    setError('')
    setNotice('')
    try {
      await api.downloadPublicShare(token, password, entry?.name ?? share.name, entry?.id)
      setNotice('已交给浏览器下载。')
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

  return (
    <XDriveAuthShell viewport decorated spacing="compact">
      <XDriveAuthPanel size="compact" form onSubmit={(event) => {
        event.preventDefault()
        if (share?.type === 'dir') void loadFolder([{ id: 0, name: share.name }])
        else void download()
      }}>
        <XDriveBrandLockup
          iconSrc={xDriveBrandIcon}
          variant="large"
          subtitle="安全文件分享"
        />

        <Box
          data-xdrive-public-share-read-slot
          aria-busy={loading}
          sx={{ minHeight: 180, minWidth: 0, position: 'relative' }}
        >
          {showFirstReadLoading ? (
            <Box
              data-xdrive-public-share-delayed-feedback
              sx={{
                position: 'absolute', inset: 0, display: 'grid',
                placeItems: 'center', pointerEvents: 'none',
              }}
            >
              <XDriveStatePanel variant="plain" loading message="正在加载分享…" />
            </Box>
          ) : null}
          {error && <XDriveStatusAlert tone="bad" sx={{ mb: 2.25 }}>{error}</XDriveStatusAlert>}
          {notice && <XDriveStatusAlert tone="good" sx={{ mb: 2.25 }}>{notice}</XDriveStatusAlert>}

          {share && (
            <Stack spacing={2}>
              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                {share.type === 'dir'
                  ? <FolderRoundedIcon sx={{ fontSize: 28, mt: 0.5 }} />
                  : <InsertDriveFileRoundedIcon sx={{ fontSize: 28, mt: 0.5 }} />}
                <Box sx={{ minWidth: 0 }}>
                  <Typography component="h2" variant="h6" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
                    {share.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {share.type === 'dir' ? '只读文件夹 · 按需浏览' : formatBytes(share.size)}
                  </Typography>
                </Box>
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
                  label="分享密码"
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

              {share.type === 'dir' ? (
                <Stack spacing={1.25}>
                  {folder ? (
                    <Box role="region" aria-label="分享文件夹内容" aria-busy={folderPending}
                      sx={{ minHeight: 180, position: 'relative' }}>
                      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.5} sx={{ mb: 1 }}>
                        {folder.path.map((crumb, index) => (
                          <Button key={crumb.id} type="button" size="small"
                            disabled={index === folder.path.length - 1}
                            onClick={() => void loadFolder(folder.path.slice(0, index + 1))}>
                            {crumb.name}
                          </Button>
                        ))}
                      </Stack>
                      <Box role="list" sx={{ maxHeight: 400, overflowY: 'auto' }}>
                        {folder.items.map((entry) => (
                          <Stack key={entry.id} role="listitem" direction="row" spacing={1}
                            alignItems="center"
                            sx={{ py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
                            {entry.type === 'dir'
                              ? <FolderRoundedIcon fontSize="small" color="action" />
                              : <InsertDriveFileRoundedIcon fontSize="small" color="action" />}
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                                {entry.name}
                              </Typography>
                              {entry.type === 'file' && (
                                <Typography variant="caption" color="text.secondary">
                                  {formatBytes(entry.size)}
                                </Typography>
                              )}
                            </Box>
                            {entry.type === 'dir' ? (
                              <Button type="button" size="small"
                                onClick={() => void loadFolder([...folder.path,
                                  { id: entry.id, name: entry.name }])}>
                                打开
                              </Button>
                            ) : (
                              <Button type="button" size="small" disabled={!canDownload}
                                startIcon={<DownloadRoundedIcon />}
                                onClick={() => void download(entry)}>
                                下载
                              </Button>
                            )}
                          </Stack>
                        ))}
                      </Box>
                      {!folderPending && folder.items.length === 0 && (
                        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                          此文件夹为空
                        </Typography>
                      )}
                      {(folder.history.length > 0 || folder.next > 0) && (
                        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                          {folder.history.length > 0 && (
                            <Button type="button" fullWidth size="small" disabled={folderPending}
                              onClick={() => void loadFolder(
                                folder.path, folder.history[folder.history.length - 1], true,
                              )}>
                              上一页
                            </Button>
                          )}
                          {folder.next > 0 && (
                            <Button type="button" fullWidth size="small" disabled={folderPending}
                              onClick={() => void loadFolder(folder.path, folder.next)}>
                              下一页
                            </Button>
                          )}
                        </Stack>
                      )}
                      {showFolderPending && (
                        <Box sx={{
                          position: 'absolute', inset: 0, display: 'grid',
                          placeItems: 'center', pointerEvents: 'none',
                          bgcolor: 'background.paper', opacity: 0.88,
                        }}>
                          <XDriveStatePanel variant="plain" loading message="正在读取文件夹…" />
                        </Box>
                      )}
                    </Box>
                  ) : (
                    <XDriveActionButton intent="primary" type="button" fullWidth
                      disabled={!canDownload} loading={folderPending}
                      onClick={() => void loadFolder([{ id: 0, name: share.name }])}>
                      浏览文件夹
                    </XDriveActionButton>
                  )}
                  {folderError && <XDriveStatusAlert tone="bad">{folderError}</XDriveStatusAlert>}
                </Stack>
              ) : (
                <XDriveActionButton intent="primary" type="submit" fullWidth
                  startIcon={<DownloadRoundedIcon />} loading={downloading}
                  loadingLabel="正在下载…" disabled={!canDownload}>
                  下载
                </XDriveActionButton>
              )}
            </Stack>
          )}
        </Box>
      </XDriveAuthPanel>
    </XDriveAuthShell>
  )
}

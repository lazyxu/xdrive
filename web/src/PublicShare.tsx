import { useEffect, useMemo, useRef, useState } from 'react'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import FolderZipRoundedIcon from '@mui/icons-material/FolderZipRounded'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import { Box, InputAdornment, Stack, TextField, Typography } from '@mui/material'
import { XDriveActionButton, XDriveAuthPanel, XDriveAuthShell, XDriveBrandLockup, XDrivePublicShareReadOnlyExplorer, XDriveStatusAlert } from '@xdrive/ui/mui'
import { ApiError, XDriveApi } from './api'
import type { PublicShare, PublicShareChild } from '../../ui/shared/src'
import { formatBytes } from '../../ui/shared/src'
import xDriveBrandIcon from '../../assets/icon/master/xdrive-icon-master.svg'

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
  const [zipPreparing, setZipPreparing] = useState(false)
  const [zipTaskID, setZipTaskID] = useState('')
  const [zipNotice, setZipNotice] = useState('')
  const [zipError, setZipError] = useState('')
  const zipPollRef = useRef<AbortController | null>(null)
  const pendingPage = useRef<AbortController | null>(null)
  // Public metadata and normal folder navigation are presentation-silent.
  // Real GETs start immediately; authenticated rows/crumbs remain mounted.

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
      // Stop only the browser's status requests, not the durable preparation
      // the recipient explicitly started. That task owns its own cancellation.
      zipPollRef.current?.abort()
      zipPollRef.current = null
    }
  }, [])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    ;(async () => {
      try {
        const result = await api.publicShare(token, controller.signal)
        if (active && !controller.signal.aborted) setShare(result)
      } catch (err) {
        if (!active || controller.signal.aborted) return
        if (err instanceof ApiError && err.status === 410) {
          setError('此分享已过期、达到下载上限或已被撤销。')
        } else if (err instanceof ApiError && err.status === 404) {
          setError('此分享链接不存在。')
        } else {
          setError(err instanceof Error ? err.message : '无法加载此分享。')
        }
      } finally {
        if (active && !controller.signal.aborted) setLoading(false)
      }
    })()
    return () => { active = false; controller.abort() }
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

  const startSharedFolderZIP = async () => {
    if (!share || share.type !== 'dir' || !canDownload || zipPreparing) return
    zipPollRef.current?.abort()
    const controller = new AbortController()
    zipPollRef.current = controller
    setZipPreparing(true)
    setZipTaskID('')
    setZipNotice('')
    setZipError('')
    try {
      let status = await api.preparePublicShareArchive(token, password, controller.signal)
      if (controller.signal.aborted) return
      setZipTaskID(status.prepare_id)
      while (!controller.signal.aborted) {
        if (status.state === 'completed') {
          await api.downloadPublicShareArchive(
            token, password, status.prepare_id, status.filename || `${share.name}.zip`,
            controller.signal,
          )
          if (controller.signal.aborted) return
          setShare((current) => current
            ? { ...current, download_count: current.download_count + 1 }
            : current)
          setZipTaskID('')
          setZipNotice('ZIP 已交给浏览器下载，准备任务已完成。')
          return
        }
        if (status.state === 'failed' || status.state === 'cancelled') {
          setZipTaskID('')
          setZipError(status.error || 'ZIP 准备失败，请重试。')
          return
        }
        // An explicit, persistent archive is a real network task, not a
        // decorative loading spinner. Poll the durable Server state gently.
        await new Promise<void>((resolve, reject) => {
          const finish = () => {
            controller.signal.removeEventListener('abort', cancel)
            resolve()
          }
          const cancel = () => {
            clearTimeout(timer)
            reject(new DOMException('Aborted', 'AbortError'))
          }
          const timer = setTimeout(finish, 2500)
          controller.signal.addEventListener('abort', cancel, { once: true })
        })
        status = await api.publicShareArchiveStatus(
          token, password, status.prepare_id, controller.signal,
        )
      }
    } catch (err) {
      if (controller.signal.aborted) return
      setZipError(err instanceof ApiError && err.status === 410
        ? '分享已过期或已被撤销，无法生成 ZIP。'
        : err instanceof Error ? err.message : 'ZIP 准备失败。')
    } finally {
      if (zipPollRef.current === controller) {
        zipPollRef.current = null
        setZipPreparing(false)
      }
    }
  }

  const cancelSharedFolderZIP = async () => {
    if (!zipTaskID || !zipPreparing) return
    zipPollRef.current?.abort()
    setZipPreparing(false)
    try {
      await api.cancelPublicShareArchive(token, password, zipTaskID)
      setZipTaskID('')
      setZipNotice('已请求取消 ZIP 准备。')
    } catch (err) {
      setZipError(err instanceof Error ? err.message : '无法取消 ZIP 准备。')
    }
  }

  return (
    <XDriveAuthShell viewport decorated spacing="compact">
      <XDriveAuthPanel size="compact" maxWidth={920} form onSubmit={(event) => {
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
                <>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
                    <XDriveActionButton type="button" intent="primary"
                      disabled={!canDownload || zipPreparing}
                      loading={zipPreparing}
                      loadingLabel="正在准备 ZIP…"
                      startIcon={<FolderZipRoundedIcon />}
                      onClick={() => void startSharedFolderZIP()}>
                      下载整个文件夹 ZIP
                    </XDriveActionButton>
                    {zipTaskID && zipPreparing && (
                      <XDriveActionButton type="button" intent="secondary"
                        onClick={() => void cancelSharedFolderZIP()}>
                        取消准备
                      </XDriveActionButton>
                    )}
                  </Stack>
                  <Box sx={{ minHeight: 24 }} aria-live="polite">
                    {zipPreparing && (
                      <Typography variant="caption" color="text.secondary">
                        正在准备文件夹 ZIP，准备任务可在页面离开后继续。
                      </Typography>
                    )}
                    {zipNotice && <Typography variant="caption" color="success.main">{zipNotice}</Typography>}
                    {zipError && <XDriveStatusAlert tone="bad">{zipError}</XDriveStatusAlert>}
                  </Box>
                  <XDrivePublicShareReadOnlyExplorer
                    kind="dir"
                    items={folder?.items ?? []}
                    path={folder?.path ?? []}
                    folderOpened={Boolean(folder)}
                    pending={folderPending}
                    canDownload={canDownload}
                    hasPreviousPage={Boolean(folder?.history.length)}
                    hasNextPage={Boolean(folder && folder.next > 0)}
                    onBrowse={() => void loadFolder([{ id: 0, name: share.name }])}
                    onCrumbClick={(index) => {
                      if (folder) void loadFolder(folder.path.slice(0, index + 1))
                    }}
                    onOpenFolder={(entry) => {
                      if (folder) void loadFolder([...folder.path, { id: entry.id, name: entry.name }])
                    }}
                    onDownloadItem={(entry) => void download(entry)}
                    onPreviousPage={() => {
                      if (folder?.history.length) {
                        void loadFolder(folder.path, folder.history[folder.history.length - 1], true)
                      }
                    }}
                    onNextPage={() => {
                      if (folder?.next) void loadFolder(folder.path, folder.next)
                    }}
                  />
                  {folderError && <XDriveStatusAlert tone="bad">{folderError}</XDriveStatusAlert>}
                </>
              ) : (
                <>
                  <XDrivePublicShareReadOnlyExplorer
                    kind="file"
                    items={[{ id: 0, name: share.name, type: 'file', size: share.size }]}
                    canDownload={canDownload}
                    onDownloadItem={() => void download()}
                  />
                  <XDriveActionButton intent="primary" type="submit" fullWidth
                    startIcon={<DownloadRoundedIcon />} loading={downloading}
                    loadingLabel="正在下载…" disabled={!canDownload}>
                    下载
                  </XDriveActionButton>
                </>
              )}
            </Stack>
          )}
        </Box>
      </XDriveAuthPanel>
    </XDriveAuthShell>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import FolderZipRoundedIcon from '@mui/icons-material/FolderZipRounded'
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import { Box, InputAdornment, Stack, Typography } from '@mui/material'
import { XDriveActionButton, XDriveAuthPanel, XDriveAuthShell, XDriveBrandLockup, XDrivePublicShareReadOnlyExplorer, XDriveStatusAlert, XDriveSensitiveField, XDriveFileExplorerItemIcon } from '@xdrive/ui/mui'
import { ApiError, XDriveApi } from './api'
import { xDriveShareReadOnlyDefaultCapabilities } from '../../ui/shared/src/file-explorer-capabilities'
import type { XDriveFileExplorerDataAdapter } from '../../ui/shared/src/file-explorer-capabilities'
import type { PublicShare, PublicShareChild } from '../../ui/shared/src'
import { formatBytes } from '../../ui/shared/src'
import xDriveBrandIcon from '../../assets/icon/master/xdrive-icon-master.svg'

type FolderPath = { id: number; name: string }
type FolderPage = { path: FolderPath[]; items: readonly PublicShareChild[]; cursor: number; next: number; history: number[] }

// One source-specific authorization adapter for the shared FileExplorer model.
// No Owner/JWT endpoint can be reached with a public Share capability.
// Server must still independently validate password, root, expiry and revoke.
function createPublicShareFileExplorerAdapter(
  api: XDriveApi, token: string, password: string,
): XDriveFileExplorerDataAdapter<PublicShareChild, number> {
  return {
    source: 'share',
    rootID: 0,
    capabilities: xDriveShareReadOnlyDefaultCapabilities,
    list: async (parentID, cursor, signal) => {
      const pageCursor = Number(cursor ?? 0)
      if (!Number.isSafeInteger(parentID) || parentID < 0 ||
          !Number.isSafeInteger(pageCursor) || pageCursor < 0) {
        throw new Error('Invalid Share-only directory cursor')
      }
      const page = await api.publicShareChildren(token, password, parentID, pageCursor, signal)
      return { items: page.items, nextCursor: page.next_cursor || null }
    },
    loadPreview: (item, signal) =>
      api.publicShareImagePreviewURL(token, password, item.id, signal),
  }
}

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
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [zipTaskID, setZipTaskID] = useState('')
  const [zipNotice, setZipNotice] = useState('')
  const [zipError, setZipError] = useState('')
  const zipPollRef = useRef<AbortController | null>(null)
  const pendingPage = useRef<AbortController | null>(null)
  const activeThumbnailRequests = useRef(new Set<AbortController>())
  const [thumbnailVisibilityEpoch, setThumbnailVisibilityEpoch] = useState(0)
  // Stable Share-only loader across unrelated page/status/ZIP updates. An
  // explicit visibility epoch resets only thumbnail cache after backgrounding.
  const loadSharedThumbnail = useCallback(
    (entry: PublicShareChild, signal?: AbortSignal) => {
      const controller = new AbortController()
      if (signal?.aborted ||
          (typeof document !== 'undefined' && document.visibilityState === 'hidden')) {
        controller.abort()
        return Promise.resolve(null)
      }
      const cancelFromViewport = () => controller.abort()
      signal?.addEventListener('abort', cancelFromViewport, { once: true })
      activeThumbnailRequests.current.add(controller)
      return api.publicShareThumbnailURL(token, password, entry.id, entry.revision, controller.signal)
        .finally(() => {
          activeThumbnailRequests.current.delete(controller)
          signal?.removeEventListener('abort', cancelFromViewport)
        })
    },
    [api, token, password, thumbnailVisibilityEpoch],
  )
  // Public metadata and normal folder navigation are presentation-silent.
  // Real GETs start immediately; authenticated rows/crumbs remain mounted.

  useEffect(() => {
    // Unmount must ALWAYS cancel an unused directory request, including in
    // no-DOM renderers. Browser-only visibility observation is optional.
    const hasDocument = typeof document !== 'undefined'
    const hasWindow = typeof window !== 'undefined'
    // Request-scoped cancellation must happen synchronously in the browser
    // lifecycle event, not after React has committed an unmount/render.
    const abortEphemeralThumbnails = () => {
      for (const controller of activeThumbnailRequests.current) controller.abort()
    }
    const onVisibilityChange = () => {
      if (!hasDocument) return
      if (document.visibilityState === 'hidden') {
        pendingPage.current?.abort()
        abortEphemeralThumbnails()
      } else {
        // A new loader/cache epoch permits intentionally canceled visible
        // thumbnails to retry, without clearing selection/scroll or ZIP jobs.
        setThumbnailVisibilityEpoch(epoch => epoch + 1)
      }
    }
    const onPageHide = () => abortEphemeralThumbnails()
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setThumbnailVisibilityEpoch(epoch => epoch + 1)
    }
    if (hasDocument) document.addEventListener('visibilitychange', onVisibilityChange)
    if (hasWindow) {
      window.addEventListener('pagehide', onPageHide)
      window.addEventListener('pageshow', onPageShow)
    }
    return () => {
      if (hasDocument) document.removeEventListener('visibilitychange', onVisibilityChange)
      if (hasWindow) {
        window.removeEventListener('pagehide', onPageHide)
        window.removeEventListener('pageshow', onPageShow)
      }
      abortEphemeralThumbnails()
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
        if (active && !controller.signal.aborted) {
          setShare(result)
          // Directly open the first bounded Share-scoped folder page: do not
          // mount the authenticated Owner FileExplorer or prefetch media.
          // Password-protected shares keep their existing explicit form.
          if (result.type === 'dir' && !result.requires_password &&
              result.capabilities?.list !== false) {
            const firstPage = new AbortController()
            pendingPage.current?.abort()
            pendingPage.current = firstPage
            setFolderPending(true)
            setFolderError('')
            void (async () => {
              try {
                const page = await createPublicShareFileExplorerAdapter(api, token, '').list(0, 0, firstPage.signal)
                if (!active || pendingPage.current !== firstPage || firstPage.signal.aborted) return
                setFolder({
                  path: [{ id: 0, name: result.name }],
                  items: page.items, cursor: 0, next: Number(page.nextCursor ?? 0), history: [],
                })
              } catch (err) {
                if (!active || pendingPage.current !== firstPage || firstPage.signal.aborted) return
                setFolderError(err instanceof ApiError && err.status === 401
                  ? '分享密码错误。'
                  : err instanceof ApiError && err.status === 410
                    ? '此分享已过期或被撤销。'
                    : err instanceof Error ? err.message : '无法打开此文件夹。')
              } finally {
                if (pendingPage.current === firstPage) {
                  pendingPage.current = null
                  setFolderPending(false)
                }
              }
            })()
          }
        }
      } catch (err) {
        if (!active || controller.signal.aborted) return
        if (err instanceof ApiError && err.status === 410) {
          setError('此分享已过期或已被撤销。')
        } else if (err instanceof ApiError && err.status === 404) {
          setError('此分享链接不存在。')
        } else {
          setError(err instanceof Error ? err.message : '无法加载此分享。')
        }
      } finally {
        if (active && !controller.signal.aborted) setLoading(false)
      }
    })()
    return () => {
      active = false
      controller.abort()
      // The first-page request and metadata belong to this specific link,
      // unlike the explicitly initiated durable whole-folder ZIP.
      pendingPage.current?.abort()
      pendingPage.current = null
    }
  }, [api, token])

  // A pending browser handoff is not an authorization revocation. The granted
  // browse/preview/download capabilities remain stable across downloading.
  // Go grants only narrow the UI; password/revoke/root are verified by
  // every independent Share API and signed media endpoint.
  const grants = share?.capabilities ?? xDriveShareReadOnlyDefaultCapabilities
  const shareEligible = !!share && (!share.requires_password || Boolean(password))
  const canBrowse = shareEligible && grants.list
  const canPreview = canBrowse && grants.preview
  const canDownload = canBrowse && grants.download
  const canUpload = canBrowse && share?.type === 'dir' && grants.upload === true
  const canDownloadZip = canDownload && grants.downloadZip
  const canStartDownload = canDownload && !downloading
  const canStartZip = canDownloadZip && !downloading
  // Keep the single-file DTO stable across selection/toolbar state changes;
  // the shared Explorer's accepted-page effect must not reset highlighting.
  const sharedFileItems = useMemo<PublicShareChild[]>(
    () => share?.type === 'file'
      ? [{ id: 0, name: share.name, type: 'file', size: share.size,
        revision: share.revision, updated_at: share.updated_at,
        thumbnail_candidate: true }]
      : [],
    [share?.type, share?.name, share?.size, share?.revision, share?.updated_at],
  )

  const loadFolder = async (path: FolderPath[], cursor = 0, back = false, refresh = false) => {
    if (!share || share.type !== 'dir' || !canBrowse) return
    // Abort superseded request-scoped JPEG GETs at user navigation time.
    // Do not abort user-owned original/ZIP downloads or an in-place refresh.
    const contentChanged = !refresh && folder !== null && (
      folder.cursor !== cursor || folder.path.at(-1)?.id !== path.at(-1)?.id
    )
    if (contentChanged) {
      // Cursor/crumb/child folder navigation is a same-page content switch.
      // The current share's read-only thumbnails are disposable, while ZIP
      // preparation and explicit downloads remain independent durable work.
      for (const request of activeThumbnailRequests.current) request.abort()
    }
    pendingPage.current?.abort()
    const controller = new AbortController()
    pendingPage.current = controller
    setFolderError('')
    setFolderPending(true)
    try {
      const shareFileAdapter = createPublicShareFileExplorerAdapter(api, token, password)
      const page = await shareFileAdapter.list(path.at(-1)?.id ?? 0, cursor, controller.signal)
      if (pendingPage.current !== controller || controller.signal.aborted) return
      // Keep one server page in the DOM even for a 100k-child folder.
      // A short cursor history supports Back without retaining older Nodes.
      setFolder((old) => {
        let history: number[] = []
        if (old && old.path.at(-1)?.id === path.at(-1)?.id) {
          if (refresh) history = old.history
          else if (back) history = old.history.slice(0, -1)
          else if (cursor > 0) history = [...old.history, old.cursor]
        }
        return { path, items: page.items, cursor, next: Number(page.nextCursor ?? 0), history }
      })
    } catch (err) {
      if (pendingPage.current !== controller || controller.signal.aborted) return
      // The old server-accepted folder stays mounted if the new folder fails.
      // Its cancelled visible JPEGs need a fresh loader/cache epoch to retry.
      if (contentChanged) setThumbnailVisibilityEpoch(epoch => epoch + 1)
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

  const uploadSelected = async (files: FileList | null) => {
    if (!canUpload || uploading || !files?.length || !share) return
    const batch = Array.from(files)
    setUploading(true)
    setUploadProgress('')
    setError('')
    setNotice('')
    let committed = 0
    try {
      const parentID = folder?.path.at(-1)?.id ?? 0
      const directoryIDs = new Map<string, number>()
      for (const [index, file] of batch.entries()) {
        const relative = file.webkitRelativePath || file.name
        const components = relative.split('/')
        // Never transform untrusted browser path separators into an Owner path.
        if (components.some((name) => !name || name === '.' || name === '..' || name.includes('\\'))) {
          throw new Error('文件夹中存在无效路径')
        }
        let destination = parentID
        let key = ''
        for (const directory of components.slice(0, -1)) {
          key += '/' + directory
          let known = directoryIDs.get(key)
          if (known === undefined) {
            const created = await api.publicShareCreateDirectory(token, password, destination, directory)
            known = created.id
            directoryIDs.set(key, known)
          }
          destination = known
        }
        setUploadProgress(`正在上传 ${index + 1}/${batch.length}：${file.name}`)
        await api.uploadPublicShareFile(token, password, destination, file, (fraction) =>
          setUploadProgress(`正在上传 ${index + 1}/${batch.length}：${file.name}（${Math.floor(fraction * 100)}%）`))
        committed += 1
      }
      setNotice(`成功上传 ${committed} 个文件`)
      setUploadProgress('')
      if (folder) await loadFolder(folder.path, folder.cursor, false, true)
    } catch (err) {
      setUploadProgress('')
      setError(`已完成 ${committed}/${batch.length} 个文件；${err instanceof Error ? err.message : '匿名上传失败'}`)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (folderInputRef.current) folderInputRef.current.value = ''
    }
  }

  const download = async (entry?: PublicShareChild) => {
    if (!share || !canStartDownload) return
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

  const startSharedFolderZIP = async (entry?: PublicShareChild) => {
    if (!share || share.type !== 'dir' || !canStartZip || zipPreparing) return
    const zipName = entry?.name ?? share.name
    const folderID = entry?.type === 'dir' ? entry.id : 0
    zipPollRef.current?.abort()
    const controller = new AbortController()
    zipPollRef.current = controller
    setZipPreparing(true)
    setZipTaskID('')
    setZipNotice('')
    setZipError('')
    try {
      let status = await api.preparePublicShareArchive(token, password, controller.signal, folderID)
      if (controller.signal.aborted) return
      setZipTaskID(status.prepare_id)
      while (!controller.signal.aborted) {
        if (status.state === 'completed') {
          await api.downloadPublicShareArchive(
            token, password, status.prepare_id, status.filename || `${zipName}.zip`,
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
    <XDriveAuthShell viewport spacing="compact"
      sx={{ p: 0, minHeight: '100dvh', bgcolor: 'background.default', overflowX: 'hidden' }}>
      <XDriveAuthPanel size="compact" maxWidth="100%" form onSubmit={(event) => {
        event.preventDefault()
        if (share?.type === 'dir') void loadFolder([{ id: 0, name: share.name }])
        else void download()
      }} sx={{
        maxWidth: 'none', width: '100%', minHeight: '100dvh',
        m: 0, p: 0, border: 0, borderRadius: 0, boxShadow: 'none',
        bgcolor: 'background.default',
      }}>
        <Box component="header" data-xdrive-public-share-titlebar
          sx={{
            height: 52, minHeight: 52, width: '100%', px: { xs: 2, md: 3 },
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper',
          }}>
          <XDriveBrandLockup iconSrc={xDriveBrandIcon} variant="titlebar" subtitle="安全文件分享" />
          <Typography variant="caption" color="text.secondary">只读 · 授权访问</Typography>
        </Box>
        <Box component="main" data-xdrive-public-share-workspace
          sx={{
            width: '100%', maxWidth: 1500, mx: 'auto', minWidth: 0,
            minHeight: 'calc(100dvh - 52px)', p: { xs: 1.5, sm: 2.5, lg: 3 },
          }}>

        <Box
          data-xdrive-public-share-read-slot
          aria-busy={loading}
          sx={{ minHeight: 180, minWidth: 0, position: 'relative' }}
        >
          {/* A failed first metadata read has no mounted Explorer to displace.
              Once authenticated content exists, all async receipts float outside its Stack. */}
          {!share && error ? <XDriveStatusAlert tone="bad" sx={{ mb: 2.25 }}>{error}</XDriveStatusAlert> : null}

          {share && (
            <Stack spacing={2.25} sx={{ width: '100%', minWidth: 0 }}>
              <Stack direction="row" spacing={1.5} alignItems="flex-start"
                sx={{
                  px: { xs: 1.5, sm: 2.5 }, py: 2, minWidth: 0, alignItems: 'center',
                  border: 1, borderColor: 'divider', borderRadius: 2,
                  bgcolor: 'background.paper',
                }}>
                <Box sx={{ mt: 0.5 }}>
                  <XDriveFileExplorerItemIcon item={{ name: share.name, kind: share.type === 'dir' ? 'dir' : 'file' }} size={28} />
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography component="h2" variant="h6" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
                    {share.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {share.type === 'dir' ? (canUpload ? '查看 + 上传 · 可提交文件和完整文件夹' : '只读文件夹 · 按需浏览') : formatBytes(share.size)}
                  </Typography>
                </Box>
              </Stack>

              <Typography variant="body2" color="text.secondary" sx={{ px: 0.5 }}>
                {share.expires_at ? `过期时间 ${new Date(share.expires_at).toLocaleString()}` : '永不过期'}
                {' · '}下载不限次数
              </Typography>

              {share.requires_password && (
                <XDriveSensitiveField
                  label="分享密码"
                  value={password}
                  onChange={setPassword}
                  placeholder="分享密码"
                  autoComplete="current-password"
                  sx={{ maxWidth: 440 }}
                  startAdornment={
                    <InputAdornment position="start">
                      <LockRoundedIcon fontSize="small" />
                    </InputAdornment>
                  }
                />
              )}

              {/* Eligibility changes are announced in the persistent floating owner below. */}

              {share.type === 'dir' ? (
                <>
                  {uploadProgress ? <Typography role="status" sx={{ px: 0.5 }}>{uploadProgress}</Typography> : null}
                  <Box data-xdrive-public-share-zip-status-slot
                    aria-live="polite" aria-busy={zipPreparing || undefined}
                    sx={{ height: 24, minHeight: 24, px: 0.5, minWidth: 0 }}>
                    {zipPreparing ? (
                      <Typography variant="caption" color="text.secondary" noWrap
                        title="正在准备文件夹 ZIP，准备任务可在页面离开后继续。"
                        sx={{ display: 'block', lineHeight: '24px' }}>
                        正在准备文件夹 ZIP，准备任务可在页面离开后继续。
                      </Typography>
                    ) : null}
                  </Box>
                  <XDrivePublicShareReadOnlyExplorer
                    kind="dir"
                    items={folder?.items ?? []}
                    path={folder?.path ?? []}
                    folderOpened={Boolean(folder) || folderPending}
                    pending={folderPending}
                    canBrowse={canBrowse}
                    canPreview={canPreview}
                    canDownload={canDownload}
                    canDownloadZip={canDownloadZip}
                    downloadPending={downloading}
                    hasPreviousPage={Boolean(folder?.history.length)}
                    hasNextPage={Boolean(folder && folder.next > 0)}
                    toolbarActions={
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        {canUpload ? (
                          <>
                            <input ref={fileInputRef} type="file" multiple hidden
                              aria-label="选择要上传的文件"
                              onChange={(event) => { void uploadSelected(event.target.files) }} />
                            <input ref={(element) => {
                              folderInputRef.current = element
                              element?.setAttribute('webkitdirectory', '')
                            }} type="file" multiple hidden
                              aria-label="选择要上传的文件夹"
                              onChange={(event) => { void uploadSelected(event.target.files) }} />
                            <XDriveActionButton type="button" intent="secondary"
                              disabled={uploading} startIcon={<UploadFileRoundedIcon />}
                              onClick={() => fileInputRef.current?.click()}>上传文件</XDriveActionButton>
                            <XDriveActionButton type="button" intent="secondary"
                              disabled={uploading} startIcon={<CreateNewFolderRoundedIcon />}
                              onClick={() => folderInputRef.current?.click()}>上传文件夹</XDriveActionButton>
                          </>
                        ) : null}
                        <XDriveActionButton type="button" intent="primary"
                          disabled={!canStartZip || zipPreparing}
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
                    }
                    onBrowse={() => void loadFolder([{ id: 0, name: share.name }])}
                    onCrumbClick={(index) => {
                      if (folder) void loadFolder(folder.path.slice(0, index + 1))
                    }}
                    onOpenFolder={(entry) => {
                      if (folder) void loadFolder([...folder.path, { id: entry.id, name: entry.name }])
                    }}
                    onDownloadItem={(entry) => void download(entry)}
                    onDownloadFolder={(entry) => void startSharedFolderZIP(entry)}
                    folderZIPPreparing={zipPreparing}
                    loadThumbnail={loadSharedThumbnail}
                    loadImagePreview={(entry, signal) => api.publicShareImagePreviewURL(token, password, entry.id, signal)}
                    onPreviousPage={() => {
                      if (folder?.history.length) {
                        void loadFolder(folder.path, folder.history[folder.history.length - 1], true)
                      }
                    }}
                    onNextPage={() => {
                      if (folder?.next) void loadFolder(folder.path, folder.next)
                    }}
                    onRefresh={() => {
                      if (folder) void loadFolder(folder.path, folder.cursor, false, true)
                    }}
                  />
                  {/* A failed folder GET retains the existing Explorer and is reported
                      by the fixed feedback owner outside the layout Stack. */}
                </>
              ) : (
                <XDrivePublicShareReadOnlyExplorer
                  kind="file"
                  items={sharedFileItems}
                  canBrowse={canBrowse}
                  canPreview={canPreview}
                  canDownload={canDownload}
                  canDownloadZip={canDownloadZip}
                  downloadPending={downloading}
                  onDownloadItem={() => void download()}
                  loadThumbnail={loadSharedThumbnail}
                  loadImagePreview={(_entry, signal) => api.publicShareImagePreviewURL(token, password, 0, signal)}
                  toolbarActions={
                    <XDriveActionButton intent="primary" type="submit"
                      startIcon={<DownloadRoundedIcon />} loading={downloading}
                      loadingLabel="正在下载…" disabled={!canStartDownload}>
                      下载文件
                    </XDriveActionButton>
                  }
                />
              )}
            </Stack>
          )}
          {/* Never inject asynchronous share/ZIP/folder feedback among the
              already-mounted shared Explorer siblings. MUI Stack spacing
              can shift list rows even for an absolute-positioned child. */}
          <Box data-xdrive-public-share-floating-feedback
            sx={{
              position: 'fixed', left: '50%', transform: 'translateX(-50%)',
              bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
              width: 'min(calc(100vw - 24px), 560px)',
              maxHeight: 'min(35dvh, 240px)', overflowY: 'auto',
              zIndex: (theme) => theme.zIndex.snackbar,
              pointerEvents: 'none', display: 'flex',
              flexDirection: 'column', gap: 0.5,
            }}>
            {share && error ? <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert> : null}
            {share && notice ? (
              <Typography role="status" variant="caption"
                sx={{ p: 1.25, bgcolor: 'background.paper', borderRadius: 1.5, boxShadow: 2 }}>
                {notice}
              </Typography>
            ) : null}
            {exhausted ? <XDriveStatusAlert tone="warning">此分享已达到下载上限。</XDriveStatusAlert> : null}
            {share?.type === 'dir' && zipNotice ? (
              <Typography role="status" variant="caption"
                sx={{ p: 1.25, bgcolor: 'background.paper', borderRadius: 1.5, boxShadow: 2 }}>
                {zipNotice}
              </Typography>
            ) : null}
            {share?.type === 'dir' && zipError ? <XDriveStatusAlert tone="bad">{zipError}</XDriveStatusAlert> : null}
            {share?.type === 'dir' && folderError ? <XDriveStatusAlert tone="bad">{folderError}</XDriveStatusAlert> : null}
          </Box>
        </Box>
        </Box>
      </XDriveAuthPanel>
    </XDriveAuthShell>
  )
}

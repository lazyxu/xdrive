import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import type {
  XDriveSynologyBackupLocalClient, XDriveSynologyOwnerFileNode,
} from '../synology-backup-adapter'
import { XDriveFileExplorer } from './FileExplorer'
import type { XDriveFileExplorerUnavailableActions } from './FileExplorer'
import { useXDriveFileExplorerOwnerFence } from './FileExplorerOwnerFence'
import { XDriveFileQuickLookDialog } from './FileQuickLookDialog'
import { xDriveFileSupportsTextPreview } from '../file-preview'
import { xDriveFileSupportsThumbnail } from './FileExplorerItemPresentation'
import { xDriveSynologyLoadOwnerThumbnail } from '../synology-owner-thumbnail'
import {
  xDriveSynologyFetchVerifiedDownload,
  XDRIVE_SYNOLOGY_OWNER_DOWNLOAD_MAX_BYTES,
} from '../synology-owner-download'
import { xDriveMediaByteProgressLabel } from './MediaLoadProgress'
import type { XDriveByteProgressHandler } from '../file-preview'
import {
  xDriveSynologyLoadBoundedMediaPreview, xDriveSynologyPreviewMIME,
  XDRIVE_SYNOLOGY_MEDIA_BLOB_MAX_BYTES,
} from '../synology-media-preview'
import {
  xDriveSynologyLoadNativeMediaStream, xDriveSynologyPlaybackMIME,
} from '../synology-media-stream'
import type {
  XDriveFileExplorerCrumb, XDriveFileExplorerItem, XDriveFileExplorerSort,
} from './FileExplorer'
import { XDriveActionButton } from './ActionButton'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'
import {
  xDriveSynologyOwnerFilesScopeKey,
  xDriveSynologyOwnerFilesNearEnd,
} from '../synology-owner-files-scope'

const pageSize = 200

function supportsOwnerPreview(item: XDriveFileExplorerItem): boolean {
  if (item.kind !== 'file') return false
  if (xDriveFileSupportsTextPreview(item.name, item.kind)) return true
  if (typeof item.size !== 'number' || !Number.isSafeInteger(item.size) || item.size < 1) return false
  return Boolean(xDriveSynologyPlaybackMIME(item.name) ||
    (xDriveSynologyPreviewMIME(item.name) && item.size <= XDRIVE_SYNOLOGY_MEDIA_BLOB_MAX_BYTES))
}

function itemForExplorer(node: XDriveSynologyOwnerFileNode): XDriveFileExplorerItem {
  return {
    id: node.id,
    name: node.name,
    kind: node.type,
    size: node.size,
    revision: node.revision,
    createdAt: node.created_at,
    updatedAt: node.updated_at,
    statusLabel: '只读',
    thumbnailEligible: xDriveFileSupportsThumbnail(node.name, node.type),
  }
}

/**
 * One canonical FileExplorer component, driven by a strictly read-only,
 * Server Owner-authenticated Agent data source in the DSM host.
 * This is not an independent NAS file manager and cannot access DSM paths.
 */
export function XDriveSynologyOwnerFilesPage({
  client,
  unavailableActions,
}: { client: XDriveSynologyBackupLocalClient; unavailableActions?: XDriveFileExplorerUnavailableActions }) {
  const [crumbs, setCrumbs] = useState<XDriveFileExplorerCrumb[]>([])
  const [items, setItems] = useState<XDriveSynologyOwnerFileNode[]>([])
  const [sort, setSort] = useState<XDriveFileExplorerSort>({ key: 'name', direction: 'asc' })
  const [loadingRoot, setLoadingRoot] = useState(true)
  const [rootError, setRootError] = useState('')
  const [loading, setLoading] = useState(true)
  const [verified, setVerified] = useState(false)
  const [verifiedScopeKey, setVerifiedScopeKey] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<{
    scopeKey: string; rootRevision: number; client: XDriveSynologyBackupLocalClient
    item: XDriveFileExplorerItem; sessionIDs?: (string | number)[]
  } | null>(null)
  const [paging, setPaging] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState('')
  const [rootRevision, setRootRevision] = useState(0)
  const [download, setDownload] = useState<{ name: string; loaded: number; total: number } | null>(null)
  const [verifiedDownload, setVerifiedDownload] = useState<{
    filename: string; url: string; scopeKey: string; rootRevision: number
  } | null>(null)

  const downloadAbort = useRef<AbortController | null>(null)
  const verifiedDownloadURL = useRef<string | null>(null)
  const pageEpoch = useRef(0)
  const pendingPage = useRef<AbortController | null>(null)
  const pagingActive = useRef(false)
  const itemsRef = useRef<XDriveSynologyOwnerFileNode[]>([])
  const verifiedOwnerRef = useRef<{
    client: XDriveSynologyBackupLocalClient; rootRevision: number
  } | null>(null)

  // A folder/sort switch renders before its request effect runs. Never hand
  // previous-owner/folder rows to the canonical FileExplorer during that gap.
  const currentScopeKey = xDriveSynologyOwnerFilesScopeKey(crumbs, sort.key, sort.direction)
  const currentScopeVerified = verified && verifiedScopeKey === currentScopeKey &&
    verifiedOwnerRef.current?.client === client && verifiedOwnerRef.current.rootRevision === rootRevision
  // Authenticated DSM CGI and Desktop Files share one Owner lifecycle fence.
  const { isCurrent: isCurrentOwner, invalidate: invalidateOwner } =
    useXDriveFileExplorerOwnerFence(client, currentScopeKey, rootRevision)
  const displayedItems = useMemo(
    () => currentScopeVerified ? items.map(itemForExplorer) : [],
    [items, currentScopeVerified],
  )
  const previewItems = useMemo(() => {
    const candidates = displayedItems.filter(supportsOwnerPreview)
    if (!preview?.sessionIDs) return candidates
    const byID = new Map(candidates.map(item => [item.id, item]))
    return preview.sessionIDs.flatMap(id => {
      const item = byID.get(id)
      return item ? [item] : []
    })
  }, [displayedItems, preview?.sessionIDs])
  const previewIndex = currentScopeVerified && preview?.scopeKey === currentScopeKey &&
    preview.rootRevision === rootRevision && preview.client === client
    ? previewItems.findIndex(item => item.id === preview.item.id &&
      item.revision === preview.item.revision && item.name === preview.item.name &&
      item.size === preview.item.size)
    : -1
  const previewItem = previewIndex >= 0 ? previewItems[previewIndex] : null
  const previewPositionLabel = previewItem
    ? `${previewIndex + 1} / ${previewItems.length} ${preview?.sessionIDs ? '已选择' : '已加载'}` : ''
  const readyDownload = currentScopeVerified &&
    verifiedDownload?.scopeKey === currentScopeKey &&
    verifiedDownload.rootRevision === rootRevision ? verifiedDownload : null
  const loadTextPreview = useCallback((item: XDriveFileExplorerItem, signal?: AbortSignal) => {
    if (typeof item.id !== 'number' || !xDriveFileSupportsTextPreview(item.name, item.kind)) {
      return Promise.reject(new Error('仅允许对已确认的文本文件执行 Owner 预览'))
    }
    return client.ownerFileTextPreview(item.id, signal)
  }, [client])
  const loadOwnerThumbnail = useCallback((
    item: XDriveFileExplorerItem,
    signal?: AbortSignal,
    onProgress?: XDriveByteProgressHandler,
  ) => xDriveSynologyLoadOwnerThumbnail(client, item, signal, onProgress), [client])
  // Every entry uses the same capability check, including the actual handler.
  // Reject unsupported/stale requests before retiring an already verified save.
  const getDownloadDisabledReason = useCallback((
    selected: readonly XDriveFileExplorerItem[], count = selected.length,
  ): string | null => {
    if (!isCurrentOwner() || !currentScopeVerified) return '当前 Server Owner 目录尚未验证'
    if (downloadAbort.current) return '已有正在执行的文件下载'
    if (count !== 1 || selected.length !== 1) return '暂仅支持单个文件下载'
    const item = selected[0]
    if (item.kind !== 'file' || typeof item.size !== 'number' ||
        !Number.isSafeInteger(item.size) || item.size < 1 ||
        item.size > XDRIVE_SYNOLOGY_OWNER_DOWNLOAD_MAX_BYTES) {
      return '仅支持大小为 1 B～32 MiB 的单个原始文件下载'
    }
    if (!itemsRef.current.some(node =>
      node.type === 'file' && node.id === item.id &&
      node.revision === item.revision && node.name === item.name &&
      node.size === item.size)) {
      return '该文件不属于当前已核实的 Server Owner 目录'
    }
    return null
  }, [currentScopeVerified, isCurrentOwner])
  // Native OS/browser saving is initiated only AFTER complete Owner/revision
  // validation and whole-file SHA-256 proof. No unsafe Server URL or token
  // is ever exposed, and partial bytes never reach the browser download UI.
  const downloadSelectedFiles = useCallback((selected: XDriveFileExplorerItem[]) => {
    if (!isCurrentOwner()) return
    const disabledReason = getDownloadDisabledReason(selected)
    if (disabledReason) {
      setNotice(disabledReason)
      return
    }
    const item = selected[0]
    // The browser save step needs a fresh user click. Reveal the existing
    // page's progress/cancel/save controls instead of hiding them behind MUI.
    setPreview(null)
    // Retire a previous verified but unused Blob before a different request.
    if (verifiedDownloadURL.current) {
      URL.revokeObjectURL(verifiedDownloadURL.current)
      verifiedDownloadURL.current = null
      setVerifiedDownload(null)
    }
    const controller = new AbortController()
    downloadAbort.current = controller
    setDownload({ name: item.name, loaded: 0, total: item.size ?? 0 })
    setNotice('')
    void xDriveSynologyFetchVerifiedDownload(client, item, controller.signal,
      (loaded, total) => {
        if (downloadAbort.current === controller && !controller.signal.aborted) {
          setDownload({ name: item.name, loaded, total: total ?? item.size ?? 0 })
        }
      })
      .then(({ filename, blob }) => {
        if (controller.signal.aborted || downloadAbort.current !== controller) return
        // Safari can reject a synthetic anchor.click() following 128 awaited
        // Owner range requests. Expose a real user-activated a[download] link
        // only after complete SHA verification, never a premature save.
        const url = URL.createObjectURL(blob)
        verifiedDownloadURL.current = url
        setVerifiedDownload({ filename, url, scopeKey: currentScopeKey, rootRevision })
        setNotice('文件完整性校验成功，请点击“保存文件”；链接 60 秒后失效。')
        window.setTimeout(() => {
          if (verifiedDownloadURL.current !== url) return
          verifiedDownloadURL.current = null
          URL.revokeObjectURL(url)
          setVerifiedDownload(previous => previous?.url === url ? null : previous)
        }, 60_000)
      })
      .catch(() => {
        if (downloadAbort.current === controller && !controller.signal.aborted) {
          setNotice('文件下载未完成完整性校验，未提供不完整的文件。')
        }
      })
      .finally(() => {
        if (downloadAbort.current === controller) {
          downloadAbort.current = null
          setDownload(null)
        }
      })
  }, [client, currentScopeKey, rootRevision, getDownloadDisabledReason, isCurrentOwner])

  const cancelDownload = useCallback(() => {
    if (!isCurrentOwner()) return
    downloadAbort.current?.abort()
    downloadAbort.current = null
    setDownload(null)
    setNotice('已取消文件下载。')
  }, [isCurrentOwner])

  const openFilePreview = useCallback((item: XDriveFileExplorerItem, sessionIDs?: (string | number)[]) => {
    if (!isCurrentOwner() || !currentScopeVerified) return
    const current = displayedItems.find(candidate => candidate.id === item.id &&
      candidate.revision === item.revision && candidate.name === item.name && candidate.size === item.size)
    if (!current || !supportsOwnerPreview(current)) {
      setNotice('该文件类型或大小暂不支持 DSM Viewer；请通过 Desktop/Web 打开。')
      return
    }
    setNotice('')
    setPreview({ scopeKey: currentScopeKey, rootRevision, client, item: current,
      sessionIDs: sessionIDs ? [...new Set(sessionIDs)] : undefined })
  }, [client, currentScopeKey, rootRevision, currentScopeVerified, displayedItems, isCurrentOwner])

  const movePreview = useCallback((delta: -1 | 1) => {
    if (!isCurrentOwner() || !currentScopeVerified) return
    setPreview(previous => {
      if (!previous || previous.client !== client || previous.rootRevision !== rootRevision ||
          previous.scopeKey !== currentScopeKey) return previous
      const index = previewItems.findIndex(item => item.id === previous.item.id &&
        item.revision === previous.item.revision)
      const next = index >= 0 ? previewItems[index + delta] : undefined
      return next ? { ...previous, item: next } : previous
    })
  }, [client, currentScopeKey, rootRevision, currentScopeVerified, previewItems, isCurrentOwner])
  const previewDownloadReason = previewItem ? getDownloadDisabledReason([previewItem]) : null
  const previewActions = previewItem ? [{
    id: 'download', label: previewDownloadReason ? '下载：' + previewDownloadReason : '下载',
    disabled: Boolean(previewDownloadReason),
    onSelect: () => downloadSelectedFiles([previewItem]),
  }] : []

  const loadMediaPreview = useCallback((
    item: XDriveFileExplorerItem,
    kind: 'image' | 'video' | 'audio' | 'pdf' | 'live_photo',
    signal?: AbortSignal,
    onProgress?: XDriveByteProgressHandler,
  ) => {
    if ((kind === 'video' || kind === 'audio') && xDriveSynologyPlaybackMIME(item.name)) {
      return xDriveSynologyLoadNativeMediaStream(client, item, signal)
    }
    if ((kind !== 'image' && kind !== 'pdf') || !xDriveSynologyPreviewMIME(item.name)) {
      return Promise.reject(new Error('DSM 暂不支持此媒体类型的预览'))
    }
    return xDriveSynologyLoadBoundedMediaPreview(client, item, signal, onProgress)
  }, [client])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoadingRoot(true)
    setRootError('')
    setCrumbs([])
    void client.ownerFilesRoot(controller.signal).then(root => {
      if (active) setCrumbs([{ id: root.id, name: root.name }])
    }).catch(() => {
      if (active) {
        setLoading(false)
        setRootError('无法通过 Agent 当前 xDrive Server 账号读取云端根目录；未确认任何文件。')
      }
    }).finally(() => {
      if (active) setLoadingRoot(false)
    })
    return () => { active = false; controller.abort() }
  }, [client, rootRevision])

  useEffect(() => {
    if (crumbs.length === 0) return
    const epoch = ++pageEpoch.current
    pendingPage.current?.abort()
    const controller = new AbortController()
    pendingPage.current = controller
    pagingActive.current = false
    itemsRef.current = []
    verifiedOwnerRef.current = null
    setItems([])
    setHasMore(false)
    setNextCursor('')
    setPaging(false)
    setVerified(false)
    setVerifiedScopeKey('')
    setError('')
    setNotice('')
    setLoading(true)
    const parent = crumbs[crumbs.length - 1].id
    if (typeof parent !== 'number') return
    void client.ownerFilesPage(parent, pageSize, sort.key, sort.direction, '',
      controller.signal).then(page => {
      if (controller.signal.aborted || pageEpoch.current !== epoch) return
      itemsRef.current = page.items
      setItems(page.items)
      setNextCursor(page.next_cursor ?? '')
      setHasMore(page.has_more)
      verifiedOwnerRef.current = { client, rootRevision }
      setVerifiedScopeKey(currentScopeKey)
      setVerified(true)
    }).catch(() => {
      if (controller.signal.aborted || pageEpoch.current !== epoch) return
      setError('该目录读取失败或 Server 会话已失效；不会显示未验证的旧账号文件。')
    }).finally(() => {
      if (!controller.signal.aborted && pageEpoch.current === epoch) setLoading(false)
    })
    return () => {
      controller.abort()
      pageEpoch.current++
      pagingActive.current = false
    }
  }, [client, crumbs, sort.key, sort.direction, currentScopeKey, rootRevision])

  const loadMore = useCallback(() => {
    const parent = crumbs[crumbs.length - 1]?.id
    if (typeof parent !== 'number' || !currentScopeVerified || !hasMore ||
      nextCursor.length === 0 || pagingActive.current || loading) return
    const epoch = pageEpoch.current
    const cursor = nextCursor
    const controller = new AbortController()
    pendingPage.current?.abort()
    pendingPage.current = controller
    pagingActive.current = true
    setPaging(true)
    setError('')
    void client.ownerFilesPage(parent, pageSize, sort.key, sort.direction, cursor,
      controller.signal).then(page => {
      if (controller.signal.aborted || pageEpoch.current !== epoch) return
      const seen = new Set(itemsRef.current.map(node => node.id))
      if (page.items.some(node => seen.has(node.id))) {
        setError('Server 返回了重复文件，已保留先前核实的结果；请刷新目录。')
        return
      }
      const updated = [...itemsRef.current, ...page.items]
      itemsRef.current = updated
      setItems(updated)
      setHasMore(page.has_more)
      setNextCursor(page.next_cursor ?? '')
    }).catch(() => {
      if (!controller.signal.aborted && pageEpoch.current === epoch) {
        setError('继续加载失败，已保留核实的文件；可重试。')
      }
    }).finally(() => {
      if (!controller.signal.aborted && pageEpoch.current === epoch) {
        pagingActive.current = false
        setPaging(false)
      }
    })
  }, [client, crumbs, hasMore, nextCursor, loading, currentScopeVerified, sort.key, sort.direction])

  // DSM and Server account identity are not interchangeable. Returning to a
  // background tab or pressing Refresh starts with a newly authenticated root,
  // rather than retaining breadcrumbs or file names from a previous Owner.
  const refreshAuthenticatedOwner = useCallback(() => {
    invalidateOwner()
    verifiedOwnerRef.current = null
    // Do not carry an in-progress Owner download into another login/session.
    downloadAbort.current?.abort()
    downloadAbort.current = null
    setDownload(null)
    if (verifiedDownloadURL.current) {
      URL.revokeObjectURL(verifiedDownloadURL.current)
      verifiedDownloadURL.current = null
    }
    setVerifiedDownload(null)
    pendingPage.current?.abort()
    pageEpoch.current++
    pagingActive.current = false
    itemsRef.current = []
    setItems([])
    setCrumbs([])
    setVerified(false)
    setVerifiedScopeKey('')
    setHasMore(false)
    setNextCursor('')
    setPaging(false)
    setNotice('')
    setPreview(null)
    setError('')
    setRootError('')
    setLoading(true)
    setLoadingRoot(true)
    setRootRevision(epoch => epoch + 1)
  }, [invalidateOwner])

  // Folder, sort, account/root revision, client or page unmount may invalidate
  // an Owner-scoped download. Cancel the private Agent range requests.
  useEffect(() => {
    // A previous account or directory's status must disappear even if its
    // canceled Agent promise settles much later than the new page render.
    setDownload(null)
    setVerifiedDownload(null)
    return () => {
      downloadAbort.current?.abort()
      downloadAbort.current = null
      if (verifiedDownloadURL.current) {
        URL.revokeObjectURL(verifiedDownloadURL.current)
        verifiedDownloadURL.current = null
      }
    }
  }, [client, rootRevision, currentScopeKey])

  useEffect(() => {
    const onResume = () => {
      if (document.visibilityState === 'visible') refreshAuthenticatedOwner()
    }
    document.addEventListener('visibilitychange', onResume)
    return () => document.removeEventListener('visibilitychange', onResume)
  }, [refreshAuthenticatedOwner])

  const navigateUp = useCallback(() => {
    setPreview(null)
    setCrumbs(current => current.length > 1 ? current.slice(0, -1) : current)
  }, [])

  return (
    <XDriveWorkspaceSurface presentation="page" title="云端文件"
      subtitle="使用共用 FileExplorer 查看 Server Owner 文件，支持文本、受限图片/PDF 以及原生视频/音频 Range 播放。"
      pageActions={<XDriveActionButton startIcon={<RefreshRoundedIcon />}
        compact onClick={refreshAuthenticatedOwner}
        disabled={loadingRoot || (crumbs.length > 0 && (loading || paging))}>刷新</XDriveActionButton>}>
      <Stack spacing={1.5} onScrollCapture={(event) => {
        // FileExplorer owns the virtualized scroll host. Scope this listener
        // to that exact host and retain the explicit button as a fallback.
        const host = event.target
        if (!(host instanceof HTMLElement) ||
          !host.hasAttribute('data-xdrive-file-explorer-scroll-host')) return
        if (xDriveSynologyOwnerFilesNearEnd(
          host.scrollTop, host.clientHeight, host.scrollHeight,
        )) loadMore()
      }}>
        <XDriveStatusAlert tone="neutral">
          本页提供经 Server Owner 鉴权的文件列表、最多 1 MiB 的文本预览，以及最多 32 MiB 的
          JPEG/PNG/WebP/GIF/PDF 查看和可见图片/视频的 Server 派生缩略图，支持 DSM 身份验证下的原生视频/音频 Range 播放。
          支持单文件最多 32 MiB 完整 SHA-256 校验后下载。Live、批量或更大的下载、上传、移动、
          删除和 NAS 物理路径仍未开放；当前分页不代表整个目录。
        </XDriveStatusAlert>
        {rootError ? <XDriveStatusAlert tone="bad">{rootError}</XDriveStatusAlert> : null}
        {loadingRoot ? <Box data-xdrive-nas-cloud-root-first-read aria-busy
          sx={{ minHeight: 180 }} /> : null}
        {!loadingRoot && crumbs.length > 0 ? (
          <>
            {error ? <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert> : null}
            {notice ? <XDriveStatusAlert tone="neutral">{notice}</XDriveStatusAlert> : null}
            {readyDownload ? (
              <XDriveStatusAlert tone="neutral">
                已核实：{readyDownload.filename}
                {' '}
                <Box component="a" href={readyDownload.url}
                  download={readyDownload.filename} rel="noopener noreferrer"
                  onClick={() => setNotice('已向浏览器请求保存：' + readyDownload.filename)}
                  sx={{ display: 'inline-block', color: 'primary.main', fontWeight: 600,
                    textDecoration: 'underline', mx: 1 }}>
                  保存文件
                </Box>
                <XDriveActionButton compact onClick={() => {
                  if (verifiedDownloadURL.current === readyDownload.url) {
                    URL.revokeObjectURL(readyDownload.url)
                    verifiedDownloadURL.current = null
                  }
                  setVerifiedDownload(null)
                  setNotice('')
                }}>取消保存</XDriveActionButton>
              </XDriveStatusAlert>
            ) : null}
            {download ? (
              <XDriveStatusAlert tone="neutral">
                下载校验：{download.name} · {xDriveMediaByteProgressLabel(download.loaded, download.total)}
                <XDriveActionButton compact onClick={cancelDownload}>取消下载</XDriveActionButton>
              </XDriveStatusAlert>
            ) : null}
            <XDriveFileExplorer
              presentation="workspace"
              interactionLifecycleKey={rootRevision + ':' + currentScopeKey}
              suspendBackgroundThumbnails={previewItem !== null}
              items={displayedItems}
              crumbs={crumbs}
              loading={loading}
              emptyReadState={currentScopeVerified ? 'ready' : error ? 'error' : 'unverified'}
              searchEnabled
              unavailableActions={unavailableActions}
              groupingEnabled={false}
              externallySorted
              forceVirtualization
              sort={sort}
              onSortChange={next => { setPreview(null); setSort(next); return true }}
              canGoUp={crumbs.length > 1}
              onUp={navigateUp}
              onCrumbClick={(_crumb, index) => {
                setPreview(null)
                setCrumbs(current => current.slice(0, index + 1))
              }}
              onRefresh={refreshAuthenticatedOwner}
              loadTextPreview={loadTextPreview}
              loadThumbnail={loadOwnerThumbnail}
              loadPreviewURL={loadMediaPreview}
              onOpenQuickLook={request => openFilePreview(request.item, request.sessionIDs)}
              onDownloadItems={downloadSelectedFiles}
              getSelectionActionDisabledReason={(action, selected, count) => {
                return action === 'download' ? getDownloadDisabledReason(selected, count) : null
              }}
              onOpenItem={item => {
                if (item.kind === 'dir') {
                  setPreview(null)
                  setCrumbs(current => [...current, { id: item.id, name: item.name }])
                } else {
                  openFilePreview(item)
                }
              }}
              statusText={currentScopeVerified
                ? `已核实 ${displayedItems.length.toLocaleString('zh-CN')} 项${hasMore ? ' · 仍有后续页' : ''} · 云端只读`
                : '云端账号目录尚未确认'}
            />
            {currentScopeVerified && hasMore ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <XDriveActionButton compact loading={paging} disabled={paging || loading}
                  onClick={loadMore}>加载更多文件</XDriveActionButton>
              </Box>
            ) : null}
            {currentScopeVerified && !hasMore ? (
              <Typography variant="caption" color="text.secondary" sx={{ px: 1.5 }}>
                当前目录已按 Server 授权游标读完；不是整个账号或其它设备的文件总数。
              </Typography>
            ) : null}
          </>
        ) : null}
      </Stack>
      <XDriveFileQuickLookDialog
        key={rootRevision + ':' + currentScopeKey}
        open={previewItem !== null}
        item={previewItem}
        positionLabel={previewPositionLabel}
        canPrevious={previewIndex > 0}
        canNext={previewIndex >= 0 && previewIndex < previewItems.length - 1}
        onPrevious={() => movePreview(-1)}
        onNext={() => movePreview(1)}
        actions={previewActions.map(action => ({ ...action, icon: <DownloadRoundedIcon fontSize="small" /> }))}
        loadTextPreview={loadTextPreview}
        // The SAME shared two-layer Viewer shows the current Owner's proven
        // JPEG/PNG thumbnail while the full original is still downloading.
        // For video, the same source becomes the pre-play poster. A cold
        // derivative falls back to the existing icon without delaying the
        // independent original/media Range request.
        loadImagePreview={loadOwnerThumbnail}
        loadPreviewURL={loadMediaPreview}
        onClose={() => setPreview(null)}
      />
    </XDriveWorkspaceSurface>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import type {
  XDriveSynologyBackupLocalClient, XDriveSynologyOwnerFileNode,
} from '../synology-backup-adapter'
import { XDriveFileExplorer } from './FileExplorer'
import { xDriveFindVerifiedOwnerSelection } from './FileExplorerVerifiedOwnerSelection'
import type { XDriveFileExplorerUnavailableActions } from './FileExplorer'
import { useXDriveFileExplorerCursorDirectory } from './FileExplorerCursorDirectoryController'
import type { XDriveFileExplorerCursorPort } from './FileExplorerCursorDirectoryController'
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
import { XDriveFilesWorkspacePage } from './FilesWorkspacePage'
import { useXDriveFileExplorerOwnerQuota } from './FileExplorerOwnerQuota'
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
  // One Host-neutral, scoped cursor Controller owns root and directory reads.
  // The DSM adapter supplies only its real authenticated Owner CGI methods.
  const ownerReadPort = useMemo<XDriveFileExplorerCursorPort<
    XDriveSynologyOwnerFileNode, XDriveFileExplorerSort
  >>(() => ({
    readRoot: (signal) => client.ownerFilesRoot(signal),
    readPage: (parentID, limit, sort, cursor, signal) =>
      client.ownerFilesPage(parentID, limit, sort.key, sort.direction, cursor, signal),
  }), [client])
  const {
    crumbs, setCrumbs, items, itemsRef, sort, setSort,
    loadingRoot, rootError, loading, error, paging, hasMore,
    rootRevision, currentScopeKey, currentScopeVerified, isCurrentOwner,
    loadMore, refreshAuthenticatedRoot,
  } = useXDriveFileExplorerCursorDirectory({
    host: client,
    port: ownerReadPort,
    initialSort: { key: 'name', direction: 'asc' },
    scopeKeyFor: xDriveSynologyOwnerFilesScopeKey,
    limit: pageSize,
  })
  // The identical shared Files quota banner is enabled only after a
  // Server Owner-authorized read. No DSM volume estimate is substituted.
  const verifiedOverQuota = useXDriveFileExplorerOwnerQuota(client, rootRevision)
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<{
    scopeKey: string; rootRevision: number; client: XDriveSynologyBackupLocalClient
    item: XDriveFileExplorerItem; sessionIDs?: (string | number)[]
  } | null>(null)
  const [download, setDownload] = useState<{ name: string; loaded: number; total: number } | null>(null)
  const [verifiedDownload, setVerifiedDownload] = useState<{
    filename: string; url: string; scopeKey: string
    client: XDriveSynologyBackupLocalClient; rootRevision: number
  } | null>(null)

  const downloadAbort = useRef<AbortController | null>(null)
  const verifiedDownloadURL = useRef<string | null>(null)
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
  // A verified explicit download is not a disposable directory read. Keep
  // its proven Blob/save action across same-Owner folder and sort changes.
  // Never offer it after an account/client or root-session replacement.
  const readyDownload = verifiedDownload?.client === client &&
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
    const current = xDriveFindVerifiedOwnerSelection(item, itemsRef.current)
    if (!current || current.type !== 'file') {
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
        setVerifiedDownload({ filename, url, scopeKey: currentScopeKey, client, rootRevision })
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
    // A stale rendered item cannot claim a new Owner/current cursor page.
    const current = xDriveFindVerifiedOwnerSelection(item, displayedItems)
    const authenticatedRow = xDriveFindVerifiedOwnerSelection(item, itemsRef.current)
    if (!current || !authenticatedRow || !supportsOwnerPreview(current)) {
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

  // Unavailable/obsolete per-directory messages must not survive a scope switch.
  useEffect(() => {
    setNotice('')
  }, [client, rootRevision, currentScopeKey])

  // DSM and Server account identity are not interchangeable. Returning to a
  // background tab or pressing Refresh starts with a newly authenticated root,
  // rather than retaining breadcrumbs or file names from a previous Owner.
  const refreshAuthenticatedOwner = useCallback(() => {
    refreshAuthenticatedRoot()
    // Downloads remain bound to the old Owner/revision until explicitly
    // revoked; the shared cursor Controller never writes or handles bytes.
    downloadAbort.current?.abort()
    downloadAbort.current = null
    setDownload(null)
    if (verifiedDownloadURL.current) {
      URL.revokeObjectURL(verifiedDownloadURL.current)
      verifiedDownloadURL.current = null
    }
    setVerifiedDownload(null)
    setNotice('')
    setPreview(null)
  }, [refreshAuthenticatedRoot])

  // An explicit verified Owner download continues while browsing another
  // directory or changing sort. Only account/client replacement, root-session
  // revalidation, page unmount, or user Cancel may stop its private range.
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
  }, [client, rootRevision])

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
    <XDriveFilesWorkspacePage overQuota={verifiedOverQuota === true}>
      <Stack spacing={1.5} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}
        onScrollCapture={(event) => {
        // FileExplorer owns the virtualized scroll host. Scope this listener
        // to that exact host and retain the explicit button as a fallback.
        const host = event.target
        if (!(host instanceof HTMLElement) ||
          !host.hasAttribute('data-xdrive-file-explorer-scroll-host')) return
        if (xDriveSynologyOwnerFilesNearEnd(
          host.scrollTop, host.clientHeight, host.scrollHeight,
        )) loadMore()
      }}>
        {rootError ? (
          <XDriveStatusAlert tone="bad" action={
            <XDriveActionButton startIcon={<RefreshRoundedIcon />} compact
              disabled={loadingRoot} onClick={refreshAuthenticatedOwner}>重试</XDriveActionButton>
          }>
            {rootError}
          </XDriveStatusAlert>
        ) : null}
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
                if (!isCurrentOwner() || !currentScopeVerified) return
                // Select only a canonical item still present in the CURRENT
                // authenticated cursor page, never a stale or forged list row.
                const verified = xDriveFindVerifiedOwnerSelection(item, itemsRef.current)
                if (!verified) {
                  setNotice('所选项目已发生变化，请刷新当前 Owner 目录。')
                  return
                }
                if (verified.type === 'dir') {
                  setPreview(null)
                  setCrumbs(current => [...current, { id: verified.id, name: verified.name }])
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
    </XDriveFilesWorkspacePage>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import type {
  XDriveSynologyBackupLocalClient, XDriveSynologyOwnerFileNode,
} from '../synology-backup-adapter'
import { XDriveFileExplorer } from './FileExplorer'
import { useXDriveSynologyOwnerFilesSearch } from './SynologyOwnerFilesSearch'
import { XDriveFileNameDialog } from './FileNameDialog'
import { xDriveFindVerifiedOwnerSelection } from './FileExplorerVerifiedOwnerSelection'
import { xDriveFileExplorerReadOnlyDownloadReason } from './FileExplorerReadOnlyDownloadAdmission'
import { xDriveFileExplorerReadOnlyViewerSelection } from './FileExplorerReadOnlyViewerSelection'
import type { XDriveFileExplorerUnavailableActions } from './FileExplorer'
import { useXDriveFileExplorerCursorDirectory } from './FileExplorerCursorDirectoryController'
import type { XDriveFileExplorerCursorPort } from './FileExplorerCursorDirectoryController'
import { XDriveFileQuickLookDialog } from './FileQuickLookDialog'
import { xDriveClassifyFilePreview, xDriveFileSupportsTextPreview } from '../file-preview'
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
import { xDriveSynologyLoadViewerPreview, xDriveSynologyViewerNeedsDerived } from '../synology-viewer-preview'
import {
  xDriveSynologyLoadNativeMediaStream, xDriveSynologyPlaybackMIME,
} from '../synology-media-stream'
import type {
  XDriveFileExplorerCrumb, XDriveFileExplorerItem, XDriveFileExplorerSort,
} from './FileExplorer'
import { XDriveActionButton } from './ActionButton'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveFilesWorkspacePage } from './FilesWorkspacePage'
import {
  XDRIVE_HOST_FILES_PREFERENCES,
  useXDriveFileExplorerPersistedViewMode,
} from './FileExplorerViewPreference'
import { useXDriveFileExplorerOwnerQuota } from './FileExplorerOwnerQuota'
import {
  xDriveSynologyOwnerFilesScopeKey,
  xDriveSynologyOwnerFilesNearEnd,
} from '../synology-owner-files-scope'

const pageSize = 200

// An authenticated Owner thumbnail remains usable when the original image
// exceeds the verified Blob cap or needs a browser-compatible derivative.
// Never offer this fallback for videos, Live Photos or unknown binary files.
function usesOwnerThumbnailOnlyPreview(item: XDriveFileExplorerItem): boolean {
  return item.kind === 'file' &&
    typeof item.size === 'number' && Number.isSafeInteger(item.size) && item.size > 0 &&
    xDriveClassifyFilePreview(item) === 'image' &&
    xDriveFileSupportsThumbnail(item.name, item.kind) &&
    (!xDriveSynologyPreviewMIME(item.name) ||
      item.size > XDRIVE_SYNOLOGY_MEDIA_BLOB_MAX_BYTES)
}

function supportsOwnerPreview(item: XDriveFileExplorerItem): boolean {
  if (item.kind !== 'file') return false
  if (xDriveFileSupportsTextPreview(item.name, item.kind)) return true
  if (typeof item.size !== 'number' || !Number.isSafeInteger(item.size) || item.size < 1) return false
  const mime = xDriveSynologyPreviewMIME(item.name)
  return Boolean(xDriveSynologyPlaybackMIME(item.name) ||
    // Large PDFs are streamed by the already authorized DSM CGI Range reader.
    // Images still use a bounded full-SHA Blob; no arbitrary binary proxy.
    mime === 'application/pdf' ||
    (mime?.startsWith('image/') && item.size <= XDRIVE_SYNOLOGY_MEDIA_BLOB_MAX_BYTES) ||
    xDriveSynologyViewerNeedsDerived(item.name) ||
    usesOwnerThumbnailOnlyPreview(item))
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
  // Same List/Grid/column preference semantics as Desktop. Only UI appearance
  // is stored at this DSM browser origin; no Owner data or Agent permission.
  const { viewMode, onViewModeChange } = useXDriveFileExplorerPersistedViewMode(
    XDRIVE_HOST_FILES_PREFERENCES.viewMode,
  )
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
    rootRevision, authenticatedRootCurrent,
    currentScopeKey, currentScopeVerified, isCurrentOwner,
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
  const verifiedOverQuota = useXDriveFileExplorerOwnerQuota(
    client, rootRevision, authenticatedRootCurrent,
  )
  const [notice, setNotice] = useState('')
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const uploadAbort = useRef<AbortController | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  useEffect(() => {
    return () => {
      uploadAbort.current?.abort()
      uploadAbort.current = null
    }
  }, [client, rootRevision, currentScopeKey])
  const [createFolderTarget, setCreateFolderTarget] = useState<{
    parentID: number; scopeKey: string; rootRevision: number
    client: XDriveSynologyBackupLocalClient
  } | null>(null)
  useEffect(() => setCreateFolderTarget(null), [client, rootRevision, currentScopeKey])
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
  const search = useXDriveSynologyOwnerFilesSearch({
    client, scopeKey: currentScopeKey, rootRevision,
    verified: currentScopeVerified, isCurrentOwner,
  })
  const searchSummary = search.current ? {
    query: search.current.query,
    conditions: [
      '已载入 ' + search.current.hits.length.toLocaleString('zh-CN') +
        (search.current.hasMore ? ' 项，尚有后续页' : ' 项'),
      '点击结果进入所在文件夹',
    ],
    resultCount: search.current.loading && search.current.hits.length === 0
      ? null : search.current.hits.length,
    loading: search.current.loading,
    error: search.current.error || undefined,
    onClear: search.clear,
    onRetry: search.retry,
  } : undefined
  // Use the exact same Owner-fenced readonly Viewer selection lifecycle
  // as any other Host supplying authorized Files rows and media evidence.
  const viewerSelection = useMemo(() => xDriveFileExplorerReadOnlyViewerSelection({
    items: displayedItems,
    isPreviewable: supportsOwnerPreview,
    preview: preview ? {
      host: preview.client,
      scopeKey: preview.scopeKey,
      rootRevision: preview.rootRevision,
      item: preview.item,
      sessionIDs: preview.sessionIDs,
    } : null,
    host: client,
    scopeKey: currentScopeKey,
    rootRevision,
    verified: currentScopeVerified,
  }), [displayedItems, preview, client, currentScopeKey, rootRevision, currentScopeVerified])
  const previewItems = viewerSelection.items
  const previewIndex = viewerSelection.index
  const previewItem = viewerSelection.item
  const previewPositionLabel = viewerSelection.positionLabel
  const thumbnailOnlyPreview = previewItem !== null && usesOwnerThumbnailOnlyPreview(previewItem)
  // #3528's Owner-scoped 4K reader is an allowed *derivative*, not an unsafe
  // full-original Blob. A prior thumbnail-only fallback must not suppress it.
  // Unavailable/undecodable derivatives still leave the independent verified
  // thumbnail visible in the shared two-layer image Viewer.
  const ownerDerivedPreview = previewItem !== null && (
    xDriveSynologyViewerNeedsDerived(previewItem.name) ||
    (thumbnailOnlyPreview && typeof previewItem.size === 'number' &&
      previewItem.size > XDRIVE_SYNOLOGY_MEDIA_BLOB_MAX_BYTES)
  )
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
  ): string | null => xDriveFileExplorerReadOnlyDownloadReason({
    selected,
    count,
    rows: itemsRef.current,
    ownerCurrent: isCurrentOwner(),
    scopeVerified: currentScopeVerified,
    downloadActive: downloadAbort.current !== null,
    maxBytes: XDRIVE_SYNOLOGY_OWNER_DOWNLOAD_MAX_BYTES,
    sizeLimitLabel: '32 MiB',
  }), [currentScopeVerified, isCurrentOwner])
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


  // A user-picked browser File is the only upload input. The original DSM
  // CGI and owning Agent verify the current Owner and use the existing CAS
  // upload writer. No browser-controlled absolute NAS path is accepted.
  const uploadSmallOwnerFile = useCallback((file: File) => {
    if (uploadAbort.current || !isCurrentOwner() || !currentScopeVerified ||
      search.current || verifiedOverQuota === true) {
      setNotice('请先进入当前已验证的云端文件夹，并等待正在执行的操作完成。')
      return
    }
    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > 4 << 20) {
      setNotice('DSM 当前每次仅支持上传 1 B～4 MiB 的单个文件；更大的文件暂请使用 Desktop/Web。')
      return
    }
    const parentID = crumbs[crumbs.length - 1]?.id
    if (!Number.isSafeInteger(parentID) || parentID < 1) return
    const controller = new AbortController()
    uploadAbort.current = controller
    setUploading(file.name)
    setNotice('')
    void (async () => {
      const status = await client.serverConnection(controller.signal)
      if (!status.configured || !/^[0-9a-f]{64}$/.test(status.owner_scope) ||
        !isCurrentOwner() || controller.signal.aborted) {
        throw new Error('Server Owner login changed before upload')
      }
      const created = await client.ownerUploadSmallFile(
        parentID, file, status.owner_scope, controller.signal)
      if (controller.signal.aborted || !isCurrentOwner()) {
        throw new Error('Server Owner changed during upload')
      }
      setPreview(null)
      setCrumbs(previous => [...previous])
      setNotice('已上传文件：' + created.name)
    })().catch(() => {
      if (uploadAbort.current === controller && isCurrentOwner()) {
        // If HTTP abort/lost acknowledgement happens after CAS commit,
        // never automatically retry and create an accidental duplicate.
        setCrumbs(previous => [...previous])
        setNotice('上传失败或结果尚未确认；请刷新目录核对后再重试，已有文件不会被覆盖。')
      }
    }).finally(() => {
      if (uploadAbort.current === controller) {
        uploadAbort.current = null
        setUploading(null)
      }
    })
  }, [client, crumbs, currentScopeVerified, isCurrentOwner,
    search.current, verifiedOverQuota])

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
    if (kind === 'pdf' && typeof item.size === 'number' &&
        item.size > XDRIVE_SYNOLOGY_MEDIA_BLOB_MAX_BYTES &&
        xDriveSynologyPreviewMIME(item.name) === 'application/pdf') {
      return xDriveSynologyLoadNativeMediaStream(client, item, signal)
    }
    if ((kind === 'image' || kind === 'live_photo') &&
        (xDriveSynologyViewerNeedsDerived(item.name) ||
         (typeof item.size === 'number' && item.size > XDRIVE_SYNOLOGY_MEDIA_BLOB_MAX_BYTES))) {
      return xDriveSynologyLoadViewerPreview(client, item, signal, onProgress)
    }
    if ((kind !== 'image' && kind !== 'pdf') || !xDriveSynologyPreviewMIME(item.name)) {
      return Promise.reject(new Error('DSM 暂不支持此媒体类型的预览'))
    }
    return xDriveSynologyLoadBoundedMediaPreview(client, item, signal, onProgress)
  }, [client])
  // Preserve thumbnail-only for unsupported originals without a derived
  // transport (e.g. small BMP). Only verified Owner image derivatives may
  // enable the same Quick Look's higher-quality second layer.
  const quickLookPreviewURLLoader =
    thumbnailOnlyPreview && !ownerDerivedPreview ? undefined : loadMediaPreview

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
    setCreateFolderTarget(null)
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
            <input
              ref={uploadInputRef}
              type="file"
              hidden
              aria-label="选择要上传到当前 Owner 文件夹的文件"
              onChange={event => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                if (file) uploadSmallOwnerFile(file)
              }}
            />
            {uploading ? (
              <XDriveStatusAlert tone="neutral">
                正在上传并等待 Server 确认：{uploading}
                <XDriveActionButton compact onClick={() => {
                  uploadAbort.current?.abort()
                  uploadAbort.current = null
                  setUploading(null)
                  setCrumbs(previous => [...previous])
                  setNotice('已请求取消上传；Server 可能已经完成，请刷新后核对。')
                }}>取消上传</XDriveActionButton>
              </XDriveStatusAlert>
            ) : null}
            <XDriveFileExplorer
              presentation="workspace"
              viewMode={viewMode}
              onViewModeChange={onViewModeChange}
              detailsPreferencesKey={XDRIVE_HOST_FILES_PREFERENCES.detailsLayout}
              viewPreferencesKey={XDRIVE_HOST_FILES_PREFERENCES.viewPreferences}
              interactionLifecycleKey={rootRevision + ':' + currentScopeKey}
              suspendBackgroundThumbnails={previewItem !== null}
              items={search.current ? search.items : displayedItems}
              crumbs={crumbs}
              loading={search.current
                ? search.current.loading && search.current.hits.length === 0
                : loading}
              emptyReadState={currentScopeVerified ? 'ready' : error ? 'error' : 'unverified'}
              searchEnabled
              searchValue={search.draft}
              onSearchValueChange={search.setDraft}
              onSearch={search.start}
              searchSummary={searchSummary}
              unavailableActions={search.current
                ? { ...unavailableActions,
                    createFolder: '退出搜索后可新建文件夹。',
                    uploadFiles: '退出搜索后可上传文件。',
                    rename: '退出搜索并进入文件夹后可重命名。' }
                : unavailableActions}
              groupingEnabled={false}
              externallySorted
              forceVirtualization
              sort={sort}
              onSortChange={next => { if (search.current) return false; setPreview(null); setSort(next); return true }}
              canGoUp={crumbs.length > 1}
              onUp={navigateUp}
              onCrumbClick={(_crumb, index) => {
                search.clear()
                setPreview(null)
                setCrumbs(current => current.slice(0, index + 1))
              }}
              onRefresh={search.current ? () => search.start(search.current!.query) : refreshAuthenticatedOwner}
              onUpload={() => {
                if (!isCurrentOwner() || !currentScopeVerified || search.current ||
                  uploadAbort.current) {
                  setNotice('当前文件夹尚未核实或有正在执行的上传，请稍后重试。')
                  return
                }
                uploadInputRef.current?.click()
              }}
              onCreateFolder={() => {
                if (search.current) return
                if (!isCurrentOwner() || !currentScopeVerified) {
                  setNotice('请先确认当前 Server Owner 文件目录，再新建文件夹。')
                  return
                }
                const parent = crumbs[crumbs.length - 1]?.id
                if (!Number.isSafeInteger(parent) || parent < 1) return
                setCreateFolderTarget({
                  parentID: parent, scopeKey: currentScopeKey, rootRevision, client,
                })
              }}
              onRenameItem={async (item, name) => {
                if (search.current) throw new Error('请先退出搜索并进入目标文件夹。')
                // Rebind the inline FileExplorer draft to the current
                // authenticated Server Owner cursor row, not a stale selection.
                if (!isCurrentOwner() || !currentScopeVerified ||
                  typeof item.id !== 'number' || typeof item.revision !== 'number') {
                  throw new Error('请先核实当前 Server Owner 文件目录。')
                }
                const selected = xDriveFindVerifiedOwnerSelection(item, itemsRef.current)
                const parent = crumbs[crumbs.length - 1]?.id
                if (!selected || !Number.isSafeInteger(parent) || parent < 1 ||
                  selected.parent_id !== parent ||
                  (selected.type !== 'file' && selected.type !== 'dir')) {
                  throw new Error('所选文件已改变，请刷新当前 Owner 目录。')
                }
                const connection = await client.serverConnection()
                if (!connection.configured || !/^[0-9a-f]{64}$/.test(connection.owner_scope) ||
                  !isCurrentOwner()) {
                  throw new Error('当前 Server Owner 已改变，请刷新目录后重试。')
                }
                setPreview(null)
                try {
                  const renamed = await client.ownerRenameNode(
                    selected.id, selected.revision, parent, selected.type,
                    name, connection.owner_scope)
                  if (!isCurrentOwner()) {
                    refreshAuthenticatedOwner()
                    throw new Error('Server Owner 已改变，请刷新目录确认重命名结果。')
                  }
                  // Replay the first authenticated cursor page instead of
                  // splicing a mutable node into the sorted directory rows.
                  setCrumbs(current => [...current])
                  setNotice('已重命名：' + renamed.name)
                } catch (cause) {
                  // A lost ACK may still mean a committed rename; refresh
                  // rather than auto-retrying an uncertain Server mutation.
                  if (isCurrentOwner()) setCrumbs(current => [...current])
                  throw cause
                }
              }}
              loadTextPreview={loadTextPreview}
              loadThumbnail={loadOwnerThumbnail}
              loadPreviewURL={loadMediaPreview}
              onOpenQuickLook={search.current ? undefined : request => openFilePreview(request.item, request.sessionIDs)}
              onDownloadItems={downloadSelectedFiles}
              getSelectionActionDisabledReason={(action, selected, count) => {
                if (search.current) return '先进入搜索结果所在的文件夹，再执行此操作。'
                return action === 'download' ? getDownloadDisabledReason(selected, count) : null
              }}
              onOpenItem={item => {
                if (!isCurrentOwner() || !currentScopeVerified) return
                if (search.current) {
                  const result = search.current.hits.find(hit =>
                    hit.node.id === item.id && hit.node.revision === item.revision)
                  // Owner search can only navigate a Server-authenticated chain
                  // that starts at the current verified root. The destination
                  // must be fetched independently before any Viewer or mutation.
                  if (!result || result.crumbs[0]?.id !== crumbs[0]?.id ||
                      result.crumbs.at(-1)?.id !== result.node.parent_id) {
                    setNotice('搜索结果所属目录未核实，请重新搜索。')
                    return
                  }
                  const path = result.crumbs.map(crumb => ({
                    id: crumb.id, name: crumb.name || crumbs[0].name,
                  }))
                  if (result.node.type === 'dir') {
                    path.push({ id: result.node.id, name: result.node.name })
                  }
                  search.clear()
                  setPreview(null)
                  setCrumbs(path)
                  return
                }
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
                ? `已核实 ${displayedItems.length.toLocaleString('zh-CN')} 项${hasMore ? ' · 仍有后续页' : ''} · 云端已开放新建文件夹、重命名及小文件上传`
                : '云端账号目录尚未确认'}
            />
            {search.current?.hasMore ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <XDriveActionButton compact loading={search.current.loading}
                  disabled={search.current.loading || Boolean(search.current.error)}
                  onClick={search.loadMore}>加载更多搜索结果</XDriveActionButton>
              </Box>
            ) : null}
            {!search.current && currentScopeVerified && hasMore ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <XDriveActionButton compact loading={paging} disabled={paging || loading}
                  onClick={loadMore}>加载更多文件</XDriveActionButton>
              </Box>
            ) : null}
            {!search.current && currentScopeVerified && !hasMore ? (
              <Typography variant="caption" color="text.secondary" sx={{ px: 1.5 }}>
                当前目录已按 Server 授权游标读完；不是整个账号或其它设备的文件总数。
              </Typography>
            ) : null}
          </>
        ) : null}
      </Stack>
      <XDriveFileNameDialog
        open={createFolderTarget !== null}
        mode="create-folder"
        lifecycleKey={rootRevision + ':' + currentScopeKey}
        onClose={() => setCreateFolderTarget(null)}
        onSubmit={async (name) => {
          const target = createFolderTarget
          if (!target || target.client !== client || target.rootRevision !== rootRevision ||
            target.scopeKey !== currentScopeKey || !currentScopeVerified || !isCurrentOwner() ||
            crumbs[crumbs.length - 1]?.id !== target.parentID) {
            throw new Error('Server Owner 文件目录已改变，请重新确认。')
          }
          const connection = await client.serverConnection()
          if (!connection.configured || !/^[0-9a-f]{64}$/.test(connection.owner_scope) ||
            !isCurrentOwner()) {
            throw new Error('当前 Server Owner 登录状态不可用，请先刷新。')
          }
          const created = await client.ownerCreateFolder(target.parentID, name, connection.owner_scope)
          if (!isCurrentOwner()) {
            refreshAuthenticatedOwner()
            throw new Error('Server Owner 已改变，不能确认新文件夹；请刷新核实。')
          }
          // Same verified folder and sort: replay its first authenticated
          // cursor page, never splice an unverified Server node into old rows.
          setCrumbs(current => [...current])
          setNotice('已创建文件夹：' + created.name)
        }}
      />
      <XDriveFileQuickLookDialog
        key={rootRevision + ':' + currentScopeKey}
        open={previewItem !== null}
        item={previewItem}
        positionLabel={previewPositionLabel}
        subtitle={thumbnailOnlyPreview
          ? ownerDerivedPreview
            ? '不直接读取原件；优先加载已认证的 4K 派生图，失败时保留缩略图'
            : '仅显示已认证的缩略预览；原件格式或大小暂不支持直接查看'
          : undefined}
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
        loadPreviewURL={quickLookPreviewURLLoader}
        onClose={() => setPreview(null)}
      />
    </XDriveFilesWorkspacePage>
  )
}

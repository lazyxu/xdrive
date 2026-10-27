import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import type {
  XDriveSynologyBackupLocalClient, XDriveSynologyOwnerFileNode,
} from '../synology-backup-adapter'
import { XDriveFileExplorer } from './FileExplorer'
import { XDriveFileQuickLookDialog } from './FileQuickLookDialog'
import { xDriveFileSupportsTextPreview } from '../file-preview'
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
    thumbnailEligible: false,
  }
}

/**
 * One canonical FileExplorer component, driven by a strictly read-only,
 * Server Owner-authenticated Agent data source in the DSM host.
 * This is not an independent NAS file manager and cannot access DSM paths.
 */
export function XDriveSynologyOwnerFilesPage({
  client,
}: { client: XDriveSynologyBackupLocalClient }) {
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
  const [preview, setPreview] = useState<{ scopeKey: string; item: XDriveFileExplorerItem } | null>(null)
  const [paging, setPaging] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState('')
  const [rootRevision, setRootRevision] = useState(0)

  const pageEpoch = useRef(0)
  const pendingPage = useRef<AbortController | null>(null)
  const pagingActive = useRef(false)
  const itemsRef = useRef<XDriveSynologyOwnerFileNode[]>([])

  // A folder/sort switch renders before its request effect runs. Never hand
  // previous-owner/folder rows to the canonical FileExplorer during that gap.
  const currentScopeKey = xDriveSynologyOwnerFilesScopeKey(crumbs, sort.key, sort.direction)
  const currentScopeVerified = verified && verifiedScopeKey === currentScopeKey
  const previewItem = currentScopeVerified && preview?.scopeKey === currentScopeKey
    ? preview.item : null
  const loadTextPreview = useCallback((item: XDriveFileExplorerItem, signal?: AbortSignal) => {
    if (typeof item.id !== 'number' || !xDriveFileSupportsTextPreview(item.name, item.kind)) {
      return Promise.reject(new Error('仅允许对已确认的文本文件执行 Owner 预览'))
    }
    return client.ownerFileTextPreview(item.id, signal)
  }, [client])
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
  }, [client, crumbs, sort.key, sort.direction, currentScopeKey])

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
  }, [])

  useEffect(() => {
    const onResume = () => {
      if (document.visibilityState === 'visible') refreshAuthenticatedOwner()
    }
    document.addEventListener('visibilitychange', onResume)
    return () => document.removeEventListener('visibilitychange', onResume)
  }, [refreshAuthenticatedOwner])

  const displayedItems = useMemo(
    () => currentScopeVerified ? items.map(itemForExplorer) : [],
    [items, currentScopeVerified],
  )
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
          JPEG/PNG/WebP/GIF/PDF 查看，以及 DSM 身份验证下的原生视频/音频 Range 播放。
          Live、缩略图、下载、上传、移动、删除和 NAS 物理路径仍未开放；当前分页不代表整个目录。
        </XDriveStatusAlert>
        {rootError ? <XDriveStatusAlert tone="bad">{rootError}</XDriveStatusAlert> : null}
        {loadingRoot ? <Box data-xdrive-nas-cloud-root-first-read aria-busy
          sx={{ minHeight: 180 }} /> : null}
        {!loadingRoot && crumbs.length > 0 ? (
          <>
            {error ? <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert> : null}
            {notice ? <XDriveStatusAlert tone="neutral">{notice}</XDriveStatusAlert> : null}
            <XDriveFileExplorer
              presentation="workspace"
              interactionLifecycleKey={crumbs.map(crumb => crumb.id).join('/')}
              items={displayedItems}
              crumbs={crumbs}
              loading={loading}
              emptyReadState={currentScopeVerified ? 'ready' : error ? 'error' : 'unverified'}
              searchEnabled={false}
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
              loadPreviewURL={loadMediaPreview}
              onOpenItem={item => {
                if (item.kind === 'dir') {
                  setPreview(null)
                  setCrumbs(current => [...current, { id: item.id, name: item.name }])
                } else if (xDriveFileSupportsTextPreview(item.name, item.kind) ||
                  (xDriveSynologyPreviewMIME(item.name) &&
                    typeof item.size === 'number' && item.size > 0 &&
                    item.size <= XDRIVE_SYNOLOGY_MEDIA_BLOB_MAX_BYTES) ||
                  (xDriveSynologyPlaybackMIME(item.name) &&
                    typeof item.size === 'number' && Number.isSafeInteger(item.size) &&
                    item.size > 0)) {
                  setNotice('')
                  setPreview({ scopeKey: currentScopeKey, item })
                } else {
                  setNotice('该文件类型或大小暂不支持 DSM Viewer；请通过 Desktop/Web 打开。')
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
        open={previewItem !== null}
        item={previewItem}
        loadTextPreview={loadTextPreview}
        loadPreviewURL={loadMediaPreview}
        onClose={() => setPreview(null)}
      />
    </XDriveWorkspaceSurface>
  )
}

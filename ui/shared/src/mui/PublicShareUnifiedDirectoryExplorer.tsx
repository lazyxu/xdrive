import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material'
import type { PublicShareChild } from '../models'
import { xDriveResolveFileExplorerCapabilities } from '../file-explorer-capabilities'
import { XDriveFileExplorer } from './FileExplorer'
import type { XDriveFileExplorerItem, XDriveFileExplorerMenuItem } from './FileExplorer'
import { XDriveFilePreviewSurface } from './FilePreviewSurface'
import type { XDrivePublicShareReadOnlyExplorerProps } from './PublicShareReadOnlyExplorer'

const sharePageLimit = 100
const shareImagePreviewPattern = /\.(?:jpe?g|png|webp|gif)$/i
const shareThumbnailPattern = /\.(?:jpe?g|png|webp|gif|bmp|heic|heif|avif|tiff?|livp|mp4|mov|mkv|webm)$/i

// This is only a Share-scoped *adapter* to the same Grid/Details/Viewer core
// used by Owner. It never imports JWT/Owner APIs, FileOperation or Agent IPC.
// Share requests and every signed media/download URL remain server-authorized.
export function XDrivePublicShareUnifiedDirectoryExplorer({
  kind, items, path = [], folderOpened = false, pending = false,
  canBrowse, canPreview, canDownload = false, canDownloadZip,
  downloadPending = false, hasPreviousPage = false, hasNextPage = false,
  toolbarActions, onBrowse, onCrumbClick, onOpenFolder, onDownloadItem,
  onDownloadFolder, folderZIPPreparing = false, loadThumbnail, loadImagePreview,
  onPreviousPage, onNextPage, onRefresh,
}: XDrivePublicShareReadOnlyExplorerProps) {
  const fileLink = kind === 'file'
  const [view, setView] = useState<'details' | 'grid'>('details')
  const [pageFilter, setPageFilter] = useState('')
  const [previewEntry, setPreviewEntry] = useState<PublicShareChild | null>(null)
  const rootID = path[0]?.id ?? 0
  const currentFolderID = path.at(-1)?.id ?? rootID
  const caps = xDriveResolveFileExplorerCapabilities('share', {
    list: canBrowse ?? canDownload,
    preview: (canPreview ?? canBrowse ?? canDownload) && Boolean(loadImagePreview),
    download: canDownload && Boolean(onDownloadItem),
    downloadZip: (canDownloadZip ?? canDownload) && Boolean(onDownloadFolder),
    search: false, write: false, delete: false,
  })
  const canStartDownload = caps.download && !downloadPending
  // The renderer may not retain visible children after Share eligibility is
  // revoked. It is still the Go Share API that enforces expiry/revocation.
  const acceptedPage = useMemo(
    () => caps.list ? items.slice(0, fileLink ? 1 : sharePageLimit) : [],
    [items, caps.list, fileLink],
  )
  const pageIdentity = useMemo(
    () => kind + ':' + currentFolderID + ':' + acceptedPage.map(item =>
      item.id + ':' + (item.revision ?? 0) + ':' + item.name).join(','),
    [kind, currentFolderID, acceptedPage],
  )
  useLayoutEffect(() => {
    setPageFilter('')
    setPreviewEntry(null)
  }, [pageIdentity])
  const byID = useMemo(
    () => new Map(acceptedPage.map(entry => [entry.id, entry])),
    [acceptedPage],
  )
  const normalizedFilter = pageFilter.trim().toLocaleLowerCase()
  const projectedItems = useMemo<XDriveFileExplorerItem[]>(() => (
    acceptedPage
      .filter(entry => !normalizedFilter || entry.name.toLocaleLowerCase().includes(normalizedFilter))
      .map(entry => ({
        id: entry.id, name: entry.name, kind: entry.type,
        size: entry.size, revision: entry.revision, updatedAt: entry.updated_at,
        thumbnailEligible: caps.preview && entry.type === 'file' &&
          entry.thumbnail_candidate === true && Number(entry.revision ?? 0) > 0 &&
          shareThumbnailPattern.test(entry.name),
      }))
  ), [acceptedPage, normalizedFilter, caps.preview])
  const entryFor = useCallback(
    (item: XDriveFileExplorerItem) => byID.get(Number(item.id)),
    [byID],
  )
  const eligiblePreview = useCallback(
    (entry: PublicShareChild) => (
      caps.preview && entry.type === 'file' && shareImagePreviewPattern.test(entry.name)
    ),
    [caps.preview],
  )
  const startDownload = (item: XDriveFileExplorerItem) => {
    const entry = entryFor(item)
    if (!entry || !canStartDownload) return
    if (entry.type === 'dir') {
      if (caps.downloadZip && !folderZIPPreparing) onDownloadFolder?.(entry)
    } else {
      onDownloadItem?.(entry)
    }
  }
  const openItem = (item: XDriveFileExplorerItem) => {
    const entry = entryFor(item)
    if (!entry || !caps.list) return
    if (entry.type === 'dir') onOpenFolder?.(entry)
    else if (eligiblePreview(entry)) setPreviewEntry(entry)
    else startDownload(item)
  }
  const contextActions = (item: XDriveFileExplorerItem): XDriveFileExplorerMenuItem[] => {
    const entry = entryFor(item)
    if (!entry || !caps.list) return []
    return [
      ...(entry.type === 'dir' ? [{
        id: 'open',
        label: '打开文件夹',
        icon: <FolderOpenRoundedIcon fontSize="small" />,
        onSelect: () => onOpenFolder?.(entry),
      }] : []),
      ...(eligiblePreview(entry) ? [{
        id: 'preview',
        label: '预览',
        onSelect: () => setPreviewEntry(entry),
      }] : []),
      ...((entry.type === 'file' && caps.download) ||
          (entry.type === 'dir' && caps.downloadZip) ? [{
        id: 'download',
        label: entry.type === 'dir' ? '下载文件夹 ZIP' : '下载文件',
        icon: <DownloadRoundedIcon fontSize="small" />,
        disabled: !canStartDownload || (entry.type === 'dir' && folderZIPPreparing),
        onSelect: () => startDownload(item),
      }] : []),
    ]
  }
  // The shared thumbnail Provider keys its cache by loader identity. Never
  // synthesize a new function on every download/progress/selection render:
  // doing so would evict cached images and restart actual Go media requests.
  const thumbnailLoader = useMemo(() => caps.preview && loadThumbnail
    ? (item: XDriveFileExplorerItem, signal?: AbortSignal) => {
      const entry = entryFor(item)
      return entry && entry.type === 'file' && entry.revision === item.revision
        ? loadThumbnail(entry, signal) : Promise.resolve(null)
    }
    : undefined, [caps.preview, loadThumbnail, entryFor])
  const previewURLLoader = useMemo(() => caps.preview && loadImagePreview
    ? (item: XDriveFileExplorerItem, kind: 'image' | 'video' | 'audio' | 'pdf' | 'live_photo') => {
      const entry = entryFor(item)
      return entry && kind === 'image' && eligiblePreview(entry)
        ? Promise.resolve(loadImagePreview(entry)).then(value => value ?? null)
        : Promise.resolve(null)
    }
    : undefined, [caps.preview, loadImagePreview, entryFor, eligiblePreview])
  const coreCrumbs = useMemo(() => [...path], [path])
  const lastCrumbIndex = path.length - 1
  return (
    <Box data-xdrive-public-share-explorer-workspace
      data-xdrive-public-share-unified-core="true"
      data-xdrive-public-share-file-browser={fileLink || undefined}
      data-xdrive-public-share-kind={kind}
      data-xdrive-public-share-explorer-view={view}
      sx={{
        height: 'clamp(520px, calc(100dvh - 290px), 900px)',
        minHeight: 520, minWidth: 0, width: '100%',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        border: 1, borderColor: 'divider', borderRadius: 2,
      }}>
      {!fileLink && !folderOpened && !pending ? (
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button onClick={onBrowse} disabled={!caps.list}>浏览文件夹</Button>
          {toolbarActions}
        </Stack>
      ) : (
        <XDriveFileExplorer
          items={projectedItems}
          crumbs={coreCrumbs}
          interactionLifecycleKey={'share:' + rootID + ':' + currentFolderID + ':' + pageIdentity}
          loading={pending}
          presentation="workspace"
          forceVirtualization
          emptyMessage={fileLink ? '当前文件不可访问' : normalizedFilter ? '当前页没有匹配的文件' : '此文件夹为空'}
          searchEnabled={false}
          groupingEnabled={false}
          viewMode={view}
          onViewModeChange={mode => { if (mode !== 'columns') setView(mode) }}
          canGoUp={caps.list && lastCrumbIndex > 0}
          onUp={() => { if (lastCrumbIndex > 0) onCrumbClick?.(lastCrumbIndex - 1) }}
          onCrumbClick={(_crumb, index) => {
            if (index >= 0 && index < path.length) onCrumbClick?.(index)
          }}
          onRefresh={caps.list && !fileLink ? onRefresh : undefined}
          onOpenItem={openItem}
          onDownloadItems={caps.download ? targets => {
            if (targets.length === 1) startDownload(targets[0])
          } : undefined}
          folderDownloadSupported={!fileLink && caps.downloadZip}
          getSelectionActionDisabledReason={(action, targets) => (
            action === 'download' && (targets.length !== 1 || downloadPending || folderZIPPreparing)
              ? '请一次下载一项，或完成当前下载。' : null
          )}
          getItemMenuItems={contextActions}
          loadThumbnail={thumbnailLoader}
          loadPreviewURL={previewURLLoader}
          commandBarEnd={
            <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
              {!fileLink && <TextField size="small" label="筛选当前页" placeholder="筛选当前页" value={pageFilter}
                disabled={!caps.list} onChange={event => setPageFilter(event.target.value)}
                sx={{ width: 150 }} />}
              {!fileLink && <Button size="small" disabled={pending || !caps.list || !hasPreviousPage}
                onClick={onPreviousPage}>上一页</Button>}
              {!fileLink && <Button size="small" disabled={pending || !caps.list || !hasNextPage}
                onClick={onNextPage}>下一页</Button>}
              {toolbarActions}
            </Stack>
          }
          statusText={fileLink ? '只读访问 · 单文件分享' : '当前页 ' + acceptedPage.length + ' 项' +
            (normalizedFilter ? ' · 匹配 ' + projectedItems.length + ' 项' : '') +
            ' · 排序仅影响当前页'}
        />
      )}
      <Dialog open={previewEntry !== null && caps.preview} onClose={() => setPreviewEntry(null)}
        aria-labelledby="xdrive-public-share-preview-title" maxWidth="lg" fullWidth>
        <DialogTitle id="xdrive-public-share-preview-title">
          {previewEntry?.name || '预览'} · 只读
        </DialogTitle>
        <DialogContent dividers sx={{ p: 1, minHeight: 320 }}>
          {previewEntry && (
            <XDriveFilePreviewSurface
              target={{ id: previewEntry.id, name: previewEntry.name, kind: 'file', size: previewEntry.size }}
              loadImagePreview={(_item, signal) => loadImagePreview
                ? loadImagePreview(previewEntry, signal)
                : Promise.resolve(null)}
              imageFit="contain" interactiveImage minHeight={300}
              maxHeight="min(74dvh, 840px)"
              fallback={<Typography color="text.secondary">当前媒体不能安全预览。</Typography>}
            />
          )}
        </DialogContent>
        <DialogActions>
          {canStartDownload && previewEntry ? (
            <Button onClick={() => onDownloadItem?.(previewEntry)}>下载原文件</Button>
          ) : null}
          <Button onClick={() => setPreviewEntry(null)}>关闭预览</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import ViewListRoundedIcon from '@mui/icons-material/ViewListRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import { Box, Button, Breadcrumbs, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, Stack, TextField, Typography, useMediaQuery } from '@mui/material'
import type { PublicShareChild } from '../models'
import { xDriveResolveFileExplorerCapabilities } from '../file-explorer-capabilities'
import { XDrivePublicShareUnifiedDirectoryExplorer } from './PublicShareUnifiedDirectoryExplorer'
import type { XDriveFileExplorerItem } from './FileExplorer'
import { XDriveFileExplorerThumbnail, XDriveFileExplorerThumbnailProvider } from './FileExplorerThumbnail'
import { formatBytes } from '../format'
import { XDriveActionButton } from './ActionButton'
import { XDriveFilePreviewSurface } from './FilePreviewSurface'
import {
  XDriveFileExplorerItemIcon,
  XDriveFileExplorerDetailsNameCell,
  XDriveFileExplorerDetailsRowCell,
  XDriveFileExplorerItemSurface,
  xDriveFileExplorerDetailsHeaderGeometry,
  XDriveFileExplorerGridTileContent,
  XDriveFileExplorerItemName,
  xDriveFileTypeLabel,
  xDriveFileExplorerDetailsNormalRowHeight,
  xDriveFileExplorerDetailsHeaderHeight,
  xDriveFileExplorerDetailsMobileRowHeight,
} from './FileExplorerItemPresentation'

// The same neutral Owner/Share thumbnail surface is mounted ONLY while its
// small page tile intersects the real scroll viewport. Eviction unmounts the
// consumer and immediately aborts the underlying Share-scoped GET/Go context.
function XDrivePublicShareThumbnailSlot({
  entry, grid, enabled,
}: {
  entry: PublicShareChild
  grid: boolean
  enabled: boolean
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [nearViewport, setNearViewport] = useState(false)
  const eligible = enabled && entry.thumbnail_candidate === true && entry.type === 'file' && Number(entry.revision ?? 0) > 0 &&
    /\.(?:jpe?g|png|webp|gif|bmp|heic|heif|avif|tiff?|livp|mp4|mov|mkv|webm)$/i.test(entry.name)
  useEffect(() => {
    const host = ref.current
    if (!host || !eligible) {
      setNearViewport(false)
      return
    }
    if (typeof IntersectionObserver === 'undefined') {
      setNearViewport(true)
      return
    }
    const root = host.closest('[data-xdrive-public-share-scroll-host]')
    const observer = new IntersectionObserver(
      (entries) => setNearViewport(Boolean(entries[0]?.isIntersecting)),
      { root, rootMargin: '80px 0px' },
    )
    observer.observe(host)
    return () => observer.disconnect()
  }, [entry.id, entry.revision, eligible, grid])
  const size = grid ? 52 : 21
  const fallback = <XDriveFileExplorerItemIcon
    item={{ name: entry.name, kind: entry.type }}
    size={size} folderSize={grid ? 52 : 22} />
  const item: XDriveFileExplorerItem = {
    id: entry.id, name: entry.name, kind: entry.type, size: entry.size,
    revision: entry.revision, updatedAt: entry.updated_at,
  }
  return (
    <Box ref={ref} data-xdrive-public-share-thumbnail-viewport
      sx={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {eligible && nearViewport
        ? <XDriveFileExplorerThumbnail item={item} eligible fallback={fallback} />
        : fallback}
    </Box>
  )
}

export type XDrivePublicShareExplorerCrumb = { id: number; name: string }
export type XDrivePublicShareReadOnlyExplorerProps = {
  kind: 'dir' | 'file'
  items: readonly PublicShareChild[]
  path?: readonly XDrivePublicShareExplorerCrumb[]
  folderOpened?: boolean
  pending?: boolean
  canDownload?: boolean
  // Pending native handoff is not a capability or a viewport-cancel signal.
  downloadPending?: boolean
  // Future read-only account folders and preview-only shares can narrow these
  // independently. Omitted props preserve existing Share behavior.
  canBrowse?: boolean
  canPreview?: boolean
  canDownloadZip?: boolean
  hasPreviousPage?: boolean
  hasNextPage?: boolean
  toolbarActions?: ReactNode
  onBrowse?: () => void
  onCrumbClick?: (index: number) => void
  onOpenFolder?: (entry: PublicShareChild) => void
  onDownloadItem?: (entry: PublicShareChild) => void
  onDownloadFolder?: (entry: PublicShareChild) => void
  folderZIPPreparing?: boolean
  loadImagePreview?: (entry: PublicShareChild, signal?: AbortSignal) => Promise<string | null | undefined>
  loadThumbnail?: (entry: PublicShareChild, signal?: AbortSignal) => Promise<string | null | undefined>
  onPreviousPage?: () => void
  onNextPage?: () => void
  onRefresh?: () => void
}

// Only capability-scoped DTOs and callbacks are accepted. This presentation
// never imports the account FileExplorer, Owner API, session or private actions.
export function XDrivePublicShareReadOnlyExplorer({
  kind, items, path = [], folderOpened = false, pending = false,
  canDownload = false, downloadPending = false, canBrowse, canPreview, canDownloadZip,
  hasPreviousPage = false, hasNextPage = false,
  toolbarActions, onBrowse, onCrumbClick, onOpenFolder, onDownloadItem, onDownloadFolder,
  folderZIPPreparing = false, loadImagePreview, loadThumbnail,
  onPreviousPage, onNextPage, onRefresh,
}: XDrivePublicShareReadOnlyExplorerProps) {
  const [view, setView] = useState<'details' | 'grid'>('details')
  const [selectedID, setSelectedID] = useState<number | null>(null)
  const [pageFilter, setPageFilter] = useState('')
  const [contextMenu, setContextMenu] = useState<{
    entry: PublicShareChild
    mouseX: number
    mouseY: number
  } | null>(null)
  const [propertiesEntry, setPropertiesEntry] = useState<PublicShareChild | null>(null)
  const [previewEntry, setPreviewEntry] = useState<PublicShareChild | null>(null)
  // UI capability upper bounds only; the Share API separately validates
  // password, revocation, expiry, root containment and download tickets.
  const capabilities = xDriveResolveFileExplorerCapabilities('share', {
    list: canBrowse ?? canDownload,
    preview: (canPreview ?? canBrowse ?? canDownload) && Boolean(loadImagePreview),
    download: canDownload && Boolean(onDownloadItem),
    downloadZip: (canDownloadZip ?? canDownload) && Boolean(onDownloadFolder),
    search: false,
    write: false,
    delete: false,
  })
  // Legacy Share shows the download action disabled while a browser-native
  // download is busy. An explicit browse grant can instead hide it entirely
  // for future preview-only capabilities without changing existing layouts.
  const showDownloadOption = canBrowse === undefined
    ? Boolean(onDownloadItem)
    : capabilities.download
  const canStartDownload = capabilities.download && !downloadPending
  const supportsPublicImagePreview = (entry: PublicShareChild) => entry.type === 'file' &&
    capabilities.preview && /\.(?:jpe?g|png|webp|gif)$/i.test(entry.name)
  const folder = kind === 'dir'
  const compactShareViewport = useMediaQuery('(max-width:620px)')
  const currentFolderID = path.at(-1)?.id ?? 0

  // Reset only when the server-accepted bounded page or owning folder changes.
  // Repeated refreshes may return new arrays for the same authorized page:
  // do not clear the current filter, selected row, or Properties dialog.
  const acceptedPageIdentity = useMemo(
    () => `${currentFolderID}:${items.length}:${items.slice(0, 100).map((item) => item.id).join(',')}`,
    [currentFolderID, items],
  )
  useLayoutEffect(() => {
    setSelectedID(null)
    setPageFilter('')
    setContextMenu(null)
    setPropertiesEntry(null)
    setPreviewEntry(null)
  }, [acceptedPageIdentity])

  const openEntry = (entry: PublicShareChild) => {
    if (!capabilities.list) return
    if (entry.type === 'dir') onOpenFolder?.(entry)
    else if (supportsPublicImagePreview(entry)) setPreviewEntry(entry)
    else if (canStartDownload) onDownloadItem?.(entry)
  }
  const onEntryKeyDown = (event: KeyboardEvent<HTMLDivElement>, entry: PublicShareChild) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter') {
      event.preventDefault()
      openEntry(entry)
    } else if (event.key === 'Backspace' && folder && path.length > 1) {
      event.preventDefault()
      onCrumbClick?.(path.length - 2)
    }
  }
  const openContextMenu = (event: MouseEvent<HTMLDivElement>, entry: PublicShareChild) => {
    event.preventDefault()
    setSelectedID(entry.id)
    setContextMenu({ entry, mouseX: event.clientX + 2, mouseY: event.clientY + 2 })
  }
  // Filter only the bounded 100-item server page. It is intentionally NOT
  // presented as a search of all children or an extra private API request.
  const pageItems = items.slice(0, 100)
  const filter = pageFilter.trim().toLocaleLowerCase()
  const visibleItems = filter
    ? pageItems.filter(entry => entry.name.toLocaleLowerCase().includes(filter))
    : pageItems
  // Only the currently authorized, bounded page may supply a selection action.
  // The fixed-size selection slot stays mounted, preventing toolbar reflow.
  const selectedEntry = visibleItems.find(entry => entry.id === selectedID) ?? null
  const shareDetailsColumns = 'minmax(0,1fr) 190px 150px 120px'
  const directoryControlsEnabled = folder && folderOpened && capabilities.list
  const thumbnailEntries = useMemo(
    () => new Map(items.map(entry => [entry.id, entry])),
    [items],
  )
  // A temporary download-busy state must not evict already visible cached
  // thumbnails. Explicit preview denial still prevents requesting them.
  const shareThumbnailLoader = useMemo(() => canPreview !== false && loadThumbnail
    ? (item: XDriveFileExplorerItem, signal?: AbortSignal) => {
      const entry = thumbnailEntries.get(Number(item.id))
      return entry && entry.type === 'file' && entry.revision === item.revision
        ? loadThumbnail(entry, signal)
        : Promise.resolve(null)
    }
    : undefined,
  [canPreview, loadThumbnail, thumbnailEntries])
  // A shared *directory* uses the exact Owner Grid/Details/Viewer engine. The
  // temporary Share facade still owns eligibility and single-file link UI;
  // none of its independent directory Grid/Details rows mount on this path.
  if (folder && folderOpened) {
    return (
      <XDrivePublicShareUnifiedDirectoryExplorer
        kind="dir" items={items} path={path} folderOpened={folderOpened}
        pending={pending} canDownload={canDownload} downloadPending={downloadPending}
        canBrowse={canBrowse} canPreview={canPreview} canDownloadZip={canDownloadZip}
        hasPreviousPage={hasPreviousPage} hasNextPage={hasNextPage}
        toolbarActions={toolbarActions} onBrowse={onBrowse}
        onCrumbClick={onCrumbClick} onOpenFolder={onOpenFolder}
        onDownloadItem={onDownloadItem} onDownloadFolder={onDownloadFolder}
        folderZIPPreparing={folderZIPPreparing} loadImagePreview={loadImagePreview}
        loadThumbnail={loadThumbnail} onPreviousPage={onPreviousPage}
        onNextPage={onNextPage} onRefresh={onRefresh}
      />
    )
  }
  const viewButtons = (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Button type="button" size="small" aria-pressed={view === 'details'}
        variant={view === 'details' ? 'contained' : 'text'}
        startIcon={<ViewListRoundedIcon />} onClick={() => setView('details')}>列表</Button>
      <Button type="button" size="small" aria-pressed={view === 'grid'}
        variant={view === 'grid' ? 'contained' : 'text'}
        startIcon={<GridViewRoundedIcon />} onClick={() => setView('grid')}>网格</Button>
    </Stack>
  )
  const rows = (
    <XDriveFileExplorerThumbnailProvider lifecycleKey={acceptedPageIdentity} loadThumbnail={shareThumbnailLoader}>
    <Box role="list" data-xdrive-public-share-scroll-host aria-label={folder ? '分享文件夹中的文件' : '已分享文件'}
      data-xdrive-public-share-explorer-view={view}
      sx={{
        flex: '1 1 auto', minHeight: 0, overflowY: 'auto', minWidth: 0,
        display: view === 'grid' ? 'grid' : 'block',
        gridTemplateColumns: view === 'grid' ? 'repeat(auto-fill, minmax(112px, 1fr))' : undefined,
        alignContent: 'start', gap: view === 'grid' ? 1 : 0,
        px: view === 'grid' ? 1.25 : 0, py: view === 'grid' ? 1.25 : 0,
        '@media (max-width: 620px)': view === 'grid'
          ? { px: 1, gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' }
          : {},
      }}>
      {view === 'details' && (
        <Box data-xdrive-public-share-details-header
          sx={{
            ...xDriveFileExplorerDetailsHeaderGeometry(shareDetailsColumns),
            '@media (max-width: 620px)': {
              gridTemplateColumns: 'minmax(0,1fr)',
              '& .xdrive-shared-file-updated': { display: 'none' },
              '& .xdrive-shared-file-type': { display: 'none' },
              '& .xdrive-shared-file-size': { display: 'none' },
            },
          }}>
          <Typography variant="caption" color="text.secondary">名称</Typography>
          <Typography className="xdrive-shared-file-updated" variant="caption" color="text.secondary">修改时间</Typography>
          <Typography className="xdrive-shared-file-type" variant="caption" color="text.secondary">类型</Typography>
          <Typography className="xdrive-shared-file-size" variant="caption" color="text.secondary" textAlign="right">大小</Typography>
        </Box>
      )}
      {visibleItems.map(entry => (
        <XDriveFileExplorerItemSurface key={entry.id} role="listitem" tabIndex={0}
          surfaceMode={view}
          selected={selectedID === entry.id}
          columns={view === 'details' ? shareDetailsColumns : undefined}
          detailsRowHeight={xDriveFileExplorerDetailsNormalRowHeight}
          gridMinItemHeight={124}
          gridMaxItemWidth={180}
          gridItemPadding={1}
          gridItemGap={0.75}
          gridEstimatedRowHeight={140}
          data-xdrive-file-explorer-item
          aria-selected={selectedID === entry.id}
          data-xdrive-public-share-item-id={entry.id}
          aria-label={(entry.type === 'dir' ? '文件夹 ' : '文件 ') + entry.name}
          onClick={(event) => {
            // Compact Files opens the target on tap; any future inline controls
            // must never bubble into a second open or Share ticket.
            if ((event.target as Element | null)?.closest?.('button, a, input, [role="button"]')) return
            if (compactShareViewport) openEntry(entry)
            else setSelectedID(entry.id)
          }}
          onContextMenu={(event) => openContextMenu(event, entry)}
          onKeyDown={(event) => onEntryKeyDown(event, entry)}
          onDoubleClick={() => { if (!compactShareViewport) openEntry(entry) }}
          sx={{
            '@media (max-width: 620px)': view === 'details' ? {
              minHeight: xDriveFileExplorerDetailsMobileRowHeight,
              gridTemplateColumns: 'minmax(0,1fr)',
              // Hide entire empty metadata cells, not just their labels.
              '& > [role="cell"]:not(:first-child)': { display: 'none' },
              '& .xdrive-shared-file-updated': { display: 'none' },
              '& .xdrive-shared-file-type': { display: 'none' },
              '& .xdrive-shared-file-size': { display: 'none' },
            } : {},
          }}>
          {view === 'details' ? (
            <XDriveFileExplorerDetailsRowCell columnKey="name">
              <XDriveFileExplorerDetailsNameCell
                compact={compactShareViewport}
                visual={<XDrivePublicShareThumbnailSlot entry={entry} grid={false} enabled={canPreview !== false && Boolean(loadThumbnail)} />}
                label={<XDriveFileExplorerItemName name={entry.name} grid={false} />}
              />
            </XDriveFileExplorerDetailsRowCell>
          ) : (
            <XDriveFileExplorerGridTileContent
              thumbnailWidth={72}
              thumbnailHeight={72}
              visual={<XDrivePublicShareThumbnailSlot entry={entry} grid enabled={canPreview !== false && Boolean(loadThumbnail)} />}
              label={<XDriveFileExplorerItemName name={entry.name} grid />}
            />
          )}
          {view === 'details' && (
            <>
              <XDriveFileExplorerDetailsRowCell columnKey="updated">
                <Typography className="xdrive-shared-file-updated" variant="body2" color="text.secondary" noWrap>
                  {entry.updated_at ? new Date(entry.updated_at).toLocaleString() : '—'}
                </Typography>
              </XDriveFileExplorerDetailsRowCell>
              <XDriveFileExplorerDetailsRowCell columnKey="type">
                <Typography className="xdrive-shared-file-type" variant="caption" color="text.secondary"
                  sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {xDriveFileTypeLabel(entry.name, entry.type)}
                </Typography>
              </XDriveFileExplorerDetailsRowCell>
              <XDriveFileExplorerDetailsRowCell columnKey="size" rightAligned>
                <Typography className="xdrive-shared-file-size" variant="caption" color="text.secondary"
                  textAlign="right">{entry.type === 'dir' ? '—' : formatBytes(entry.size)}</Typography>
              </XDriveFileExplorerDetailsRowCell>
            </>
          )}
        </XDriveFileExplorerItemSurface>
      ))}
      {!pending && folderOpened && pageItems.length === 0 && (
        <Typography variant="body2" color="text.secondary" textAlign="center"
          sx={{ py: 5 }}>此文件夹为空</Typography>
      )}
      {pageItems.length > 0 && visibleItems.length === 0 && (
        <Typography variant="body2" color="text.secondary" textAlign="center"
          sx={{ py: 5 }}>当前页没有匹配的文件</Typography>
      )}
    </Box>
    </XDriveFileExplorerThumbnailProvider>
  )

  return (
    <>
      <Box data-xdrive-public-share-explorer-workspace
        sx={{
          display: 'flex', flexDirection: 'column', minWidth: 0, width: '100%',
          minHeight: folder ? 520 : 275,
          height: folder ? 'clamp(520px, calc(100dvh - 290px), 900px)' : 'auto',
          border: 1, borderColor: 'divider',
          borderRadius: 2, overflow: 'hidden', bgcolor: 'background.paper',
          '@media (max-width: 620px)': {
            borderRadius: 1.5, minHeight: folder ? 445 : 250,
            height: folder ? 'clamp(445px, calc(100dvh - 310px), 760px)' : 'auto',
          },
        }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center"
          flexWrap="wrap" useFlexGap spacing={1}
          sx={{ px: 2, py: 1.25, minHeight: 62, borderBottom: 1, borderColor: 'divider' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={650}>
              {folder ? '文件夹内容' : '共享文件'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {capabilities.download ? '只读访问 · 浏览与下载' : '只读访问 · 浏览与预览'}
            </Typography>
          </Box>
          {toolbarActions}
        </Stack>
        <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap spacing={1}
          sx={{ px: 1.5, py: 1, minWidth: 0, minHeight: 54, borderBottom: 1, borderColor: 'divider' }}>
          {folder && folderOpened && (
            <>
              <IconButton size="small" aria-label="返回上级文件夹"
                disabled={!directoryControlsEnabled || path.length < 2}
                onClick={() => onCrumbClick?.(path.length - 2)}>
                <ArrowBackRoundedIcon fontSize="small" />
              </IconButton>
              <Breadcrumbs separator={<ChevronRightRoundedIcon fontSize="small" />}
                aria-label="文件夹路径"
                sx={{ flex: '1 1 230px', minWidth: 0, '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap' },
                  '& .MuiBreadcrumbs-li': { minWidth: 0 } }}>
                {path.map((crumb, index) => (
                  <Button key={crumb.id} type="button" size="small"
                    disabled={pending || !capabilities.list || index === path.length - 1}
                    onClick={() => onCrumbClick?.(index)}
                    sx={{ textTransform: 'none', maxWidth: 230, minWidth: 0, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{crumb.name}</Button>
                ))}
              </Breadcrumbs>
              <IconButton size="small" aria-label="刷新文件夹" disabled={!directoryControlsEnabled || pending}
                onClick={onRefresh}><RefreshRoundedIcon fontSize="small" /></IconButton>
              <TextField size="small" value={pageFilter} onChange={(event) => setPageFilter(event.target.value)}
                placeholder="筛选当前页" inputProps={{ 'aria-label': '筛选当前页文件' }}
                onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }}
                sx={{ width: 164, maxWidth: '100%' }} />
            </>
          )}
          <Box data-xdrive-public-share-selection-slot
            sx={{
              display: compactShareViewport ? 'none' : 'flex',
              flex: '0 0 238px', minWidth: 238, height: 36,
              alignItems: 'center', overflow: 'hidden',
            }}>
            {selectedEntry && (
              <Stack data-xdrive-public-share-selection-actions
                direction="row" alignItems="center" spacing={0.5} sx={{ whiteSpace: 'nowrap' }}>
                {selectedEntry.type === 'dir' ? (
                  <Button type="button" size="small" disabled={!capabilities.list || pending}
                    data-xdrive-public-share-selected-open
                    onClick={() => onOpenFolder?.(selectedEntry)}>打开</Button>
                ) : (
                  <>
                    {supportsPublicImagePreview(selectedEntry) && (
                      <Button type="button" size="small" disabled={!capabilities.preview || pending}
                        data-xdrive-public-share-selected-preview
                        onClick={() => setPreviewEntry(selectedEntry)}>预览</Button>
                    )}
                    {showDownloadOption && (
                      <Button type="button" size="small" disabled={!canStartDownload || pending}
                        data-xdrive-public-share-selected-download
                        startIcon={<DownloadRoundedIcon />}
                        onClick={() => onDownloadItem?.(selectedEntry)}>下载</Button>
                    )}
                  </>
                )}
                <Button type="button" size="small"
                  data-xdrive-public-share-selected-properties
                  onClick={() => setPropertiesEntry(selectedEntry)}>属性</Button>
              </Stack>
            )}
          </Box>
          <Box sx={{ ml: folder && folderOpened ? 'auto' : 0 }}>{viewButtons}</Box>
        </Stack>
        {folder ? (
          <Box data-xdrive-public-share-folder-browser aria-busy={pending}
            sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 180 }}>
            {folderOpened ? (
              <Box role="region" aria-label="分享文件夹内容" aria-busy={pending}
                sx={{ minHeight: 180, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                {rows}
                {(hasPreviousPage || hasNextPage) && (
                  <Stack direction="row" justifyContent="flex-end" spacing={1}
                    sx={{ px: 2, py: 1.25, borderTop: 1, borderColor: 'divider' }}>
                    <Button type="button" size="small" disabled={pending || !hasPreviousPage}
                      onClick={onPreviousPage}>上一页</Button>
                    <Button type="button" size="small" disabled={pending || !hasNextPage}
                      onClick={onNextPage}>下一页</Button>
                  </Stack>
                )}
              </Box>
            ) : (
              <Stack alignItems="center" justifyContent="center" spacing={1.5}
                sx={{ flex: 1, minHeight: 260, px: 3, py: 4, textAlign: 'center' }}>
                <FolderOpenRoundedIcon sx={{ fontSize: 44, color: 'text.secondary' }} />
                <Typography variant="subtitle1" fontWeight={650}>浏览共享文件夹</Typography>
                <Typography variant="body2" color="text.secondary">
                  使用只读文件管理器查看目录及文件，不会修改原始内容。
                </Typography>
                <XDriveActionButton intent="primary" type="button"
                  disabled={!capabilities.list || pending} onClick={onBrowse}>浏览文件夹</XDriveActionButton>
              </Stack>
            )}
          </Box>
        ) : (
          <Box data-xdrive-public-share-file-browser role="region"
            aria-label="分享文件只读浏览"
            sx={{ display: 'flex', flex: 1, minHeight: 82, minWidth: 0 }}>{rows}</Box>
        )}
        <Stack direction="row" justifyContent="space-between" alignItems="center"
          flexWrap="wrap" spacing={1}
          sx={{ px: 2, py: 1.1, minHeight: 40, borderTop: 1, borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary">
            {folder && !folderOpened ? '只读共享目录'
              : '当前页 ' + pageItems.length + ' 项' + (filter ? ' · 匹配 ' + visibleItems.length + ' 项' : '')}
          </Typography>
          <Typography variant="caption" color="text.secondary">每页最多 100 项 · 仅分享范围</Typography>
        </Stack>
      </Box>
      <Menu open={contextMenu !== null} onClose={() => setContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}>
        {contextMenu?.entry && (contextMenu.entry.type === 'dir' ? (canBrowse === undefined || capabilities.list) : showDownloadOption) && (
        <MenuItem disabled={contextMenu?.entry.type === 'dir' ? !capabilities.list : !canStartDownload} onClick={() => {
          const entry = contextMenu?.entry
          setContextMenu(null)
          // Context-menu Download must retain its original meaning even when
          // a safe inline image Preview is available on double-click/Enter.
          if (entry?.type === 'dir') onOpenFolder?.(entry)
          else if (entry) onDownloadItem?.(entry)
        }}>
          {contextMenu?.entry.type === 'dir' ? '打开文件夹' : '下载文件'}
        </MenuItem>
        )}
        {contextMenu?.entry.type === 'dir' && onDownloadFolder && capabilities.downloadZip && (
          <MenuItem disabled={downloadPending || pending || folderZIPPreparing} onClick={() => {
            const entry = contextMenu?.entry
            setContextMenu(null)
            if (entry?.type === 'dir') onDownloadFolder?.(entry)
          }}>下载该文件夹 ZIP</MenuItem>
        )}
        {contextMenu?.entry && supportsPublicImagePreview(contextMenu.entry) && (
          <MenuItem disabled={!capabilities.preview} onClick={() => {
            setPreviewEntry(contextMenu.entry)
            setContextMenu(null)
          }}>预览图片</MenuItem>
        )}
        <MenuItem onClick={() => {
          setPropertiesEntry(contextMenu?.entry ?? null)
          setContextMenu(null)
        }}>属性</MenuItem>
      </Menu>
      <Dialog open={propertiesEntry !== null} onClose={() => setPropertiesEntry(null)}
        aria-labelledby="xdrive-public-share-properties-title" maxWidth="xs" fullWidth>
        <DialogTitle id="xdrive-public-share-properties-title">属性 · 只读</DialogTitle>
        <DialogContent dividers>
          {propertiesEntry && (
            <Stack spacing={1.25} sx={{ overflowWrap: 'anywhere' }}>
              <Typography variant="body2">名称：{propertiesEntry.name}</Typography>
              <Typography variant="body2">类型：{xDriveFileTypeLabel(propertiesEntry.name, propertiesEntry.type)}</Typography>
              <Typography variant="body2">大小：{propertiesEntry.type === 'dir' ? '—' : formatBytes(propertiesEntry.size)}</Typography>
              {propertiesEntry.updated_at ? <Typography variant="body2">修改时间：{new Date(propertiesEntry.updated_at).toLocaleString()}</Typography> : null}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button type="button" onClick={() => setPropertiesEntry(null)}>关闭</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={previewEntry !== null && capabilities.preview} onClose={() => setPreviewEntry(null)}
        aria-labelledby="xdrive-public-share-preview-title" maxWidth="lg" fullWidth>
        <DialogTitle id="xdrive-public-share-preview-title">
          {previewEntry?.name || '预览'} · 只读
        </DialogTitle>
        <DialogContent dividers sx={{ p: 1, minHeight: 320 }}>
          {previewEntry && (
            <XDriveFilePreviewSurface
              target={{ id: previewEntry.id, name: previewEntry.name, kind: 'file', size: previewEntry.size }}
              loadImagePreview={(_target, signal) => loadImagePreview
                ? loadImagePreview(previewEntry, signal)
                : Promise.resolve(null)}
              imageFit="contain" interactiveImage minHeight={300}
              maxHeight="min(74dvh, 840px)"
              fallback={<Typography color="text.secondary">当前媒体不能安全预览。</Typography>}
            />
          )}
        </DialogContent>
        <DialogActions>
          {showDownloadOption && (
            <Button type="button" disabled={!canStartDownload || previewEntry === null}
              onClick={() => { if (previewEntry) onDownloadItem?.(previewEntry) }}>下载原文件</Button>
          )}
          <Button type="button" onClick={() => setPreviewEntry(null)}>关闭预览</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

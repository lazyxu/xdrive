import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded'
import ViewListRoundedIcon from '@mui/icons-material/ViewListRounded'
import { Box, Button, Stack, Typography } from '@mui/material'
import type { PublicShareChild } from '../models'
import { formatBytes } from '../format'
import { XDriveActionButton } from './ActionButton'
import { XDriveFileExplorerItemIcon, xDriveFileTypeLabel } from './FileExplorerItemPresentation'

export type XDrivePublicShareExplorerCrumb = { id: number; name: string }
export type XDrivePublicShareReadOnlyExplorerProps = {
  kind: 'dir' | 'file'
  items: readonly PublicShareChild[]
  path?: readonly XDrivePublicShareExplorerCrumb[]
  folderOpened?: boolean
  pending?: boolean
  canDownload?: boolean
  hasPreviousPage?: boolean
  hasNextPage?: boolean
  onBrowse?: () => void
  onCrumbClick?: (index: number) => void
  onOpenFolder?: (entry: PublicShareChild) => void
  onDownloadItem?: (entry: PublicShareChild) => void
  onPreviousPage?: () => void
  onNextPage?: () => void
}

// Public-capability-only presentation. It has NO authenticated Owner API,
// private Node datasource, credential access, mutation, clipboard or drag-out.
export function XDrivePublicShareReadOnlyExplorer({
  kind, items, path = [], folderOpened = false, pending = false,
  canDownload = false, hasPreviousPage = false, hasNextPage = false,
  onBrowse, onCrumbClick, onOpenFolder, onDownloadItem, onPreviousPage, onNextPage,
}: XDrivePublicShareReadOnlyExplorerProps) {
  const [view, setView] = useState<'details' | 'grid'>('details')
  const folder = kind === 'dir'
  const openEntry = (entry: PublicShareChild) => {
    if (entry.type === 'dir') onOpenFolder?.(entry)
    else if (canDownload) onDownloadItem?.(entry)
  }
  const onEntryKeyDown = (event: KeyboardEvent<HTMLDivElement>, entry: PublicShareChild) => {
    if (event.target === event.currentTarget && event.key === 'Enter') {
      event.preventDefault()
      openEntry(entry)
    }
  }

  // The Server returns one <=100 item keyset page, never the entire directory.
  // Do not sort or augment it with unauthorized account/FileExplorer requests.
  const rows = (
    <Box role="list" aria-label={folder ? '分享文件夹中的文件' : '已分享文件'}
      data-xdrive-public-share-explorer-view={view}
      sx={{ maxHeight: 400, overflowY: 'auto',
        display: view === 'grid' ? 'grid' : 'block',
        gridTemplateColumns: view === 'grid' ? 'repeat(auto-fill, minmax(140px, 1fr))' : undefined,
        gap: view === 'grid' ? 1 : 0 }}>
      {items.slice(0, 100).map((entry) => (
        <Box key={entry.id} role="listitem" tabIndex={0}
          data-xdrive-public-share-item-id={entry.id}
          aria-label={`${entry.type === 'dir' ? '文件夹' : '文件'} ${entry.name}`}
          onKeyDown={(event) => onEntryKeyDown(event, entry)}
          onDoubleClick={() => openEntry(entry)}
          sx={{
            display: view === 'grid' ? 'flex' : 'grid',
            flexDirection: view === 'grid' ? 'column' : undefined,
            alignItems: 'center', gap: 1, minWidth: 0,
            minHeight: view === 'grid' ? 148 : 48, px: 1, py: view === 'grid' ? 1.5 : 0.75,
            borderBottom: view === 'details' ? 1 : undefined,
            border: view === 'grid' ? 1 : undefined,
            borderColor: 'divider', borderRadius: view === 'grid' ? 1.5 : 0,
            gridTemplateColumns: view === 'details' ? 'minmax(0, 1fr) minmax(100px, 150px) 92px' : undefined,
            '@media (max-width: 620px)': view === 'details' ? {
              gridTemplateColumns: 'minmax(0, 1fr) 78px',
              '& .xdrive-shared-file-type': { display: 'none' },
            } : undefined,
            '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
          }}>
          <Stack direction={view === 'grid' ? 'column' : 'row'} spacing={1}
            alignItems="center" sx={{ minWidth: 0, width: view === 'grid' ? '100%' : undefined, flex: view === 'grid' ? 1 : undefined }}>
            <XDriveFileExplorerItemIcon item={{ name: entry.name, kind: entry.type }}
              size={view === 'grid' ? 38 : 22} />
            <Box sx={{ minWidth: 0, width: view === 'grid' ? '100%' : undefined }}>
              <Typography variant="body2" title={entry.name}
                sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  textAlign: view === 'grid' ? 'center' : 'left' }}>{entry.name}</Typography>
              {view === 'grid' && <Typography variant="caption" color="text.secondary"
                sx={{ display: 'block', textAlign: 'center' }}>
                {entry.type === 'dir' ? '文件夹' : formatBytes(entry.size)}
              </Typography>}
            </Box>
          </Stack>
          {view === 'details' && <Typography className="xdrive-shared-file-type"
            variant="caption" color="text.secondary"
            sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {xDriveFileTypeLabel(entry.name, entry.type)}
          </Typography>}
          {folder ? (entry.type === 'dir' ? (
            <Button type="button" size="small" onDoubleClick={(event) => event.stopPropagation()} onClick={() => onOpenFolder?.(entry)}>打开</Button>
          ) : (
            <Button type="button" size="small" disabled={!canDownload}
              startIcon={<DownloadRoundedIcon />} onDoubleClick={(event) => event.stopPropagation()} onClick={() => onDownloadItem?.(entry)}>下载</Button>
          )) : view === 'details' ? (
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>
              {formatBytes(entry.size)}
            </Typography>
          ) : null}
        </Box>
      ))}
    </Box>
  )

  if (!folder) return <Box data-xdrive-public-share-file-browser role="region"
    aria-label="分享文件只读浏览" sx={{ minHeight: 82, minWidth: 0 }}>{rows}</Box>

  return (
    <Stack data-xdrive-public-share-folder-browser aria-busy={pending || undefined} spacing={1.25}>
      {folderOpened ? (
        <Box role="region" aria-label="分享文件夹内容" aria-busy={pending}
          sx={{ minHeight: 180, minWidth: 0, position: 'relative' }}>
          <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.5} sx={{ mb: 1 }}>
            {path.map((crumb, index) => (
              <Button key={crumb.id} type="button" size="small"
                disabled={index === path.length - 1}
                onClick={() => onCrumbClick?.(index)}>{crumb.name}</Button>
            ))}
          </Stack>
          <Stack direction="row" alignItems="center" justifyContent="space-between"
            flexWrap="wrap" useFlexGap spacing={1} sx={{ minHeight: 42, mb: 1 }}>
            <Typography variant="caption" color="text.secondary">只读文件管理器 · 每页最多 100 项</Typography>
            <Stack direction="row" spacing={0.5}>
              <Button type="button" size="small" aria-pressed={view === 'details'}
                variant={view === 'details' ? 'contained' : 'text'}
                startIcon={<ViewListRoundedIcon />} onClick={() => setView('details')}>列表</Button>
              <Button type="button" size="small" aria-pressed={view === 'grid'}
                variant={view === 'grid' ? 'contained' : 'text'}
                startIcon={<GridViewRoundedIcon />} onClick={() => setView('grid')}>网格</Button>
            </Stack>
          </Stack>
          {rows}
          {!pending && items.length === 0 && <Typography variant="body2"
            color="text.secondary" sx={{ py: 2 }}>此文件夹为空</Typography>}
          {(hasPreviousPage || hasNextPage) && <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            {hasPreviousPage && <Button type="button" fullWidth size="small"
              disabled={pending} onClick={onPreviousPage}>上一页</Button>}
            {hasNextPage && <Button type="button" fullWidth size="small"
              disabled={pending} onClick={onNextPage}>下一页</Button>}
          </Stack>}
        </Box>
      ) : (
        <XDriveActionButton intent="primary" type="button" fullWidth
          disabled={!canDownload || pending} onClick={onBrowse}>浏览文件夹</XDriveActionButton>
      )}
    </Stack>
  )
}

import { FolderOutlined as FolderIcon, Refresh as RefreshIcon } from '@mui/icons-material'
import { Box, Button, CircularProgress, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material'
import type { KeyboardEvent } from 'react'
import type { MediaFolderView, MediaSyncFolder } from '../models'
import { XDriveMediaAsyncThumbnail } from './MediaGalleryPreviewMedia'
import { XDriveStatusAlert } from './StatusAlert'

type FolderTileProps = {
  name: string
  path: string
  directMediaCount: number
  childFolderCount: number
  coverNodeID?: number
  loadThumbnail: (nodeID: number) => Promise<string | null>
  onOpen: () => void
}

function activateWithKeyboard(event: KeyboardEvent, action: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  action()
}

function FolderTile({
  name,
  path,
  directMediaCount,
  childFolderCount,
  coverNodeID,
  loadThumbnail,
  onOpen,
}: FolderTileProps) {
  return (
    <Paper
      variant="outlined"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => activateWithKeyboard(event, onOpen)}
      data-xdrive-gallery-folder-card
      sx={{
        cursor: 'pointer',
        overflow: 'hidden',
        minWidth: 0,
        '&:hover': { bgcolor: 'action.hover' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
      }}
    >
      <Box sx={{ aspectRatio: '16 / 9', overflow: 'hidden', bgcolor: 'action.hover' }}>
        <XDriveMediaAsyncThumbnail
          nodeID={coverNodeID}
          alt={name}
          loadThumbnail={loadThumbnail}
          fallback={(
            <Box sx={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'text.secondary' }}>
              <FolderIcon sx={{ fontSize: 42 }} />
            </Box>
          )}
        />
      </Box>
      <Stack spacing={0.25} sx={{ px: 1.5, py: 1.25, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={650} noWrap title={name}>{name}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {directMediaCount.toLocaleString('zh-CN')} 个媒体 · {childFolderCount.toLocaleString('zh-CN')} 个子目录
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap title={path}>{path}</Typography>
      </Stack>
    </Paper>
  )
}

export interface XDriveMediaGallerySyncFoldersProps {
  roots: MediaSyncFolder[]
  view?: MediaFolderView | null
  loading: boolean
  error: string
  loadThumbnail: (nodeID: number) => Promise<string | null>
  onOpen: (sourceID: number, folderID: number) => void
  onReloadRoots?: () => void
}

export function XDriveMediaGallerySyncFolders({
  roots,
  view = null,
  loading,
  error,
  loadThumbnail,
  onOpen,
  onReloadRoots,
}: XDriveMediaGallerySyncFoldersProps) {
  const folders = view?.children ?? []
  return (
    <Stack spacing={1.25} data-xdrive-gallery-sync-folder-browser>
      {view ? (
        <>
          <Stack direction="row" spacing={0.5} alignItems="center" useFlexGap flexWrap="wrap" data-xdrive-gallery-folder-breadcrumbs>
            {view.breadcrumbs.map((part, index) => (
              <Button
                size="small"
                key={part.id}
                variant={index === view.breadcrumbs.length - 1 ? 'outlined' : 'text'}
                disabled={loading || index === view.breadcrumbs.length - 1}
                onClick={() => onOpen(view.source.source_id, part.id)}
                title={part.path}
              >
                {part.name}
              </Button>
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            仅显示当前目录中的媒体；进入子目录可查看对应照片
          </Typography>
        </>
      ) : (
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="subtitle1" fontWeight={700}>按同步文件夹浏览</Typography>
          {onReloadRoots ? (
            <Tooltip title="刷新同步文件夹">
              <span>
                <IconButton size="small" onClick={onReloadRoots} disabled={loading} aria-label="刷新同步文件夹">
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          ) : null}
        </Stack>
      )}

      {error ? <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert> : null}
      {loading ? (
        <Stack direction="row" alignItems="center" spacing={1}>
          <CircularProgress size={16} />
          <Typography color="text.secondary" variant="caption">正在读取目录…</Typography>
        </Stack>
      ) : null}

      <Box sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 190px), 1fr))',
        gap: 1.25,
      }}>
        {view
          ? folders.map((folder) => (
            <FolderTile
              key={folder.id}
              name={folder.name}
              path={folder.path}
              directMediaCount={folder.direct_media_count}
              childFolderCount={folder.child_folder_count}
              coverNodeID={folder.cover_node_id}
              loadThumbnail={loadThumbnail}
              onOpen={() => onOpen(view.source.source_id, folder.id)}
            />
          ))
          : roots.map((root) => (
            <FolderTile
              key={root.source_id}
              name={root.source_name || root.target_name}
              path={root.target_path}
              directMediaCount={root.direct_media_count}
              childFolderCount={root.child_folder_count}
              coverNodeID={root.cover_node_id}
              loadThumbnail={loadThumbnail}
              onOpen={() => onOpen(root.source_id, root.target_node_id)}
            />
          ))}
      </Box>
      {!loading && !error && !view && roots.length === 0 ? (
        <Typography color="text.secondary" variant="body2">暂无可以浏览的同步文件夹</Typography>
      ) : null}
    </Stack>
  )
}

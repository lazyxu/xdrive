import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import ShareRoundedIcon from '@mui/icons-material/ShareRounded'
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import { Box, IconButton, Stack, Tooltip } from '@mui/material'
import type {
  MediaEditRecipe,
  MediaEditRecipeInput,
  MediaCreativeGeneration,
  MediaCreativeInput,
  MediaItem,
} from '../models'
import {
  xDriveMediaItemSupportsBasicEditing,
} from '../media-edit'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveOpenPreviewDialog } from './FileOpenPreviewDialog'
import {
  XDriveMediaGalleryCreativeDialog,
  xDriveMediaItemSupportsCreative,
} from './MediaGalleryCreativeDialog'
import { XDriveMediaGalleryEditDialog } from './MediaGalleryEditDialog'
import { XDriveMediaGalleryFilmstrip } from './MediaGalleryFilmstrip'
import type { XDriveMediaGalleryFilmstripEntry } from './MediaGalleryFilmstrip'
import { XDriveMediaViewerContent } from './MediaViewerContent'
import { xDriveMediaCaptureTimeLabel } from '../media-viewer'
import type {
  MediaMotionLoader,
  MediaPreviewURLLoader,
  MediaThumbnailLoader,
} from './MediaGallery'

type ViewerAction = 'favorite' | 'download' | 'delete' | ''

export function XDriveMediaGalleryViewer({
  item,
  positionLabel,
  canPrevious,
  canNext,
  filmstripEntries,
  activeIndex,
  loadThumbnail,
  loadLivePhotoMotion,
  loadPreviewURL,
  onPrevious,
  onNext,
  onFilmstripSelect,
  onToggleFavorite,
  onInfo,
  onSaveEditRecipe,
  onResetEditRecipe,
  onCreateCreativeGeneration,
  onGetCreativeGeneration,
  onCancelCreativeGeneration,
  onCreativeCompleted,
  onDownload,
  onShare,
  onDelete,
  onClose,
}: {
  item: MediaItem | null
  positionLabel?: ReactNode
  canPrevious: boolean
  canNext: boolean
  filmstripEntries: readonly XDriveMediaGalleryFilmstripEntry[]
  activeIndex: number
  loadThumbnail: MediaThumbnailLoader
  loadLivePhotoMotion?: MediaMotionLoader
  loadPreviewURL?: MediaPreviewURLLoader
  onPrevious: () => void
  onNext: () => void
  onFilmstripSelect: (index: number) => void
  onToggleFavorite?: (item: MediaItem) => Promise<void>
  onInfo?: (item: MediaItem) => void
  onSaveEditRecipe?: (
    item: MediaItem,
    input: MediaEditRecipeInput,
  ) => Promise<MediaEditRecipe>
  onResetEditRecipe?: (
    item: MediaItem,
    revision: number,
  ) => Promise<MediaEditRecipe>
  onCreateCreativeGeneration?: (
    item: MediaItem,
    input: MediaCreativeInput,
  ) => Promise<MediaCreativeGeneration>
  onGetCreativeGeneration?: (
    generationID: string,
  ) => Promise<MediaCreativeGeneration>
  onCancelCreativeGeneration?: (
    generationID: string,
  ) => Promise<MediaCreativeGeneration>
  onCreativeCompleted?: (generation: MediaCreativeGeneration) => void
  onDownload?: (item: MediaItem) => Promise<void>
  onShare?: (item: MediaItem) => void
  onDelete?: (item: MediaItem) => Promise<void>
  onClose: () => void
}) {
  const [fullScreen, setFullScreen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [creativeOpen, setCreativeOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [busyAction, setBusyAction] = useState<ViewerAction>('')

  const run = useCallback(async (
    action: ViewerAction,
    task: () => Promise<void>,
  ) => {
    if (busyAction) return
    setBusyAction(action)
    try {
      await task()
    } finally {
      setBusyAction('')
    }
  }, [busyAction])

  const close = () => {
    setDeleteOpen(false)
    setCreativeOpen(false)
    setEditOpen(false)
    setFullScreen(false)
    onClose()
  }

  const actions = item ? (
    <Stack direction="row" spacing={0.25} alignItems="center">
      {onToggleFavorite ? (
        <Tooltip title={item.favorite ? '取消收藏' : '收藏'}>
          <span>
            <IconButton
              size="small"
              aria-label={item.favorite ? '取消收藏' : '收藏'}
              disabled={Boolean(busyAction)}
              onClick={() => {
                void run('favorite', () => onToggleFavorite(item)).catch(() => undefined)
              }}
            >
              {item.favorite
                ? <StarRoundedIcon fontSize="small" />
                : <StarBorderRoundedIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      ) : null}
      {onCreateCreativeGeneration &&
      onGetCreativeGeneration &&
      loadPreviewURL &&
      xDriveMediaItemSupportsCreative(item) ? (
        <Tooltip title="创作">
          <IconButton
            size="small"
            aria-label="创作图片"
            onClick={() => setCreativeOpen(true)}
          >
            <AutoFixHighRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
      {onSaveEditRecipe && xDriveMediaItemSupportsBasicEditing(item) ? (
        <Tooltip title="编辑">
          <IconButton
            size="small"
            aria-label="编辑媒体"
            onClick={() => setEditOpen(true)}
          >
            <EditRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
      {onInfo ? (
        <Tooltip title="信息">
          <IconButton size="small" aria-label="媒体信息" onClick={() => onInfo(item)}>
            <InfoOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
      {onDownload ? (
        <Tooltip title="下载">
          <span>
            <IconButton
              size="small"
              aria-label="下载媒体"
              disabled={Boolean(busyAction)}
              onClick={() => {
                void run('download', () => onDownload(item)).catch(() => undefined)
              }}
            >
              <DownloadRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      ) : null}
      {onShare ? (
        <Tooltip title="分享">
          <IconButton size="small" aria-label="分享媒体" onClick={() => onShare(item)}>
            <ShareRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
      {onDelete ? (
        <Tooltip title="删除">
          <span>
            <IconButton
              size="small"
              color="error"
              aria-label="删除媒体"
              disabled={Boolean(busyAction)}
              onClick={() => setDeleteOpen(true)}
            >
              <DeleteOutlineRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      ) : null}
    </Stack>
  ) : null

  const footer = item ? (
    <Box sx={{ width: '100%', minWidth: 0 }}>
      <XDriveMediaGalleryFilmstrip
        entries={filmstripEntries}
        activeIndex={activeIndex}
        loadThumbnail={loadThumbnail}
        onSelect={onFilmstripSelect}
      />
    </Box>
  ) : null

  return (
    <>
      <XDriveOpenPreviewDialog
        open={Boolean(item)}
        title={item?.node.name ?? ''}
        subtitle={item ? xDriveMediaCaptureTimeLabel(item.metadata.captured_at) : undefined}
        positionLabel={positionLabel}
        canPrevious={canPrevious}
        canNext={canNext}
        onPrevious={onPrevious}
        onNext={onNext}
        actions={actions}
        footer={footer}
        immersive
        fullScreen={fullScreen}
        onFullScreenChange={setFullScreen}
        onClose={close}
      >
        {item ? (
          <XDriveMediaViewerContent
            item={item}
            loadThumbnail={loadThumbnail}
            loadLivePhotoMotion={loadLivePhotoMotion}
            loadPreviewURL={loadPreviewURL}
            interactiveImage
            onSwipePrevious={canPrevious ? onPrevious : undefined}
            onSwipeNext={canNext ? onNext : undefined}
            minHeight={0}
            maxHeight="none"
          />
        ) : null}
      </XDriveOpenPreviewDialog>

      <XDriveMediaGalleryCreativeDialog
        open={creativeOpen}
        item={item}
        loadPreviewURL={loadPreviewURL}
        onCreate={onCreateCreativeGeneration}
        onGet={onGetCreativeGeneration}
        onCancel={onCancelCreativeGeneration}
        onCompleted={onCreativeCompleted}
        onClose={() => setCreativeOpen(false)}
      />

      <XDriveMediaGalleryEditDialog
        open={editOpen}
        item={item}
        loadThumbnail={loadThumbnail}
        loadPreviewURL={loadPreviewURL}
        onSave={async (value, input) => {
          if (!onSaveEditRecipe) throw new Error('当前客户端不支持媒体编辑')
          return onSaveEditRecipe(value, input)
        }}
        onReset={onResetEditRecipe}
        onClose={() => setEditOpen(false)}
      />

      <XDriveConfirmDialog
        open={deleteOpen}
        title="删除这张照片或视频？"
        description="项目会移到回收站；删除任务可在任务中心查看和取消。"
        confirmLabel="删除"
        confirmIntent="danger"
        loading={busyAction === 'delete'}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          if (!item || !onDelete) return
          void run('delete', () => onDelete(item))
            .then(() => {
              setDeleteOpen(false)
              close()
            })
            .catch(() => undefined)
        }}
      />
    </>
  )
}

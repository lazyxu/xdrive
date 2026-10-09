import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Star as StarIcon,
  StarBorder as StarBorderIcon,
} from '@mui/icons-material'
import {
  Box,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { MediaAlbum, MediaItem } from '../models'
import type {
  XDriveByteProgressHandler,
  XDriveLivePhotoMotionSource,
} from '../file-preview'
import { xDriveMediaEditPreviewTransform } from '../media-edit'
import { formatBytes } from '../format'
import { xDriveMediaCaptureTimeValue } from '../media-viewer'
import { XDriveFilePreviewSurface } from './FilePreviewSurface'
import type {
  XDriveFilePreviewImageLoader,
  XDriveFilePreviewURLLoader,
} from './FilePreviewSurface'
import { XDriveLivePhotoSurface } from './LivePhotoSurface'
import {
  XDriveMediaAsyncThumbnail,
  xDriveMediaFallback,
} from './MediaGalleryPreviewMedia'
import {
  xDriveMediaFormatDuration,
  xDriveMediaGalleryErrorMessage,
} from './MediaGalleryUtils'
import { XDriveStatusAlert } from './StatusAlert'

type MediaThumbnailLoader = (nodeID: number) => Promise<string | null>
type MediaMotionLoader = (
  nodeID: number,
  onProgress?: XDriveByteProgressHandler,
) => Promise<XDriveLivePhotoMotionSource | null>
type MediaPreviewURLLoader = (
  nodeID: number,
  kind: 'image' | 'video',
) => Promise<string | null>

function formatMediaBytes(bytes?: number) {
  if (bytes === undefined || bytes < 0) return '—'
  return formatBytes(bytes)
}

function orientationLabel(orientation?: number) {
  const labels: Record<number, string> = {
    1: '正常',
    2: '水平镜像',
    3: '旋转 180°',
    4: '垂直镜像',
    5: '转置',
    6: '顺时针 90°',
    7: '横向转置',
    8: '逆时针 90°',
  }
  return orientation ? (labels[orientation] || `EXIF ${orientation}`) : '—'
}

function mediaAssetLabel(item: MediaItem) {
  if (item.live_photo || item.asset_kind === 'live_photo') return '实况照片'
  switch (item.asset_kind) {
    case 'raw_pair':
      return 'RAW 组合'
    case 'burst':
      return '连拍'
    case 'sidecar':
      return '编辑组合'
    case 'video':
      return '视频'
    case 'image':
      return '图片'
    default:
      return item.metadata.media_kind === 'video' ? '视频' : '图片'
  }
}

function parseMediaTagsInput(value: string) {
  return value
    .split(/[,，\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function mediaResourceRoleLabel(role: string) {
  switch (role) {
    case 'primary':
      return '主资源'
    case 'still':
      return '静态照片'
    case 'motion':
      return '动态视频'
    case 'raw':
      return 'RAW'
    case 'rendered':
      return '渲染照片'
    case 'sidecar':
      return 'Sidecar'
    case 'container':
      return '原始容器'
    case 'auxiliary':
      return '辅助资源'
    default:
      return role || '资源'
  }
}

type MediaDetailRow = [label: string, value: string]

/** Presentation-only groups over canonical local media metadata; no directory inference. */
export function xDriveMediaInspectorFields(item: MediaItem) {
  const metadata = item.metadata
  const photoInfo: MediaDetailRow[] = [
    ['类型', mediaAssetLabel(item)],
    ['拍摄时间', xDriveMediaCaptureTimeValue(metadata.captured_at)],
    [
      '分辨率',
      metadata.width && metadata.height
        ? `${metadata.width} × ${metadata.height}`
        : '—',
    ],
    ['方向', orientationLabel(metadata.orientation)],
  ]
  if (metadata.media_kind === 'video') {
    photoInfo.push(
      ['时长', xDriveMediaFormatDuration(metadata.duration_ms) || '—'],
      ['视频旋转', metadata.rotation_degrees ? `${metadata.rotation_degrees}°` : '0°'],
      ['帧率', metadata.frame_rate ? `${metadata.frame_rate.toFixed(2)} fps` : '—'],
      ['码率', metadata.bit_rate ? `${(metadata.bit_rate / 1_000_000).toFixed(2)} Mbps` : '—'],
      ['视频编码', metadata.video_codec || '—'],
      ['音频编码', metadata.audio_codec || '—'],
    )
  }
  if (metadata.camera_make || metadata.camera_model) {
    photoInfo.push([
      '相机',
      [metadata.camera_make, metadata.camera_model].filter(Boolean).join(' '),
    ])
  }
  if (metadata.lens_model) photoInfo.push(['镜头', metadata.lens_model])
  if (metadata.latitude != null && metadata.longitude != null) {
    photoInfo.push(['GPS', `${metadata.latitude.toFixed(6)}, ${metadata.longitude.toFixed(6)}`])
  }
  if (metadata.altitude_m != null) photoInfo.push(['海拔', `${metadata.altitude_m.toFixed(1)} m`])

  const organize: MediaDetailRow[] = [
    ['收藏', item.favorite ? '已收藏' : '未收藏'],
    ['标签', item.tags?.length ? item.tags.join('、') : '—'],
    ['人物', item.people?.length ? item.people.join('、') : '—'],
    ['备注', item.description?.trim() || '—'],
  ]
  const files: MediaDetailRow[] = [
    ['文件名', item.node.name],
    ['大小', formatMediaBytes(item.node.size)],
    ['格式', metadata.mime_type || '—'],
  ]
  if (metadata.thumbnail_width && metadata.thumbnail_height) {
    files.push([
      '缩略图',
      `${metadata.thumbnail_width} × ${metadata.thumbnail_height} · ${metadata.thumbnail_mime_type || 'image/jpeg'}`,
    ])
  }
  if (item.resources && item.resources.length > 1) {
    files.push(['资源数', String(item.resources.length)])
  }
  return { photoInfo, organize, files }
}

function MediaDetailsRows({ rows }: { rows: readonly (readonly [label: string, value: ReactNode])[] }) {
  if (rows.length === 0) return null
  return (
    <Stack spacing={1.1}>
      {rows.map(([label, value]) => (
        <Box
          key={label}
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '88px minmax(0, 1fr)', sm: '112px minmax(0, 1fr)' },
            gap: 2,
          }}
        >
          <Typography variant="body2" color="text.secondary">{label}</Typography>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{value}</Typography>
        </Box>
      ))}
    </Stack>
  )
}

export interface XDriveMediaDetailsContentProps {
  item: MediaItem | null
  showPreview?: boolean
  extraFileRows?: Array<[label: string, value: ReactNode]>
  loadThumbnail: MediaThumbnailLoader
  loadLivePhotoMotion?: MediaMotionLoader
  loadPreviewURL?: MediaPreviewURLLoader
  albums: MediaAlbum[]
  currentAlbum?: MediaAlbum | null
  onSetFavorite?: (item: MediaItem, favorite: boolean) => Promise<void>
  onSetTags?: (item: MediaItem, tags: string[]) => Promise<string[]>
  onSetPeople?: (item: MediaItem, people: string[]) => Promise<string[]>
  onSetDescription?: (item: MediaItem, description: string) => Promise<string>
  onAddToAlbum?: (album: MediaAlbum, item: MediaItem) => Promise<MediaAlbum>
  onRemoveFromAlbum?: (album: MediaAlbum, item: MediaItem) => Promise<MediaAlbum>
}

export function XDriveMediaDetailsContent({
  item,
  showPreview = true,
  extraFileRows = [],
  loadThumbnail,
  loadLivePhotoMotion,
  loadPreviewURL,
  albums,
  currentAlbum,
  onSetFavorite,
  onSetTags,
  onSetPeople,
  onSetDescription,
  onAddToAlbum,
  onRemoveFromAlbum,
}: XDriveMediaDetailsContentProps) {
  const [targetAlbumID, setTargetAlbumID] = useState('')
  const [albumBusy, setAlbumBusy] = useState(false)
  const [albumError, setAlbumError] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [tagsBusy, setTagsBusy] = useState(false)
  const [tagsError, setTagsError] = useState('')
  const [peopleInput, setPeopleInput] = useState('')
  const [peopleBusy, setPeopleBusy] = useState(false)
  const [peopleError, setPeopleError] = useState('')
  const [descriptionInput, setDescriptionInput] = useState('')
  const [descriptionBusy, setDescriptionBusy] = useState(false)
  const [descriptionError, setDescriptionError] = useState('')
  const tagsKey = (item?.tags || []).join('\u0000')
  const peopleKey = (item?.people || []).join('\u0000')
  const livePhoto = Boolean(item?.live_photo || item?.asset_kind === 'live_photo')
  const ordinaryImage = Boolean(item?.metadata.media_kind === 'image' && !livePhoto)
  const ordinaryVideo = Boolean(item?.metadata.media_kind === 'video' && !livePhoto)
  const ordinaryPreview = ordinaryImage || ordinaryVideo
  const previewTarget = useMemo(() => (
    item && (ordinaryPreview || livePhoto)
      ? {
          id: item.node.id,
          name: item.node.name,
          kind: 'file' as const,
          mimeType: item.metadata.mime_type,
          size: item.node.size,
          revision: item.node.revision,
        }
      : null
  ), [
    item?.node.id,
    item?.node.name,
    item?.node.revision,
    item?.node.size,
    item?.metadata.mime_type,
    livePhoto,
    ordinaryPreview,
  ])
  const loadSelectedPreview = useCallback<XDriveFilePreviewURLLoader>(async (_target, kind) => {
    if (!item || !loadPreviewURL || (kind !== 'image' && kind !== 'video')) return null
    return loadPreviewURL(item.node.id, kind)
  }, [item?.node.id, loadPreviewURL])
  const loadSelectedThumbnail = useCallback<XDriveFilePreviewImageLoader>(async () => {
    if (!item?.metadata.has_thumbnail) return null
    return loadThumbnail(item.node.id)
  }, [item?.metadata.has_thumbnail, item?.node.id, loadThumbnail])

  const loadSelectedLivePhotoMotion = useCallback(async (
    onProgress?: XDriveByteProgressHandler,
  ) => {
    if (!item || !loadLivePhotoMotion) return null
    return loadLivePhotoMotion(item.node.id, onProgress)
  }, [item?.node.id, loadLivePhotoMotion])

  useEffect(() => {
    setTagsInput((item?.tags || []).join(', '))
    setTagsBusy(false)
    setTagsError('')
  }, [item?.node.id, tagsKey])

  useEffect(() => {
    setPeopleInput((item?.people || []).join(', '))
    setPeopleBusy(false)
    setPeopleError('')
  }, [item?.node.id, peopleKey])

  useEffect(() => {
    setDescriptionInput(item?.description || '')
    setDescriptionBusy(false)
    setDescriptionError('')
  }, [item?.node.id, item?.description])

  const sectionRows = useMemo(
    () => item ? xDriveMediaInspectorFields(item) : null,
    [item],
  )

  if (!item || !sectionRows) return null

  return (
    <Stack spacing={2} sx={{ p: 1.5 }}>
      {showPreview ? (
      <Box
        sx={{
          height: 184,
          border: 1,
          borderColor: 'divider',
          borderRadius: 1.5,
          overflow: 'hidden',
        }}
      >
        {livePhoto && loadLivePhotoMotion ? (
          <XDriveLivePhotoSurface
            key={item.node.id}
            label={item.node.name}
            loadMotion={loadSelectedLivePhotoMotion}
            sourceKey={`${item.node.id}:${item.node.revision}`}
            still={(
              <XDriveFilePreviewSurface
                target={previewTarget}
                loadPreviewURL={loadSelectedPreview}
                loadImagePreview={loadSelectedThumbnail}
                fallback={xDriveMediaFallback(item.metadata.media_kind)}
                minHeight={160}
                maxHeight={240}
                mediaTransform={xDriveMediaEditPreviewTransform(item.edit_recipe)}
              />
            )}
          />
        ) : ordinaryPreview && loadPreviewURL ? (
          <XDriveFilePreviewSurface
            target={previewTarget}
            loadPreviewURL={loadSelectedPreview}
            loadImagePreview={loadSelectedThumbnail}
            fallback={xDriveMediaFallback(item.metadata.media_kind)}
            minHeight={160}
            maxHeight={240}
            mediaTransform={xDriveMediaEditPreviewTransform(item.edit_recipe)}
          />
        ) : (
          <XDriveMediaAsyncThumbnail
            nodeID={item.metadata.has_thumbnail ? item.node.id : undefined}
            alt={item.node.name}
            loadThumbnail={loadThumbnail}
            fallback={xDriveMediaFallback(item.metadata.media_kind)}
          />
        )}
      </Box>
      ) : null}
      <Box component="section" aria-label="照片信息" data-xdrive-media-details-info>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>照片信息</Typography>
        <MediaDetailsRows rows={sectionRows.photoInfo} />
        {item.metadata.index_error ? (
          <Box sx={{ mt: 1 }}>
            <XDriveStatusAlert tone="warning">
              部分媒体元数据未能解析：{item.metadata.index_error}
            </XDriveStatusAlert>
          </Box>
        ) : null}
      </Box>
      <Box component="section" aria-label="整理" data-xdrive-media-details-organize>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>整理</Typography>
        <Stack spacing={2}>
          <MediaDetailsRows
            rows={sectionRows.organize.filter(([label]) => (
              (label === '收藏' && !onSetFavorite) ||
              (label === '标签' && !onSetTags) ||
              (label === '人物' && !onSetPeople) ||
              (label === '备注' && !onSetDescription && Boolean(item.description?.trim()))
            ))}
          />
          {onSetFavorite ? (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                size="small"
                variant={item.favorite ? 'contained' : 'outlined'}
                startIcon={item.favorite ? <StarIcon /> : <StarBorderIcon />}
                onClick={() => {
                  void onSetFavorite(item, !item.favorite).catch(() => undefined)
                }}
              >
                {item.favorite ? '取消收藏' : '收藏'}
              </Button>
            </Box>
          ) : null}
          {onSetTags ? (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.75 }}>标签</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                  size="small"
                  fullWidth
                  label="标签"
                  placeholder="家庭, 旅行, 工作"
                  value={tagsInput}
                  disabled={tagsBusy}
                  onChange={(event) => {
                    setTagsInput(event.target.value)
                    setTagsError('')
                  }}
                  helperText="使用逗号分隔；最多 32 个标签。"
                />
                <Button
                  variant="outlined"
                  disabled={tagsBusy}
                  onClick={() => {
                    setTagsBusy(true)
                    setTagsError('')
                    void onSetTags(item, parseMediaTagsInput(tagsInput))
                      .then((tags) => setTagsInput(tags.join(', ')))
                      .catch((tagError) => setTagsError(xDriveMediaGalleryErrorMessage(tagError)))
                      .finally(() => setTagsBusy(false))
                  }}
                >
                  保存标签
                </Button>
              </Stack>
              {tagsError ? (
                <Box sx={{ mt: 1 }}>
                  <XDriveStatusAlert tone="bad">{tagsError}</XDriveStatusAlert>
                </Box>
              ) : null}
            </Box>
          ) : null}
          {onSetPeople ? (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.75 }}>人物标签</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                  size="small"
                  fullWidth
                  label="人物"
                  placeholder="Alice, Bob, 张三"
                  value={peopleInput}
                  disabled={peopleBusy}
                  onChange={(event) => {
                    setPeopleInput(event.target.value)
                    setPeopleError('')
                  }}
                  helperText="用户维护的本地人物标签；使用逗号分隔，最多 32 个。不进行自动人脸识别。"
                />
                <Button
                  variant="outlined"
                  disabled={peopleBusy}
                  onClick={() => {
                    setPeopleBusy(true)
                    setPeopleError('')
                    void onSetPeople(item, parseMediaTagsInput(peopleInput))
                      .then((people) => setPeopleInput(people.join(', ')))
                      .catch((saveError) => setPeopleError(xDriveMediaGalleryErrorMessage(saveError)))
                      .finally(() => setPeopleBusy(false))
                  }}
                >
                  保存人物
                </Button>
              </Stack>
              {peopleError ? (
                <Box sx={{ mt: 1 }}>
                  <XDriveStatusAlert tone="bad">{peopleError}</XDriveStatusAlert>
                </Box>
              ) : null}
            </Box>
          ) : null}
          {onSetDescription ? (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.75 }}>描述 / 备注</Typography>
              <Stack spacing={1}>
                <TextField
                  multiline
                  minRows={3}
                  maxRows={8}
                  fullWidth
                  label="描述"
                  placeholder="为这张照片或视频添加本地备注"
                  value={descriptionInput}
                  disabled={descriptionBusy}
                  onChange={(event) => {
                    setDescriptionInput(event.target.value)
                    setDescriptionError('')
                  }}
                  helperText={`${Array.from(descriptionInput).length.toLocaleString('zh-CN')} / 4096 字符；仅保存在 xDrive 本地图库。`}
                />
                <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    variant="outlined"
                    disabled={descriptionBusy || Array.from(descriptionInput).length > 4096}
                    onClick={() => {
                      setDescriptionBusy(true)
                      setDescriptionError('')
                      void onSetDescription(item, descriptionInput)
                        .then((description) => setDescriptionInput(description))
                        .catch((saveError) => setDescriptionError(xDriveMediaGalleryErrorMessage(saveError)))
                        .finally(() => setDescriptionBusy(false))
                    }}
                  >
                    保存描述
                  </Button>
                </Box>
              </Stack>
              {descriptionError ? (
                <Box sx={{ mt: 1 }}>
                  <XDriveStatusAlert tone="bad">{descriptionError}</XDriveStatusAlert>
                </Box>
              ) : null}
            </Box>
          ) : null}
          {(onAddToAlbum || (currentAlbum?.kind === 'manual' && onRemoveFromAlbum)) ? (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.75 }}>相册</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                {onAddToAlbum ? (
                  <>
                    <TextField
                      select
                      size="small"
                      label="添加到手动相册"
                      value={targetAlbumID}
                      onChange={(event) => {
                        setTargetAlbumID(event.target.value)
                        setAlbumError('')
                      }}
                      sx={{ minWidth: 220, flex: 1 }}
                    >
                      <MenuItem value="">选择相册</MenuItem>
                      {albums.filter((album) => album.kind === 'manual').map((album) => (
                        <MenuItem key={album.id} value={album.id}>
                          {album.name}
                        </MenuItem>
                      ))}
                    </TextField>
                    <Button
                      variant="outlined"
                      disabled={!targetAlbumID || albumBusy}
                      onClick={() => {
                        const album = albums.find((value) => value.id === targetAlbumID)
                        if (!album) return
                        setAlbumBusy(true)
                        setAlbumError('')
                        void onAddToAlbum(album, item)
                          .then(() => setTargetAlbumID(''))
                          .catch((error) => setAlbumError(xDriveMediaGalleryErrorMessage(error)))
                          .finally(() => setAlbumBusy(false))
                      }}
                    >
                      添加
                    </Button>
                  </>
                ) : null}
                {currentAlbum?.kind === 'manual' && onRemoveFromAlbum ? (
                  <Button
                    color="error"
                    variant="outlined"
                    disabled={albumBusy}
                    onClick={() => {
                      setAlbumBusy(true)
                      setAlbumError('')
                      void onRemoveFromAlbum(currentAlbum, item)
                        .catch((error) => setAlbumError(xDriveMediaGalleryErrorMessage(error)))
                        .finally(() => setAlbumBusy(false))
                    }}
                  >
                    从当前相册移除
                  </Button>
                ) : null}
              </Stack>
              {albumError ? (
                <Box sx={{ mt: 1 }}>
                  <XDriveStatusAlert tone="bad">{albumError}</XDriveStatusAlert>
                </Box>
              ) : null}
            </Box>
          ) : null}
        </Stack>
      </Box>
      <Box component="section" aria-label="文件与资源" data-xdrive-media-details-file-resources>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>文件与资源</Typography>
        <MediaDetailsRows rows={sectionRows.files} />
        {extraFileRows.length > 0 ? <MediaDetailsRows rows={extraFileRows} /> : null}
        {item.resources && item.resources.length > 1 ? (
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.75 }}>资产资源</Typography>
            <Stack spacing={0.75}>
              {item.resources.map((resource, index) => (
                <Box
                  key={`${resource.kind}:${resource.node_id}:${resource.role}:${index}`}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '88px minmax(0, 1fr)', sm: '112px minmax(0, 1fr)' },
                    gap: 2,
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    {mediaResourceRoleLabel(resource.role)}
                  </Typography>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                    {resource.name}
                    {resource.mime_type ? ` · ${resource.mime_type}` : ''}
                    {resource.size > 0 ? ` · ${formatMediaBytes(resource.size)}` : ''}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Box>
        ) : null}
      </Box>
    </Stack>
  )
}


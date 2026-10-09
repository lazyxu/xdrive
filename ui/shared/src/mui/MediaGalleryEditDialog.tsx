import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  Slider,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import RotateLeftRoundedIcon from '@mui/icons-material/RotateLeftRounded'
import RotateRightRoundedIcon from '@mui/icons-material/RotateRightRounded'
import FlipRoundedIcon from '@mui/icons-material/FlipRounded'
import type {
  MediaEditRecipe,
  MediaEditRecipeInput,
  MediaItem,
} from '../models'
import {
  xDriveDefaultMediaEditInput,
  xDriveMediaEditInputFromRecipe,
  xDriveMediaEditPreviewTransform,
} from '../media-edit'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'
import { XDriveFilePreviewSurface } from './FilePreviewSurface'
import type {
  XDriveFilePreviewImageLoader,
  XDriveFilePreviewURLLoader,
} from './FilePreviewSurface'
import { xDriveMediaFallback } from './MediaGalleryPreviewMedia'

type ThumbnailLoader = (nodeID: number) => Promise<string | null>
type PreviewLoader = (
  nodeID: number,
  kind: 'image' | 'video',
) => Promise<string | null>

function percent(value: number) {
  return Math.round(value * 100)
}

export function XDriveMediaGalleryEditDialog({
  open,
  item,
  loadThumbnail,
  loadPreviewURL,
  onSave,
  onReset,
  onClose,
}: {
  open: boolean
  item: MediaItem | null
  loadThumbnail: ThumbnailLoader
  loadPreviewURL?: PreviewLoader
  onSave: (
    item: MediaItem,
    input: MediaEditRecipeInput,
  ) => Promise<MediaEditRecipe>
  onReset?: (
    item: MediaItem,
    revision: number,
  ) => Promise<MediaEditRecipe>
  onClose: () => void
}) {
  const [draft, setDraft] = useState<MediaEditRecipeInput>(
    () => xDriveDefaultMediaEditInput('image'),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // The editor can switch assets, recipe revisions, or open sessions while a
  // previous request is unresolved. Each scope owns only its own async results.
  const actionScopeRef = useRef({
    nodeID: item?.node.id,
    recipeRevision: item?.edit_recipe?.revision,
    open,
    inFlight: false,
  })
  if (
    actionScopeRef.current.nodeID !== item?.node.id ||
    actionScopeRef.current.recipeRevision !== item?.edit_recipe?.revision ||
    actionScopeRef.current.open !== open
  ) {
    actionScopeRef.current = {
      nodeID: item?.node.id,
      recipeRevision: item?.edit_recipe?.revision,
      open,
      inFlight: false,
    }
  }
  const actionScope = actionScopeRef.current

  useEffect(() => {
    if (!item || !open) return
    setDraft(xDriveMediaEditInputFromRecipe(
      item.edit_recipe,
      item.metadata.media_kind,
    ))
    setBusy(false)
    setError('')
  }, [item?.node.id, item?.edit_recipe?.revision, open])

  const target = useMemo(() => item ? ({
    id: item.node.id,
    name: item.node.name,
    kind: 'file' as const,
    mimeType: item.metadata.mime_type,
    size: item.node.size,
    revision: item.node.revision,
  }) : null, [
    item?.node.id,
    item?.node.name,
    item?.node.revision,
    item?.node.size,
    item?.metadata.mime_type,
  ])

  const loadOpenPreview = useCallback<XDriveFilePreviewURLLoader>(
    async (_target, kind) => {
      if (!item || !loadPreviewURL || (kind !== 'image' && kind !== 'video')) {
        return null
      }
      return loadPreviewURL(item.node.id, kind)
    },
    [item?.node.id, loadPreviewURL],
  )
  const loadOpenThumbnail = useCallback<XDriveFilePreviewImageLoader>(
    async () => {
      if (!item?.metadata.has_thumbnail) return null
      return loadThumbnail(item.node.id)
    },
    [item?.metadata.has_thumbnail, item?.node.id, loadThumbnail],
  )

  if (!item) return null
  const video = item.metadata.media_kind === 'video'
  const durationMS = Math.max(0, item.metadata.duration_ms || 0)
  const trimEnd = draft.trim_end_ms > 0
    ? draft.trim_end_ms
    : durationMS
  const rotate = (delta: number) => {
    setDraft((current) => ({
      ...current,
      rotation_degrees:
        ((current.rotation_degrees + delta + 360) % 360),
    }))
  }
  const runMutation = async (work: () => Promise<MediaEditRecipe>) => {
    // A synchronous in-flight claim also prevents duplicate same-tick submits,
    // before React can publish the next disabled/Busy render.
    if (!open || actionScopeRef.current !== actionScope || actionScope.inFlight) return
    actionScope.inFlight = true
    setBusy(true)
    setError('')
    try {
      const result = await work()
      if (actionScopeRef.current === actionScope) {
        setDraft(xDriveMediaEditInputFromRecipe(result, item.metadata.media_kind))
      }
    } catch (mutationError) {
      if (actionScopeRef.current === actionScope) {
        setError(mutationError instanceof Error
          ? mutationError.message
          : String(mutationError))
      }
    } finally {
      if (actionScopeRef.current === actionScope) {
        actionScope.inFlight = false
        setBusy(false)
      }
    }
  }
  const save = () => runMutation(() => onSave(item, draft))

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      maxWidth="md"
      fullWidth
      slotProps={{ paper: xDriveDialogPaperProps }}
    >
      <XDriveDialogTitle title="编辑" onClose={() => !busy && onClose()} />
      <XDriveDialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="info">
            编辑以参数形式保存，原文件不会被改写；当前“下载”仍下载原始文件。
          </Alert>
          {!item.edit_recipe?.source_current && item.edit_recipe?.revision ? (
            <Alert severity="warning">
              原文件内容已变化；旧编辑不会自动应用。保存后会基于当前文件建立新版本。
            </Alert>
          ) : null}
          <Box
            sx={{
              height: { xs: 260, sm: 360 },
              bgcolor: 'black',
              borderRadius: 1.5,
              overflow: 'hidden',
            }}
          >
            <XDriveFilePreviewSurface
              target={target}
              loadPreviewURL={loadOpenPreview}
              loadImagePreview={loadOpenThumbnail}
              fallback={xDriveMediaFallback(item.metadata.media_kind)}
              minHeight={240}
              maxHeight={480}
              mediaTransform={xDriveMediaEditPreviewTransform(draft)}
            />
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="center">
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                startIcon={<RotateLeftRoundedIcon />}
                onClick={() => rotate(-90)}
              >
                左转
              </Button>
              <Button
                size="small"
                startIcon={<RotateRightRoundedIcon />}
                onClick={() => rotate(90)}
              >
                右转
              </Button>
            </Stack>
            <ToggleButtonGroup
              size="small"
              value={[
                draft.flip_horizontal ? 'h' : '',
                draft.flip_vertical ? 'v' : '',
              ].filter(Boolean)}
              onChange={(_event, values: string[]) => {
                setDraft((current) => ({
                  ...current,
                  flip_horizontal: values.includes('h'),
                  flip_vertical: values.includes('v'),
                }))
              }}
            >
              <ToggleButton value="h" aria-label="水平翻转">
                <FlipRoundedIcon fontSize="small" sx={{ mr: 0.5 }} />
                水平翻转
              </ToggleButton>
              <ToggleButton value="v" aria-label="垂直翻转">
                <FlipRoundedIcon
                  fontSize="small"
                  sx={{ mr: 0.5, transform: 'rotate(90deg)' }}
                />
                垂直翻转
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          {video ? (
            <Stack spacing={0.5}>
              <Typography variant="body2" fontWeight={600}>
                裁剪时间
              </Typography>
              {durationMS > 0 ? (
                <>
                  <Slider
                    min={0}
                    max={durationMS}
                    step={100}
                    value={[
                      Math.min(draft.trim_start_ms, durationMS),
                      Math.min(trimEnd || durationMS, durationMS),
                    ]}
                    valueLabelDisplay="auto"
                    valueLabelFormat={(value) => `${(Number(value) / 1000).toFixed(1)}s`}
                    onChange={(_event, value) => {
                      if (!Array.isArray(value)) return
                      const start = Math.round(Number(value[0]))
                      const end = Math.round(Number(value[1]))
                      setDraft((current) => ({
                        ...current,
                        trim_start_ms: start,
                        trim_end_ms: end >= durationMS ? 0 : end,
                      }))
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {(draft.trim_start_ms / 1000).toFixed(1)}s –{' '}
                    {((draft.trim_end_ms || durationMS) / 1000).toFixed(1)}s
                  </Typography>
                </>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  当前视频缺少可靠时长，只能保存旋转与翻转。
                </Typography>
              )}
            </Stack>
          ) : (
            <>
              <Stack spacing={0.5}>
                <Typography variant="body2" fontWeight={600}>裁剪</Typography>
                <Typography variant="caption" color="text.secondary">
                  左 {percent(draft.crop_x)}% · 上 {percent(draft.crop_y)}% ·
                  宽 {percent(draft.crop_width)}% · 高 {percent(draft.crop_height)}%
                </Typography>
                <Typography variant="caption">左边界</Typography>
                <Slider
                  min={0}
                  max={Math.max(0, 1 - draft.crop_width)}
                  step={0.01}
                  value={draft.crop_x}
                  onChange={(_event, value) => setDraft((current) => ({
                    ...current,
                    crop_x: Number(value),
                  }))}
                />
                <Typography variant="caption">上边界</Typography>
                <Slider
                  min={0}
                  max={Math.max(0, 1 - draft.crop_height)}
                  step={0.01}
                  value={draft.crop_y}
                  onChange={(_event, value) => setDraft((current) => ({
                    ...current,
                    crop_y: Number(value),
                  }))}
                />
                <Typography variant="caption">宽度</Typography>
                <Slider
                  min={0.05}
                  max={Math.max(0.05, 1 - draft.crop_x)}
                  step={0.01}
                  value={draft.crop_width}
                  onChange={(_event, value) => setDraft((current) => ({
                    ...current,
                    crop_width: Number(value),
                  }))}
                />
                <Typography variant="caption">高度</Typography>
                <Slider
                  min={0.05}
                  max={Math.max(0.05, 1 - draft.crop_y)}
                  step={0.01}
                  value={draft.crop_height}
                  onChange={(_event, value) => setDraft((current) => ({
                    ...current,
                    crop_height: Number(value),
                  }))}
                />
              </Stack>

              {([
                ['exposure_ev', '曝光', -2, 2, 0.1],
                ['contrast', '对比度', -1, 1, 0.05],
                ['saturation', '饱和度', -1, 1, 0.05],
              ] as const).map(([key, label, min, max, step]) => (
                <Stack key={key} spacing={0.5}>
                  <Typography variant="body2" fontWeight={600}>
                    {label} · {draft[key].toFixed(2)}
                  </Typography>
                  <Slider
                    min={min}
                    max={max}
                    step={step}
                    value={draft[key]}
                    onChange={(_event, value) => setDraft((current) => ({
                      ...current,
                      [key]: Number(value),
                    }))}
                  />
                </Stack>
              ))}
            </>
          )}

          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </XDriveDialogContent>
      <DialogActions>
        {item.edit_recipe?.revision && onReset ? (
          <Button
            color="warning"
            disabled={busy}
            onClick={() => {
              if (onReset && item.edit_recipe?.revision) {
                void runMutation(() => onReset(item, item.edit_recipe!.revision))
              }
            }}
          >
            移除已保存编辑
          </Button>
        ) : null}
        <Button
          disabled={busy}
          onClick={() => setDraft(xDriveDefaultMediaEditInput(
            item.metadata.media_kind,
            item.edit_recipe?.revision || 0,
          ))}
        >
          参数归零
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button disabled={busy} onClick={onClose}>取消</Button>
        <Button variant="contained" disabled={busy} onClick={() => void save()}>
          保存编辑
        </Button>
      </DialogActions>
    </Dialog>
  )
}

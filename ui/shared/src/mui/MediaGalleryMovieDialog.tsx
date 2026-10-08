import { useEffect, useMemo, useRef, useState } from 'react'
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import MovieCreationOutlinedIcon from '@mui/icons-material/MovieCreationOutlined'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type {
  MediaCreativeGeneration,
  MediaCreativeInput,
  MediaItem,
} from '../models'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'
import {
  XDriveMediaAsyncThumbnail,
} from './MediaGalleryPreviewMedia'

const terminalMovieStates = new Set(['completed', 'failed', 'cancelled'])

function movieStatusLabel(generation: MediaCreativeGeneration | null) {
  switch (generation?.state) {
    case 'queued': return '等待生成'
    case 'running': return '正在生成'
    case 'completed': return '已完成'
    case 'failed': return '生成失败'
    case 'cancelled': return '已取消'
    default: return ''
  }
}

export function xDriveMediaItemSupportsAutoMovie(item: MediaItem) {
  return item.asset_kind === 'image' &&
    item.metadata.media_kind === 'image' &&
    item.metadata.index_state === 'ready' &&
    !item.live_photo
}

export function XDriveMediaGalleryMovieDialog({
  open,
  items,
  loadThumbnail,
  loadPreviewURL,
  onCreate,
  onGet,
  onCancel,
  onCompleted,
  onClose,
}: {
  open: boolean
  items: MediaItem[]
  loadThumbnail: (nodeID: number) => Promise<string | null>
  loadPreviewURL?: (
    nodeID: number,
    kind: 'image' | 'video',
  ) => Promise<string | null>
  onCreate?: (
    item: MediaItem,
    input: MediaCreativeInput,
  ) => Promise<MediaCreativeGeneration>
  onGet?: (generationID: string) => Promise<MediaCreativeGeneration>
  onCancel?: (generationID: string) => Promise<MediaCreativeGeneration>
  onCompleted?: (generation: MediaCreativeGeneration) => void
  onClose: () => void
}) {
  const completedRef = useRef('')
  const movieActionGenerationRef = useRef(0)
  const [orderedItems, setOrderedItems] = useState<MediaItem[]>([])
  const [frameDurationMS, setFrameDurationMS] = useState(2000)
  const [transitionMS, setTransitionMS] = useState(350)
  const [outputName, setOutputName] = useState('')
  const [generation, setGeneration] = useState<MediaCreativeGeneration | null>(null)
  const [resultURL, setResultURL] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    movieActionGenerationRef.current += 1
    setBusy(false)
    if (!open) return
    setOrderedItems(items.slice(0, 30))
    setFrameDurationMS(2000)
    setTransitionMS(350)
    setOutputName('')
    setGeneration(null)
    setResultURL('')
    setError('')
    completedRef.current = ''
  }, [items, open])

  const generating = generation?.state === 'queued' || generation?.state === 'running'
  const allSupported = orderedItems.length >= 2 &&
    orderedItems.length <= 30 &&
    orderedItems.every(xDriveMediaItemSupportsAutoMovie)
  const durationSeconds = useMemo(() => {
    if (!orderedItems.length) return 0
    const raw = orderedItems.length * frameDurationMS -
      Math.max(0, orderedItems.length - 1) * transitionMS
    return Math.max(0, raw) / 1000
  }, [frameDurationMS, orderedItems.length, transitionMS])

  useEffect(() => {
    if (!open || !generation || !onGet || terminalMovieStates.has(generation.state)) {
      return
    }
    let disposed = false
    let timer = 0
    const generationID = generation.id
    const poll = () => {
      timer = window.setTimeout(() => {
        void onGet(generationID)
          .then((next) => {
            if (disposed) return
            setGeneration(next)
            if (!terminalMovieStates.has(next.state)) poll()
          })
          .catch((pollError) => {
            if (disposed) return
            setError(
              pollError instanceof Error
                ? pollError.message
                : '无法读取自动电影任务状态',
            )
          })
      }, 800)
    }
    poll()
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [generation?.id, generation?.state, onGet, open])

  useEffect(() => {
    if (
      !open ||
      generation?.state !== 'completed' ||
      !generation.output_node_id ||
      !loadPreviewURL
    ) return
    const key = `${generation.id}:${generation.output_node_id}`
    if (completedRef.current === key) return
    completedRef.current = key
    onCompleted?.(generation)
    let disposed = false
    void loadPreviewURL(generation.output_node_id, 'video')
      .then((url) => {
        if (!disposed) setResultURL(url || '')
      })
      .catch(() => undefined)
    return () => {
      disposed = true
    }
  }, [
    generation?.id,
    generation?.output_node_id,
    generation?.state,
    loadPreviewURL,
    onCompleted,
    open,
  ])

  const move = (index: number, delta: -1 | 1) => {
    setOrderedItems((current) => {
      const target = index + delta
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const createMovie = async () => {
    if (!onCreate || !allSupported || generating || orderedItems.length < 2) return
    const actionGeneration = movieActionGenerationRef.current
    const isCurrent = () => actionGeneration === movieActionGenerationRef.current
    setBusy(true)
    setError('')
    setResultURL('')
    try {
      const input: MediaCreativeInput = {
        kind: 'movie',
        output_name: outputName.trim() || undefined,
        source_node_ids: orderedItems.map((item) => item.node.id),
        frame_duration_ms: frameDurationMS,
        transition_ms: transitionMS,
      }
      const next = await onCreate(orderedItems[0], input)
      if (isCurrent()) setGeneration(next)
    } catch (createError) {
      if (!isCurrent()) return
      setError(
        createError instanceof Error
          ? createError.message
          : '创建自动电影任务失败',
      )
    } finally {
      if (isCurrent()) setBusy(false)
    }
  }

  const cancelMovie = async () => {
    if (!generation || !onCancel || !generating) return
    const actionGeneration = movieActionGenerationRef.current
    const isCurrent = () => actionGeneration === movieActionGenerationRef.current
    setBusy(true)
    setError('')
    try {
      const next = await onCancel(generation.id)
      if (isCurrent()) setGeneration(next)
    } catch (cancelError) {
      if (!isCurrent()) return
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : '取消自动电影失败',
      )
    } finally {
      if (isCurrent()) setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      maxWidth="md"
      fullWidth
      slotProps={{ paper: xDriveDialogPaperProps }}
      data-xdrive-gallery-movie-dialog
    >
      <XDriveDialogTitle
        title="自动电影"
        subtitle="将 2–30 张普通照片按顺序生成本地 1080p MP4；原图不会被修改。"
        onClose={() => !busy && onClose()}
      />
      <XDriveDialogContent dividers>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {generation ? (
            <Alert
              severity={
                generation.state === 'failed'
                  ? 'error'
                  : generation.state === 'completed'
                    ? 'success'
                    : generation.state === 'cancelled'
                      ? 'info'
                      : 'warning'
              }
            >
              {movieStatusLabel(generation)}
              {generation.last_error ? `：${generation.last_error}` : ''}
            </Alert>
          ) : null}

          {!allSupported ? (
            <Alert severity="warning">
              自动电影首版只支持 2–30 张普通、已就绪的图片；Live Photo、RAW、Burst 和视频暂不参与。
            </Alert>
          ) : null}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              select
              size="small"
              label="每张时长"
              value={frameDurationMS}
              disabled={generating || busy}
              onChange={(event) => setFrameDurationMS(Number(event.target.value))}
              sx={{ minWidth: 150 }}
            >
              {[1000, 1500, 2000, 3000, 5000].map((value) => (
                <MenuItem key={value} value={value}>{value / 1000} 秒</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="淡化过渡"
              value={transitionMS}
              disabled={generating || busy}
              onChange={(event) => setTransitionMS(Number(event.target.value))}
              sx={{ minWidth: 150 }}
            >
              {[0, 200, 350, 500, 750, 1000]
                .filter((value) => value < frameDurationMS)
                .map((value) => (
                  <MenuItem key={value} value={value}>
                    {value === 0 ? '无' : `${value / 1000} 秒`}
                  </MenuItem>
                ))}
            </TextField>
            <TextField
              size="small"
              label="输出文件名"
              placeholder="例如：旅行回忆.mp4"
              value={outputName}
              disabled={generating || busy}
              onChange={(event) => setOutputName(event.target.value)}
              sx={{ flex: 1, minWidth: 220 }}
            />
          </Stack>

          <Typography variant="caption" color="text.secondary">
            预计时长约 {durationSeconds.toFixed(1)} 秒 · 无自动配乐 · 本地 FFmpeg 编码
          </Typography>

          <Stack spacing={1}>
            {orderedItems.map((item, index) => (
              <Paper key={item.node.id} variant="outlined" sx={{ p: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box sx={{ width: 64, height: 48, overflow: 'hidden', flexShrink: 0 }}>
                    <XDriveMediaAsyncThumbnail
                      nodeID={item.node.id}
                      alt={item.node.name}
                      loadThumbnail={loadThumbnail}
                      fallback={(
                        <Box
                          sx={{
                            width: '100%',
                            height: '100%',
                            display: 'grid',
                            placeItems: 'center',
                            bgcolor: 'action.hover',
                          }}
                        >
                          <MovieCreationOutlinedIcon fontSize="small" />
                        </Box>
                      )}
                    />
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {index + 1}. {item.node.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {item.metadata.width || '—'} × {item.metadata.height || '—'}
                    </Typography>
                  </Box>
                  <IconButton
                    size="small"
                    aria-label="上移"
                    disabled={generating || busy || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUpwardRoundedIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    aria-label="下移"
                    disabled={generating || busy || index === orderedItems.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDownwardRoundedIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Paper>
            ))}
          </Stack>

          {resultURL ? (
            <Box
              component="video"
              src={resultURL}
              controls
              preload="metadata"
              sx={{ width: '100%', maxHeight: 420, bgcolor: 'black', borderRadius: 1 }}
            />
          ) : null}
        </Stack>
      </XDriveDialogContent>
      <DialogActions>
        {generating && onCancel ? (
          <Button color="error" disabled={busy} onClick={() => void cancelMovie()}>
            取消任务
          </Button>
        ) : null}
        <Button disabled={busy} onClick={onClose}>关闭</Button>
        <Button
          variant="contained"
          startIcon={<MovieCreationOutlinedIcon />}
          disabled={!allSupported || generating || busy || !onCreate}
          onClick={() => void createMovie()}
        >
          {generation?.state === 'completed' ? '重新生成' : '生成电影'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

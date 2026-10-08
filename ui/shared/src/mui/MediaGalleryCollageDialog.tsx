import { useEffect, useRef, useState } from 'react'
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  IconButton,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import type { MediaCreativeGeneration, MediaCreativeInput, MediaItem } from '../models'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'
import { XDriveMediaAsyncThumbnail } from './MediaGalleryPreviewMedia'

const terminalCollageStates = new Set(['completed', 'failed', 'cancelled'])
const collageTemplates = [
  { value: 'grid', label: '网格', hint: '均衡排列' },
  { value: 'featured', label: '主图', hint: '第一张突出显示' },
  { value: 'columns', label: '竖排', hint: '等宽竖向切分' },
  { value: 'rows', label: '横排', hint: '等高横向切分' },
] as const
type CollageTemplate = typeof collageTemplates[number]['value']

function collageStatusLabel(generation: MediaCreativeGeneration | null) {
  switch (generation?.state) {
    case 'queued': return '等待生成'
    case 'running': return '正在生成'
    case 'completed': return '已完成'
    case 'failed': return '生成失败'
    case 'cancelled': return '已取消'
    default: return ''
  }
}

export function xDriveMediaItemSupportsCollage(item: MediaItem) {
  return item.asset_kind === 'image' &&
    item.metadata.media_kind === 'image' &&
    item.metadata.index_state === 'ready' &&
    !item.live_photo
}

export function XDriveMediaGalleryCollageDialog({
  open, items, loadThumbnail, loadPreviewURL, onCreate, onGet, onCancel, onCompleted, onClose,
}: {
  open: boolean
  items: MediaItem[]
  loadThumbnail: (nodeID: number) => Promise<string | null>
  loadPreviewURL?: (nodeID: number, kind: 'image' | 'video') => Promise<string | null>
  onCreate?: (item: MediaItem, input: MediaCreativeInput) => Promise<MediaCreativeGeneration>
  onGet?: (generationID: string) => Promise<MediaCreativeGeneration>
  onCancel?: (generationID: string) => Promise<MediaCreativeGeneration>
  onCompleted?: (generation: MediaCreativeGeneration) => void
  onClose: () => void
}) {
  const completedRef = useRef('')
  const collageActionGenerationRef = useRef(0)
  const [orderedItems, setOrderedItems] = useState<MediaItem[]>([])
  const [template, setTemplate] = useState<CollageTemplate>('grid')
  const [outputName, setOutputName] = useState('')
  const [generation, setGeneration] = useState<MediaCreativeGeneration | null>(null)
  const [resultURL, setResultURL] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    collageActionGenerationRef.current += 1
    setBusy(false)
    if (!open) return
    setOrderedItems(items.slice(0, 9))
    setTemplate('grid')
    setOutputName('')
    setGeneration(null)
    setResultURL('')
    setError('')
    completedRef.current = ''
  }, [items, open])

  const generating = generation?.state === 'queued' || generation?.state === 'running'
  const allSupported = orderedItems.length >= 2 &&
    orderedItems.length <= 9 &&
    orderedItems.every(xDriveMediaItemSupportsCollage)

  useEffect(() => {
    if (!open || !generation || !onGet || terminalCollageStates.has(generation.state)) return
    let disposed = false
    let timer = 0
    const generationID = generation.id
    const poll = () => {
      timer = window.setTimeout(() => {
        void onGet(generationID).then((next) => {
          if (disposed) return
          setGeneration(next)
          if (!terminalCollageStates.has(next.state)) poll()
        }).catch((pollError) => {
          if (!disposed) {
            setError(pollError instanceof Error ? pollError.message : '无法读取拼图任务状态')
          }
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
    if (!open || generation?.state !== 'completed' ||
      !generation.output_node_id || !loadPreviewURL) return
    const key = `${generation.id}:${generation.output_node_id}`
    if (completedRef.current === key) return
    completedRef.current = key
    onCompleted?.(generation)
    let disposed = false
    void loadPreviewURL(generation.output_node_id, 'image').then((url) => {
      if (!disposed) setResultURL(url || '')
    }).catch(() => undefined)
    return () => { disposed = true }
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

  const createCollage = async () => {
    if (!onCreate || !allSupported || generating) return
    const actionGeneration = collageActionGenerationRef.current
    const isCurrent = () => actionGeneration === collageActionGenerationRef.current
    setBusy(true)
    setError('')
    setResultURL('')
    try {
      const input: MediaCreativeInput = {
        kind: 'collage',
        output_name: outputName.trim() || undefined,
        source_node_ids: orderedItems.map((item) => item.node.id),
        collage_template: template,
      }
      const next = await onCreate(orderedItems[0], input)
      if (isCurrent()) setGeneration(next)
    } catch (createError) {
      if (!isCurrent()) return
      setError(createError instanceof Error ? createError.message : '创建拼图任务失败')
    } finally {
      if (isCurrent()) setBusy(false)
    }
  }

  const cancelCollage = async () => {
    if (!generation || !onCancel || !generating) return
    const actionGeneration = collageActionGenerationRef.current
    const isCurrent = () => actionGeneration === collageActionGenerationRef.current
    setBusy(true)
    setError('')
    try {
      const next = await onCancel(generation.id)
      if (isCurrent()) setGeneration(next)
    } catch (cancelError) {
      if (!isCurrent()) return
      setError(cancelError instanceof Error ? cancelError.message : '取消拼图失败')
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
      data-xdrive-gallery-collage-dialog
    >
      <XDriveDialogTitle
        title="拼图"
        subtitle="将 2–9 张普通照片按固定模板生成一张新的 2048×2048 JPEG；原图不会被修改。"
        onClose={() => !busy && onClose()}
      />
      <XDriveDialogContent dividers>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {generation ? (
            <Alert severity={
              generation.state === 'failed' ? 'error'
                : generation.state === 'completed' ? 'success'
                  : generation.state === 'cancelled' ? 'info' : 'warning'
            }>
              {collageStatusLabel(generation)}
              {generation.last_error ? `：${generation.last_error}` : ''}
            </Alert>
          ) : null}
          {!allSupported ? (
            <Alert severity="warning">
              拼图首版只支持 2–9 张普通、已就绪的图片；Live Photo、RAW、Burst 和视频暂不参与。
            </Alert>
          ) : null}
          <Box>
            <Typography variant="caption" color="text.secondary">布局模板</Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={template}
              disabled={generating || busy}
              onChange={(_, value: CollageTemplate | null) => { if (value) setTemplate(value) }}
              sx={{ mt: 0.75, display: 'flex', flexWrap: 'wrap' }}
            >
              {collageTemplates.map((option) => (
                <ToggleButton key={option.value} value={option.value} sx={{ flex: 1, minWidth: 120 }}>
                  <Stack spacing={0.25} alignItems="center">
                    <Typography variant="body2" fontWeight={600}>{option.label}</Typography>
                    <Typography variant="caption" color="text.secondary">{option.hint}</Typography>
                  </Stack>
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>
          <TextField
            size="small"
            label="输出文件名"
            placeholder="例如：旅行拼图.jpg"
            value={outputName}
            disabled={generating || busy}
            onChange={(event) => setOutputName(event.target.value)}
          />
          <Typography variant="caption" color="text.secondary">
            第一张照片会作为“主图”模板的重点照片 · 全部处理均在本地 Photo Intelligence 中完成
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
                        <Box sx={{
                          width: '100%', height: '100%', display: 'grid',
                          placeItems: 'center', bgcolor: 'action.hover',
                        }}>
                          <GridViewRoundedIcon fontSize="small" />
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
                  <IconButton size="small" aria-label="上移"
                    disabled={generating || busy || index === 0} onClick={() => move(index, -1)}>
                    <ArrowUpwardRoundedIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" aria-label="下移"
                    disabled={generating || busy || index === orderedItems.length - 1}
                    onClick={() => move(index, 1)}>
                    <ArrowDownwardRoundedIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Paper>
            ))}
          </Stack>
          {resultURL ? (
            <Box component="img" src={resultURL} alt="拼图结果"
              sx={{ width: '100%', maxHeight: 520, objectFit: 'contain', bgcolor: 'action.hover' }} />
          ) : null}
        </Stack>
      </XDriveDialogContent>
      <DialogActions>
        {generating && onCancel ? (
          <Button color="error" disabled={busy} onClick={() => void cancelCollage()}>取消任务</Button>
        ) : null}
        <Button disabled={busy} onClick={onClose}>关闭</Button>
        <Button variant="contained" startIcon={<GridViewRoundedIcon />}
          disabled={!allSupported || generating || busy || !onCreate}
          onClick={() => void createCollage()}>
          {generation?.state === 'completed' ? '重新生成' : '生成拼图'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

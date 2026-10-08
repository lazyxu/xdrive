import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  FormControlLabel,
  Radio,
  RadioGroup,
  Slider,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import type {
  MediaCreativeGeneration,
  MediaCreativeInput,
  MediaCreativePoint,
  MediaCreativeStroke,
  MediaCreativeStrokePoint,
  MediaItem,
} from '../models'
import type { MediaPreviewURLLoader } from './MediaGallery'
import { XDriveDialogActions } from './DialogActions'
import { XDriveDialogContent } from './DialogContent'
import {
  XDriveDialogTitle,
  xDriveDialogPaperProps,
} from './DialogTitle'

type CreativeMode = 'cutout' | 'erase'

const terminalCreativeStates = new Set(['completed', 'failed', 'cancelled'])

export function xDriveMediaItemSupportsCreative(
  item: MediaItem | null | undefined,
) {
  return Boolean(
    item &&
    item.metadata.media_kind === 'image' &&
    item.metadata.index_state === 'ready' &&
    item.asset_kind === 'image' &&
    !item.live_photo,
  )
}

function creativeStatusLabel(generation: MediaCreativeGeneration | null) {
  switch (generation?.state) {
    case 'queued': return '等待处理'
    case 'running': return '正在生成'
    case 'completed': return '已生成'
    case 'failed': return '生成失败'
    case 'cancelled': return '已取消'
    default: return ''
  }
}

function normalizedPoint(
  event: { clientX: number; clientY: number },
  element: HTMLElement,
): MediaCreativeStrokePoint | null {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  }
}

function pointDistance(
  left: MediaCreativeStrokePoint,
  right: MediaCreativeStrokePoint,
) {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

export function XDriveMediaGalleryCreativeDialog({
  open,
  item,
  loadPreviewURL,
  onCreate,
  onGet,
  onCancel,
  onCompleted,
  onClose,
}: {
  open: boolean
  item: MediaItem | null
  loadPreviewURL?: MediaPreviewURLLoader
  onCreate?: (
    item: MediaItem,
    input: MediaCreativeInput,
  ) => Promise<MediaCreativeGeneration>
  onGet?: (generationID: string) => Promise<MediaCreativeGeneration>
  onCancel?: (generationID: string) => Promise<MediaCreativeGeneration>
  onCompleted?: (generation: MediaCreativeGeneration) => void
  onClose: () => void
}) {
  const imageRef = useRef<HTMLImageElement | null>(null)
  const completedRef = useRef('')
  const creativeActionGenerationRef = useRef(0)
  const cutoutPointDragRef = useRef<number | null>(null)
  const [mode, setMode] = useState<CreativeMode>('cutout')
  const [cutoutForeground, setCutoutForeground] = useState(true)
  const [cutoutExpand, setCutoutExpand] = useState(0)
  const [cutoutFeather, setCutoutFeather] = useState(0)
  const [points, setPoints] = useState<MediaCreativePoint[]>([])
  const [strokes, setStrokes] = useState<MediaCreativeStroke[]>([])
  const [activeStroke, setActiveStroke] = useState<MediaCreativeStroke | null>(null)
  const [brushRadius, setBrushRadius] = useState(0.03)
  const [outputName, setOutputName] = useState('')
  const [sourceURL, setSourceURL] = useState('')
  const [resultURL, setResultURL] = useState('')
  const [generation, setGeneration] = useState<MediaCreativeGeneration | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const supported = xDriveMediaItemSupportsCreative(item)
  const generating = generation?.state === 'queued' || generation?.state === 'running'
  const canGenerate = Boolean(
    item &&
    onCreate &&
    supported &&
    !generating &&
    (
      mode === 'cutout'
        ? points.some((point) => point.foreground)
        : strokes.length > 0
    ),
  )

  const helper = useMemo(() => {
    if (mode === 'cutout') {
      return points.length
        ? `已标记 ${points.length} 个提示点；绿色保留，红色排除；现有提示点可直接拖动微调。`
        : '先用“保留主体”在主体上点一下；必要时用“排除区域”补充背景点，之后可拖动提示点微调。'
    }
    return strokes.length
      ? `已绘制 ${strokes.length} 条消除笔迹。`
      : '拖动鼠标或触控笔涂抹要移除的对象；本地模型会扩展目标区域并智能填充。'
  }, [mode, points.length, strokes.length])

  const resetPrompts = () => {
    setPoints([])
    setStrokes([])
    setActiveStroke(null)
    setGeneration(null)
    setResultURL('')
    setError('')
    completedRef.current = ''
  }

  useEffect(() => {
    creativeActionGenerationRef.current += 1
    cutoutPointDragRef.current = null
    setBusy(false)
    setCutoutExpand(0)
    setCutoutFeather(0)
    if (!open || !item || !supported || !loadPreviewURL) {
      setSourceURL('')
      return
    }
    let disposed = false
    setSourceURL('')
    setResultURL('')
    setError('')
    setGeneration(null)
    setPoints([])
    setStrokes([])
    setActiveStroke(null)
    completedRef.current = ''
    void loadPreviewURL(item.node.id, 'image')
      .then((url) => {
        if (!disposed) setSourceURL(url || '')
      })
      .catch((loadError) => {
        if (!disposed) {
          setError(loadError instanceof Error
            ? loadError.message
            : '无法载入创作预览')
        }
      })
    return () => {
      disposed = true
    }
  }, [item?.node.id, loadPreviewURL, open, supported])

  useEffect(() => {
    if (!open || !generation || !onGet || terminalCreativeStates.has(generation.state)) {
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
            if (!terminalCreativeStates.has(next.state)) poll()
          })
          .catch((pollError) => {
            if (disposed) return
            setError(pollError instanceof Error
              ? pollError.message
              : '无法读取创作任务状态')
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
    const completionKey = `${generation.id}:${generation.output_node_id}`
    if (completedRef.current === completionKey) return
    completedRef.current = completionKey
    onCompleted?.(generation)
    let disposed = false
    void loadPreviewURL(generation.output_node_id, 'image')
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

  useEffect(() => {
    if (open) return
    setBusy(false)
    setError('')
    setSourceURL('')
    setResultURL('')
    setGeneration(null)
    cutoutPointDragRef.current = null
    setCutoutExpand(0)
    setCutoutFeather(0)
    setPoints([])
    setStrokes([])
    setActiveStroke(null)
    setOutputName('')
    completedRef.current = ''
  }, [open])

  const addCutoutPoint = (event: ReactMouseEvent<HTMLImageElement>) => {
    if (mode !== 'cutout' || generating || !imageRef.current || points.length >= 6) return
    const point = normalizedPoint(event, imageRef.current)
    if (!point) return
    setPoints((current) => [
      ...current,
      {
        x: point.x,
        y: point.y,
        foreground: cutoutForeground,
      },
    ])
  }

  const startCutoutPointDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (mode !== 'cutout' || generating) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    cutoutPointDragRef.current = index
  }

  const moveCutoutPointDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const index = cutoutPointDragRef.current
    if (index === null || generating || !imageRef.current) return
    event.stopPropagation()
    const point = normalizedPoint(event, imageRef.current)
    if (!point) return
    setPoints((current) => current.map((value, currentIndex) => (
      currentIndex === index
        ? { ...value, x: point.x, y: point.y }
        : value
    )))
  }

  const finishCutoutPointDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (cutoutPointDragRef.current === null) return
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    cutoutPointDragRef.current = null
  }

  const startEraseStroke = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (mode !== 'erase' || generating || !imageRef.current || strokes.length >= 64) return
    const point = normalizedPoint(event, imageRef.current)
    if (!point) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setActiveStroke({ radius: brushRadius, points: [point] })
  }

  const extendEraseStroke = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (!activeStroke || !imageRef.current) return
    const point = normalizedPoint(event, imageRef.current)
    if (!point) return
    setActiveStroke((current) => {
      if (!current || current.points.length >= 256) return current
      const previous = current.points[current.points.length - 1]
      if (previous && pointDistance(previous, point) < 0.003) return current
      return { ...current, points: [...current.points, point] }
    })
  }

  const finishEraseStroke = () => {
    if (activeStroke?.points.length) {
      setStrokes((all) => all.length < 64 ? [...all, activeStroke] : all)
    }
    setActiveStroke(null)
  }

  const runGeneration = async () => {
    if (!item || !onCreate || !canGenerate) return
    const actionGeneration = creativeActionGenerationRef.current
    const isCurrent = () => actionGeneration === creativeActionGenerationRef.current
    setBusy(true)
    setError('')
    setResultURL('')
    completedRef.current = ''
    try {
      const input: MediaCreativeInput = mode === 'cutout'
        ? {
            kind: 'cutout',
            output_name: outputName.trim() || undefined,
            cutout_mode: 'object',
            cutout_expand: cutoutExpand,
            cutout_feather: cutoutFeather,
            points,
          }
        : {
            kind: 'erase',
            output_name: outputName.trim() || undefined,
            strokes,
          }
      const next = await onCreate(item, input)
      if (isCurrent()) setGeneration(next)
    } catch (generationError) {
      if (!isCurrent()) return
      setError(generationError instanceof Error
        ? generationError.message
        : '创建创作任务失败')
    } finally {
      if (isCurrent()) setBusy(false)
    }
  }

  const cancelGeneration = async () => {
    if (!generation || !onCancel || !generating) return
    const actionGeneration = creativeActionGenerationRef.current
    const isCurrent = () => actionGeneration === creativeActionGenerationRef.current
    setBusy(true)
    setError('')
    try {
      const next = await onCancel(generation.id)
      if (isCurrent()) setGeneration(next)
    } catch (cancelError) {
      if (!isCurrent()) return
      setError(cancelError instanceof Error
        ? cancelError.message
        : '取消创作任务失败')
    } finally {
      if (isCurrent()) setBusy(false)
    }
  }

  const visibleStrokes = activeStroke ? [...strokes, activeStroke] : strokes

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy && !generating) onClose()
      }}
      fullWidth
      maxWidth="lg"
      slotProps={{ paper: xDriveDialogPaperProps }}
      data-xdrive-media-creative-dialog
    >
      <XDriveDialogTitle
        title="创作"
        subtitle="本地 AI；结果保存为新文件，原图不会被修改"
        onClose={() => {
          if (!busy && !generating) onClose()
        }}
      />
      <XDriveDialogContent dividers>
        <Stack spacing={1.5}>
          <Tabs
            value={mode}
            onChange={(_event, value) => {
              if (generating) return
              setMode(value as CreativeMode)
              resetPrompts()
            }}
          >
            <Tab value="cutout" label="AI 抠图" />
            <Tab value="erase" label="智能消除" />
          </Tabs>

          {!supported ? (
            <Alert severity="info">
              当前仅支持普通图片；Live Photo、RAW、连拍组和视频暂不进入这一版创作工具。
            </Alert>
          ) : null}
          {item?.edit_recipe ? (
            <Alert severity="info">
              创作基于原始图片生成新文件，不叠加当前非破坏编辑 recipe。
            </Alert>
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
          {generation ? (
            <Alert
              severity={generation.state === 'failed'
                ? 'error'
                : generation.state === 'completed'
                  ? 'success'
                  : generation.state === 'cancelled'
                    ? 'info'
                    : 'info'}
              action={generating && onCancel ? (
                <Button
                  size="small"
                  color="inherit"
                  disabled={busy}
                  onClick={() => void cancelGeneration()}
                >
                  取消任务
                </Button>
              ) : undefined}
            >
              {creativeStatusLabel(generation)}
              {generation.last_error ? `：${generation.last_error}` : ''}
              {generation.state === 'completed'
                ? '；结果已保存到原图所在文件夹。'
                : ''}
            </Alert>
          ) : null}

          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            alignItems={{ md: 'center' }}
          >
            {mode === 'cutout' ? (
              <RadioGroup
                row
                value={cutoutForeground ? 'foreground' : 'background'}
                onChange={(event) => setCutoutForeground(
                  event.target.value === 'foreground',
                )}
              >
                <FormControlLabel
                  value="foreground"
                  control={<Radio size="small" />}
                  label="保留主体"
                  disabled={generating}
                />
                <FormControlLabel
                  value="background"
                  control={<Radio size="small" />}
                  label="排除区域"
                  disabled={generating}
                />
              </RadioGroup>
            ) : (
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 280 }}>
                <Typography variant="body2" color="text.secondary">画笔</Typography>
                <Slider
                  value={brushRadius}
                  min={0.005}
                  max={0.1}
                  step={0.005}
                  onChange={(_event, value) => setBrushRadius(value as number)}
                  disabled={generating}
                  sx={{ width: 180 }}
                />
              </Stack>
            )}
            <Button
              size="small"
              disabled={generating || (mode === 'cutout' ? points.length === 0 : strokes.length === 0)}
              onClick={resetPrompts}
            >
              清除标记
            </Button>
            {mode === 'cutout' && points.length > 0 ? (
              <Button
                size="small"
                disabled={generating}
                onClick={() => setPoints((current) => current.slice(0, -1))}
              >
                撤销上一个点
              </Button>
            ) : null}
            {mode === 'erase' && strokes.length > 0 ? (
              <Button
                size="small"
                disabled={generating}
                onClick={() => setStrokes((current) => current.slice(0, -1))}
              >
                撤销上一笔
              </Button>
            ) : null}
          </Stack>

          {mode === 'cutout' ? (
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              alignItems={{ md: 'center' }}
            >
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 300 }}>
                <Typography variant="body2" color="text.secondary" sx={{ minWidth: 72 }}>
                  边缘调整
                </Typography>
                <Slider
                  value={cutoutExpand}
                  min={-0.02}
                  max={0.02}
                  step={0.002}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(value) => `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%`}
                  onChange={(_event, value) => setCutoutExpand(value as number)}
                  disabled={generating}
                  sx={{ width: 180 }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 46 }}>
                  {cutoutExpand === 0
                    ? '0%'
                    : `${cutoutExpand > 0 ? '+' : ''}${(cutoutExpand * 100).toFixed(1)}%`}
                </Typography>
              </Stack>
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 280 }}>
                <Typography variant="body2" color="text.secondary" sx={{ minWidth: 48 }}>
                  羽化
                </Typography>
                <Slider
                  value={cutoutFeather}
                  min={0}
                  max={0.02}
                  step={0.002}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(value) => `${(value * 100).toFixed(1)}%`}
                  onChange={(_event, value) => setCutoutFeather(value as number)}
                  disabled={generating}
                  sx={{ width: 180 }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 40 }}>
                  {(cutoutFeather * 100).toFixed(1)}%
                </Typography>
              </Stack>
            </Stack>
          ) : null}

          {mode === 'cutout' ? (
            <Typography variant="caption" color="text.secondary">
              边缘调整：负值收缩，正值扩展；百分比按图片短边计算。
            </Typography>
          ) : null}

          <Typography variant="body2" color="text.secondary">
            {helper}
          </Typography>

          <Box
            sx={{
              minHeight: 360,
              maxHeight: '66vh',
              p: 1,
              display: 'grid',
              placeItems: 'center',
              overflow: 'auto',
              bgcolor: 'action.hover',
              backgroundImage: resultURL
                ? 'linear-gradient(45deg, rgba(0,0,0,.08) 25%, transparent 25%), linear-gradient(-45deg, rgba(0,0,0,.08) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(0,0,0,.08) 75%), linear-gradient(-45deg, transparent 75%, rgba(0,0,0,.08) 75%)'
                : undefined,
              backgroundSize: resultURL ? '24px 24px' : undefined,
              backgroundPosition: resultURL
                ? '0 0, 0 12px, 12px -12px, -12px 0px'
                : undefined,
            }}
          >
            {resultURL ? (
              <Box
                component="img"
                src={resultURL}
                alt="创作结果"
                sx={{
                  display: 'block',
                  maxWidth: '100%',
                  maxHeight: '62vh',
                  objectFit: 'contain',
                }}
              />
            ) : sourceURL ? (
              <Box sx={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
                <Box
                  ref={imageRef}
                  component="img"
                  src={sourceURL}
                  alt={item?.node.name || '原始图片'}
                  onClick={mode === 'cutout' ? addCutoutPoint : undefined}
                  onPointerDown={mode === 'erase' ? startEraseStroke : undefined}
                  onPointerMove={mode === 'erase' ? extendEraseStroke : undefined}
                  onPointerUp={mode === 'erase' ? finishEraseStroke : undefined}
                  onPointerCancel={mode === 'erase' ? finishEraseStroke : undefined}
                  sx={{
                    display: 'block',
                    maxWidth: '100%',
                    maxHeight: '62vh',
                    objectFit: 'contain',
                    cursor: generating
                      ? 'wait'
                      : mode === 'cutout'
                        ? 'crosshair'
                        : 'none',
                    touchAction: mode === 'erase' ? 'none' : 'auto',
                    userSelect: 'none',
                  }}
                />
                {mode === 'cutout' ? points.map((point, index) => (
                  <Box
                    component="button"
                    type="button"
                    key={`${index}:${point.foreground}`}
                    aria-label={point.foreground ? '拖动保留主体提示点' : '拖动排除区域提示点'}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => startCutoutPointDrag(event, index)}
                    onPointerMove={moveCutoutPointDrag}
                    onPointerUp={finishCutoutPointDrag}
                    onPointerCancel={finishCutoutPointDrag}
                    sx={{
                      position: 'absolute',
                      left: `${point.x * 100}%`,
                      top: `${point.y * 100}%`,
                      width: 18,
                      height: 18,
                      p: 0,
                      borderRadius: '50%',
                      bgcolor: point.foreground ? 'success.main' : 'error.main',
                      border: '2px solid white',
                      boxShadow: 1,
                      transform: 'translate(-50%, -50%)',
                      cursor: generating ? 'wait' : 'grab',
                      touchAction: 'none',
                    }}
                  />
                )) : null}
                {mode === 'erase' && visibleStrokes.length > 0 ? (
                  <Box
                    component="svg"
                    viewBox="0 0 1 1"
                    preserveAspectRatio="none"
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      pointerEvents: 'none',
                    }}
                  >
                    {visibleStrokes.map((stroke, index) => (
                      <polyline
                        key={index}
                        points={stroke.points.map((point) => `${point.x},${point.y}`).join(' ')}
                        fill="none"
                        stroke="rgba(244,67,54,.72)"
                        strokeWidth={Math.max(0.004, stroke.radius * 2)}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ))}
                  </Box>
                ) : null}
                {generating ? (
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      display: 'grid',
                      placeItems: 'center',
                      bgcolor: 'rgba(0,0,0,.26)',
                    }}
                  >
                    <Stack spacing={1} alignItems="center">
                      <CircularProgress size={34} />
                      <Chip
                        size="small"
                        label={creativeStatusLabel(generation)}
                        sx={{ bgcolor: 'background.paper' }}
                      />
                    </Stack>
                  </Box>
                ) : null}
              </Box>
            ) : supported ? (
              <CircularProgress size={28} />
            ) : null}
          </Box>

          <TextField
            size="small"
            label="输出文件名（可选）"
            value={outputName}
            disabled={generating}
            onChange={(event) => setOutputName(event.target.value)}
            placeholder={mode === 'cutout' ? '例如：主体-cutout.png' : '例如：照片-erase.jpg'}
          />
          <Typography variant="caption" color="text.secondary">
            Creative Tools 使用最长边 2048px 的本地工作预览；生成结果是新的 canonical 文件。
            任务进度和取消状态同时出现在任务中心。
          </Typography>
        </Stack>
      </XDriveDialogContent>
      <XDriveDialogActions>
        {generation?.state === 'completed' ? (
          <Button disabled={busy} onClick={resetPrompts}>
            再创作一次
          </Button>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <Button
          disabled={busy || generating}
          onClick={onClose}
        >
          关闭
        </Button>
        <Button
          variant="contained"
          disabled={!canGenerate || busy}
          onClick={() => void runGeneration()}
        >
          {mode === 'cutout' ? '生成抠图' : '智能消除'}
        </Button>
      </XDriveDialogActions>
    </Dialog>
  )
}

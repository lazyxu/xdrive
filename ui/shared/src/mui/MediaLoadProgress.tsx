import { Box, CircularProgress, Typography } from '@mui/material'

export type XDriveMediaLoadStage =
  | 'transfer'
  | 'decode'
  | 'buffering'
  | 'poster_lookup'
  | 'video_read'
  | 'poster_capture'

export type XDriveMediaByteProgress = {
  loadedBytes?: number
  totalBytes?: number
}

function byteAmount(value: number, unit: number, decimals: number) {
  return (value / unit).toFixed(decimals)
}

/** Display actual transferred bytes only, never an inferred original-file size. */
export function xDriveMediaByteProgressLabel(loadedBytes: number, totalBytes?: number): string {
  const loaded = Number.isFinite(loadedBytes) ? Math.max(0, loadedBytes) : 0
  const total = totalBytes !== undefined && Number.isFinite(totalBytes) && totalBytes > 0
    ? totalBytes : undefined
  const scale = Math.max(loaded, total ?? 0) >= 1_000_000 ? 1_000_000 : 1_000
  const unit = scale === 1_000_000 ? 'MB' : 'KB'
  const decimals = scale === 1_000_000 ? 1 : 0
  const numerator = byteAmount(loaded, scale, decimals)
  return total === undefined
    ? `${numerator} ${unit}`
    : `${numerator} / ${byteAmount(total, scale, decimals)} ${unit}`
}

function clock(seconds: number) {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const minutes = Math.floor(s / 60)
  return `${String(minutes).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Native media exposes buffered time intervals, not trustworthy whole-file bytes. */
export function xDriveMediaBufferProgressLabel(bufferedSeconds: number, durationSeconds?: number) {
  if (durationSeconds === undefined || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return `已缓冲 ${clock(bufferedSeconds)}`
  }
  return `已缓冲 ${clock(bufferedSeconds)} / ${clock(durationSeconds)}`
}

export function XDriveMediaLoadingProgress({
  stage = 'transfer',
  loadedBytes = 0,
  totalBytes,
  bufferedSeconds = 0,
  durationSeconds,
  compact = false,
}: XDriveMediaByteProgress & {
  stage?: XDriveMediaLoadStage
  bufferedSeconds?: number
  durationSeconds?: number
  compact?: boolean
}) {
  const measured = stage === 'transfer' && totalBytes !== undefined &&
    Number.isFinite(totalBytes) && totalBytes > 0
  const percent = measured ? Math.max(0, Math.min(100, (loadedBytes / totalBytes!) * 100)) : 0
  const label = stage === 'transfer'
    ? loadedBytes > 0 || measured ? xDriveMediaByteProgressLabel(loadedBytes, totalBytes) : '正在加载…'
    : stage === 'decode' ? '正在解码…'
      : stage === 'buffering' ? xDriveMediaBufferProgressLabel(bufferedSeconds, durationSeconds)
        : stage === 'poster_lookup' ? '正在读取封面…'
          : stage === 'video_read' ? '正在读取视频…' : '正在生成封面…'
  return (
    <Box
      data-xdrive-media-loading-progress
      data-xdrive-media-loading-stage={stage}
      role="status"
      aria-label={label}
      sx={{
        position: 'absolute', inset: 0, display: 'flex',
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: compact ? 0.25 : 0.75, minWidth: 0, pointerEvents: 'none',
      }}
    >
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: compact ? 0.5 : 1,
        borderRadius: 1, px: compact ? 0.5 : 1.25, py: compact ? 0.25 : 1,
        bgcolor: 'rgba(0, 0, 0, 0.58)', color: 'common.white',
        backdropFilter: 'blur(6px)', maxWidth: '100%',
      }}>
        <CircularProgress
          size={compact ? 14 : 28}
          color="inherit"
          variant={measured ? 'determinate' : 'indeterminate'}
          value={measured ? percent : undefined}
          aria-hidden
        />
        <Typography variant="caption" sx={{
          color: 'inherit', fontSize: compact ? 9 : undefined,
          fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{label}</Typography>
      </Box>
    </Box>
  )
}

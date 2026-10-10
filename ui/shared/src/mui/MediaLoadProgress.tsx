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

/** The transferred HTTP body, not the original asset size, owns the pie. */
export function xDriveMediaPiePercent(loadedBytes: number, totalBytes?: number): number | null {
  if (!Number.isFinite(loadedBytes) || totalBytes === undefined ||
    !Number.isFinite(totalBytes) || totalBytes <= 0) return null
  return Math.max(0, Math.min(100, (Math.max(0, loadedBytes) / totalBytes) * 100))
}

function clock(seconds: number) {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const minutes = Math.floor(s / 60)
  return `${String(minutes).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Native media exposes buffered time intervals, not trustworthy whole-file bytes. */
export function xDriveMediaBufferProgressLabel(
  bufferedSeconds: number,
  durationSeconds?: number,
  bufferedStartSeconds?: number,
) {
  const range = bufferedStartSeconds !== undefined && Number.isFinite(bufferedStartSeconds) &&
    bufferedStartSeconds > 0 && bufferedSeconds > bufferedStartSeconds
    ? `缓冲 ${clock(bufferedStartSeconds)}–${clock(bufferedSeconds)}`
    : `已缓冲 ${clock(bufferedSeconds)}`
  return durationSeconds !== undefined && Number.isFinite(durationSeconds) && durationSeconds > 0
    ? `${range} / ${clock(durationSeconds)}` : range
}

export function XDriveMediaLoadingProgress({
  stage = 'transfer',
  loadedBytes = 0,
  totalBytes,
  bufferedSeconds = 0,
  bufferedStartSeconds,
  durationSeconds,
  compact = false,
}: XDriveMediaByteProgress & {
  stage?: XDriveMediaLoadStage
  bufferedSeconds?: number
  bufferedStartSeconds?: number
  durationSeconds?: number
  compact?: boolean
}) {
  const measuredPercent = stage === 'transfer'
    ? xDriveMediaPiePercent(loadedBytes, totalBytes) : null
  const measured = measuredPercent !== null
  const percent = measuredPercent ?? 0
  const label = stage === 'transfer'
    ? loadedBytes > 0 || measured ? xDriveMediaByteProgressLabel(loadedBytes, totalBytes) : '正在加载…'
    : stage === 'decode' ? '正在解码…'
      : stage === 'buffering' ? xDriveMediaBufferProgressLabel(bufferedSeconds, durationSeconds, bufferedStartSeconds)
        : stage === 'poster_lookup' ? '正在读取封面…'
          : stage === 'video_read' ? '正在读取视频…' : '正在生成封面…'
  if (compact) {
    // Paint the entire visible thumbnail placeholder, not a small circular ring.
    // The hosting thumbnail is clipped to its own shape; there is no second
    // ongoing animation for each item in a large virtualized photo wall.
    return (
      <Box
        data-xdrive-media-loading-progress
        data-xdrive-media-loading-stage={stage}
        data-xdrive-media-loading-style={measured ? 'solid-pie' : 'indeterminate'}
        data-xdrive-media-loading-percent={measured ? Math.round(percent) : undefined}
        role="status"
        aria-label={measured ? `已下载 ${Math.round(percent)}%，${label}` : label}
        sx={{
          position: 'absolute', inset: 0, minWidth: 0,
          display: 'grid', placeItems: 'center',
          overflow: 'hidden', borderRadius: 'inherit',
          pointerEvents: 'none',
          animation: 'xdriveMediaPieReveal 120ms ease-out 160ms backwards',
          '@keyframes xdriveMediaPieReveal': {
            from: { opacity: 0 },
            to: { opacity: 1 },
          },
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      >
        <Box
          data-xdrive-media-solid-pie
          data-xdrive-media-progress-coverage="full-surface"
          aria-hidden
          sx={{
            position: 'absolute', inset: 0, borderRadius: 'inherit',
            // conic-gradient has no hole: the downloaded sector reaches every
            // edge of the nontransparent thumbnail placeholder, even in a
            // rectangular FileExplorer cell. Parent clipping preserves corners.
            background: measured
              ? `conic-gradient(from -90deg at 50% 50%, rgba(10, 132, 255, 0.86) 0% ${percent}%, rgba(24, 30, 44, 0.42) ${percent}% 100%)`
              : 'rgba(24, 30, 44, 0.08)',
          }}
        />
        {measured ? (
          <Typography
            aria-hidden
            sx={{
              position: 'relative',
              color: 'common.white',
              fontSize: 10, lineHeight: 1.1, fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              borderRadius: 0.75,
              px: 0.5, py: 0.25,
              bgcolor: 'rgba(0, 0, 0, 0.4)',
              textShadow: '0 1px 2px rgba(0, 0, 0, 0.55)',
            }}
          >{Math.round(percent)}%</Typography>
        ) : null}
      </Box>
    )
  }
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

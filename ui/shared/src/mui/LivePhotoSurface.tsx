import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'
import { PlayCircleOutline as LivePhotoIcon } from '@mui/icons-material'
import { Box, Chip, CircularProgress, Typography } from '@mui/material'

export type XDriveLivePhotoMotionLoader = () => Promise<string | null | undefined>

export type XDriveLivePhotoSurfaceProps = {
  still: ReactNode
  loadMotion?: XDriveLivePhotoMotionLoader
  label?: string
}

function revokeMotionURL(value: string) {
  if (value.startsWith('blob:')) URL.revokeObjectURL(value)
}

export function XDriveLivePhotoSurface({
  still,
  loadMotion,
  label = '实况照片',
}: XDriveLivePhotoSurfaceProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [motionURL, setMotionURL] = useState('')
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [playing, setPlaying] = useState(false)

  const stopPlayback = useCallback(() => {
    const video = videoRef.current
    if (video) {
      video.pause()
      try {
        video.currentTime = 0
      } catch {
        // Some runtimes reject seeks before metadata is available.
      }
    }
    setPlaying(false)
  }, [])

  const startPlayback = useCallback(() => {
    if (!motionURL || failed) return
    const video = videoRef.current
    if (!video) return

    video.pause()
    try {
      video.currentTime = 0
    } catch {
      // The subsequent play() call will begin once enough metadata is available.
    }
    video.volume = 1
    setPlaying(true)
    void video.play().catch(() => {
      setPlaying(false)
      setFailed(true)
    })
  }, [failed, motionURL])

  useEffect(() => {
    let active = true
    let resolved = ''
    stopPlayback()
    setMotionURL('')
    setFailed(false)
    setLoading(Boolean(loadMotion))

    if (!loadMotion) return () => undefined

    void loadMotion()
      .then((value) => {
        if (!value) {
          if (active) setFailed(true)
          return
        }
        resolved = value
        if (active) setMotionURL(value)
        else revokeMotionURL(value)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
      if (resolved) revokeMotionURL(resolved)
    }
  }, [loadMotion, stopPlayback])

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best-effort; release handlers still stop playback.
    }
    startPlayback()
  }, [startPlayback])

  const handlePointerRelease = useCallback((event: PointerEvent<HTMLDivElement>) => {
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      // Ignore runtimes that have already released the pointer.
    }
    stopPlayback()
  }, [stopPlayback])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
      event.preventDefault()
      startPlayback()
    }
  }, [startPlayback])

  const handleKeyUp = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      stopPlayback()
    }
  }, [stopPlayback])

  const statusLabel = failed
    ? '实况不可用'
    : loading
      ? '实况加载中'
      : playing
        ? '实况播放中'
        : '实况'

  return (
    <Box
      role="button"
      tabIndex={0}
      aria-label={`${label}。按住播放，松开停止。`}
      aria-pressed={playing}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerRelease}
      onPointerCancel={handlePointerRelease}
      onPointerLeave={stopPlayback}
      onLostPointerCapture={stopPlayback}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onBlur={stopPlayback}
      onContextMenu={(event) => event.preventDefault()}
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        bgcolor: 'black',
        cursor: motionURL && !failed ? 'pointer' : 'default',
        userSelect: 'none',
        touchAction: 'pan-y pinch-zoom',
        outline: 'none',
        '&:focus-visible': {
          boxShadow: (theme) => `inset 0 0 0 2px ${theme.palette.primary.main}`,
        },
        '& img': {
          objectFit: 'contain !important',
          pointerEvents: 'none',
          userSelect: 'none',
        },
      }}
    >
      <Box sx={{ position: 'absolute', inset: 0 }}>
        {still}
      </Box>

      {motionURL ? (
        <Box
          ref={videoRef}
          component="video"
          src={motionURL}
          controls={false}
          playsInline
          preload="auto"
          disablePictureInPicture
          onEnded={stopPlayback}
          onError={() => {
            setPlaying(false)
            setFailed(true)
          }}
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            display: 'block',
            objectFit: 'contain',
            bgcolor: 'black',
            opacity: playing ? 1 : 0,
            transition: 'opacity 120ms ease',
            pointerEvents: 'none',
          }}
        />
      ) : null}

      <Chip
        size="small"
        icon={loading ? <CircularProgress size={14} /> : <LivePhotoIcon fontSize="small" />}
        label={statusLabel}
        sx={{
          position: 'absolute',
          top: 10,
          left: 10,
          pointerEvents: 'none',
          bgcolor: 'rgba(0, 0, 0, 0.56)',
          color: 'common.white',
          backdropFilter: 'blur(8px)',
          '& .MuiChip-icon': { color: 'inherit' },
        }}
      />

      {!loading && !failed && motionURL && !playing ? (
        <Typography
          variant="caption"
          sx={{
            position: 'absolute',
            left: '50%',
            bottom: 12,
            transform: 'translateX(-50%)',
            px: 1.25,
            py: 0.5,
            borderRadius: 999,
            bgcolor: 'rgba(0, 0, 0, 0.56)',
            color: 'common.white',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            backdropFilter: 'blur(8px)',
          }}
        >
          按住播放
        </Typography>
      ) : null}
    </Box>
  )
}

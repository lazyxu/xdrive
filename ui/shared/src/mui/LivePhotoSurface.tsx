import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'
import { PlayCircleOutline as LivePhotoIcon } from '@mui/icons-material'
import { Box, Chip, CircularProgress, Typography } from '@mui/material'
import type { XDriveByteProgressHandler } from '../file-preview'

export type XDriveLivePhotoMotionLoader = (
  onProgress?: XDriveByteProgressHandler,
) => Promise<string | null | undefined>

export type XDriveLivePhotoSurfaceProps = {
  still: ReactNode
  loadMotion?: XDriveLivePhotoMotionLoader
  label?: string
}

function revokeMotionURL(value: string) {
  if (value.startsWith('blob:')) URL.revokeObjectURL(value)
}

function livePhotoProgressPercent(loadedBytes: number, totalBytes?: number) {
  if (!totalBytes || totalBytes <= 0) return null
  return Math.max(0, Math.min(100, (loadedBytes / totalBytes) * 100))
}

export function XDriveLivePhotoSurface({
  still,
  loadMotion,
  label = '实况照片',
}: XDriveLivePhotoSurfaceProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const motionURLRef = useRef('')
  const loadGenerationRef = useRef(0)
  const loadStartedRef = useRef(false)
  const holdActiveRef = useRef(false)
  const [motionURL, setMotionURL] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadProgress, setLoadProgress] = useState<number | null>(null)
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

  const playLoadedMotion = useCallback(() => {
    if (!motionURLRef.current || failed) return
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
  }, [failed])

  const requestMotion = useCallback(() => {
    if (
      !loadMotion ||
      loadStartedRef.current ||
      motionURLRef.current ||
      failed
    ) return

    loadStartedRef.current = true
    const generation = loadGenerationRef.current
    setLoading(true)
    setLoadProgress(null)

    const onProgress: XDriveByteProgressHandler = (loadedBytes, totalBytes) => {
      if (loadGenerationRef.current !== generation) return
      setLoadProgress(livePhotoProgressPercent(loadedBytes, totalBytes))
    }

    void loadMotion(onProgress)
      .then((value) => {
        if (!value) {
          if (loadGenerationRef.current === generation) setFailed(true)
          return
        }
        if (loadGenerationRef.current !== generation) {
          revokeMotionURL(value)
          return
        }
        motionURLRef.current = value
        setLoadProgress(100)
        setMotionURL(value)
      })
      .catch(() => {
        if (loadGenerationRef.current === generation) setFailed(true)
      })
      .finally(() => {
        if (loadGenerationRef.current === generation) setLoading(false)
      })
  }, [failed, loadMotion])

  const beginHold = useCallback(() => {
    holdActiveRef.current = true
    if (motionURLRef.current) playLoadedMotion()
    else requestMotion()
  }, [playLoadedMotion, requestMotion])

  const endHold = useCallback(() => {
    holdActiveRef.current = false
    stopPlayback()
  }, [stopPlayback])

  useEffect(() => {
    if (motionURL && holdActiveRef.current && !failed) playLoadedMotion()
  }, [failed, motionURL, playLoadedMotion])

  useEffect(() => {
    loadGenerationRef.current += 1
    loadStartedRef.current = false
    holdActiveRef.current = false
    stopPlayback()

    const current = motionURLRef.current
    motionURLRef.current = ''
    setMotionURL('')
    setLoading(false)
    setLoadProgress(null)
    setFailed(false)
    if (current) revokeMotionURL(current)

    return () => {
      loadGenerationRef.current += 1
      holdActiveRef.current = false
      stopPlayback()
      const resolved = motionURLRef.current
      motionURLRef.current = ''
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
    beginHold()
  }, [beginHold])

  const handlePointerRelease = useCallback((event: PointerEvent<HTMLDivElement>) => {
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      // Ignore runtimes that have already released the pointer.
    }
    endHold()
  }, [endHold])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
      event.preventDefault()
      beginHold()
    }
  }, [beginHold])

  const handleKeyUp = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      endHold()
    }
  }, [endHold])

  const statusLabel = failed
    ? '实况不可用'
    : loading
      ? loadProgress === null
        ? '实况加载中'
        : `实况加载 ${Math.round(loadProgress)}%`
      : playing
        ? '实况播放中'
        : motionURL
          ? '实况'
          : '实况待加载'

  const holdLabel = motionURL ? '按住播放' : '按住加载并播放'

  return (
    <Box
      role="button"
      tabIndex={0}
      aria-label={`${label}。按住加载并播放，松开停止。`}
      aria-pressed={playing}
      aria-busy={loading}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerRelease}
      onPointerCancel={handlePointerRelease}
      onPointerLeave={endHold}
      onLostPointerCapture={endHold}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onBlur={endHold}
      onContextMenu={(event) => event.preventDefault()}
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        bgcolor: 'black',
        cursor: loadMotion && !failed ? 'pointer' : 'default',
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
        icon={
          loading ? (
            <CircularProgress
              size={14}
              variant={loadProgress === null ? 'indeterminate' : 'determinate'}
              value={loadProgress ?? undefined}
            />
          ) : (
            <LivePhotoIcon fontSize="small" />
          )
        }
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

      {loading ? (
        <Box
          sx={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 58,
            height: 58,
            transform: 'translate(-50%, -50%)',
            display: 'grid',
            placeItems: 'center',
            borderRadius: '50%',
            bgcolor: 'rgba(0, 0, 0, 0.46)',
            pointerEvents: 'none',
            backdropFilter: 'blur(6px)',
          }}
        >
          <CircularProgress
            size={42}
            thickness={4}
            variant={loadProgress === null ? 'indeterminate' : 'determinate'}
            value={loadProgress ?? undefined}
            sx={{ color: 'common.white' }}
          />
          {loadProgress !== null ? (
            <Typography
              variant="caption"
              sx={{
                position: 'absolute',
                color: 'common.white',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {Math.round(loadProgress)}%
            </Typography>
          ) : null}
        </Box>
      ) : null}

      {!loading && !failed && loadMotion && !playing ? (
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
          {holdLabel}
        </Typography>
      ) : null}
    </Box>
  )
}

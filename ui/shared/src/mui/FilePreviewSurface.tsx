import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, CircularProgress, Stack, Typography } from '@mui/material'
import {
  xDriveClassifyFilePreview,
} from '../file-preview'
import type {
  XDriveByteProgressHandler,
  XDriveFilePreviewKind,
  XDriveFilePreviewTarget,
  XDriveFileTextPreview,
} from '../file-preview'
import { XDriveLivePhotoSurface } from './LivePhotoSurface'

export type XDriveFilePreviewTextLoader<T extends XDriveFilePreviewTarget = XDriveFilePreviewTarget> = (
  target: T,
) => Promise<XDriveFileTextPreview | null | undefined>

export type XDriveFilePreviewImageLoader<T extends XDriveFilePreviewTarget = XDriveFilePreviewTarget> = (
  target: T,
) => Promise<string | null | undefined>

export type XDriveFilePreviewMotionLoader<T extends XDriveFilePreviewTarget = XDriveFilePreviewTarget> = (
  target: T,
  onProgress?: XDriveByteProgressHandler,
) => Promise<string | null | undefined>

export type XDriveFilePreviewURLLoader<T extends XDriveFilePreviewTarget = XDriveFilePreviewTarget> = (
  target: T,
  kind: Exclude<XDriveFilePreviewKind, 'none' | 'text' | 'live_photo'>,
) => Promise<string | null | undefined>

export type XDriveFilePreviewSurfaceProps<T extends XDriveFilePreviewTarget = XDriveFilePreviewTarget> = {
  target: T | null
  loadTextPreview?: XDriveFilePreviewTextLoader<T>
  loadImagePreview?: XDriveFilePreviewImageLoader<T>
  loadPreviewURL?: XDriveFilePreviewURLLoader<T>
  loadLivePhotoMotion?: XDriveFilePreviewMotionLoader<T>
  fallback?: ReactNode
  minHeight?: number
  maxHeight?: number
  imageFit?: 'contain' | 'cover'
}

function revokePreviewURL(value: string) {
  if (value.startsWith('blob:')) URL.revokeObjectURL(value)
}

export function XDriveFilePreviewSurface<T extends XDriveFilePreviewTarget>({
  target,
  loadTextPreview,
  loadImagePreview,
  loadPreviewURL,
  loadLivePhotoMotion,
  fallback = null,
  minHeight = 176,
  maxHeight = 420,
  imageFit = 'contain',
}: XDriveFilePreviewSurfaceProps<T>) {
  const previewKind = useMemo(
    () => target ? xDriveClassifyFilePreview(target) : 'none',
    [target?.kind, target?.mimeType, target?.name],
  )
  const livePhotoMotionLoader = useMemo(() => {
    if (!target || !loadLivePhotoMotion) return undefined
    return (onProgress?: XDriveByteProgressHandler) =>
      loadLivePhotoMotion(target, onProgress)
  }, [
    loadLivePhotoMotion,
    target?.id,
    target?.kind,
    target?.mimeType,
    target?.name,
    target?.revision,
    target?.size,
  ])
  const [textPreview, setTextPreview] = useState<XDriveFileTextPreview | null>(null)
  const [previewURL, setPreviewURL] = useState('')
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [usingImageFallback, setUsingImageFallback] = useState(false)
  const previewURLRef = useRef('')
  const previewGenerationRef = useRef(0)

  const assignPreviewURL = useCallback((value: string) => {
    const previous = previewURLRef.current
    if (previous && previous !== value) revokePreviewURL(previous)
    previewURLRef.current = value
    setPreviewURL(value)
  }, [])

  useEffect(() => () => {
    const current = previewURLRef.current
    previewURLRef.current = ''
    if (current) revokePreviewURL(current)
  }, [])

  useEffect(() => {
    let active = true
    const generation = previewGenerationRef.current + 1
    previewGenerationRef.current = generation
    setTextPreview(null)
    assignPreviewURL('')
    setLoading(false)
    setFailed(false)
    setUsingImageFallback(false)

    if (!target || previewKind === 'none') return () => undefined

    if (previewKind === 'text') {
      if (!loadTextPreview) return () => undefined
      setLoading(true)
      void loadTextPreview(target)
        .then((value) => {
          if (!active) return
          if (value) setTextPreview(value)
          else setFailed(true)
        })
        .catch(() => {
          if (active) setFailed(true)
        })
        .finally(() => {
          if (active) setLoading(false)
        })
      return () => {
        active = false
      }
    }

    const canLoadOriginal = previewKind !== 'live_photo' && Boolean(loadPreviewURL)
    const canLoadImageFallback =
      (previewKind === 'image' || previewKind === 'live_photo') &&
      Boolean(loadImagePreview)
    if (!canLoadOriginal && !canLoadImageFallback) return () => undefined

    setLoading(true)
    void (async () => {
      let value: string | null | undefined = null
      if (loadPreviewURL && previewKind !== 'live_photo') {
        value = await loadPreviewURL(target, previewKind)
      }
      let fallback = false
      if (
        !value &&
        (previewKind === 'image' || previewKind === 'live_photo') &&
        loadImagePreview
      ) {
        value = await loadImagePreview(target)
        fallback = Boolean(value)
      }
      return { value, fallback }
    })()
      .then(({ value, fallback }) => {
        if (!value) {
          if (active) setFailed(true)
          return
        }
        if (!active || previewGenerationRef.current !== generation) {
          revokePreviewURL(value)
          return
        }
        setUsingImageFallback(fallback)
        assignPreviewURL(value)
      })
      .catch(() => {
        if (active && previewGenerationRef.current === generation) setFailed(true)
      })
      .finally(() => {
        if (active && previewGenerationRef.current === generation) setLoading(false)
      })

    return () => {
      active = false
      if (previewGenerationRef.current === generation) previewGenerationRef.current += 1
    }
  }, [
    assignPreviewURL,
    loadImagePreview,
    loadPreviewURL,
    loadTextPreview,
    previewKind,
    target,
  ])

  const loadImageFallback = useCallback(() => {
    if (
      previewKind !== 'image' ||
      !target ||
      !loadImagePreview ||
      usingImageFallback
    ) {
      setFailed(true)
      return
    }
    const generation = previewGenerationRef.current
    setLoading(true)
    void loadImagePreview(target)
      .then((value) => {
        if (!value) {
          if (previewGenerationRef.current === generation) setFailed(true)
          return
        }
        if (previewGenerationRef.current !== generation) {
          revokePreviewURL(value)
          return
        }
        setUsingImageFallback(true)
        setFailed(false)
        assignPreviewURL(value)
      })
      .catch(() => {
        if (previewGenerationRef.current === generation) setFailed(true)
      })
      .finally(() => {
        if (previewGenerationRef.current === generation) setLoading(false)
      })
  }, [
    assignPreviewURL,
    loadImagePreview,
    previewKind,
    target,
    usingImageFallback,
  ])

  const body = (() => {
    if (loading) {
      return (
        <Box sx={{ minHeight: 96, display: 'grid', placeItems: 'center' }}>
          <CircularProgress size={26} />
        </Box>
      )
    }
    if (failed) return fallback
    if (previewKind === 'text' && textPreview) {
      return (
        <Stack spacing={0.5} sx={{ width: '100%', minWidth: 0, minHeight: 0, p: 1, alignSelf: 'stretch' }}>
          <Box
            component="pre"
            sx={{
              m: 0,
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              fontFamily: 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace',
              fontSize: 11,
              lineHeight: 1.45,
              color: 'text.primary',
              userSelect: 'text',
            }}
          >
            {textPreview.text || '（空文件）'}
          </Box>
          {textPreview.truncated ? (
            <Typography variant="caption" color="text.secondary">仅显示前 64 KiB</Typography>
          ) : null}
        </Stack>
      )
    }
    if (!previewURL) return fallback
    if (previewKind === 'live_photo') {
      return (
        <XDriveLivePhotoSurface
          still={(
            <Box
              component="img"
              src={previewURL}
              alt={target?.name || ''}
              draggable={false}
              onError={() => setFailed(true)}
              sx={{ width: '100%', height: '100%', objectFit: imageFit, display: 'block' }}
            />
          )}
          loadMotion={livePhotoMotionLoader}
          label={target?.name ? `${target.name} 实况照片` : '实况照片'}
        />
      )
    }
    if (previewKind === 'image') {
      return (
        <Box
          component="img"
          src={previewURL}
          alt={target?.name || ''}
          draggable={false}
          onError={loadImageFallback}
          sx={{ width: '100%', height: '100%', objectFit: imageFit, display: 'block' }}
        />
      )
    }
    if (previewKind === 'video') {
      return (
        <Box
          component="video"
          src={previewURL}
          controls
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
          sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', bgcolor: 'black' }}
        />
      )
    }
    if (previewKind === 'audio') {
      return (
        <Box sx={{ width: '100%', px: 1.5, display: 'flex', alignItems: 'center' }}>
          <Box
            component="audio"
            src={previewURL}
            controls
            preload="metadata"
            onError={() => setFailed(true)}
            sx={{ width: '100%' }}
          />
        </Box>
      )
    }
    if (previewKind === 'pdf') {
      return (
        <Box
          component="iframe"
          src={previewURL}
          title={target?.name || 'PDF 预览'}
          sx={{ width: '100%', height: '100%', border: 0, bgcolor: 'background.paper' }}
        />
      )
    }
    return fallback
  })()

  return (
    <Box
      data-xdrive-file-preview-kind={previewKind}
      aria-busy={loading || undefined}
      sx={{
        width: '100%',
        minWidth: 0,
        minHeight,
        maxHeight,
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {body}
    </Box>
  )
}

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, CircularProgress, Stack, Typography } from '@mui/material'
import {
  xDriveClassifyFilePreview,
} from '../file-preview'
import type {
  XDriveFilePreviewKind,
  XDriveFilePreviewTarget,
  XDriveFileTextPreview,
} from '../file-preview'

export type XDriveFilePreviewTextLoader<T extends XDriveFilePreviewTarget = XDriveFilePreviewTarget> = (
  target: T,
) => Promise<XDriveFileTextPreview | null | undefined>

export type XDriveFilePreviewImageLoader<T extends XDriveFilePreviewTarget = XDriveFilePreviewTarget> = (
  target: T,
) => Promise<string | null | undefined>

export type XDriveFilePreviewURLLoader<T extends XDriveFilePreviewTarget = XDriveFilePreviewTarget> = (
  target: T,
  kind: Exclude<XDriveFilePreviewKind, 'none' | 'text'>,
) => Promise<string | null | undefined>

export type XDriveFilePreviewSurfaceProps<T extends XDriveFilePreviewTarget = XDriveFilePreviewTarget> = {
  target: T | null
  loadTextPreview?: XDriveFilePreviewTextLoader<T>
  loadImagePreview?: XDriveFilePreviewImageLoader<T>
  loadPreviewURL?: XDriveFilePreviewURLLoader<T>
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
  fallback = null,
  minHeight = 176,
  maxHeight = 420,
  imageFit = 'contain',
}: XDriveFilePreviewSurfaceProps<T>) {
  const previewKind = useMemo(
    () => target ? xDriveClassifyFilePreview(target) : 'none',
    [target?.kind, target?.mimeType, target?.name],
  )
  const [textPreview, setTextPreview] = useState<XDriveFileTextPreview | null>(null)
  const [previewURL, setPreviewURL] = useState('')
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    let resolvedURL = ''
    setTextPreview(null)
    setPreviewURL('')
    setLoading(false)
    setFailed(false)

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

    const loader = previewKind === 'image' && loadImagePreview
      ? (candidate: T) => loadImagePreview(candidate)
      : loadPreviewURL
        ? (candidate: T) => loadPreviewURL(candidate, previewKind)
        : undefined
    if (!loader) return () => undefined

    setLoading(true)
    void loader(target)
      .then((value) => {
        if (!value) {
          if (active) setFailed(true)
          return
        }
        resolvedURL = value
        if (active) setPreviewURL(value)
        else revokePreviewURL(value)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
      if (resolvedURL) revokePreviewURL(resolvedURL)
    }
  }, [
    loadImagePreview,
    loadPreviewURL,
    loadTextPreview,
    previewKind,
    target,
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
    if (previewKind === 'image') {
      return (
        <Box
          component="img"
          src={previewURL}
          alt={target?.name || ''}
          draggable={false}
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

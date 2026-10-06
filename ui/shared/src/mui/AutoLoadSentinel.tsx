import { useEffect, useRef } from 'react'
import { Box, CircularProgress, Stack, Typography } from '@mui/material'

export function XDriveAutoLoadSentinel({
  enabled,
  loading,
  onLoad,
  label = '正在加载更多…',
  rootMargin = '240px 0px',
}: {
  enabled: boolean
  loading: boolean
  onLoad: () => void | Promise<void>
  label?: string
  rootMargin?: string
}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!enabled || loading) return
    const sentinel = sentinelRef.current
    if (!sentinel) return

    let triggered = false
    const trigger = () => {
      if (triggered) return
      triggered = true
      void onLoad()
    }

    if (typeof IntersectionObserver === 'undefined') {
      trigger()
      return
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      trigger()
    }, { rootMargin })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [enabled, loading, onLoad, rootMargin])

  if (!enabled) return null

  return (
    <Box
      ref={sentinelRef}
      data-xdrive-auto-load-sentinel
      sx={{ minHeight: loading ? 28 : 1 }}
    >
      {loading ? (
        <Stack
          direction="row"
          spacing={0.75}
          alignItems="center"
          justifyContent="center"
          sx={{ minHeight: 28 }}
        >
          <CircularProgress size={13} />
          <Typography variant="caption" color="text.secondary">
            {label}
          </Typography>
        </Stack>
      ) : null}
    </Box>
  )
}

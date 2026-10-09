import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded'
import FullscreenExitRoundedIcon from '@mui/icons-material/FullscreenExitRounded'
import KeyboardArrowLeftRoundedIcon from '@mui/icons-material/KeyboardArrowLeftRounded'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'
import { Box, Dialog, DialogContent, IconButton, Stack, Tooltip, Typography, useMediaQuery } from '@mui/material'

export type XDriveOpenPreviewDialogProps = {
  open: boolean
  title?: ReactNode
  subtitle?: ReactNode
  positionLabel?: ReactNode
  quickLook?: boolean
  canPrevious?: boolean
  canNext?: boolean
  onPrevious?: () => void
  onNext?: () => void
  actions?: ReactNode
  footer?: ReactNode
  immersive?: boolean
  fullScreen?: boolean
  onFullScreenChange?: (fullScreen: boolean) => void
  chromeAutoHideMs?: number
  onClose: () => void
  children: ReactNode
}

export function XDriveOpenPreviewDialog({
  open,
  title,
  subtitle,
  positionLabel,
  quickLook = false,
  canPrevious = false,
  canNext = false,
  onPrevious,
  onNext,
  actions,
  footer,
  immersive = false,
  fullScreen = false,
  onFullScreenChange,
  chromeAutoHideMs = 2200,
  onClose,
  children,
}: XDriveOpenPreviewDialogProps) {
  const compactTouch = useMediaQuery('(max-width:899.95px) and (pointer: coarse)')
  const effectiveFullScreen = fullScreen || compactTouch
  const hasNavigation = canPrevious || canNext
  const [chromeVisible, setChromeVisible] = useState(true)
  const chromeTimerRef = useRef<number | null>(null)
  const touchTapTimerRef = useRef<number | null>(null)
  const touchPointersRef = useRef(new Set<number>())
  const touchTapRef = useRef<{
    pointerID: number
    startX: number
    startY: number
    moved: boolean
    multi: boolean
    interactive: boolean
  } | null>(null)
  const lastTouchTapRef = useRef<{ at: number; x: number; y: number } | null>(null)

  const clearChromeTimer = useCallback(() => {
    if (chromeTimerRef.current !== null) {
      window.clearTimeout(chromeTimerRef.current)
      chromeTimerRef.current = null
    }
  }, [])

  const showChrome = useCallback(() => {
    setChromeVisible(true)
    clearChromeTimer()
    if (immersive && open) {
      chromeTimerRef.current = window.setTimeout(() => {
        chromeTimerRef.current = null
        setChromeVisible(false)
      }, chromeAutoHideMs)
    }
  }, [chromeAutoHideMs, clearChromeTimer, immersive, open])

  const clearTouchTapTimer = useCallback(() => {
    if (touchTapTimerRef.current !== null) {
      window.clearTimeout(touchTapTimerRef.current)
      touchTapTimerRef.current = null
    }
  }, [])

  const handleTouchPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!compactTouch || !immersive || event.pointerType !== 'touch') return
    touchPointersRef.current.add(event.pointerId)
    if (touchPointersRef.current.size > 1) {
      if (touchTapRef.current) touchTapRef.current.multi = true
      clearTouchTapTimer()
      return
    }
    const target = event.target instanceof HTMLElement ? event.target : null
    touchTapRef.current = {
      pointerID: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      multi: false,
      interactive: Boolean(target?.closest(
        'button, input, textarea, select, video, audio, iframe, [role="button"], [role="slider"], [contenteditable="true"]',
      )),
    }
  }

  const handleTouchPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const tap = touchTapRef.current
    if (!tap || tap.pointerID !== event.pointerId) return
    if (Math.hypot(event.clientX - tap.startX, event.clientY - tap.startY) > 10) tap.moved = true
  }

  const handleTouchPointerRelease = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch') return
    touchPointersRef.current.delete(event.pointerId)
    const tap = touchTapRef.current
    if (!tap || tap.pointerID !== event.pointerId) return
    touchTapRef.current = null
    if (tap.moved || tap.multi || tap.interactive) return

    const now = Date.now()
    const previous = lastTouchTapRef.current
    if (
      previous &&
      now - previous.at <= 320 &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 32
    ) {
      lastTouchTapRef.current = null
      clearTouchTapTimer()
      return
    }

    lastTouchTapRef.current = { at: now, x: event.clientX, y: event.clientY }
    const hideChrome = chromeVisible
    clearTouchTapTimer()
    touchTapTimerRef.current = window.setTimeout(() => {
      touchTapTimerRef.current = null
      if (hideChrome) {
        clearChromeTimer()
        setChromeVisible(false)
      } else {
        showChrome()
      }
    }, 260)
  }

  const handleTouchPointerCancel = (event: ReactPointerEvent<HTMLElement>) => {
    touchPointersRef.current.delete(event.pointerId)
    if (touchTapRef.current?.pointerID === event.pointerId) touchTapRef.current = null
  }

  useEffect(() => () => {
    clearTouchTapTimer()
    touchPointersRef.current.clear()
    touchTapRef.current = null
  }, [clearTouchTapTimer])

  useEffect(() => {
    if (!open) {
      clearChromeTimer()
      setChromeVisible(true)
      return () => undefined
    }
    showChrome()
    return clearChromeTimer
  }, [clearChromeTimer, open, showChrome])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    showChrome()
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      if (fullScreen && onFullScreenChange) {
        onFullScreenChange(false)
      } else {
        onClose()
      }
      return
    }
    const target = event.target instanceof HTMLElement ? event.target : null
    const interactiveKeyTarget = Boolean(target?.closest(
      'button, input, textarea, select, video, audio, iframe, [role="button"], [role="slider"], [contenteditable="true"]',
    ))
    if (quickLook && event.key === ' ' && !interactiveKeyTarget) {
      event.preventDefault()
      onClose()
      return
    }
    if (interactiveKeyTarget) return
    if (event.key === 'ArrowLeft' && canPrevious && onPrevious) {
      event.preventDefault()
      onPrevious()
      return
    }
    if (event.key === 'ArrowRight' && canNext && onNext) {
      event.preventDefault()
      onNext()
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      onKeyDown={handleKeyDown}
      maxWidth="lg"
      fullWidth
      fullScreen={effectiveFullScreen}
      aria-label={quickLook ? '快速预览' : '打开预览'}
      data-xdrive-open-preview-dialog
      data-xdrive-file-quick-look={quickLook || undefined}
      slotProps={{
        paper: {
          sx: {
            width: effectiveFullScreen ? '100vw' : 'min(1080px, calc(100vw - 32px))',
            height: effectiveFullScreen ? '100dvh' : { xs: '78vh', sm: '82vh' },
            minHeight: 0,
            maxHeight: effectiveFullScreen ? 'none' : 820,
            borderRadius: effectiveFullScreen ? 0 : { xs: 1.5, sm: 2 },
            overflow: 'hidden',
            backgroundImage: 'none',
          },
        },
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        data-xdrive-preview-chrome="header"
        sx={{
          minHeight: compactTouch ? 56 : 48,
          px: compactTouch ? 1 : 1.5,
          pl: compactTouch ? 'max(8px, env(safe-area-inset-left))' : undefined,
          pr: compactTouch ? 'max(8px, env(safe-area-inset-right))' : undefined,
          pt: compactTouch ? 'env(safe-area-inset-top)' : 0,
          '& .MuiIconButton-root': compactTouch ? { width: 44, height: 44 } : undefined,
          borderBottom: 1,
          borderColor: 'divider',
          opacity: immersive && !chromeVisible ? 0 : 1,
          pointerEvents: immersive && !chromeVisible ? 'none' : 'auto',
          transition: 'opacity 160ms ease',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap>{title}</Typography>
          {subtitle ? <Typography variant="caption" noWrap sx={{ display: 'block', opacity: 0.72 }}>{subtitle}</Typography> : null}
        </Box>
        {positionLabel ? (
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            {positionLabel}
          </Typography>
        ) : null}
        {!compactTouch ? actions : null}
        {onFullScreenChange && !compactTouch ? (
          <Tooltip title={fullScreen ? '退出全屏' : '全屏'}>
            <IconButton
              size="small"
              aria-label={fullScreen ? '退出全屏预览' : '全屏预览'}
              onClick={() => onFullScreenChange(!fullScreen)}
            >
              {fullScreen
                ? <FullscreenExitRoundedIcon fontSize="small" />
                : <FullscreenRoundedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        ) : null}
        <Tooltip title={quickLook ? '关闭（Space / Esc）' : '关闭（Esc）'}>
          <IconButton size="small" aria-label="关闭预览" onClick={onClose}>
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      <DialogContent
        onMouseMove={compactTouch ? undefined : showChrome}
        onFocusCapture={showChrome}
        onPointerDownCapture={handleTouchPointerDown}
        onPointerMoveCapture={handleTouchPointerMove}
        onPointerUpCapture={handleTouchPointerRelease}
        onPointerCancelCapture={handleTouchPointerCancel}
        sx={{
          position: 'relative',
          p: 0,
          minHeight: 0,
          overflow: 'hidden',
          bgcolor: immersive ? 'black' : 'background.default',
        }}
      >
        <Box sx={{ width: '100%', height: '100%', minHeight: 0, display: 'flex' }}>
          {children}
        </Box>

        {!compactTouch && hasNavigation ? (
          <>
          <Tooltip title="上一个">
            <span>
              <IconButton
                aria-label="预览上一个项目"
                disabled={!canPrevious}
                onClick={onPrevious}
                sx={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  bgcolor: 'background.paper',
                  boxShadow: 2,
                  opacity: immersive && !chromeVisible ? 0 : 1,
                  pointerEvents: immersive && !chromeVisible ? 'none' : 'auto',
                  transition: 'opacity 160ms ease',
                  '&:hover': { bgcolor: 'background.paper' },
                }}
              >
                <KeyboardArrowLeftRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
  
          <Tooltip title="下一个">
            <span>
              <IconButton
                aria-label="预览下一个项目"
                disabled={!canNext}
                onClick={onNext}
                sx={{
                  position: 'absolute',
                  right: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  bgcolor: 'background.paper',
                  boxShadow: 2,
                  opacity: immersive && !chromeVisible ? 0 : 1,
                  pointerEvents: immersive && !chromeVisible ? 'none' : 'auto',
                  transition: 'opacity 160ms ease',
                  '&:hover': { bgcolor: 'background.paper' },
                }}
              >
                <KeyboardArrowRightRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
  
          </>
        ) : null}
      </DialogContent>

      {compactTouch ? (
        <>
          {footer ? (
            <Box
              data-xdrive-preview-mobile-filmstrip
              sx={{
                flexShrink: 0,
                borderTop: 1,
                borderColor: 'divider',
                opacity: chromeVisible ? 1 : 0,
                pointerEvents: chromeVisible ? 'auto' : 'none',
                transition: 'opacity 160ms ease',
              }}
            >
              {footer}
            </Box>
          ) : null}
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="flex-start"
            spacing={0.5}
            data-xdrive-preview-mobile-actions
            sx={{
              minHeight: 56,
              px: 1,
              pl: 'max(8px, env(safe-area-inset-left))',
              pr: 'max(8px, env(safe-area-inset-right))',
              pb: 'env(safe-area-inset-bottom)',
              flexShrink: 0,
              overflowX: 'auto',
              borderTop: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
              opacity: chromeVisible ? 1 : 0,
              pointerEvents: chromeVisible ? 'auto' : 'none',
              transition: 'opacity 160ms ease',
              '& .MuiIconButton-root': { width: 44, height: 44, flexShrink: 0 },
            }}
          >
            {hasNavigation ? <IconButton aria-label="预览上一个项目" disabled={!canPrevious} onClick={onPrevious}>
              <KeyboardArrowLeftRoundedIcon />
            </IconButton> : null}
            <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', '& .MuiStack-root': { flexWrap: 'nowrap' } }}>
              {actions}
            </Box>
            {hasNavigation ? <IconButton aria-label="预览下一个项目" disabled={!canNext} onClick={onNext}>
              <KeyboardArrowRightRoundedIcon />
            </IconButton> : null}
          </Stack>
        </>
      ) : (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="center"
          data-xdrive-preview-chrome="footer"
          sx={{
            minHeight: footer ? 72 : 32,
            px: 1.5,
            borderTop: 1,
            borderColor: 'divider',
            opacity: immersive && !chromeVisible ? 0 : 1,
            pointerEvents: immersive && !chromeVisible ? 'none' : 'auto',
            transition: 'opacity 160ms ease',
          }}
        >
          {footer ?? (
            <Typography variant="caption" color="text.secondary">
              {hasNavigation
                ? quickLook ? 'Space / Esc 关闭 · ← / → 切换' : 'Esc 关闭 · ← / → 切换'
                : quickLook ? 'Space / Esc 关闭' : 'Esc 关闭'}
            </Typography>
          )}
        </Stack>
  
      )}
    </Dialog>
  )
}

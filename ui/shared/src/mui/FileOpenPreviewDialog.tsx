import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded'
import FullscreenExitRoundedIcon from '@mui/icons-material/FullscreenExitRounded'
import KeyboardArrowLeftRoundedIcon from '@mui/icons-material/KeyboardArrowLeftRounded'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'
import { Box, Dialog, DialogContent, IconButton, Stack, Tooltip, Typography } from '@mui/material'

export type XDriveOpenPreviewDialogProps = {
  open: boolean
  title?: ReactNode
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
  const [chromeVisible, setChromeVisible] = useState(true)
  const chromeTimerRef = useRef<number | null>(null)

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
      fullScreen={fullScreen}
      aria-label={quickLook ? '快速预览' : '打开预览'}
      data-xdrive-open-preview-dialog
      data-xdrive-file-quick-look={quickLook || undefined}
      slotProps={{
        paper: {
          sx: {
            width: fullScreen ? '100vw' : 'min(1080px, calc(100vw - 32px))',
            height: fullScreen ? '100vh' : { xs: '78vh', sm: '82vh' },
            maxHeight: fullScreen ? 'none' : 820,
            borderRadius: fullScreen ? 0 : { xs: 1.5, sm: 2 },
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
          minHeight: 48,
          px: 1.5,
          borderBottom: 1,
          borderColor: 'divider',
          opacity: immersive && !chromeVisible ? 0 : 1,
          pointerEvents: immersive && !chromeVisible ? 'none' : 'auto',
          transition: 'opacity 160ms ease',
        }}
      >
        <Typography variant="subtitle2" noWrap sx={{ flex: 1, minWidth: 0 }}>
          {title}
        </Typography>
        {positionLabel ? (
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            {positionLabel}
          </Typography>
        ) : null}
        {actions}
        {onFullScreenChange ? (
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
        onMouseMove={showChrome}
        onFocusCapture={showChrome}
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
      </DialogContent>

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
            {quickLook ? 'Space / Esc 关闭 · ← / → 切换' : 'Esc 关闭 · ← / → 切换'}
          </Typography>
        )}
      </Stack>
    </Dialog>
  )
}

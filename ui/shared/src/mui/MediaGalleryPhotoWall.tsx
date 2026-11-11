import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode, TouchEvent } from 'react'
import { Box } from '@mui/material'
import { xDriveMediaGalleryPinchColumnCount } from './MediaGalleryVirtualGrid'
import { mediaGalleryScrollParent } from './MediaGallerySharedTiles'
import { xDriveMediaGalleryFramingStyles } from './MediaGalleryPhotoWallFraming'
import type { XDriveMediaGalleryFraming } from './MediaGalleryPhotoWallFraming'

/** A shared photo-wall host. The Gallery and trusted Places Parent supply
 * independent Owner-authorized collections; this host owns only presentation
 * and an optional mobile pinch gesture. No SDK data or authorization enters it.
 */
export type XDriveMediaGalleryPhotoWallPinch = Readonly<{
  columns: number
  minColumns?: number
  maxColumns?: number
  onChange: (columns: number, anchorIndex: number, viewportOffset: number) => void
  /** Caller-only interaction cleanup (e.g. cancel Gallery long-press). */
  onStart?: (anchorIndex: number) => void
  /** Parent capture listeners must also reject the synthetic pinch click. */
  onGestureEnd?: () => void
}>

export function XDriveMediaGalleryPhotoWall({
  children, surface, pinch, framing,
}: {
  children: ReactNode
  surface: 'gallery' | 'places'
  pinch?: XDriveMediaGalleryPhotoWallPinch
  framing?: XDriveMediaGalleryFraming
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const gesture = useRef<{
    startDistance: number
    lastDistance: number
    columns: number
    index: number
    viewportOffset: number
    active: boolean
  } | null>(null)
  const suppressClickUntil = useRef(0)

  const clearGesture = useCallback(() => {
    gesture.current = null
    hostRef.current?.style.removeProperty('--xdrive-gallery-pinch-preview')
  }, [])
  useEffect(() => clearGesture, [clearGesture, surface, pinch?.onChange])

  const touchDistance = (event: TouchEvent<HTMLDivElement>) =>
    Math.hypot(
      event.touches[0].clientX - event.touches[1].clientX,
      event.touches[0].clientY - event.touches[1].clientY,
    )

  const startPinch = (event: TouchEvent<HTMLDivElement>) => {
    if (!pinch || event.touches.length !== 2) return
    const host = hostRef.current
    if (!host || !(event.target instanceof Element) ||
        !event.target.closest('[data-xdrive-media-tile]')) return
    const distance = touchDistance(event)
    if (distance < 24) return
    const x = (event.touches[0].clientX + event.touches[1].clientX) / 2
    const y = (event.touches[0].clientY + event.touches[1].clientY) / 2
    const candidate = host.ownerDocument.elementFromPoint(x, y)
    const tile = candidate?.closest<HTMLElement>('[data-xdrive-media-tile]') ??
      event.target.closest<HTMLElement>('[data-xdrive-media-tile]')
    if (!tile || !host.contains(tile)) return
    const index = Number(tile.getAttribute('data-xdrive-media-index'))
    if (!Number.isSafeInteger(index) || index < 0) return
    const scroll = mediaGalleryScrollParent(tile)
    gesture.current = {
      startDistance: distance, lastDistance: distance,
      columns: pinch.columns, index,
      viewportOffset: tile.getBoundingClientRect().top -
        (scroll?.getBoundingClientRect().top ?? 0),
      active: false,
    }
    pinch.onStart?.(index)
  }

  const movePinch = (event: TouchEvent<HTMLDivElement>) => {
    const current = gesture.current
    if (!current || event.touches.length !== 2) return
    const distance = touchDistance(event)
    if (!Number.isFinite(distance) || distance < 24) return
    current.lastDistance = distance
    const zoom = distance / current.startDistance
    if (!current.active && Math.abs(zoom - 1) < 0.08) return
    current.active = true
    hostRef.current?.style.setProperty(
      '--xdrive-gallery-pinch-preview',
      String(Math.max(0.8, Math.min(1.2, zoom))),
    )
  }

  const endPinch = (commit: boolean) => {
    const current = gesture.current
    clearGesture()
    if (!current || !current.active) return
    suppressClickUntil.current = Date.now() + 350
    pinch?.onGestureEnd?.()
    if (!commit || !pinch) return
    const columns = xDriveMediaGalleryPinchColumnCount(
      current.columns, current.startDistance, current.lastDistance,
      pinch.minColumns ?? 2, pinch.maxColumns ?? 10,
    )
    if (columns !== current.columns) {
      pinch.onChange(columns, current.index, current.viewportOffset)
    }
  }

  return (
    <Box
      ref={hostRef}
      data-xdrive-shared-photo-wall={surface}
      data-xdrive-shared-photo-wall-framing={framing}
      onTouchStartCapture={startPinch}
      onTouchMoveCapture={movePinch}
      onTouchEndCapture={event => {
        if (event.touches.length < 2) endPinch(true)
      }}
      onTouchCancelCapture={() => endPinch(false)}
      onClickCapture={event => {
        if (Date.now() < suppressClickUntil.current &&
            event.target instanceof Element &&
            event.target.closest('[data-xdrive-media-tile]')) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      sx={{
        width: '100%', minWidth: 0,
        touchAction: pinch ? 'pan-y' : undefined,
        // Compose the touch preview with objectFit in a single MUI sx
        // selector: two shallow spreads of the same img key lose framing.
        ...(framing ? xDriveMediaGalleryFramingStyles(framing, Boolean(pinch))
          : pinch ? {
            '& [data-xdrive-media-tile] img': {
              transform: 'scale(var(--xdrive-gallery-pinch-preview, 1))',
              transformOrigin: 'center',
            },
          } : {}),
      }}
    >
      {children}
    </Box>
  )
}

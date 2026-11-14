import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import {
  XDRIVE_MEDIA_GALLERY_MOBILE_COLUMNS_MAX,
  XDRIVE_MEDIA_GALLERY_MOBILE_COLUMNS_MIN,
  xDriveReadMobileGalleryColumns,
  xDriveObserveMobileGalleryColumns,
} from './MediaGalleryPhotoWallPreferences'
import type {
  XDriveGalleryPhotoWallColumns,
  XDriveGalleryPhotoWallScale,
} from './MediaGalleryPhotoWallPreferences'

/** Gallery and trusted Places share one state/observer for *cosmetic* columns.
 * The one-time Viewer-return override is clamped; it cannot overwrite another
 * tab's stored settings or carry any Owner/Cell/Node/URL identifiers.
 */
export function useXDriveMediaGalleryMobileColumns(
  initial?: Readonly<{ scale: XDriveGalleryPhotoWallScale; columns?: number }>,
): readonly [
  XDriveGalleryPhotoWallColumns,
  Dispatch<SetStateAction<XDriveGalleryPhotoWallColumns>>,
] {
  const [columns, setColumns] = useState<XDriveGalleryPhotoWallColumns>(() => {
    const stored = xDriveReadMobileGalleryColumns()
    const n = initial?.columns
    if (typeof n !== 'number' || !Number.isFinite(n)) return stored
    return {
      ...stored,
      [initial!.scale]: Math.max(XDRIVE_MEDIA_GALLERY_MOBILE_COLUMNS_MIN,
        Math.min(XDRIVE_MEDIA_GALLERY_MOBILE_COLUMNS_MAX, Math.round(n))),
    }
  })
  useEffect(() => xDriveObserveMobileGalleryColumns(setColumns), [])
  return [columns, setColumns] as const
}

export type XDriveMediaGalleryNumericReturnIntent =
  | number
  | Readonly<{ index: number; viewportOffset: number }>

/** Exactly one UI-only date/return state machine in Gallery and Places.
 * The caller keeps the actual logical/signed Range, the current authorization,
 * viewport materialization and Reader; this hook never performs media I/O.
 */
export function useXDriveMediaGalleryTimelineJump<
  T extends XDriveMediaGalleryNumericReturnIntent
>() {
  const [returnAnchor, setReturnAnchor] = useState<T | null>(null)
  const [dayInput, setDayInput] = useState('')
  const [dayFeedback, setDayFeedback] = useState('')
  const clearDay = useCallback(() => {
    setDayInput('')
    setDayFeedback('')
  }, [])
  const reset = useCallback(() => {
    setReturnAnchor(null)
    clearDay()
  }, [clearDay])
  return {
    returnAnchor, setReturnAnchor,
    dayInput, setDayInput, dayFeedback, setDayFeedback,
    clearDay, reset,
  }
}

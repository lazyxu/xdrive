/**
 * Only the already-authorized neighbor may complete a mobile photo page turn.
 * The current decoded image follows the finger; unavailable edges resist.
 * No media fetch, mutation or Owner capability is inferred from a gesture.
 */
export const XDRIVE_PHOTO_PAGE_SETTLE_MS = 150

export function xDrivePhotoFingerTranslation(
  dx: number, dy: number, viewportWidth: number,
  canPrevious: boolean, canNext: boolean,
): number {
  if (![dx, dy, viewportWidth].every(Number.isFinite) || viewportWidth <= 0 ||
      Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy) * 1.15) return 0
  const available = dx > 0 ? canPrevious : canNext
  const offset = available ? dx : dx * 0.18
  return Math.max(-viewportWidth, Math.min(viewportWidth, offset))
}

export function xDrivePhotoPageTurn(
  dx: number, dy: number, elapsedMS: number,
  canPrevious: boolean, canNext: boolean,
): 'previous' | 'next' | null {
  if (![dx, dy, elapsedMS].every(Number.isFinite) ||
      elapsedMS < 0 || elapsedMS > 700 ||
      Math.abs(dx) < 56 || Math.abs(dx) <= Math.abs(dy) * 1.25) return null
  return dx > 0 ? canPrevious ? 'previous' : null
    : canNext ? 'next' : null
}

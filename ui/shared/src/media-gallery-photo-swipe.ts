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
  canPrevious: boolean, canNext: boolean, viewportWidth = 0,
): 'previous' | 'next' | null {
  // A deliberate drag across at least 28% of the viewport remains valid
  // after 700ms; short slow movements still rebound instead of paging.
  const deliberate = Number.isFinite(viewportWidth) && viewportWidth > 0 &&
    Math.abs(dx) >= Math.max(96, Math.min(240, viewportWidth * 0.28))
  if (![dx, dy, elapsedMS].every(Number.isFinite) ||
      elapsedMS < 0 || Math.abs(dx) <= Math.abs(dy) * 1.25 ||
      ((elapsedMS > 700 || Math.abs(dx) < 56) && !deliberate)) return null
  return dx > 0 ? canPrevious ? 'previous' : null
    : canNext ? 'next' : null
}

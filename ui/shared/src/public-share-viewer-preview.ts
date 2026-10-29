import type { PublicShareChild } from './models'

/**
 * A Public Share grants a bounded image preview, not Owner file access.
 * The original-ticket API accepts only JPEG/PNG/WebP/GIF; other image and
 * Live Photo stills may be shown ONLY as cached JPEG/PNG derivatives from
 * the distinct share-thumbnail ticket, with current Node revision proven.
 * Never treat a cached video poster as playable media or a Live motion grant.
 */
const originalShareStill = /\.(?:jpe?g|png|webp|gif)$/i
const cachedShareStill = /\.(?:bmp|heic|heif|avif|tiff?|livp)$/i

export type XDrivePublicShareViewerStillMode = 'original' | 'cached-still' | null

export function xDrivePublicShareViewerStillMode(
  entry: Pick<PublicShareChild, 'type' | 'name' | 'revision' | 'thumbnail_candidate'>,
  capability: { canPreview: boolean; hasOriginal: boolean; hasThumbnail: boolean },
): XDrivePublicShareViewerStillMode {
  if (!capability.canPreview || entry.type !== 'file') return null
  if (capability.hasOriginal && originalShareStill.test(entry.name)) return 'original'
  if (capability.hasThumbnail && cachedShareStill.test(entry.name) &&
      entry.thumbnail_candidate === true &&
      Number.isSafeInteger(entry.revision) && (entry.revision ?? 0) > 0) {
    return 'cached-still'
  }
  return null
}

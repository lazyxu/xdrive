import {
  xDriveCopyBaiduMapPhotoScope, xDriveBaiduMapPhotoScopeKey,
} from './media-gallery-baidu-map-photo-scope'
import type { XDriveBaiduMapPhotoScope } from './media-gallery-baidu-map-photo-scope'

// This is a short-lived UI-only return hint. It is never a permission to
// fetch /cells, /cell-items, thumbnails or Viewer originals; Server must
// re-authorize every operation after a Viewer, Owner, mode or route return.
// Never write private Owner/album/filter/camera state to URLs or storage.
export const XDRIVE_BAIDU_MAP_VISUAL_SCOPE_TTL_MS = 10 * 60 * 1000
const MAX_OWNERS = 8
type Entry = { value: XDriveBaiduMapPhotoScope; seen: number }
const sessions = new Map<string, Entry>()
function admissibleOwner(owner: string): boolean {
  return typeof owner === 'string' && owner.length > 0 && owner.length <= 1024
}
function validClock(now: number): boolean {
  return Number.isSafeInteger(now) && now >= 0
}
function sweep(now: number): void {
  for (const [owner,entry] of sessions)
    if (entry.seen > now || now-entry.seen >= XDRIVE_BAIDU_MAP_VISUAL_SCOPE_TTL_MS)
      sessions.delete(owner)
}
/** Only a validated explicit Gallery/Map filter is recorded. */
export function xDriveRememberBaiduMapVisualScope(
  owner: string, scope: XDriveBaiduMapPhotoScope, now = Date.now(),
): boolean {
  if (!admissibleOwner(owner) || !validClock(now)) return false
  const copied=xDriveCopyBaiduMapPhotoScope(scope)
  if (!copied) return false
  sweep(now)
  sessions.delete(owner)
  sessions.set(owner,{value:copied,seen:now})
  while(sessions.size>MAX_OWNERS) {
    const first=sessions.keys().next().value
    if(first===undefined)break
    sessions.delete(first)
  }
  return true
}
/** A cloned snapshot, not a token or implicit all-library fallback. */
export function xDriveReadBaiduMapVisualScope(
  owner: string, now = Date.now(),
): XDriveBaiduMapPhotoScope | undefined {
  if (!admissibleOwner(owner) || !validClock(now)) return undefined
  sweep(now)
  const entry=sessions.get(owner)
  if (!entry) return undefined
  const value=xDriveCopyBaiduMapPhotoScope(entry.value)
  if (!value) {sessions.delete(owner);return undefined}
  return value
}
export function xDriveClearBaiduMapVisualScope(owner: string): void {
  if(admissibleOwner(owner))sessions.delete(owner)
}


/** A Viewer return is only a visual intent. Older filtered/camera Cell
 * snapshots must never restore a broader/different Owner album membership
 * after a newer handoff or filter change. A fresh Server Range is STILL
 * mandatory even when this comparison succeeds. */
export function xDriveBaiduMapViewerReturnScopeMatches(
  current: XDriveBaiduMapPhotoScope, returning: XDriveBaiduMapPhotoScope,
): boolean {
  const a=xDriveCopyBaiduMapPhotoScope(current)
  const b=xDriveCopyBaiduMapPhotoScope(returning)
  return !!a && !!b && xDriveBaiduMapPhotoScopeKey(a)===xDriveBaiduMapPhotoScopeKey(b)
}

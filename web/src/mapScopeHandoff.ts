import {
  XDRIVE_PLACES_MAP_HANDOFF_QUERY,
  XDRIVE_PLACES_MAP_SCOPE_REQUIRED_QUERY,
  xDrivePlacesMapModeFromHref,
} from '../../ui/shared/src/media-gallery-places-map-mode'
import type { XDriveBaiduMapPhotoScope } from '../../ui/shared/src/media-gallery-baidu-map-photo-scope'
import type { XDriveBaiduNativeCameraSnapshot } from '../../ui/shared/src/media-gallery-baidu-native-camera-session'

export type XDriveMapScopeHandoffState =
  | Readonly<{ state:'none' }>
  | Readonly<{ state:'pending';ticket:string;target:'prototype'|'isolated' }>
  | Readonly<{ state:'denied' }>
  | Readonly<{ state:'ready';ownerID:number;username:string;
      scope:XDriveBaiduMapPhotoScope;camera?:XDriveBaiduNativeCameraSnapshot;revision:number }>

/** Restricted WebKit can deny the optional History.state getter while still
 * allowing replaceState. A null history payload preserves the crucial
 * nonce-scrub capability without granting any Owner/map permission. */
function readableMapHistoryState(browser: Pick<Window, 'history'>): unknown {
  try { return browser.history.state }
  catch { return null }
}

/** Consume the opaque URL hint synchronously BEFORE mounting any Gallery/SDK
 * component; never retain it in History, Storage, logs, a route or a referrer.
 * The hint has NO capability without authenticated Server redemption. */
export function xDriveTakeMapScopeHandoffFromURL(
  browser: Pick<Window, 'location' | 'history'>,
): XDriveMapScopeHandoffState {
  try {
    const url = new URL(browser.location.href)
    const tickets = url.searchParams.getAll(XDRIVE_PLACES_MAP_HANDOFF_QUERY)
    const required = url.searchParams.getAll(XDRIVE_PLACES_MAP_SCOPE_REQUIRED_QUERY)
    if (tickets.length === 0) {
      // A forced refresh/Back/Forward after nonce removal must NEVER silently
      // render the full Owner library while a restricted scope is required.
      return required.length === 0 ? {state:'none'} : {state:'denied'}
    }
    url.searchParams.delete(XDRIVE_PLACES_MAP_HANDOFF_QUERY)
    // Even an invalid/duplicated hint must be stripped before any SDK mount.
    browser.history.replaceState(readableMapHistoryState(browser), '', url.href)
    if (tickets.length !== 1 || !/^[a-f0-9]{64}$/.test(tickets[0]) ||
        required.length !== 1 || required[0] !== '1' ||
        url.protocol !== 'https:' ||
        browser.location.origin !== url.origin) return {state:'denied'}
    const selections = url.searchParams.getAll('places_map_mode')
    if (selections.length > 1 ||
        (selections.length === 1 && selections[0] !== 'prototype' &&
          selections[0] !== 'isolated')) return {state:'denied'}
    const target = xDrivePlacesMapModeFromHref(url.href)
    return {state:'pending',ticket:tickets[0],target}
  } catch {
    // history.replaceState denial must fail closed (not mount the map).
    return {state:'denied'}
  }
}

/** Only an explicit user choice to abandon the restricted map can remove
 * this nonsecret marker. A failed History rewrite must keep the deny page. */
export function xDriveAbandonMapScopeRequired(
  browser: Pick<Window, 'location' | 'history'>,
): boolean {
  try {
    const url = new URL(browser.location.href)
    if (url.origin !== browser.location.origin) return false
    url.searchParams.delete(XDRIVE_PLACES_MAP_HANDOFF_QUERY)
    url.searchParams.delete(XDRIVE_PLACES_MAP_SCOPE_REQUIRED_QUERY)
    browser.history.replaceState(readableMapHistoryState(browser), '', url.href)
    return true
  } catch { return false }
}

/** Restore the normal origin-only provider Referrer AFTER the one-use URL
 * hint is scrubbed. The initial HTML deliberately suppresses all referrers
 * while the handoff nonce is still present. Never restore if it survived. */
export function xDriveRestoreMapReferrerAfterScrub(
  browser: Pick<Window, 'location' | 'document'>,
): boolean {
  try {
    const url=new URL(browser.location.href)
    if (url.protocol!=='https:' ||
        url.searchParams.has(XDRIVE_PLACES_MAP_HANDOFF_QUERY)) return false
    const meta=browser.document.querySelector<HTMLMetaElement>('meta[name="referrer"]')
    if (!meta || meta.content!=='no-referrer') return false
    meta.content='strict-origin-when-cross-origin'
    return true
  } catch { return false }
}

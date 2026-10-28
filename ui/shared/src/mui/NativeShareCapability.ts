/** Capability hints only. Some Safari/WebKit contexts deny optional property
 * reads even when navigator exists; unavailable must never crash shared UI.
 * File bytes still require a separate synchronous user click and canShare check. */
export function xDriveCanUseNativeShare(kind: 'file' | 'link'): boolean {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false
    return kind !== 'file' || typeof navigator.canShare === 'function'
  } catch {
    return false
  }
}

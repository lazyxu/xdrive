/**
 * A transient, memory-only handoff from the mounted Gallery's exact
 * Node/revision thumbnail cache into its own routed Web/iOS PWA Viewer.
 *
 * One instance belongs to ONE authenticated App API/Owner scope. Neither
 * tokens, signed URLs nor thumbnail bytes enter the route, sessionStorage,
 * IndexedDB or a persistent cache. A standalone Viewer cannot borrow without
 * a Gallery-origin activation and a live registration.
 */
export type XDriveRoutedGalleryThumbnailLease = {
  url: string
  release: () => void
}
export type XDriveRoutedGalleryThumbnailCacheBorrower = (
  nodeID: number, revision: number,
) => XDriveRoutedGalleryThumbnailLease | null
export type XDriveRoutedGalleryThumbnailBorrower = (
  contextID: string | undefined, nodeID: number, revision: number,
) => XDriveRoutedGalleryThumbnailLease | null
export type XDriveRoutedGalleryThumbnailRegistrar = (
  borrower: XDriveRoutedGalleryThumbnailCacheBorrower,
) => () => void

export class XDriveRoutedGalleryThumbnailBridge {
  private mounted: { borrower: XDriveRoutedGalleryThumbnailCacheBorrower } | null = null
  private activeContextID: string | null = null

  /** A stale Gallery cleanup cannot unregister a newer Gallery instance. */
  register: XDriveRoutedGalleryThumbnailRegistrar = (borrower) => {
    const registered = { borrower }
    this.mounted = registered
    return () => {
      if (this.mounted === registered) this.mounted = null
    }
  }

  activate = (contextID: string) => {
    this.activeContextID = typeof contextID === 'string' && contextID.length > 0
      ? contextID : null
  }

  accepts = (contextID: string | undefined) =>
    Boolean(contextID && this.activeContextID === contextID)

  /** Route exit revokes admission, not already-acquired, release-owned blobs. */
  leave = () => {
    this.activeContextID = null
  }

  borrow: XDriveRoutedGalleryThumbnailBorrower = (contextID, nodeID, revision) => {
    const registered = this.mounted
    if (!this.accepts(contextID) || !registered ||
        !Number.isSafeInteger(nodeID) || nodeID <= 0 ||
        !Number.isSafeInteger(revision) || revision <= 0) return null

    // A Gallery scheduler may be disposed during a route/Owner change. This
    // optional warm-cache fast path must not break the Viewer: null preserves
    // its ordinary authenticated, revocable thumbnail transport.
    let lease: XDriveRoutedGalleryThumbnailLease | null
    try { lease = registered.borrower(nodeID, revision) }
    catch { return null }
    if (!lease) return null
    try {
      // Check again after the borrowed callback: it can synchronously revoke
      // this route or replace the mounted Gallery. Never publish its old Blob.
      if (this.mounted === registered && this.accepts(contextID) &&
          typeof lease.url === 'string' && lease.url.startsWith('blob:') &&
          typeof lease.release === 'function') return lease
    } catch { /* A malformed optional lease is not a media authorization. */ }
    try { if (typeof lease.release === 'function') lease.release() }
    catch { /* Best-effort release cannot suppress authorized network fallback. */ }
    return null
  }
}

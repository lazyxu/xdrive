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
    if (!this.accepts(contextID) || !this.mounted ||
        !Number.isSafeInteger(nodeID) || nodeID <= 0 ||
        !Number.isSafeInteger(revision) || revision <= 0) return null
    return this.mounted.borrower(nodeID, revision)
  }
}

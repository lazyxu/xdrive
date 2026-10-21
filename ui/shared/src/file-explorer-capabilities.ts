// Common capability contract for the one FileExplorer browsing core.
// Credentials (Owner JWT / public Share token) remain private to the caller's
// data adapter and must never be passed into neutral item or Viewer components.
export type XDriveFileExplorerCapability =
  | 'list' | 'preview' | 'download' | 'downloadZip' | 'search' | 'write' | 'delete'

export type XDriveFileExplorerCapabilities = Readonly<
  Record<XDriveFileExplorerCapability, boolean>
>

export type XDriveFileExplorerSource = 'account' | 'share'

export type XDriveFileExplorerPage<TItem> = Readonly<{
  items: readonly TItem[]
  nextCursor: string | number | null
}>

// A shared *data shape*, not a way for Share grants to call Owner endpoints.
// Each adapter implements its own request authorization, ownership checks,
// root containment, revision and cancellation contract server-side.
export type XDriveFileExplorerDataAdapter<TItem, TID extends string | number> = Readonly<{
  source: XDriveFileExplorerSource
  rootID: TID
  capabilities: XDriveFileExplorerCapabilities
  list: (
    parentID: TID,
    cursor: string | number | null,
    signal: AbortSignal,
  ) => Promise<XDriveFileExplorerPage<TItem>>
  // Request-scoped media access; cancel as soon as no visible consumer needs it.
  loadPreview?: (item: TItem, requestSignal: AbortSignal) => Promise<string | null>
  // The two following operations are USER-OWNED. Their signal is controlled
  // only by explicit user cancellation, never by viewport eviction/unmount.
  download?: (item: TItem, userCancelSignal: AbortSignal) => Promise<void>
  downloadZip?: (item: TItem, userCancelSignal: AbortSignal) => Promise<void>
}>

// Fail closed for absent grants. A capability is an upper bound on the UI,
// not proof of server authorization. No Share mutation or Owner credential
// delegation is possible merely by setting a renderer-side flag.
export function xDriveResolveFileExplorerCapabilities(
  source: XDriveFileExplorerSource,
  grants: Partial<Record<XDriveFileExplorerCapability, boolean>>,
): XDriveFileExplorerCapabilities {
  const list = grants.list === true
  const preview = list && grants.preview === true
  const download = list && grants.download === true
  const downloadZip = download && grants.downloadZip === true
  const search = list && grants.search === true
  const write = source === 'account' && list && grants.write === true
  const remove = write && grants.delete === true
  return Object.freeze({
    list, preview, download, downloadZip, search, write, delete: remove,
  })
}

export const xDriveShareReadOnlyDefaultCapabilities = xDriveResolveFileExplorerCapabilities(
  'share',
  {
    list: true,
    preview: true,
    download: true,
    downloadZip: true,
    // Public Share only filters the *currently loaded 100 rows*. This must
    // never be advertised as an authorized full-subtree Search API.
    search: false,
    write: false,
    delete: false,
  },
)

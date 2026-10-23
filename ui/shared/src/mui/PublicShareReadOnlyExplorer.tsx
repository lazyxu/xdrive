import type { ReactNode } from 'react'
import type { PublicShareChild } from '../models'
import { XDrivePublicShareUnifiedDirectoryExplorer } from './PublicShareUnifiedDirectoryExplorer'

export type XDrivePublicShareExplorerCrumb = { id: number; name: string }
export type XDrivePublicShareReadOnlyExplorerProps = {
  kind: 'dir' | 'file'
  items: readonly PublicShareChild[]
  path?: readonly XDrivePublicShareExplorerCrumb[]
  folderOpened?: boolean
  pending?: boolean
  canDownload?: boolean
  // Pending native handoff is not a capability or a viewport-cancel signal.
  downloadPending?: boolean
  // Future read-only account folders and preview-only shares can narrow these
  // independently. Omitted props preserve existing Share behavior.
  canBrowse?: boolean
  canPreview?: boolean
  canDownloadZip?: boolean
  hasPreviousPage?: boolean
  hasNextPage?: boolean
  toolbarActions?: ReactNode
  onBrowse?: () => void
  onCrumbClick?: (index: number) => void
  onOpenFolder?: (entry: PublicShareChild) => void
  onDownloadItem?: (entry: PublicShareChild) => void
  onDownloadFolder?: (entry: PublicShareChild) => void
  folderZIPPreparing?: boolean
  loadImagePreview?: (entry: PublicShareChild, signal?: AbortSignal) => Promise<string | null | undefined>
  loadThumbnail?: (entry: PublicShareChild, signal?: AbortSignal) => Promise<string | null | undefined>
  onPreviousPage?: () => void
  onNextPage?: () => void
  onRefresh?: () => void
}

// Share password, expiry and durable ZIP state live in the web adapter, not
// in an independent Explorer implementation. Single-file and folder links
// MUST render the identical Owner/Share FileExplorer core.
export function XDrivePublicShareReadOnlyExplorer(props: XDrivePublicShareReadOnlyExplorerProps) {
  return <XDrivePublicShareUnifiedDirectoryExplorer {...props} />
}

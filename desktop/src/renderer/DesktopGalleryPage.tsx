import type { MediaGalleryDataSource } from '@xdrive/ui/mui'
import { XDriveMediaGalleryPage, XDriveWorkspaceSurface } from '@xdrive/ui/mui'

export function DesktopGalleryPage({
  source,
  onError,
}: {
  source: MediaGalleryDataSource
  onError: (error: unknown) => void
}) {
  return (
    <XDriveWorkspaceSurface presentation="page" title="图库">
      <XDriveMediaGalleryPage source={source} onError={onError} />
    </XDriveWorkspaceSurface>
  )
}

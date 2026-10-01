import { XDriveSourceManager } from '@xdrive/ui/mui'
import type { XDriveApi } from './api'

export default function ExternalSourcesPanel({
  api,
  defaultTargetNodeID,
  defaultTargetLabel,
  defaultTargetPath,
  onError,
}: {
  api: XDriveApi
  defaultTargetNodeID?: number
  defaultTargetLabel: string
  defaultTargetPath: string
  onError: (error: unknown) => void
}) {
  return (
    <XDriveSourceManager
      adapter={api}
      defaultTargetNodeID={defaultTargetNodeID}
      defaultTargetLabel={defaultTargetLabel}
      defaultTargetPath={defaultTargetPath}
      onError={onError}
    />
  )
}

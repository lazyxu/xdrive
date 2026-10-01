import { useMemo } from 'react'
import {
  XDriveShareDialog,
  type XDriveShareDialogAdapter,
} from '@xdrive/ui/mui'
import type { XDriveApi } from './api'
import type { Node } from '../../ui/shared/src'

export default function ShareDialog({
  api,
  node,
  onClose,
  onError,
}: {
  api: XDriveApi
  node: Node | null
  onClose: () => void
  onError: (error: unknown) => void
}) {
  const adapter = useMemo<XDriveShareDialogAdapter>(() => ({
    listShares: (nodeID) => api.shares(nodeID),
    createShare: async (nodeID, input) => {
      const created = await api.createShare(nodeID, input)
      return { url: `${window.location.origin}/#/s/${created.token}` }
    },
    revokeShare: (shareID) => api.revokeShare(shareID),
  }), [api])

  return (
    <XDriveShareDialog
      adapter={adapter}
      node={node}
      onClose={onClose}
      onError={onError}
      expiryMode="datetime"
      listVariant="table"
    />
  )
}

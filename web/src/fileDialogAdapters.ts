import {
  createXDriveShareDialogAdapter,
  createXDriveTrashDialogAdapter,
  createXDriveVersionHistoryDialogAdapter,
} from '@xdrive/ui/mui'
import type { XDriveApi } from './api'

export function createWebTrashDialogAdapter(api: XDriveApi) {
  return createXDriveTrashDialogAdapter({
    listTrash: () => api.trash(),
    restoreTrash: (nodeID, revision) => api.restoreTrash(nodeID, revision),
    deleteTrash: (nodeID, revision) => api.permanentlyDeleteTrash(nodeID, revision),
  })
}

export function createWebVersionHistoryDialogAdapter(api: XDriveApi) {
  return createXDriveVersionHistoryDialogAdapter({
    listVersions: (nodeID) => api.versions(nodeID),
    restoreVersion: (nodeID, revision, versionID) =>
      api.restoreVersion(nodeID, revision, versionID),
    downloadVersion: (node, version) =>
      api.downloadVersion(node, version).then(() => undefined),
  })
}

export function createWebShareDialogAdapter(api: XDriveApi) {
  return createXDriveShareDialogAdapter({
    listShares: (nodeID) => api.shares(nodeID),
    createShare: (nodeID, input) => api.createShare(nodeID, input),
    revokeShare: (shareID) => api.revokeShare(shareID),
  }, {
    shareURL: (created) => {
      if (!created.token) throw new Error('Share token missing from Web response.')
      return `${window.location.origin}/#/s/${created.token}`
    },
  })
}

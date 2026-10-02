import type {
  XDriveTrashDialogAdapter,
  XDriveVersionHistoryDialogAdapter,
} from '@xdrive/ui/mui'
import type { XDriveApi } from './api'

export function createWebTrashDialogAdapter(api: XDriveApi): XDriveTrashDialogAdapter {
  return {
    listTrash: () => api.trash(),
    restoreTrash: (node) => api.restoreTrash(node.id, node.revision),
    deleteTrash: (node) => api.permanentlyDeleteTrash(node.id, node.revision),
  }
}

export function createWebVersionHistoryDialogAdapter(api: XDriveApi): XDriveVersionHistoryDialogAdapter {
  return {
    listVersions: (nodeID) => api.versions(nodeID),
    restoreVersion: (node, version) => api.restoreVersion(node.id, node.revision, version.id),
    downloadVersion: (node, version) => api.downloadVersion(node, version),
  }
}

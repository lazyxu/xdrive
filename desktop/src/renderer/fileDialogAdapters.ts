import {
  createXDriveShareDialogAdapter,
  createXDriveTrashDialogAdapter,
  createXDriveVersionHistoryDialogAdapter,
} from '@xdrive/ui/mui'

const agent = () => window.xdriveDesktop.agent

export const desktopTrashDialogAdapter = createXDriveTrashDialogAdapter({
  listTrash: () => agent().cloudTrash(),
  listTrashRange: (request) => agent().cloudTrashRange(
    request.offset,
    request.limit,
    request.sort,
    request.order,
    request.includeCount,
  ),
  restoreTrash: (nodeID, revision) => agent().cloudRestoreTrash(nodeID, revision),
  deleteTrash: (nodeID, revision) => agent().cloudDeleteTrash(nodeID, revision),
})

export const desktopVersionHistoryDialogAdapter = createXDriveVersionHistoryDialogAdapter({
  listVersions: (nodeID) => agent().cloudVersions(nodeID),
  restoreVersion: (nodeID, revision, versionID) =>
    agent().cloudRestoreVersion(nodeID, revision, versionID),
})

export const desktopShareDialogAdapter = createXDriveShareDialogAdapter({
  listShares: (nodeID) => agent().cloudShares(nodeID),
  createShare: (nodeID, input) => agent().cloudCreateShare(nodeID, input),
  revokeShare: (shareID) => agent().cloudRevokeShare(shareID),
})

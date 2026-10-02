import type {
  XDriveTrashDialogAdapter,
  XDriveVersionHistoryDialogAdapter,
} from '@xdrive/ui/mui'

type DesktopResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string; code?: string; detail?: string } }

function unwrap<T>(result: DesktopResult<T>): T {
  if (result.ok) return result.data
  const error = new Error(result.error.message) as Error & { code?: string; detail?: string }
  error.code = result.error.code
  error.detail = result.error.detail
  throw error
}

export const desktopTrashDialogAdapter: XDriveTrashDialogAdapter = {
  async listTrash() {
    return unwrap(await window.xdriveDesktop.agent.cloudTrash())
  },
  async restoreTrash(node) {
    return unwrap(await window.xdriveDesktop.agent.cloudRestoreTrash(node.id, node.revision))
  },
  async deleteTrash(node) {
    return unwrap(await window.xdriveDesktop.agent.cloudDeleteTrash(node.id, node.revision))
  },
}

export const desktopVersionHistoryDialogAdapter: XDriveVersionHistoryDialogAdapter = {
  async listVersions(nodeID) {
    return unwrap(await window.xdriveDesktop.agent.cloudVersions(nodeID))
  },
  async restoreVersion(node, version) {
    return unwrap(await window.xdriveDesktop.agent.cloudRestoreVersion(node.id, node.revision, version.id))
  },
}

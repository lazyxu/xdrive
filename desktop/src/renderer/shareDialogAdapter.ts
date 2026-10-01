import type { XDriveShareDialogAdapter } from '@xdrive/ui/mui'

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

export const desktopShareDialogAdapter: XDriveShareDialogAdapter = {
  async listShares(nodeID) {
    return unwrap(await window.xdriveDesktop.agent.cloudShares(nodeID))
  },

  async createShare(nodeID, input) {
    const created = unwrap(await window.xdriveDesktop.agent.cloudCreateShare(nodeID, input))
    return { url: created.url }
  },

  async revokeShare(shareID) {
    return unwrap(await window.xdriveDesktop.agent.cloudRevokeShare(shareID))
  },
}

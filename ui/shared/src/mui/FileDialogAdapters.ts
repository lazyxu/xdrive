import type {
  FileShare,
  FileVersion,
  Node,
} from '../models'
import type { XDriveShareCreateInput, XDriveShareDialogAdapter } from './ShareDialog'
import type { XDriveTrashDialogAdapter } from './TrashDialog'
import type { XDriveVersionHistoryDialogAdapter } from './VersionHistoryDialog'

export type XDriveFileDialogTransportError = {
  message: string
  code?: string
  detail?: string
}

export type XDriveFileDialogTransportResult<T> =
  | T
  | { ok: true; data: T }
  | { ok: false; error: XDriveFileDialogTransportError }

function isWrappedTransportResult<T>(
  value: XDriveFileDialogTransportResult<T>,
): value is
  | { ok: true; data: T }
  | { ok: false; error: XDriveFileDialogTransportError } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'ok' in value &&
    ('data' in value || 'error' in value),
  )
}

export async function resolveXDriveFileDialogTransport<T>(
  value: Promise<XDriveFileDialogTransportResult<T>>,
): Promise<T> {
  const result = await value
  if (!isWrappedTransportResult(result)) return result
  if (result.ok) return result.data
  const error = new Error(result.error.message) as Error & {
    code?: string
    detail?: string
  }
  error.code = result.error.code
  error.detail = result.error.detail
  throw error
}

export interface XDriveTrashDialogPort {
  listTrash: () => Promise<XDriveFileDialogTransportResult<Node[]>>
  restoreTrash: (
    nodeID: number,
    revision: number,
  ) => Promise<XDriveFileDialogTransportResult<Node | void>>
  deleteTrash: (
    nodeID: number,
    revision: number,
  ) => Promise<XDriveFileDialogTransportResult<unknown>>
}

export function createXDriveTrashDialogAdapter(
  port: XDriveTrashDialogPort,
): XDriveTrashDialogAdapter {
  return {
    listTrash: () => resolveXDriveFileDialogTransport(port.listTrash()),
    restoreTrash: (node) => resolveXDriveFileDialogTransport(
      port.restoreTrash(node.id, node.revision),
    ),
    deleteTrash: (node) => resolveXDriveFileDialogTransport(
      port.deleteTrash(node.id, node.revision),
    ),
  }
}

export interface XDriveVersionHistoryDialogPort {
  listVersions: (
    nodeID: number,
  ) => Promise<XDriveFileDialogTransportResult<FileVersion[]>>
  restoreVersion: (
    nodeID: number,
    revision: number,
    versionID: number,
  ) => Promise<XDriveFileDialogTransportResult<Node>>
  downloadVersion?: (
    node: Node,
    version: FileVersion,
  ) => Promise<XDriveFileDialogTransportResult<unknown>>
}

export function createXDriveVersionHistoryDialogAdapter(
  port: XDriveVersionHistoryDialogPort,
): XDriveVersionHistoryDialogAdapter {
  return {
    listVersions: (nodeID) => resolveXDriveFileDialogTransport(
      port.listVersions(nodeID),
    ),
    restoreVersion: (node, version) => resolveXDriveFileDialogTransport(
      port.restoreVersion(node.id, node.revision, version.id),
    ),
    downloadVersion: port.downloadVersion
      ? async (node, version) => {
          await resolveXDriveFileDialogTransport(
            port.downloadVersion!(node, version),
          )
        }
      : undefined,
  }
}

export type XDriveCreatedShareTransport = {
  url?: string
  token?: string
}

export interface XDriveShareDialogPort {
  listShares: (
    nodeID: number,
  ) => Promise<XDriveFileDialogTransportResult<FileShare[]>>
  createShare: (
    nodeID: number,
    input: XDriveShareCreateInput,
  ) => Promise<XDriveFileDialogTransportResult<XDriveCreatedShareTransport>>
  revokeShare: (
    shareID: number,
  ) => Promise<XDriveFileDialogTransportResult<unknown>>
}

export function createXDriveShareDialogAdapter(
  port: XDriveShareDialogPort,
  {
    shareURL,
  }: {
    shareURL?: (created: XDriveCreatedShareTransport) => string
  } = {},
): XDriveShareDialogAdapter {
  return {
    listShares: (nodeID) => resolveXDriveFileDialogTransport(
      port.listShares(nodeID),
    ),
    createShare: async (nodeID, input) => {
      const created = await resolveXDriveFileDialogTransport(
        port.createShare(nodeID, input),
      )
      const url = created.url || shareURL?.(created)
      if (!url) throw new Error('Share transport did not return a usable URL.')
      return { url }
    },
    revokeShare: (shareID) => resolveXDriveFileDialogTransport(
      port.revokeShare(shareID),
    ),
  }
}

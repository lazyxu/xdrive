import type {
  FileShare,
  FileVersion,
  Node,
} from '../models'
import type { XDriveCloudFilesRange } from '../cloud-files'
import { resolveXDriveTransport } from '../transport-result'
import type {
  XDriveTransportError,
  XDriveTransportResult,
} from '../transport-result'
import type { XDriveShareCreateInput, XDriveShareDialogAdapter } from './ShareDialog'
import type {
  XDriveTrashDialogAdapter,
  XDriveTrashRangeRequest,
} from './TrashDialog'
import type { XDriveVersionHistoryDialogAdapter } from './VersionHistoryDialog'

export type XDriveFileDialogTransportError = XDriveTransportError

export type XDriveFileDialogTransportResult<T> =
  XDriveTransportResult<T, XDriveFileDialogTransportError>

export function resolveXDriveFileDialogTransport<T>(
  value: Promise<XDriveFileDialogTransportResult<T>>,
): Promise<T> {
  return resolveXDriveTransport(value)
}

export interface XDriveTrashDialogPort {
  listTrash: () => Promise<XDriveFileDialogTransportResult<Node[]>>
  listTrashRange?: (
    request: XDriveTrashRangeRequest,
  ) => Promise<XDriveFileDialogTransportResult<XDriveCloudFilesRange<Node>>>
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
    listTrashRange: port.listTrashRange
      ? (request) => resolveXDriveFileDialogTransport(port.listTrashRange!(request))
      : undefined,
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

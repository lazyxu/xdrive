import { useEffect, useMemo } from 'react'
import { XDriveFileQuickLookDialog } from './FileQuickLookDialog'
import type { XDriveFileExplorerItem } from './FileExplorer'
import { xDriveClassifyFilePreview, xDriveFileSupportsTextPreview } from '../file-preview'
import { xDriveSynologyLoadOwnerThumbnail } from '../synology-owner-thumbnail'
import { xDriveSynologyLoadViewerPreview, xDriveSynologyViewerNeedsDerived } from '../synology-viewer-preview'
import { xDriveSynologyLoadBoundedMediaPreview, xDriveSynologyPreviewMIME, XDRIVE_SYNOLOGY_MEDIA_BLOB_MAX_BYTES } from '../synology-media-preview'
import { xDriveSynologyLoadNativeMediaStream, xDriveSynologyPlaybackMIME } from '../synology-media-stream'
import type { XDriveSynologyBackupLocalClient, XDriveSynologyClipboardFileReference } from '../synology-backup-adapter'

export type XDriveDSMClipboardViewerSelection = {
  ownerScope: string
  file: XDriveSynologyClipboardFileReference
}

/**
 * Reuse the SAME Files Quick Look and existing bounded Owner media readers.
 * A decrypted Clipboard asset:<id> is a locator, NEVER read authorization.
 * The authenticated CGI/Agent independently proves Node/revision/location;
 * every file byte request remains on the original Owner Files permission path.
 */
export function XDriveSynologyClipboardReferenceViewer({
  client, currentOwnerScope, selection, onClose,
}: {
  client: XDriveSynologyBackupLocalClient
  currentOwnerScope: string
  selection: XDriveDSMClipboardViewerSelection | null
  onClose: () => void
}) {
  const item = useMemo<XDriveFileExplorerItem | null>(() => {
    if (!selection || selection.ownerScope !== currentOwnerScope) return null
    const node = selection.file.node
    return {
      id: node.id, name: node.name, kind: 'file', size: node.size,
      revision: node.revision, createdAt: node.created_at, updatedAt: node.updated_at,
    }
  }, [selection, currentOwnerScope])
  useEffect(() => {
    if (selection && !item) onClose()
  }, [selection, item, onClose])

  const verified = async (signal?: AbortSignal) => {
    signal?.throwIfAborted()
    if (!item || !selection || selection.ownerScope !== currentOwnerScope)
      throw new Error('Clipboard 文件 Owner 已变化')
    const connection = await client.serverConnection(signal)
    if (!connection.configured || connection.must_change_password ||
        !connection.owner_scope || connection.owner_scope !== selection.ownerScope) {
      throw new Error('Clipboard 文件 Owner 授权已失效')
    }
    signal?.throwIfAborted()
  }
  const checkRead = async (signal: AbortSignal | undefined,
    read: () => Promise<string | null>,
  ) => {
    await verified(signal)
    const data = await read()
    try {
      await verified(signal)
    } catch (error) {
      // A late byte completion after Owner switch must not keep a borrowed
      // blob URL alive or show it under another current user.
      if (data?.startsWith('blob:')) URL.revokeObjectURL(data)
      throw error
    }
    return data
  }
  const mediaURL = (file: XDriveFileExplorerItem,
    kind: 'image' | 'video' | 'audio' | 'pdf' | 'live_photo',
    signal?: AbortSignal,
    onProgress?: import('../file-preview').XDriveByteProgressHandler,
  ) => checkRead(signal, () => {
    if ((kind === 'video' || kind === 'audio') && xDriveSynologyPlaybackMIME(file.name))
      return xDriveSynologyLoadNativeMediaStream(client, file, signal)
    if (kind === 'pdf' && (file.size ?? 0) > XDRIVE_SYNOLOGY_MEDIA_BLOB_MAX_BYTES &&
        xDriveSynologyPreviewMIME(file.name) === 'application/pdf')
      return xDriveSynologyLoadNativeMediaStream(client, file, signal)
    if ((kind === 'image' || kind === 'live_photo') &&
        (xDriveSynologyViewerNeedsDerived(file.name) ||
         (file.size ?? 0) > XDRIVE_SYNOLOGY_MEDIA_BLOB_MAX_BYTES))
      return xDriveSynologyLoadViewerPreview(client, file, signal, onProgress)
    if ((kind === 'image' || kind === 'pdf') && xDriveSynologyPreviewMIME(file.name))
      return xDriveSynologyLoadBoundedMediaPreview(client, file, signal, onProgress)
    throw new Error('当前 DSM 文件 Viewer 不支持此媒体类型')
  })
  return (
    <XDriveFileQuickLookDialog
      key={selection ? selection.ownerScope + ':' + selection.file.node.id + ':' + selection.file.node.revision : 'closed'}
      open={!!item}
      item={item}
      subtitle="已由当前 Owner Files API 重新核验；剪贴板消息不提供文件读取权限"
      loadTextPreview={async (file, signal) => {
        if (!xDriveFileSupportsTextPreview(file.name, file.kind)) return null
        await verified(signal)
        const response = await client.ownerFileTextPreview(Number(file.id), signal)
        await verified(signal)
        return response
      }}
      loadImagePreview={(file, signal, progress) =>
        checkRead(signal, () => xDriveSynologyLoadOwnerThumbnail(client, file, signal, progress))}
      loadPreviewURL={mediaURL}
      onClose={onClose}
    />
  )
}

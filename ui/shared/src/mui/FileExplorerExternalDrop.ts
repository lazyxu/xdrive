import { useCallback, useEffect, useRef } from 'react'
import type { Node } from '../models'
import type { XDriveFileExplorerGrouping } from '../file-explorer-grouping'
import { xDriveFileExplorerExternalDropParentID } from '../file-explorer-controller'
import type {
  XDriveFileExplorerFolderUploadEntry,
  XDriveFileExplorerSelectionItem,
} from '../file-explorer-controller'

export type XDriveFileExplorerExternalDropPayload = {
  files: XDriveFileExplorerFolderUploadEntry<File>[]
  directories: string[]
}

export type XDriveFileExplorerExternalDropControllerOptions<
  TNode extends Pick<Node, 'id' | 'type'>,
  TCrumb extends { id: string | number; name: string },
  TSort,
> = {
  lifecycleKey: string
  currentID?: number
  currentCrumbs: readonly TCrumb[]
  sort: TSort
  currentGrouping: XDriveFileExplorerGrouping
  nodeByID: ReadonlyMap<number, TNode>
  disabled?: boolean
  folderDropEnabled?: boolean
  uploadFilesToParent: (parentID: number, files: File[]) => Promise<boolean | void>
  uploadFolderEntriesToParent: (
    parentID: number,
    payload: XDriveFileExplorerExternalDropPayload,
  ) => Promise<boolean | void>
  refreshCurrentDirectoryIfIdle: (
    expectedCurrentID: number | undefined,
  ) => Promise<boolean | void>
}

export function useXDriveFileExplorerExternalDropController<
  TNode extends Pick<Node, 'id' | 'type'>,
  TCrumb extends { id: string | number; name: string },
  TSort,
>({
  lifecycleKey,
  currentID,
  nodeByID,
  disabled = false,
  folderDropEnabled = true,
  uploadFilesToParent,
  uploadFolderEntriesToParent,
  refreshCurrentDirectoryIfIdle,
}: XDriveFileExplorerExternalDropControllerOptions<TNode, TCrumb, TSort>) {
  const lifecycleKeyRef = useRef<string | null>(lifecycleKey)
  lifecycleKeyRef.current = lifecycleKey

  useEffect(() => {
    lifecycleKeyRef.current = lifecycleKey
    return () => {
      if (lifecycleKeyRef.current === lifecycleKey) {
        lifecycleKeyRef.current = null
      }
    }
  }, [lifecycleKey])

  const isCurrentLifecycle = useCallback(
    () => lifecycleKeyRef.current === lifecycleKey,
    [lifecycleKey],
  )

  const dropFilesToParent = useCallback(async (files: File[], parentID: number) => {
    if (!isCurrentLifecycle() || disabled || files.length === 0) return
    const expectedCurrentID = currentID
    const shouldRefresh = await uploadFilesToParent(parentID, files)
    if (!isCurrentLifecycle()) return
    if (shouldRefresh !== false) {
      await refreshCurrentDirectoryIfIdle(expectedCurrentID)
    }
  }, [
    currentID,
    disabled,
    isCurrentLifecycle,
    refreshCurrentDirectoryIfIdle,
    uploadFilesToParent,
  ])

  const dropFiles = useCallback(async (
    files: File[],
    target?: XDriveFileExplorerSelectionItem,
  ) => {
    if (currentID === undefined || disabled || files.length === 0) return
    const parentID = xDriveFileExplorerExternalDropParentID(currentID, target, nodeByID)
    await dropFilesToParent(files, parentID)
  }, [currentID, disabled, dropFilesToParent, nodeByID])

  const dropFolderEntriesToParent = useCallback(async (
    payload: XDriveFileExplorerExternalDropPayload,
    parentID: number,
  ) => {
    if (
      !isCurrentLifecycle() ||
      disabled ||
      !folderDropEnabled ||
      (payload.files.length === 0 && payload.directories.length === 0)
    ) return
    const expectedCurrentID = currentID
    const shouldRefresh = await uploadFolderEntriesToParent(parentID, payload)
    if (!isCurrentLifecycle()) return
    if (shouldRefresh !== false) {
      await refreshCurrentDirectoryIfIdle(expectedCurrentID)
    }
  }, [
    currentID,
    disabled,
    folderDropEnabled,
    isCurrentLifecycle,
    refreshCurrentDirectoryIfIdle,
    uploadFolderEntriesToParent,
  ])

  const dropFolderEntries = useCallback(async (
    payload: XDriveFileExplorerExternalDropPayload,
    target?: XDriveFileExplorerSelectionItem,
  ) => {
    if (currentID === undefined || disabled || !folderDropEnabled) return
    const parentID = xDriveFileExplorerExternalDropParentID(currentID, target, nodeByID)
    await dropFolderEntriesToParent(payload, parentID)
  }, [
    currentID,
    disabled,
    dropFolderEntriesToParent,
    folderDropEnabled,
    nodeByID,
  ])

  const dropFilesToCrumb = useCallback(async (files: File[], crumb: { id: string | number }) => {
    if (currentID === undefined) return
    await dropFilesToParent(files, Number(crumb.id))
  }, [currentID, dropFilesToParent])

  const dropFolderEntriesToCrumb = useCallback(async (
    payload: XDriveFileExplorerExternalDropPayload,
    crumb: { id: string | number },
  ) => {
    if (currentID === undefined) return
    await dropFolderEntriesToParent(payload, Number(crumb.id))
  }, [currentID, dropFolderEntriesToParent])

  return {
    dropFiles,
    dropFilesToCrumb,
    dropFolderEntries,
    dropFolderEntriesToCrumb,
  }
}

type XDriveLegacyFileSystemEntry = {
  isFile: boolean
  isDirectory: boolean
  name: string
}

type XDriveLegacyFileSystemFileEntry = XDriveLegacyFileSystemEntry & {
  file: (
    success: (file: File) => void,
    failure?: (error: unknown) => void,
  ) => void
}

type XDriveLegacyFileSystemDirectoryReader = {
  readEntries: (
    success: (entries: XDriveLegacyFileSystemEntry[]) => void,
    failure?: (error: unknown) => void,
  ) => void
}

type XDriveLegacyFileSystemDirectoryEntry = XDriveLegacyFileSystemEntry & {
  createReader: () => XDriveLegacyFileSystemDirectoryReader
}

function xDriveFileExplorerDroppedFile(
  entry: XDriveLegacyFileSystemFileEntry,
) {
  return new Promise<File>((resolve, reject) => entry.file(resolve, reject))
}

async function xDriveFileExplorerDroppedDirectoryEntries(
  entry: XDriveLegacyFileSystemDirectoryEntry,
) {
  const reader = entry.createReader()
  const entries: XDriveLegacyFileSystemEntry[] = []
  while (true) {
    const batch = await new Promise<XDriveLegacyFileSystemEntry[]>((resolve, reject) => (
      reader.readEntries(resolve, reject)
    ))
    if (batch.length === 0) return entries
    entries.push(...batch)
  }
}

async function xDriveFileExplorerReadDroppedEntry(
  entry: XDriveLegacyFileSystemEntry,
  parentPath: string,
  files: XDriveFileExplorerFolderUploadEntry<File>[],
  directories: Set<string>,
) {
  const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name
  if (entry.isDirectory) {
    directories.add(relativePath)
    const children = await xDriveFileExplorerDroppedDirectoryEntries(
      entry as XDriveLegacyFileSystemDirectoryEntry,
    )
    for (const child of children) {
      await xDriveFileExplorerReadDroppedEntry(child, relativePath, files, directories)
    }
    return
  }
  if (!entry.isFile) return
  const file = await xDriveFileExplorerDroppedFile(entry as XDriveLegacyFileSystemFileEntry)
  files.push({ file, relativePath })
}

export async function xDriveFileExplorerReadExternalDrop(
  dataTransfer: Pick<DataTransfer, 'items' | 'files'>,
): Promise<XDriveFileExplorerExternalDropPayload> {
  const files: XDriveFileExplorerFolderUploadEntry<File>[] = []
  const directories = new Set<string>()
  const items = Array.from(dataTransfer.items)

  for (const item of items) {
    if (item.kind !== 'file') continue
    const getEntry = (
      item as unknown as {
        webkitGetAsEntry?: () => XDriveLegacyFileSystemEntry | null
      }
    ).webkitGetAsEntry
    const entry = getEntry?.call(item)
    if (entry) {
      await xDriveFileExplorerReadDroppedEntry(entry, '', files, directories)
      continue
    }
    const file = item.getAsFile()
    if (file) files.push({ file, relativePath: file.name })
  }

  if (items.length === 0) {
    for (const file of Array.from(dataTransfer.files)) {
      files.push({ file, relativePath: file.name })
    }
  }

  return {
    files,
    directories: [...directories],
  }
}

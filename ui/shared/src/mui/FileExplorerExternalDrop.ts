import type { XDriveFileExplorerFolderUploadEntry } from '../file-explorer-controller'

export type XDriveFileExplorerExternalDropPayload = {
  files: XDriveFileExplorerFolderUploadEntry<File>[]
  directories: string[]
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

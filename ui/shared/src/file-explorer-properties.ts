export type XDriveFileExplorerPropertiesSource = {
  id: number
  name: string
  kind: string
}

export type XDriveFileExplorerPropertiesStats = {
  selected_count: number
  effective_root_count: number
  total_bytes: number
  file_count: number
  folder_count: number
  sources?: XDriveFileExplorerPropertiesSource[]
}

export type XDriveFileExplorerPropertiesRef = {
  id: number
  revision: number
}

export function xDriveFileExplorerPropertiesRefs(
  items: readonly {
    id: string | number
    revision?: string | number
  }[],
): XDriveFileExplorerPropertiesRef[] {
  return items.map((item) => {
    const id = Number(item.id)
    const revision = Number(item.revision)
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      !Number.isSafeInteger(revision) ||
      revision <= 0
    ) {
      throw new Error('属性统计需要有效的文件 ID 和 Revision。')
    }
    return { id, revision }
  })
}

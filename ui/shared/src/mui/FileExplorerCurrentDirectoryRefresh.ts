import { useCallback, useRef } from 'react'
import type { XDriveFileExplorerGrouping } from '../file-explorer-grouping'

export function useXDriveFileExplorerCurrentDirectoryRefresh<
  TCrumb extends { id: string | number; name: string },
  TSort,
>({
  currentID,
  currentCrumbs,
  sort,
  currentGrouping,
  refreshDirectory,
}: {
  currentID?: number
  currentCrumbs: readonly TCrumb[]
  sort: TSort
  currentGrouping: XDriveFileExplorerGrouping
  refreshDirectory: (
    id: number,
    crumbs: TCrumb[],
    sort: TSort,
    grouping: XDriveFileExplorerGrouping,
  ) => Promise<void>
}) {
  const contextRef = useRef({
    currentID,
    currentCrumbs,
    sort,
    grouping: currentGrouping,
    refreshDirectory,
  })
  contextRef.current = {
    currentID,
    currentCrumbs,
    sort,
    grouping: currentGrouping,
    refreshDirectory,
  }

  return useCallback(async (expectedCurrentID: number | undefined) => {
    const latest = contextRef.current
    if (
      expectedCurrentID === undefined ||
      latest.currentID !== expectedCurrentID
    ) return false

    await latest.refreshDirectory(
      latest.currentID,
      [...latest.currentCrumbs],
      latest.sort,
      latest.grouping,
    )
    return true
  }, [])
}

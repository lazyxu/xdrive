import { useCallback, useRef } from 'react'

export function useXDriveFileExplorerCurrentDirectoryRefresh<
  TCrumb extends { id: string | number; name: string },
  TSort,
>({
  currentID,
  currentCrumbs,
  sort,
  refreshDirectory,
}: {
  currentID?: number
  currentCrumbs: readonly TCrumb[]
  sort: TSort
  refreshDirectory: (
    id: number,
    crumbs: TCrumb[],
    sort: TSort,
  ) => Promise<void>
}) {
  const contextRef = useRef({
    currentID,
    currentCrumbs,
    sort,
    refreshDirectory,
  })
  contextRef.current = {
    currentID,
    currentCrumbs,
    sort,
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
    )
    return true
  }, [])
}

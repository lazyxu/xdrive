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
  refreshDirectory: (id: number, crumbs: TCrumb[], sort: TSort) => Promise<void>
}) {
  const currentContextRef = useRef({
    currentID,
    currentCrumbs,
    sort,
  })
  currentContextRef.current = {
    currentID,
    currentCrumbs,
    sort,
  }

  return useCallback(async (expectedCurrentID: number | undefined) => {
    const latest = currentContextRef.current
    if (
      expectedCurrentID === undefined ||
      latest.currentID !== expectedCurrentID
    ) return false

    await refreshDirectory(
      latest.currentID,
      [...latest.currentCrumbs],
      latest.sort,
    )
    return true
  }, [refreshDirectory])
}

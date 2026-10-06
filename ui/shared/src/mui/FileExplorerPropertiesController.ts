import { useEffect, useRef, useState } from 'react'
import type { XDriveFileExplorerPropertiesStats } from '../file-explorer-properties'

type XDriveFileExplorerPropertiesItem = {
  id: string | number
  kind: 'dir' | 'file'
  revision?: string | number
}

export type XDriveFileExplorerPropertiesLoader<
  TItem extends XDriveFileExplorerPropertiesItem,
> = (
  items: readonly TItem[],
  signal: AbortSignal,
) => Promise<XDriveFileExplorerPropertiesStats>

export function useXDriveFileExplorerPropertiesController<
  TItem extends XDriveFileExplorerPropertiesItem,
>({
  items,
  loadStats,
}: {
  items: readonly TItem[]
  loadStats?: XDriveFileExplorerPropertiesLoader<TItem>
}) {
  const [stats, setStats] = useState<XDriveFileExplorerPropertiesStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestIDRef = useRef(0)

  useEffect(() => {
    const requestID = ++requestIDRef.current
    setStats(null)
    setLoading(false)
    setError('')

    if (
      items.length === 0 ||
      !items.some((item) => item.kind === 'dir') ||
      !loadStats
    ) {
      return
    }

    const controller = new AbortController()
    setLoading(true)

    void Promise.resolve()
      .then(() => loadStats(items, controller.signal))
      .then((value) => {
        if (controller.signal.aborted || requestID !== requestIDRef.current) return
        setStats(value)
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted || requestID !== requestIDRef.current) return
        setError(requestError instanceof Error ? requestError.message : String(requestError))
      })
      .finally(() => {
        if (controller.signal.aborted || requestID !== requestIDRef.current) return
        setLoading(false)
      })

    return () => {
      controller.abort()
    }
  }, [items, loadStats])

  return {
    stats,
    loading,
    error,
  }
}

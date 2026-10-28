import { useEffect, useRef, useState } from 'react'
import type { XDriveFileExplorerSearchSourceOption } from '../file-explorer-search'
import { useXDriveFileExplorerOwnerFence } from './FileExplorerOwnerFence'

type OwnerSourceSnapshot<THost extends object> = {
  host: THost
  ownerKey: string
  options: readonly XDriveFileExplorerSearchSourceOption[]
  status: 'ready' | 'error'
}

const EMPTY_SOURCE_OPTIONS: readonly XDriveFileExplorerSearchSourceOption[] = []

/**
 * One authenticated Files Source-filter read lifecycle for Web and Desktop.
 *
 * A new Host or Owner hides old options synchronously during render, before
 * passive cleanup. Late promises and rejected old-Owner responses cannot
 * publish rows or errors into the next account. The returned status never
 * interprets an unverified/failed read as an authoritative empty Source list.
 *
 * This hook is not a transport or an authorization boundary. Each Host read
 * must still independently enforce Server/Agent Owner permissions.
 */
export function useXDriveFileExplorerOwnerSourceOptions<THost extends object>({
  host,
  ownerKey,
  read,
  onError,
}: {
  host: THost
  ownerKey: string
  read: () => Promise<readonly XDriveFileExplorerSearchSourceOption[]>
  onError?: (error: unknown) => void
}) {
  const { isCurrent } = useXDriveFileExplorerOwnerFence(host, ownerKey)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const [snapshot, setSnapshot] = useState<OwnerSourceSnapshot<THost> | null>(null)

  useEffect(() => {
    let active = true
    setSnapshot(null)
    void (async () => {
      try {
        const sources = await read()
        if (!active || !isCurrent()) return
        setSnapshot({
          host, ownerKey, status: 'ready',
          options: sources.map(({ id, name }) => ({ id, name })),
        })
      } catch (error) {
        if (!active || !isCurrent()) return
        setSnapshot({ host, ownerKey, status: 'error', options: EMPTY_SOURCE_OPTIONS })
        onErrorRef.current?.(error)
      }
    })()
    return () => { active = false }
  }, [host, ownerKey, read, isCurrent])

  const current = snapshot?.host === host && snapshot.ownerKey === ownerKey ? snapshot : null
  return {
    options: current?.options ?? EMPTY_SOURCE_OPTIONS,
    status: current?.status ?? 'unverified',
  }
}

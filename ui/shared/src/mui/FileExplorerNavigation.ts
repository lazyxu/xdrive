import { useEffect, useState } from 'react'
import { XDRIVE_FILE_EXPLORER_DEFAULT_SORT } from '../file-explorer-controller'
import type {
  XDriveFileExplorerCrumb,
  XDriveFileExplorerSort,
  XDriveFileExplorerViewMode,
} from './FileExplorer'

function loadStoredViewMode(storageKey: string): XDriveFileExplorerViewMode {
  if (typeof window === 'undefined') return 'details'
  return window.localStorage.getItem(storageKey) === 'grid' ? 'grid' : 'details'
}

export function useXDriveFileExplorerNavigation<TCrumb extends XDriveFileExplorerCrumb>({
  crumbs,
  viewModeStorageKey,
  searchActive = false,
  onLoadDirectory,
  onAfterNavigate,
}: {
  crumbs: TCrumb[]
  viewModeStorageKey: string
  searchActive?: boolean
  onLoadDirectory: (id: TCrumb['id'], crumbs: TCrumb[], sort: XDriveFileExplorerSort) => Promise<void>
  onAfterNavigate?: () => void
}) {
  const [viewMode, setViewMode] = useState<XDriveFileExplorerViewMode>(
    () => loadStoredViewMode(viewModeStorageKey),
  )
  const [sort, setSort] = useState<XDriveFileExplorerSort>(XDRIVE_FILE_EXPLORER_DEFAULT_SORT)
  const [history, setHistory] = useState<TCrumb[][]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const current = crumbs.at(-1)
  const pathValue = crumbs.map((crumb) => crumb.name).join('/')

  useEffect(() => {
    if (crumbs.length === 0 || history.length > 0) return
    setHistory([crumbs])
    setHistoryIndex(0)
  }, [crumbs, history.length])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(viewModeStorageKey, viewMode)
  }, [viewMode, viewModeStorageKey])

  const changeSort = (nextSort: XDriveFileExplorerSort) => {
    setSort(nextSort)
    if (searchActive) return
    if (current) void onLoadDirectory(current.id, crumbs, nextSort)
  }

  const recordHistory = (nextCrumbs: TCrumb[]) => {
    setHistory((currentHistory) => {
      const next = [...currentHistory.slice(0, historyIndex + 1), nextCrumbs]
      setHistoryIndex(next.length - 1)
      return next
    })
  }

  const finishNavigation = () => {
    onAfterNavigate?.()
  }

  const navigateTo = async (nextCrumbs: TCrumb[], record = true) => {
    const target = nextCrumbs.at(-1)
    if (!target) return
    await onLoadDirectory(target.id, nextCrumbs, sort)
    if (record) recordHistory(nextCrumbs)
    finishNavigation()
  }

  const goBack = async () => {
    if (historyIndex <= 0) return
    const nextIndex = historyIndex - 1
    const next = history[nextIndex]
    const target = next?.at(-1)
    if (!target) return
    await onLoadDirectory(target.id, next, sort)
    setHistoryIndex(nextIndex)
    finishNavigation()
  }

  const goForward = async () => {
    if (historyIndex < 0 || historyIndex >= history.length - 1) return
    const nextIndex = historyIndex + 1
    const next = history[nextIndex]
    const target = next?.at(-1)
    if (!target) return
    await onLoadDirectory(target.id, next, sort)
    setHistoryIndex(nextIndex)
    finishNavigation()
  }

  const goUp = async () => {
    if (crumbs.length <= 1) return
    await navigateTo(crumbs.slice(0, -1))
  }

  const navigateToCrumb = async (index: number) => {
    if (index < 0 || index >= crumbs.length) return
    await navigateTo(crumbs.slice(0, index + 1))
  }

  return {
    current,
    pathValue,
    viewMode,
    setViewMode,
    sort,
    changeSort,
    navigateTo,
    navigateToCrumb,
    goBack,
    goForward,
    goUp,
    canGoBack: historyIndex > 0,
    canGoForward: historyIndex >= 0 && historyIndex < history.length - 1,
    canGoUp: crumbs.length > 1,
  }
}

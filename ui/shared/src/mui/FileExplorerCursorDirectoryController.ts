import { useCallback, useEffect, useRef, useState } from 'react'
import { useXDriveFileExplorerOwnerFence } from './FileExplorerOwnerFence'
import { xDriveFileExplorerReadDirectoryPage } from './FileExplorerDirectoryReadStrategy'

/**
 * Authenticated Owner cursor reader shared by the Files workspace.
 *
 * A Host supplies only its actual authorized root/page endpoints; this reader
 * does not have an Electron/DSM dependency and cannot synthesize write methods.
 * Unlike indexed Desktop ranges, a cursor cannot be randomly addressed.
 */
export type XDriveFileExplorerCursorPage<TNode extends { id: number }> = {
  items: TNode[]
  has_more: boolean
  next_cursor?: string
}
export type XDriveFileExplorerCursorPort<
  TNode extends { id: number },
  TSort extends { key: string; direction: 'asc' | 'desc' },
> = {
  readRoot: (signal: AbortSignal) => Promise<{ id: number; name: string }>
  readPage: (
    parentID: number, limit: number, sort: TSort, cursor: string, signal: AbortSignal,
  ) => Promise<XDriveFileExplorerCursorPage<TNode>>
}

/**
 * Fail closed before publishing a Host-provided root into shared Files state.
 * This is shape admission, NOT permission to access an Owner or local Root:
 * DSM CGI and the owning Agent must authorize every actual request.
 * Preserve the authentic Host object; never coerce a string ID or invent a
 * fallback root on malformed/expired session responses.
 */
export function xDriveFileExplorerAdmitOwnerRoot(
  value: unknown,
): { id: number; name: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid authenticated Owner Files root')
  }
  const root = value as { id?: unknown; name?: unknown }
  if (typeof root.id !== 'number' || !Number.isSafeInteger(root.id) ||
      root.id <= 0 || typeof root.name !== 'string' ||
      root.name.trim().length === 0 || root.name.length > 512 ||
      /[\x00-\x1f\x7f]/.test(root.name)) {
    throw new Error('Invalid authenticated Owner Files root')
  }
  return value as { id: number; name: string }
}

/**
 * Root, first page, incremental pagination and sort/folder scope share a single
 * Owner/generation fence. A stale completed request never publishes rows.
 * Every new authenticated root is fetched through the Host port.
 */
export function useXDriveFileExplorerCursorDirectory<
  TNode extends { id: number },
  TSort extends { key: string; direction: 'asc' | 'desc' },
  THost extends object,
>({
  host, port, initialSort, scopeKeyFor, limit = 200,
}: {
  host: THost
  port: XDriveFileExplorerCursorPort<TNode, TSort>
  initialSort: TSort
  scopeKeyFor: (crumbs: readonly { id: string | number }[], key: string, direction: string) => string
  limit?: number
}) {
  const [crumbs, setCrumbs] = useState<Array<{ id: number; name: string }>>([])
  const [items, setItems] = useState<TNode[]>([])
  const [sort, setSort] = useState<TSort>(() => initialSort)
  const [loadingRoot, setLoadingRoot] = useState(true)
  const [rootError, setRootError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [paging, setPaging] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState('')
  const [rootRevision, setRootRevision] = useState(0)
  const pageEpoch = useRef(0)
  const pendingPage = useRef<AbortController | null>(null)
  const pagingActive = useRef(false)
  const itemsRef = useRef<TNode[]>([])
  const verifiedOwnerRef = useRef<{ host: THost; revision: number } | null>(null)
  const rootOwnerRef = useRef<{ host: THost; revision: number } | null>(null)
  const ownerIdentityRef = useRef({ host, revision: rootRevision })
  ownerIdentityRef.current = { host, revision: rootRevision }

  const currentScopeKey = scopeKeyFor(crumbs, sort.key, sort.direction)
  const rootCurrent = rootOwnerRef.current?.host === host &&
    rootOwnerRef.current.revision === rootRevision
  const [verified, setVerified] = useState(false)
  const [verifiedScopeKey, setVerifiedScopeKey] = useState('')
  const currentScopeVerified = Boolean(
    verified && rootCurrent && verifiedScopeKey === currentScopeKey &&
    verifiedOwnerRef.current?.host === host &&
    verifiedOwnerRef.current.revision === rootRevision,
  )
  const { isCurrent: isCurrentOwner, invalidate: invalidateOwner } =
    useXDriveFileExplorerOwnerFence(host, currentScopeKey, rootRevision)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    rootOwnerRef.current = null
    setLoadingRoot(true)
    setRootError('')
    setCrumbs([])
    void port.readRoot(controller.signal).then(root => {
      if (!active || controller.signal.aborted ||
          ownerIdentityRef.current.host !== host ||
          ownerIdentityRef.current.revision !== rootRevision) return
      const verifiedRoot = xDriveFileExplorerAdmitOwnerRoot(root)
      rootOwnerRef.current = { host, revision: rootRevision }
      setCrumbs([{ id: verifiedRoot.id, name: verifiedRoot.name }])
    }).catch(() => {
      if (active && !controller.signal.aborted &&
          ownerIdentityRef.current.host === host &&
          ownerIdentityRef.current.revision === rootRevision) {
        setLoading(false)
        setRootError('无法通过 Agent 当前 xDrive Server 账号读取云端根目录；未确认任何文件。')
      }
    }).finally(() => {
      if (active && ownerIdentityRef.current.host === host &&
          ownerIdentityRef.current.revision === rootRevision) setLoadingRoot(false)
    })
    return () => {
      active = false
      controller.abort()
      if (rootOwnerRef.current?.host === host &&
          rootOwnerRef.current.revision === rootRevision) rootOwnerRef.current = null
    }
  }, [host, port, rootRevision])

  useEffect(() => {
    if (!rootCurrent || crumbs.length === 0) return
    const epoch = ++pageEpoch.current
    pendingPage.current?.abort()
    const controller = new AbortController()
    pendingPage.current = controller
    pagingActive.current = false
    itemsRef.current = []
    verifiedOwnerRef.current = null
    setItems([])
    setHasMore(false)
    setNextCursor('')
    setPaging(false)
    setVerified(false)
    setVerifiedScopeKey('')
    setError('')
    setLoading(true)
    const parent = crumbs[crumbs.length - 1].id
    void xDriveFileExplorerReadDirectoryPage<TNode, TSort>({
      mode: 'cursor',
      readPage: (parentID, size, order, cursor, signal) =>
        port.readPage(parentID, size, order, cursor, signal),
    }, {
      mode: 'cursor', parentID: parent, limit, sort,
      cursor: '', signal: controller.signal,
    }).then(read => {
      if (read.mode !== 'cursor') return
      const page = read.page
      if (controller.signal.aborted || epoch !== pageEpoch.current ||
          !isCurrentOwner() || ownerIdentityRef.current.host !== host ||
          ownerIdentityRef.current.revision !== rootRevision) return
      itemsRef.current = [...page.items]
      setItems([...page.items])
      setNextCursor(page.next_cursor ?? '')
      setHasMore(page.has_more)
      verifiedOwnerRef.current = { host, revision: rootRevision }
      setVerifiedScopeKey(currentScopeKey)
      setVerified(true)
    }).catch(() => {
      if (!controller.signal.aborted && epoch === pageEpoch.current && isCurrentOwner()) {
        setError('该目录读取失败或 Server 会话已失效；不会显示未验证的旧账号文件。')
      }
    }).finally(() => {
      if (!controller.signal.aborted && epoch === pageEpoch.current) setLoading(false)
      if (pendingPage.current === controller) pendingPage.current = null
    })
    return () => {
      controller.abort()
      pageEpoch.current++
      pagingActive.current = false
    }
  }, [host, port, rootCurrent, crumbs, currentScopeKey, sort, rootRevision, limit, isCurrentOwner])

  const loadMore = useCallback(() => {
    const parent = crumbs[crumbs.length - 1]?.id
    if (typeof parent !== 'number' || !rootCurrent || !isCurrentOwner() ||
        !currentScopeVerified || !hasMore || !nextCursor ||
        pagingActive.current || loading) return
    const epoch = pageEpoch.current
    const cursor = nextCursor
    const controller = new AbortController()
    pendingPage.current?.abort()
    pendingPage.current = controller
    pagingActive.current = true
    setPaging(true)
    setError('')
    void xDriveFileExplorerReadDirectoryPage<TNode, TSort>({
      mode: 'cursor',
      readPage: (parentID, size, order, nextCursor, signal) =>
        port.readPage(parentID, size, order, nextCursor, signal),
    }, {
      mode: 'cursor', parentID: parent, limit, sort,
      cursor, signal: controller.signal,
    }).then(read => {
      if (read.mode !== 'cursor') return
      const page = read.page
      if (controller.signal.aborted || epoch !== pageEpoch.current || !isCurrentOwner()) return
      const seen = new Set(itemsRef.current.map(item => item.id))
      if (page.items.some(item => seen.has(item.id))) {
        setError('Server 返回了重复文件，已保留先前核实的结果；请刷新目录。')
        return
      }
      const updated = [...itemsRef.current, ...page.items]
      itemsRef.current = updated
      setItems(updated)
      setHasMore(page.has_more)
      setNextCursor(page.next_cursor ?? '')
    }).catch(() => {
      if (!controller.signal.aborted && epoch === pageEpoch.current && isCurrentOwner()) {
        setError('继续加载失败，已保留核实的文件；可重试。')
      }
    }).finally(() => {
      if (!controller.signal.aborted && epoch === pageEpoch.current) {
        pagingActive.current = false
        setPaging(false)
      }
      if (pendingPage.current === controller) pendingPage.current = null
    })
  }, [port, limit, sort, crumbs, rootCurrent, isCurrentOwner,
      currentScopeVerified, hasMore, nextCursor, loading])

  const refreshAuthenticatedRoot = useCallback(() => {
    invalidateOwner()
    rootOwnerRef.current = null
    verifiedOwnerRef.current = null
    pendingPage.current?.abort()
    pendingPage.current = null
    pageEpoch.current++
    pagingActive.current = false
    itemsRef.current = []
    setItems([])
    setCrumbs([])
    setVerified(false)
    setVerifiedScopeKey('')
    setHasMore(false)
    setNextCursor('')
    setPaging(false)
    setError('')
    setRootError('')
    setLoading(true)
    setLoadingRoot(true)
    setRootRevision(revision => revision + 1)
  }, [invalidateOwner])

  useEffect(() => () => {
    pendingPage.current?.abort()
    pendingPage.current = null
    pageEpoch.current++
    pagingActive.current = false
    rootOwnerRef.current = null
    verifiedOwnerRef.current = null
  }, [])

  return {
    crumbs, setCrumbs, items, itemsRef, sort, setSort, loadingRoot, rootError,
    loading, error, paging, hasMore, nextCursor, rootRevision,
    authenticatedRootCurrent: rootCurrent,
    currentScopeKey, currentScopeVerified, isCurrentOwner,
    loadMore, refreshAuthenticatedRoot,
  }
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  XDriveSynologyBackupLocalClient, XDriveSynologyOwnerSearchHit,
} from '../synology-backup-adapter'
import { xDriveSynologyValidOwnerSearchQuery } from '../synology-backup-adapter'
import { xDriveFileSupportsThumbnail } from './FileExplorerItemPresentation'
import type { XDriveFileExplorerItem } from './FileExplorer'

export type XDriveSynologyOwnerSearchState = {
  query: string
  hits: XDriveSynologyOwnerSearchHit[]
  cursor: string
  hasMore: boolean
  loading: boolean
  error: string
  client: XDriveSynologyBackupLocalClient
  scopeKey: string
  rootRevision: number
}

/** DSM contributes only authorized search data to the canonical FileExplorer.
 * No partial directory listing is ever presented as an account-wide search. */
export function useXDriveSynologyOwnerFilesSearch({
  client, scopeKey, rootRevision, verified, isCurrentOwner,
}: {
  client: XDriveSynologyBackupLocalClient
  scopeKey: string
  rootRevision: number
  verified: boolean
  isCurrentOwner: () => boolean
}) {
  const [draft, setDraft] = useState('')
  const [state, setState] = useState<XDriveSynologyOwnerSearchState | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const generation = useRef(0)

  // A different Owner, authenticated root or directory scope never inherits
  // search rows or a delayed response from a previous request.
  useEffect(() => {
    generation.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    setState(null)
    setDraft('')
    return () => {
      generation.current += 1
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [client, rootRevision, scopeKey])

  const current = state?.client === client &&
    state.rootRevision === rootRevision && state.scopeKey === scopeKey &&
    verified && isCurrentOwner() ? state : null

  const requestPage = useCallback((query: string, cursor: string, append: boolean) => {
    if (!verified || !isCurrentOwner()) return
    const id = ++generation.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setState(previous => {
      if (!append) {
        return {
          query, hits: [], cursor: '', hasMore: false, loading: true,
          error: '', client, scopeKey, rootRevision,
        }
      }
      if (!previous || previous.client !== client ||
          previous.rootRevision !== rootRevision ||
          previous.scopeKey !== scopeKey || previous.query !== query) return previous
      return { ...previous, loading: true, error: '' }
    })
    void client.ownerSearchPage(query, cursor, controller.signal).then(page => {
      if (generation.current !== id || controller.signal.aborted || !isCurrentOwner()) return
      setState(previous => {
        if (!previous || previous.client !== client ||
            previous.rootRevision !== rootRevision ||
            previous.scopeKey !== scopeKey || previous.query !== query) return previous
        const existing = append ? previous.hits : []
        const ids = new Set(existing.map(hit => hit.node.id))
        if (page.items.some(hit => ids.has(hit.node.id))) {
          return { ...previous, loading: false,
            error: '搜索分页结果重复，已保留当前已验证的结果；请重新搜索。' }
        }
        return {
          ...previous, hits: [...existing, ...page.items],
          cursor: page.next_cursor ?? '', hasMore: page.has_more,
          loading: false, error: '',
        }
      })
    }).catch(() => {
      if (generation.current !== id || controller.signal.aborted) return
      setState(previous => previous && previous.client === client &&
        previous.rootRevision === rootRevision &&
        previous.scopeKey === scopeKey && previous.query === query
        ? { ...previous, loading: false, error: '当前 Owner 搜索失败，可重试。' }
        : previous)
    }).finally(() => {
      if (abortRef.current === controller) abortRef.current = null
    })
  }, [client, rootRevision, scopeKey, verified, isCurrentOwner])

  const clear = useCallback(() => {
    generation.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    setState(null)
    setDraft('')
  }, [])

  const start = useCallback((input: string) => {
    const query = input.trim()
    if (!query) { clear(); return }
    if (!xDriveSynologyValidOwnerSearchQuery(query)) {
      generation.current += 1
      abortRef.current?.abort()
      setState({
        query, hits: [], cursor: '', hasMore: false, loading: false,
        error: '请输入至少两个字符，最多 128 个字符。', client, scopeKey, rootRevision,
      })
      return
    }
    setDraft(query)
    requestPage(query, '', false)
  }, [clear, client, scopeKey, rootRevision, requestPage])

  const loadMore = useCallback(() => {
    if (!current || current.loading || !current.hasMore || current.error) return
    requestPage(current.query, current.cursor, true)
  }, [current, requestPage])

  const retry = useCallback(() => {
    if (!current || current.loading) return
    requestPage(current.query, current.hits.length ? current.cursor : '',
      current.hits.length > 0)
  }, [current, requestPage])

  const items = useMemo<XDriveFileExplorerItem[]>(() => {
    if (!current) return []
    return current.hits.map(hit => ({
      id: hit.node.id,
      name: hit.node.name,
      kind: hit.node.type,
      size: hit.node.size,
      revision: hit.node.revision,
      createdAt: hit.node.created_at,
      updatedAt: hit.node.updated_at,
      secondaryLabel: hit.crumbs.map(crumb => crumb.name).filter(Boolean).join(' / '),
      thumbnailEligible: xDriveFileSupportsThumbnail(hit.node.name, hit.node.type),
    }))
  }, [current])

  return { draft, setDraft, current, items, start, clear, retry, loadMore }
}

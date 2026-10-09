import { useEffect, useMemo, useRef, useState } from 'react'
import type { MediaGalleryDataSource } from '@xdrive/ui/mui'
import type { MediaItem, Node, XDriveWebAppBrowseContext } from '../../ui/shared/src'
import type { XDriveApi } from './api'
import { xDriveReadWebAppBrowseSession, xDriveWriteWebAppBrowseSession } from './webAppRuntime'
import { createXDriveWebViewerSession } from './webViewerContext'
import type { XDriveWebViewerCandidate, XDriveWebViewerMediaPatch, XDriveWebViewerPredicate } from './webViewerContext'

export function useViewerNode({ api, gallerySource, nodeID, contextID, predicate, wantsMedia = false, onNavigate }: {
  api: XDriveApi
  gallerySource: MediaGalleryDataSource
  nodeID: number
  contextID?: string
  predicate: XDriveWebViewerPredicate
  wantsMedia?: boolean
  onNavigate: (nodeID: number) => void
}) {
  const context = useMemo(() => xDriveReadWebAppBrowseSession(contextID), [contextID])
  const owner = useMemo(() => ({ api, gallerySource, context }), [api, gallerySource, context])
  const [position, setPosition] = useState({ context, index: context?.activeIndex ?? 0 })
  const activeIndex = position.context === context ? position.index : context?.activeIndex ?? 0
  const [refresh, setRefresh] = useState(0)
  const currentCandidateRef = useRef<{ owner: typeof owner; candidate: XDriveWebViewerCandidate } | null>(null)
  const session = useMemo(() => {
    const selected = currentCandidateRef.current
    return createXDriveWebViewerSession(api, gallerySource, context,
      selected?.owner === owner && selected.candidate.node.id === nodeID && selected.candidate.index === activeIndex
        ? selected.candidate : undefined)
  }, [owner, api, gallerySource, context, activeIndex, nodeID, refresh])
  const activeReaderRef = useRef({ owner, session })
  activeReaderRef.current = { owner, session }
  const [content, setContent] = useState<{
    owner: typeof owner
    nodeID: number
    node: Node | null
    mediaItem: MediaItem | null
    totalCount: number
    loading: boolean
    error: string
  }>({ owner, nodeID, node: null, mediaItem: null, totalCount: 0, loading: true, error: '' })
  const [neighbors, setNeighbors] = useState<{
    session: typeof session
    index: number
    nodeID: number
    previous: XDriveWebViewerCandidate | null
    next: XDriveWebViewerCandidate | null
    totalCount: number
  } | null>(null)

  useEffect(() => {
    let active = true
    const selected = currentCandidateRef.current
    if (selected?.owner !== owner || selected.candidate.node.id !== nodeID || selected.candidate.index !== activeIndex) {
      setContent({ owner, nodeID, node: null, mediaItem: null, totalCount: 0, loading: true, error: '' })
    }
    void session.current(nodeID, activeIndex, wantsMedia).then((candidate) => {
      if (active) {
        currentCandidateRef.current = { owner, candidate }
        setContent({ owner, nodeID, node: candidate.node, mediaItem: candidate.mediaItem ?? null, totalCount: candidate.totalCount, loading: false, error: '' })
      }
    }).catch((reason) => {
      if (active) setContent({ owner, nodeID, node: null, mediaItem: null, totalCount: 0, loading: false, error: reason instanceof Error ? reason.message : String(reason) })
    })
    return () => { active = false }
  }, [owner, session, nodeID, activeIndex, wantsMedia, refresh])

  useEffect(() => {
    let active = true
    setNeighbors(null)
    void Promise.all([
      session.neighbor(activeIndex, -1, predicate),
      session.neighbor(activeIndex, 1, predicate),
    ]).then(([previous, next]) => {
      if (active) setNeighbors({ session, index: activeIndex, nodeID, previous, next, totalCount: previous?.totalCount ?? next?.totalCount ?? 0 })
    }).catch(() => {
      if (active) setNeighbors({ session, index: activeIndex, nodeID, previous: null, next: null, totalCount: 0 })
    })
    return () => { active = false }
  }, [session, activeIndex, nodeID, predicate, refresh])

  const currentContent = content.owner === owner && content.nodeID === nodeID ? content : null
  const currentNeighbors = neighbors?.session === session && neighbors.index === activeIndex && neighbors.nodeID === nodeID ? neighbors : null
  const previous = currentNeighbors?.previous ?? null
  const next = currentNeighbors?.next ?? null
  const totalCount = currentContent?.totalCount || currentNeighbors?.totalCount || (context?.kind === 'selection' ? context.nodeIDs.length : context?.kind === 'gallery' ? context.totalCount : 0)

  function navigate(candidate: XDriveWebViewerCandidate | null) {
    if (!candidate) return
    currentCandidateRef.current = { owner, candidate }
    setContent({ owner, nodeID: candidate.node.id, node: candidate.node, mediaItem: candidate.mediaItem ?? null,
      totalCount: candidate.totalCount, loading: false, error: '' })
    setPosition({ context, index: candidate.index })
    if (context && contextID) xDriveWriteWebAppBrowseSession(contextID, { ...context, activeIndex: candidate.index } as XDriveWebAppBrowseContext)
    onNavigate(candidate.node.id)
  }

  function updateMediaItem(item: MediaItem, patch?: XDriveWebViewerMediaPatch) {
    if (activeReaderRef.current.owner !== owner) return
    const updated = activeReaderRef.current.session.updateMediaItem(item, patch)
    if (!updated) return
    const selected = currentCandidateRef.current
    if (selected?.owner === owner && selected.candidate.node.id === updated.node.id &&
      selected.candidate.node.revision === updated.node.revision) {
      currentCandidateRef.current = { owner, candidate: { ...selected.candidate, node: updated.node, mediaItem: updated } }
    }
    setContent((current) => current.owner === owner && current.nodeID === item.node.id && current.node?.revision === item.node.revision
      ? { ...current, node: updated.node, mediaItem: patch ? { ...(current.mediaItem ?? updated), ...patch } : updated } : current)
    setNeighbors((current) => {
      if (current?.session !== activeReaderRef.current.session) return current
      const apply = (candidate: XDriveWebViewerCandidate | null) => candidate?.node.id === updated.node.id &&
        candidate.node.revision === updated.node.revision &&
        (!candidate.node.sha256 || !updated.node.sha256 || candidate.node.sha256 === updated.node.sha256)
        ? { ...candidate, node: updated.node,
          mediaItem: patch ? { ...(candidate.mediaItem ?? updated), ...patch } : updated } : candidate
      return { ...current, previous: apply(current.previous), next: apply(current.next) }
    })
  }

  function invalidate(id?: number) {
    if (activeReaderRef.current.owner !== owner) return
    activeReaderRef.current.session.invalidate(id)
    if (id === undefined || currentCandidateRef.current?.candidate.node.id === id) currentCandidateRef.current = null
    setRefresh((value) => value + 1)
  }

  return {
    node: currentContent?.node ?? null,
    mediaItem: currentContent?.mediaItem ?? null,
    loading: currentContent?.loading ?? true,
    error: currentContent?.error ?? '',
    activeIndex, totalCount, previous, next,
    navigationLoading: Boolean(context && !currentNeighbors),
    goPrevious: () => navigate(previous),
    goNext: () => navigate(next),
    updateMediaItem, invalidate,
  }
}

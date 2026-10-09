import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  XDriveFileExplorerOrganizationPort,
  XDriveFileSavedSearchInput,
  XDriveFileTag,
} from '../file-explorer-organization'

export function useXDriveFileExplorerOrganization({
  lifecycleKey,
  adapter,
  enabled = true,
  onError,
}: {
  lifecycleKey: string
  adapter: XDriveFileExplorerOrganizationPort
  enabled?: boolean
  onError: (error: unknown) => void
}) {
  const refreshGenerationRef = useRef(0)
  const lifecycleGenerationRef = useRef(0)
  const reorderGenerationRef = useRef(0)
  const tagNodeRefreshGenerationRef = useRef(0)
  const reorderTailRef = useRef<Promise<void>>(Promise.resolve())
  // Track the latest pending intent *per resource key*. A single global
  // holder loses singleflight ownership when an unrelated mutation starts.
  const mutationByKeyRef = useRef(new Map<string, {
    key: string
    intent: string
    lifecycleGeneration: number
    promise: Promise<unknown>
  }>())
  // Different intents for the same resource key are serialized; exact
  // duplicate intents remain single-flight and unrelated keys stay parallel.
  const mutationTailsRef = useRef(new Map<string, Promise<unknown>>())
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const [tags, setTags] = useState<XDriveFileTag[]>([])
  const [savedSearches, setSavedSearches] = useState<Awaited<ReturnType<XDriveFileExplorerOrganizationPort['listSavedSearches']>>>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState('')
  const [busyKey, setBusyKey] = useState('')
  // The passive lifecycle reset cannot protect the first render after
  // changing accounts or disabling the Organization sidebar.
  const visibleScopeRef = useRef({ lifecycleKey, enabled })

  const refresh = useCallback(async () => {
    const generation = ++refreshGenerationRef.current
    if (!enabled) {
      setTags([])
      setSavedSearches([])
      setLoading(false)
      setError('')
      return
    }
    setLoading(true)
    setError('')
    try {
      const [nextTags, nextSavedSearches] = await Promise.all([
        adapter.listTags(),
        adapter.listSavedSearches(),
      ])
      if (refreshGenerationRef.current !== generation) return
      setTags(nextTags)
      setSavedSearches([...nextSavedSearches].sort((a, b) => a.position - b.position || a.id - b.id))
    } catch (error) {
      if (refreshGenerationRef.current === generation) {
        setError(error instanceof Error ? error.message : String(error))
        onErrorRef.current(error)
      }
    } finally {
      if (refreshGenerationRef.current === generation) setLoading(false)
    }
  }, [adapter, enabled])

  useEffect(() => {
    visibleScopeRef.current = { lifecycleKey, enabled }
    lifecycleGenerationRef.current += 1
    refreshGenerationRef.current += 1
    reorderGenerationRef.current += 1
    tagNodeRefreshGenerationRef.current += 1
    reorderTailRef.current = Promise.resolve()
    mutationTailsRef.current.clear()
    mutationByKeyRef.current.clear()
    setTags([])
    setSavedSearches([])
    setBusyKey('')
    setError('')
    return () => {
      lifecycleGenerationRef.current += 1
      refreshGenerationRef.current += 1
      reorderGenerationRef.current += 1
      tagNodeRefreshGenerationRef.current += 1
      reorderTailRef.current = Promise.resolve()
      mutationTailsRef.current.clear()
      mutationByKeyRef.current.clear()
    }
  }, [lifecycleKey])

  useEffect(() => {
    // This effect also runs when the same account's capabilities toggle.
    // The disabled frame must not reveal the previously enabled list.
    visibleScopeRef.current = { lifecycleKey, enabled }
    void refresh()
  }, [lifecycleKey, enabled, refresh])

  const run = useCallback(<T,>(
    key: string,
    action: () => Promise<T>,
    after?: (value: T) => void,
    intent = key,
  ): Promise<T> => {
    const lifecycleGeneration = lifecycleGenerationRef.current
    const active = mutationByKeyRef.current.get(key)
    if (
      active &&
      active.lifecycleGeneration === lifecycleGeneration &&
      active.key === key &&
      active.intent === intent
    ) {
      return active.promise as Promise<T>
    }

    setBusyKey(key)
    const holder = {
      key,
      intent,
      lifecycleGeneration,
      promise: Promise.resolve(undefined) as Promise<unknown>,
    }
    const previous = mutationTailsRef.current.get(key)
    const operation = (previous ? previous.catch(() => undefined) : Promise.resolve())
      .then(() => {
        // A queued operation from an expired account must never run on the
        // next session's transport, even if the earlier request completes.
        if (lifecycleGenerationRef.current !== lifecycleGeneration) return undefined as T
        return action()
      })
      .then((value) => {
        if (lifecycleGenerationRef.current === lifecycleGeneration) {
          // A list refresh started before the write's commit may hold an
          // older snapshot and must not overwrite the confirmed result.
          refreshGenerationRef.current += 1
          setLoading(false)
          after?.(value)
        }
        return value
      })
      .catch((error) => {
        if (lifecycleGenerationRef.current === lifecycleGeneration) onErrorRef.current(error)
        throw error
      })
      .finally(() => {
        if (
          lifecycleGenerationRef.current === lifecycleGeneration &&
          mutationByKeyRef.current.get(key) === holder
        ) {
          mutationByKeyRef.current.delete(key)
          // An unrelated key may still be running after this task settles.
          // Keep shared controls busy until the last owned mutation finishes.
          setBusyKey(Array.from(mutationByKeyRef.current.keys()).at(-1) ?? '')
        }
        if (mutationTailsRef.current.get(key) === operation) {
          mutationTailsRef.current.delete(key)
        }
      })

    holder.promise = operation
    // Reinsert to keep the most recently submitted active key last.
    mutationByKeyRef.current.delete(key)
    mutationByKeyRef.current.set(key, holder)
    mutationTailsRef.current.set(key, operation)
    return operation
  }, [])

  const createTag = useCallback((name: string, color: string) => run(
    'tag:create',
    () => adapter.createTag(name, color),
    (tag) => setTags((current) => [...current, tag].sort((a, b) => a.name.localeCompare(b.name))),
    JSON.stringify([name, color]),
  ), [adapter, run])

  const updateTag = useCallback((id: number, input: { name?: string; color?: string }) => run(
    `tag:update:${id}`,
    () => adapter.updateTag(id, input),
    (tag) => setTags((current) => current.map((item) => item.id === id ? { ...item, ...tag } : item)
      .sort((a, b) => a.name.localeCompare(b.name))),
    JSON.stringify([input.name ?? null, input.color ?? null]),
  ), [adapter, run])

  const deleteTag = useCallback((id: number) => run(
    `tag:delete:${id}`,
    () => adapter.deleteTag(id),
    () => setTags((current) => current.filter((item) => item.id !== id)),
  ), [adapter, run])

  const setTagNodes = useCallback(async (tagID: number, nodeIDs: number[], assigned: boolean) => {
    const lifecycleGeneration = lifecycleGenerationRef.current
    await run(
      `tag:nodes:${tagID}`,
      () => assigned ? adapter.addTagNodes(tagID, nodeIDs) : adapter.removeTagNodes(tagID, nodeIDs),
      undefined,
      JSON.stringify([assigned, [...new Set(nodeIDs)].sort((a, b) => a - b)]),
    )
    if (lifecycleGenerationRef.current !== lifecycleGeneration) return
    const refreshGeneration = tagNodeRefreshGenerationRef.current + 1
    tagNodeRefreshGenerationRef.current = refreshGeneration
    try {
      const nextTags = await adapter.listTags()
      if (
        lifecycleGenerationRef.current !== lifecycleGeneration ||
        tagNodeRefreshGenerationRef.current !== refreshGeneration
      ) return
      // The node-count query can itself overlap a general sidebar refresh.
      // Once these newer counts are accepted, its older result must not win.
      refreshGenerationRef.current += 1
      setLoading(false)
      setTags(nextTags)
    } catch (error) {
      if (
        lifecycleGenerationRef.current === lifecycleGeneration &&
        tagNodeRefreshGenerationRef.current === refreshGeneration
      ) {
        onErrorRef.current(error)
      }
    }
  }, [adapter, run])

  const createSavedSearch = useCallback((input: XDriveFileSavedSearchInput) => run(
    'saved-search:create',
    () => adapter.createSavedSearch(input),
    (item) => setSavedSearches((current) => [...current, item]
      .sort((a, b) => a.position - b.position || a.id - b.id)),
    JSON.stringify([input.name, input.query, input.filters]),
  ), [adapter, run])

  const updateSavedSearch = useCallback((id: number, input: XDriveFileSavedSearchInput) => run(
    `saved-search:update:${id}`,
    () => adapter.updateSavedSearch(id, input),
    (item) => setSavedSearches((current) => current.map((candidate) => candidate.id === id ? item : candidate)),
    JSON.stringify([input.name, input.query, input.filters]),
  ), [adapter, run])

  const deleteSavedSearch = useCallback((id: number) => run(
    `saved-search:delete:${id}`,
    () => adapter.deleteSavedSearch(id),
    () => setSavedSearches((current) => current.filter((item) => item.id !== id)),
  ), [adapter, run])

  const reorderSavedSearches = useCallback((ids: number[]) => {
    const lifecycleGeneration = lifecycleGenerationRef.current
    const reorderGeneration = reorderGenerationRef.current + 1
    reorderGenerationRef.current = reorderGeneration
    // Optimistic order is newer than any refresh already in flight.
    refreshGenerationRef.current += 1
    setLoading(false)
    const index = new Map(ids.map((id, position) => [id, position]))
    setSavedSearches((current) => [...current].sort(
      (a, b) => (index.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (index.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    ).map((item, position) => ({ ...item, position })))

    const operation = reorderTailRef.current
      .catch(() => undefined)
      .then(async () => {
        if (lifecycleGenerationRef.current !== lifecycleGeneration) return
        try {
          await adapter.reorderSavedSearches(ids)
          if (
            lifecycleGenerationRef.current === lifecycleGeneration &&
            reorderGenerationRef.current === reorderGeneration
          ) {
            // A refresh may have started while the reorder was being sent.
            // Its snapshot cannot override the confirmed order either.
            refreshGenerationRef.current += 1
            setLoading(false)
          }
        } catch (error) {
          if (
            lifecycleGenerationRef.current !== lifecycleGeneration ||
            reorderGenerationRef.current !== reorderGeneration
          ) return
          try {
            const restored = await adapter.listSavedSearches()
            if (
              lifecycleGenerationRef.current !== lifecycleGeneration ||
              reorderGenerationRef.current !== reorderGeneration
            ) return
            setSavedSearches([...restored].sort(
              (a, b) => a.position - b.position || a.id - b.id,
            ))
          } catch (refreshError) {
            if (
              lifecycleGenerationRef.current === lifecycleGeneration &&
              reorderGenerationRef.current === reorderGeneration
            ) {
              onErrorRef.current(refreshError)
            }
            return
          }
          if (
            lifecycleGenerationRef.current === lifecycleGeneration &&
            reorderGenerationRef.current === reorderGeneration
          ) {
            onErrorRef.current(error)
          }
        }
      })

    reorderTailRef.current = operation
    return operation
  }, [adapter])

  const scopeVisible = enabled &&
    visibleScopeRef.current.lifecycleKey === lifecycleKey &&
    visibleScopeRef.current.enabled === enabled
  const visibleTags = scopeVisible ? tags : []
  const visibleSavedSearches = scopeVisible ? savedSearches : []
  const tagOptions = useMemo(
    () => visibleTags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    [visibleTags],
  )

  return {
    tags: visibleTags,
    tagOptions,
    savedSearches: visibleSavedSearches,
    loading: scopeVisible ? loading : enabled,
    error: scopeVisible ? error : '',
    busyKey: scopeVisible ? busyKey : '',
    refresh,
    queryNodeTags: adapter.queryNodeTags,
    createTag,
    updateTag,
    deleteTag,
    setTagNodes,
    createSavedSearch,
    updateSavedSearch,
    deleteSavedSearch,
    reorderSavedSearches,
  }
}

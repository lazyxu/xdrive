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
  const mutationRef = useRef<{
    key: string
    lifecycleGeneration: number
    promise: Promise<unknown>
  } | null>(null)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const [tags, setTags] = useState<XDriveFileTag[]>([])
  const [savedSearches, setSavedSearches] = useState<Awaited<ReturnType<XDriveFileExplorerOrganizationPort['listSavedSearches']>>>([])
  const [loading, setLoading] = useState(false)
  const [busyKey, setBusyKey] = useState('')

  const refresh = useCallback(async () => {
    const generation = ++refreshGenerationRef.current
    if (!enabled) {
      setTags([])
      setSavedSearches([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [nextTags, nextSavedSearches] = await Promise.all([
        adapter.listTags(),
        adapter.listSavedSearches(),
      ])
      if (refreshGenerationRef.current !== generation) return
      setTags(nextTags)
      setSavedSearches([...nextSavedSearches].sort((a, b) => a.position - b.position || a.id - b.id))
    } catch (error) {
      if (refreshGenerationRef.current === generation) onErrorRef.current(error)
    } finally {
      if (refreshGenerationRef.current === generation) setLoading(false)
    }
  }, [adapter, enabled])

  useEffect(() => {
    lifecycleGenerationRef.current += 1
    refreshGenerationRef.current += 1
    reorderGenerationRef.current += 1
    tagNodeRefreshGenerationRef.current += 1
    reorderTailRef.current = Promise.resolve()
    mutationRef.current = null
    setTags([])
    setSavedSearches([])
    setBusyKey('')
    return () => {
      lifecycleGenerationRef.current += 1
      refreshGenerationRef.current += 1
      reorderGenerationRef.current += 1
      tagNodeRefreshGenerationRef.current += 1
      reorderTailRef.current = Promise.resolve()
      mutationRef.current = null
    }
  }, [lifecycleKey])

  useEffect(() => {
    void refresh()
  }, [lifecycleKey, refresh])

  const run = useCallback(<T,>(
    key: string,
    action: () => Promise<T>,
    after?: (value: T) => void,
  ): Promise<T> => {
    const lifecycleGeneration = lifecycleGenerationRef.current
    const active = mutationRef.current
    if (
      active &&
      active.lifecycleGeneration === lifecycleGeneration &&
      active.key === key
    ) {
      return active.promise as Promise<T>
    }

    setBusyKey(key)
    const holder = {
      key,
      lifecycleGeneration,
      promise: Promise.resolve(undefined) as Promise<unknown>,
    }
    const operation = Promise.resolve()
      .then(action)
      .then((value) => {
        if (lifecycleGenerationRef.current === lifecycleGeneration) after?.(value)
        return value
      })
      .catch((error) => {
        if (lifecycleGenerationRef.current === lifecycleGeneration) onErrorRef.current(error)
        throw error
      })
      .finally(() => {
        if (
          lifecycleGenerationRef.current === lifecycleGeneration &&
          mutationRef.current === holder
        ) {
          mutationRef.current = null
          setBusyKey((current) => current === key ? '' : current)
        }
      })

    holder.promise = operation
    mutationRef.current = holder
    return operation
  }, [])

  const createTag = useCallback((name: string, color: string) => run(
    'tag:create',
    () => adapter.createTag(name, color),
    (tag) => setTags((current) => [...current, tag].sort((a, b) => a.name.localeCompare(b.name))),
  ), [adapter, run])

  const updateTag = useCallback((id: number, input: { name?: string; color?: string }) => run(
    `tag:update:${id}`,
    () => adapter.updateTag(id, input),
    (tag) => setTags((current) => current.map((item) => item.id === id ? { ...item, ...tag } : item)
      .sort((a, b) => a.name.localeCompare(b.name))),
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
  ), [adapter, run])

  const updateSavedSearch = useCallback((id: number, input: XDriveFileSavedSearchInput) => run(
    `saved-search:update:${id}`,
    () => adapter.updateSavedSearch(id, input),
    (item) => setSavedSearches((current) => current.map((candidate) => candidate.id === id ? item : candidate)),
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

  const tagOptions = useMemo(
    () => tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    [tags],
  )

  return {
    tags,
    tagOptions,
    savedSearches,
    loading,
    busyKey,
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

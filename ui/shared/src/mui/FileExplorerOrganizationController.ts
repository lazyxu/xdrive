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
  const generationRef = useRef(0)
  const [tags, setTags] = useState<XDriveFileTag[]>([])
  const [savedSearches, setSavedSearches] = useState<Awaited<ReturnType<XDriveFileExplorerOrganizationPort['listSavedSearches']>>>([])
  const [loading, setLoading] = useState(false)
  const [busyKey, setBusyKey] = useState('')

  const refresh = useCallback(async () => {
    const generation = ++generationRef.current
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
      if (generationRef.current !== generation) return
      setTags(nextTags)
      setSavedSearches([...nextSavedSearches].sort((a, b) => a.position - b.position || a.id - b.id))
    } catch (error) {
      if (generationRef.current === generation) onError(error)
    } finally {
      if (generationRef.current === generation) setLoading(false)
    }
  }, [adapter, enabled, onError])

  useEffect(() => {
    generationRef.current += 1
    setTags([])
    setSavedSearches([])
    setBusyKey('')
    void refresh()
    return () => {
      generationRef.current += 1
    }
  }, [lifecycleKey, refresh])

  const run = useCallback(async <T,>(
    key: string,
    action: () => Promise<T>,
    after?: (value: T) => void,
  ) => {
    setBusyKey(key)
    try {
      const value = await action()
      after?.(value)
      return value
    } catch (error) {
      onError(error)
      throw error
    } finally {
      setBusyKey((current) => current === key ? '' : current)
    }
  }, [onError])

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
    await run(
      `tag:nodes:${tagID}`,
      () => assigned ? adapter.addTagNodes(tagID, nodeIDs) : adapter.removeTagNodes(tagID, nodeIDs),
    )
    try {
      const nextTags = await adapter.listTags()
      setTags(nextTags)
    } catch (error) {
      onError(error)
    }
  }, [adapter, onError, run])

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

  const reorderSavedSearches = useCallback(async (ids: number[]) => {
    const previous = savedSearches
    const index = new Map(ids.map((id, position) => [id, position]))
    setSavedSearches((current) => [...current].sort(
      (a, b) => (index.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (index.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    ).map((item, position) => ({ ...item, position })))
    try {
      await adapter.reorderSavedSearches(ids)
    } catch (error) {
      setSavedSearches(previous)
      onError(error)
    }
  }, [adapter, onError, savedSearches])

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

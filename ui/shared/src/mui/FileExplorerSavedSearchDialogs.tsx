import type { XDriveFileSavedSearch, XDriveFileSavedSearchInput } from '../file-explorer-organization'
import { XDriveFileNameDialog } from './FileNameDialog'

type SavedSearch = Pick<XDriveFileSavedSearch, 'id' | 'name' | 'query' | 'filters'>

/**
 * Shared Web/Desktop saved-search dialog orchestration. Organization writes
 * still use the authenticated owning Host port. The currently mounted
 * Owner/session lifecycle is checked again after each asynchronous receipt,
 * before any success feedback can be displayed on a different account.
 */
export function XDriveFileExplorerSavedSearchDialogs({
  saveOpen,
  renameSearch,
  lifecycleKeyRef,
  currentQuery,
  persistedFilters,
  availabilityFilterActive,
  onCloseSave,
  onCloseRename,
  createSavedSearch,
  updateSavedSearch,
  onFeedback,
  onError,
}: {
  saveOpen: boolean
  renameSearch: SavedSearch | null
  lifecycleKeyRef: Readonly<{ current: string }>
  currentQuery: string
  persistedFilters: XDriveFileSavedSearchInput['filters']
  availabilityFilterActive: boolean
  onCloseSave: () => void
  onCloseRename: () => void
  createSavedSearch: (input: XDriveFileSavedSearchInput) => Promise<unknown>
  updateSavedSearch: (id: number, input: XDriveFileSavedSearchInput) => Promise<unknown>
  onFeedback: (tone: 'good' | 'warning', message: string) => void
  onError?: (error: unknown) => void
}) {
  return (
    <>
      <XDriveFileNameDialog
        open={saveOpen}
        mode="saved-search"
        onClose={onCloseSave}
        onError={onError}
        onSubmit={async (name) => {
          const lifecycleKey = lifecycleKeyRef.current
          await createSavedSearch({ name, query: currentQuery, filters: persistedFilters })
          if (lifecycleKeyRef.current !== lifecycleKey) return
          onFeedback(
            availabilityFilterActive ? 'warning' : 'good',
            availabilityFilterActive
              ? '智能文件夹已保存；设备可用性筛选不会跨设备保存。'
              : '智能文件夹已保存。',
          )
        }}
      />
      <XDriveFileNameDialog
        open={renameSearch !== null}
        mode="saved-search"
        initialValue={renameSearch?.name ?? ''}
        onClose={onCloseRename}
        onError={onError}
        onSubmit={async (name) => {
          if (!renameSearch) return
          const lifecycleKey = lifecycleKeyRef.current
          await updateSavedSearch(renameSearch.id, {
            name, query: renameSearch.query, filters: renameSearch.filters,
          })
          if (lifecycleKeyRef.current !== lifecycleKey) return
          onFeedback('good', '智能文件夹已重命名。')
        }}
      />
    </>
  )
}

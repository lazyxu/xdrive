import { xDriveVirtualCollectionRangesForViewport } from './virtual-collection'
import type { XDriveVirtualCollectionPage } from './virtual-collection'
import type { XDriveFileExplorerInlineVisibleRange } from './file-explorer-inline'

export type XDriveFileExplorerInlineBranchSnapshot<TItem> = {
  ownerID: number
  parentID: number
  parentIndex: number
  name: string
  itemCount: number | null
  items: ReadonlyMap<number, TItem>
  loading: boolean
  error: string | null
}
export type XDriveFileExplorerInlineSnapshot<TItem> = {
  branches: readonly XDriveFileExplorerInlineBranchSnapshot<TItem>[]
}

type ActiveBranch<TItem> = {
  ownerID: number
  parentID: number
  parentIndex: number
  name: string
  itemCount: number | null
  items: Map<number, TItem>
  loadedPages: Set<number>
  inFlight: Map<number, AbortController>
  error: string | null
  failedOffset: number | null
}

/** Scoped to an existing Web workspace. All data still comes from the
 * authenticated shared FileExplorer Server range API, never a Mobile route.
 * One owner holds bounded viewport pages, not the full child collection. */
export class XDriveFileExplorerInlineRangeStore<TItem> {
  private branches = new Map<number, ActiveBranch<TItem>>()
  private listeners = new Set<() => void>()
  private snapshot: XDriveFileExplorerInlineSnapshot<TItem> = { branches: [] }
  private disposed = false
  private readonly pageSize = 100
  private readonly maxBranches = 48

  constructor(
    private readonly loadRange: (
      ownerID: number, offset: number, limit: number, signal: AbortSignal,
    ) => Promise<XDriveVirtualCollectionPage<TItem>>,
    private readonly onError: (error: unknown) => void,
  ) {}

  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish() {
    if (this.disposed) return
    this.snapshot = {
      branches: [...this.branches.values()].map(branch => ({
        ownerID: branch.ownerID, parentID: branch.parentID,
        parentIndex: branch.parentIndex, name: branch.name, itemCount: branch.itemCount,
        items: new Map(branch.items), loading: branch.inFlight.size > 0,
        error: branch.error,
      })),
    }
    for (const listener of this.listeners) listener()
  }

  private abort(branch: ActiveBranch<TItem>) {
    for (const controller of branch.inFlight.values()) controller.abort()
    branch.inFlight.clear()
  }

  /** Collapse removes the whole descendant subtree and aborts its requests. */
  toggle(ownerID: number, parentID: number, parentIndex: number, name = '') {
    if (this.disposed || !Number.isSafeInteger(ownerID) || ownerID <= 0 ||
        !Number.isSafeInteger(parentID) || parentID <= 0 ||
        !Number.isSafeInteger(parentIndex) || parentIndex < 0 || ownerID === parentID) return
    if (this.branches.has(ownerID)) {
      const close = new Set<number>([ownerID])
      let changed = true
      while (changed) {
        changed = false
        for (const branch of this.branches.values()) {
          if (close.has(branch.parentID) && !close.has(branch.ownerID)) {
            close.add(branch.ownerID)
            changed = true
          }
        }
      }
      for (const id of close) {
        const branch = this.branches.get(id)
        if (!branch) continue
        this.abort(branch)
        this.branches.delete(id)
      }
      this.publish()
      return
    }
    if (this.branches.size >= this.maxBranches) {
      this.onError(new Error('已展开过多文件夹，请先收起部分文件夹。'))
      return
    }
    const branch: ActiveBranch<TItem> = {
      ownerID, parentID, parentIndex, name, itemCount: null,
      items: new Map(), loadedPages: new Set(), inFlight: new Map(),
      error: null, failedOffset: null,
    }
    this.branches.set(ownerID, branch)
    this.publish()
    this.request(branch, 0)
  }

  retry(ownerID: number) {
    const branch = this.branches.get(ownerID)
    if (!branch || !branch.error || branch.inFlight.size > 0 || this.disposed) return
    branch.error = null
    const offset = branch.failedOffset ?? 0
    branch.failedOffset = null
    this.publish()
    this.request(branch, offset)
  }

  private request(branch: ActiveBranch<TItem>, offset: number) {
    if (this.disposed || this.branches.get(branch.ownerID) !== branch ||
        (branch.error && branch.failedOffset === offset) ||
        branch.loadedPages.has(offset) || branch.inFlight.has(offset)) return
    const controller = new AbortController()
    branch.inFlight.set(offset, controller)
    this.publish()
    void Promise.resolve().then(() => this.loadRange(
      branch.ownerID, offset, this.pageSize, controller.signal,
    )).then(page => {
      if (this.disposed || controller.signal.aborted || this.branches.get(branch.ownerID) !== branch) return
      const itemCount = page.totalCount
      if (typeof itemCount !== 'number' || !Number.isSafeInteger(itemCount) || itemCount < 0 ||
          page.offset !== offset || page.limit !== this.pageSize ||
          page.items.length !== Math.min(this.pageSize, Math.max(0, itemCount - offset))) {
        throw new Error('Invalid FileExplorer child range/count response.')
      }
      branch.itemCount = itemCount
      branch.error = null
      branch.failedOffset = null
      const count = Math.min(page.items.length, Math.max(0, itemCount - offset))
      for (let index = 0; index < count; index++) branch.items.set(offset + index, page.items[index])
      branch.loadedPages.add(offset)
    }).catch(error => {
      if (this.disposed || controller.signal.aborted || this.branches.get(branch.ownerID) !== branch) return
      branch.error = error instanceof Error ? error.message : String(error)
      branch.failedOffset = offset
      this.onError(error)
    }).finally(() => {
      if (branch.inFlight.get(offset) === controller) {
        branch.inFlight.delete(offset)
        if (!this.disposed && this.branches.get(branch.ownerID) === branch) this.publish()
      }
    })
  }

  /** Retain at most nearby pages per expanded owner. Unseen work is aborted. */
  ensureViewport(ranges: readonly XDriveFileExplorerInlineVisibleRange[]) {
    if (this.disposed) return
    const requestedByOwner = new Map<number, Set<number>>()
    const retainedByOwner = new Map<number, Set<number>>()
    for (const range of ranges) {
      const branch = this.branches.get(range.ownerID)
      if (!branch || branch.itemCount === null) continue
      const args = {
        startIndex: range.startIndex, endIndex: range.endIndex,
        totalCount: branch.itemCount, pageSize: this.pageSize,
      }
      const requested = requestedByOwner.get(range.ownerID) ?? new Set<number>()
      for (const page of xDriveVirtualCollectionRangesForViewport({ ...args, overscanPages: 1 })) requested.add(page.offset)
      requestedByOwner.set(range.ownerID, requested)
      const retained = retainedByOwner.get(range.ownerID) ?? new Set<number>()
      for (const page of xDriveVirtualCollectionRangesForViewport({ ...args, overscanPages: 2 })) retained.add(page.offset)
      retainedByOwner.set(range.ownerID, retained)
    }
    let changed = false
    for (const branch of this.branches.values()) {
      if (branch.itemCount === null) continue
      const retained = retainedByOwner.get(branch.ownerID) ?? new Set<number>()
      for (const [offset, controller] of branch.inFlight) {
        if (retained.has(offset)) continue
        controller.abort()
        branch.inFlight.delete(offset)
        changed = true
      }
      for (const offset of [...branch.loadedPages]) {
        if (retained.has(offset)) continue
        branch.loadedPages.delete(offset)
        for (let index = offset; index < offset + this.pageSize; index++) branch.items.delete(index)
        changed = true
      }
      for (const offset of requestedByOwner.get(branch.ownerID) ?? []) this.request(branch, offset)
    }
    if (changed) this.publish()
  }

  /** Preserve the store identity but drop all expanded scope data. */
  clear() {
    if (this.disposed || this.branches.size === 0) return
    for (const branch of this.branches.values()) this.abort(branch)
    this.branches.clear()
    this.publish()
  }

  destroy() {
    if (this.disposed) return
    this.disposed = true
    for (const branch of this.branches.values()) this.abort(branch)
    this.branches.clear()
    this.listeners.clear()
  }
}

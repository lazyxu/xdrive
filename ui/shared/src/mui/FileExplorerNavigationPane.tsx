import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import TuneRoundedIcon from '@mui/icons-material/TuneRounded'
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Collapse,
  Divider,
  IconButton,
  ListItemButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import {
  XDRIVE_FILE_EXPLORER_DRAG_MIME,
  xDriveFileExplorerDecodeDragIDs,
} from '../file-explorer-drag'
import { XDriveAutoLoadSentinel } from './AutoLoadSentinel'
import {
  xDriveFileExplorerReadExternalDrop,
} from './FileExplorerExternalDrop'
import type {
  XDriveFileExplorerExternalDropPayload,
} from './FileExplorerExternalDrop'
import type { XDriveFileExplorerQuickAccessEntry } from './FileExplorerQuickAccessController'
import type { XDriveFileExplorerFavoriteNavigationEntry } from './FileExplorerFavoriteController'
import type { XDriveFileExplorerRecentEntry } from './FileExplorerRecentController'
import { XDriveFileExplorerThumbnail } from './FileExplorerThumbnail'
import {
  XDriveFileExplorerAvailabilityBadge,
  XDriveFileExplorerItemIcon,
  xDriveFileSupportsThumbnail,
} from './FileExplorer'
import type { XDriveFileExplorerItem } from './FileExplorer'
import type { XDriveFileExplorerAvailability } from '../file-explorer-availability'
import type { XDriveFileSavedSearch, XDriveFileTag } from '../file-explorer-organization'
import { xDriveFileExplorerSavedSearchRuleLabels } from '../file-explorer-organization'

export type XDriveFileExplorerNavigationTreeCrumb = {
  id: number
  name: string
}

export type XDriveFileExplorerNavigationTreeDirectory = {
  id: number
  name: string
  type: string
}

export type XDriveFileExplorerNavigationTreePage = {
  items: readonly XDriveFileExplorerNavigationTreeDirectory[]
  nextCursor: string
  hasMore: boolean
}

type XDriveFileExplorerNavigationTreeNode = {
  id: number
  name: string
  crumbs: XDriveFileExplorerNavigationTreeCrumb[]
}

type XDriveFileExplorerNavigationSection = 'quickAccess' | 'savedSearches' | 'tags' | 'favorites' | 'recent' | 'tree'
type XDriveFileExplorerNavigationSectionState = Record<XDriveFileExplorerNavigationSection, boolean>

const defaultNavigationSectionState: XDriveFileExplorerNavigationSectionState = {
  quickAccess: true,
  savedSearches: true,
  tags: true,
  favorites: true,
  recent: true,
  tree: true,
}
const defaultNavigationSectionPreferencesKey = 'xdrive.files.navigation_sections'

type XDriveFileExplorerSidebarPreferences = {
  visible: XDriveFileExplorerNavigationSectionState
  quickAccessSort: 'manual' | 'name'
}

const defaultSidebarPreferences: XDriveFileExplorerSidebarPreferences = {
  visible: { ...defaultNavigationSectionState },
  quickAccessSort: 'manual',
}

function loadSidebarPreferences(storageKey: string): XDriveFileExplorerSidebarPreferences {
  if (typeof window === 'undefined') return { ...defaultSidebarPreferences, visible: { ...defaultSidebarPreferences.visible } }
  try {
    const raw = window.localStorage.getItem(`${storageKey}.customize`)
    if (!raw) return { ...defaultSidebarPreferences, visible: { ...defaultSidebarPreferences.visible } }
    const value = JSON.parse(raw) as Partial<XDriveFileExplorerSidebarPreferences>
    return {
      visible: {
        quickAccess: value.visible?.quickAccess !== false,
        savedSearches: value.visible?.savedSearches !== false,
        tags: value.visible?.tags !== false,
        favorites: value.visible?.favorites !== false,
        recent: value.visible?.recent !== false,
        tree: value.visible?.tree !== false,
      },
      quickAccessSort: value.quickAccessSort === 'name' ? 'name' : 'manual',
    }
  } catch {
    return { ...defaultSidebarPreferences, visible: { ...defaultSidebarPreferences.visible } }
  }
}

function loadNavigationSectionState(storageKey: string) {
  if (typeof window === 'undefined') return { ...defaultNavigationSectionState }
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return { ...defaultNavigationSectionState }
    const value = JSON.parse(raw) as Partial<XDriveFileExplorerNavigationSectionState>
    return {
      quickAccess: typeof value.quickAccess === 'boolean' ? value.quickAccess : true,
      savedSearches: typeof value.savedSearches === 'boolean' ? value.savedSearches : true,
      tags: typeof value.tags === 'boolean' ? value.tags : true,
      favorites: typeof value.favorites === 'boolean' ? value.favorites : true,
      recent: typeof value.recent === 'boolean' ? value.recent : true,
      tree: typeof value.tree === 'boolean' ? value.tree : true,
    }
  } catch {
    return { ...defaultNavigationSectionState }
  }
}

export function XDriveFileExplorerNavigationPane({
  lifecycleKey = '',
  currentCrumbs,
  trashActive = false,
  onNavigateTrash,
  loadDirectoryPage,
  onNavigate,
  dropDisabled = false,
  onDropInternalItems,
  onExternalFilesDrop,
  onExternalFolderDrop,
  quickAccessEnabled = false,
  quickAccessItems = [],
  quickAccessLoading = false,
  quickAccessBusyID = null,
  currentQuickAccessPinned = false,
  onNavigateQuickAccess,
  onToggleCurrentQuickAccess,
  onUnpinQuickAccess,
  onReorderQuickAccess,
  savedSearchesEnabled = false,
  savedSearches = [],
  activeSavedSearchID = null,
  matchingSavedSearchIDs,
  onActivateSavedSearch,
  onRenameSavedSearch,
  onReplaceSavedSearch,
  canReplaceSavedSearch = false,
  onDeleteSavedSearch,
  onReorderSavedSearches,
  organizationLoading = false,
  organizationError = '',
  onRetryOrganization,
  onSaveCurrentSearch,
  canSaveCurrentSearch = false,
  savedSearchRuleLabels,
  tagsEnabled = false,
  tags = [],
  activeTagID = null,
  onActivateTag,
  onManageTags,
  favoritesEnabled = false,
  favoriteItems = [],
  favoritesLoading = false,
  favoriteBusyID = null,
  onActivateFavorite,
  onUnfavorite,
  recentEnabled = false,
  recentItems = [],
  recentLoading = false,
  onActivateRecent,
  onClearRecent,
  getItemAvailability,
  onAvailabilityItemsChange,
  onError,
  sectionPreferencesKey = defaultNavigationSectionPreferencesKey,
}: {
  lifecycleKey?: string
  currentCrumbs: readonly XDriveFileExplorerNavigationTreeCrumb[]
  trashActive?: boolean
  onNavigateTrash?: () => void | Promise<void>
  loadDirectoryPage: (
    parentID: number,
    cursor?: string,
  ) => Promise<XDriveFileExplorerNavigationTreePage>
  onNavigate: (crumbs: XDriveFileExplorerNavigationTreeCrumb[]) => void | Promise<void>
  dropDisabled?: boolean
  onDropInternalItems?: (
    itemIDs: readonly (string | number)[],
    target: XDriveFileExplorerNavigationTreeCrumb,
    operation: 'move' | 'copy',
  ) => void | Promise<void>
  onExternalFilesDrop?: (
    files: File[],
    target: XDriveFileExplorerNavigationTreeCrumb,
  ) => void | Promise<void>
  onExternalFolderDrop?: (
    payload: XDriveFileExplorerExternalDropPayload,
    target: XDriveFileExplorerNavigationTreeCrumb,
  ) => void | Promise<void>
  quickAccessEnabled?: boolean
  quickAccessItems?: readonly XDriveFileExplorerQuickAccessEntry[]
  quickAccessLoading?: boolean
  quickAccessBusyID?: number | null
  currentQuickAccessPinned?: boolean
  onNavigateQuickAccess?: (nodeID: number) => void | Promise<void>
  onToggleCurrentQuickAccess?: () => void | Promise<void>
  onUnpinQuickAccess?: (nodeID: number) => void | Promise<void>
  onReorderQuickAccess?: (nodeIDs: number[]) => void | Promise<void>
  savedSearchesEnabled?: boolean
  savedSearches?: readonly XDriveFileSavedSearch[]
  activeSavedSearchID?: number | null
  matchingSavedSearchIDs?: readonly number[]
  onActivateSavedSearch?: (search: XDriveFileSavedSearch) => void | Promise<void>
  onRenameSavedSearch?: (search: XDriveFileSavedSearch) => void | Promise<void>
  onReplaceSavedSearch?: (search: XDriveFileSavedSearch) => void | Promise<void>
  canReplaceSavedSearch?: boolean
  onDeleteSavedSearch?: (id: number) => void | Promise<void>
  onReorderSavedSearches?: (ids: number[]) => void | Promise<void>
  organizationLoading?: boolean
  organizationError?: string
  onRetryOrganization?: () => void | Promise<void>
  onSaveCurrentSearch?: () => void
  canSaveCurrentSearch?: boolean
  savedSearchRuleLabels?: (search: XDriveFileSavedSearch) => string[]
  currentSearchNotice?: string
  tagsEnabled?: boolean
  tags?: readonly XDriveFileTag[]
  activeTagID?: number | null
  onActivateTag?: (tag: XDriveFileTag) => void | Promise<void>
  onManageTags?: () => void
  favoritesEnabled?: boolean
  favoriteItems?: readonly XDriveFileExplorerFavoriteNavigationEntry[]
  favoritesLoading?: boolean
  favoriteBusyID?: number | null
  onActivateFavorite?: (nodeID: number) => void | Promise<void>
  onUnfavorite?: (nodeID: number) => void | Promise<void>
  recentEnabled?: boolean
  recentItems?: readonly XDriveFileExplorerRecentEntry[]
  recentLoading?: boolean
  onActivateRecent?: (nodeID: number) => void | Promise<void>
  onClearRecent?: () => void | Promise<void>
  getItemAvailability?: (item: XDriveFileExplorerItem) => XDriveFileExplorerAvailability | undefined
  onAvailabilityItemsChange?: (items: readonly XDriveFileExplorerItem[]) => void
  onError?: (error: unknown) => void
  sectionPreferencesKey?: string
}) {
  const [pageByParent, setPageByParent] = useState<Record<string, {
    children: XDriveFileExplorerNavigationTreeNode[]
    nextCursor: string
    hasMore: boolean
    loaded: boolean
    generation: number
    lifecycleKey: string
  }>>({})
  const pageByParentRef = useRef(pageByParent)
  const [expandedIDs, setExpandedIDs] = useState<Set<number>>(() => new Set())
  const [loadingIDs, setLoadingIDs] = useState<Set<number>>(() => new Set())
  const loadingIDsRef = useRef(new Map<number, number>())
  const loadDirectoryPageRef = useRef(loadDirectoryPage)
  const loadDirectoryPageGenerationRef = useRef(1)
  const lifecycleKeyRef = useRef(lifecycleKey)
  const loaderChanged = loadDirectoryPageRef.current !== loadDirectoryPage
  const lifecycleChanged = lifecycleKeyRef.current !== lifecycleKey
  if (loaderChanged || lifecycleChanged) {
    loadDirectoryPageRef.current = loadDirectoryPage
    lifecycleKeyRef.current = lifecycleKey
    loadDirectoryPageGenerationRef.current += 1
    if (lifecycleChanged) {
      pageByParentRef.current = {}
      loadingIDsRef.current.clear()
    }
  }
  const [dropTargetID, setDropTargetID] = useState<number | null>(null)
  const [customizeAnchor, setCustomizeAnchor] = useState<HTMLElement | null>(null)
  const [savedSearchMenu, setSavedSearchMenu] = useState<{ anchor: HTMLElement; search: XDriveFileSavedSearch } | null>(null)
  const [sidebarPreferences, setSidebarPreferences] = useState<XDriveFileExplorerSidebarPreferences>(
    () => loadSidebarPreferences(sectionPreferencesKey),
  )
  const [draggedQuickAccessID, setDraggedQuickAccessID] = useState<number | null>(null)
  const [draggedSavedSearchID, setDraggedSavedSearchID] = useState<number | null>(null)
  const [expandedSections, setExpandedSections] = useState<XDriveFileExplorerNavigationSectionState>(
    () => loadNavigationSectionState(sectionPreferencesKey),
  )

  useEffect(() => {
    pageByParentRef.current = {}
    setPageByParent({})
    loadingIDsRef.current.clear()
    setLoadingIDs(new Set())
    setExpandedIDs(new Set())
    setDropTargetID(null)
  }, [lifecycleKey])

  useEffect(() => {
    setExpandedSections(loadNavigationSectionState(sectionPreferencesKey))
    setSidebarPreferences(loadSidebarPreferences(sectionPreferencesKey))
  }, [sectionPreferencesKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(sectionPreferencesKey, JSON.stringify(expandedSections))
  }, [expandedSections, sectionPreferencesKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(`${sectionPreferencesKey}.customize`, JSON.stringify(sidebarPreferences))
  }, [sectionPreferencesKey, sidebarPreferences])

  const toggleSection = (section: XDriveFileExplorerNavigationSection) => {
    setExpandedSections((current) => ({
      ...current,
      [section]: !current[section],
    }))
  }

  const rootNode = useMemo(() => {
    const root = currentCrumbs[0]
    if (!root) return null
    return {
      id: root.id,
      name: root.name,
      crumbs: [{ id: root.id, name: root.name }],
    }
  }, [currentCrumbs])
  const latestPathCrumbsByIDRef = useRef(new Map<number, XDriveFileExplorerNavigationTreeCrumb[]>())
  latestPathCrumbsByIDRef.current = new Map(
    currentCrumbs.map((crumb, index) => [
      crumb.id,
      currentCrumbs.slice(0, index + 1).map((candidate) => ({ ...candidate })),
    ]),
  )
  const compactViewport = useMediaQuery('(max-width:899.95px)')
  const organizationDescriptionID = useId()
  const actionEdge = compactViewport ? 44 : 26
  const secondaryTrack = compactViewport ? 44 : 28
  const currentID = currentCrumbs.at(-1)?.id

  const navigationAvailabilityItems = useMemo(() => {
    const byID = new Map<number, XDriveFileExplorerItem>()
    for (let index = 1; index < currentCrumbs.length; index += 1) {
      const crumb = currentCrumbs[index]
      const path = currentCrumbs
        .slice(1, index + 1)
        .map((candidate) => candidate.name)
        .join('/')
      if (path) byID.set(crumb.id, { id: crumb.id, name: crumb.name, kind: 'dir', path })
    }
    for (const page of Object.values(pageByParent)) {
      if (page.lifecycleKey !== lifecycleKey) continue
      for (const node of page.children) {
        const path = node.crumbs.slice(1).map((crumb) => crumb.name).join('/')
        if (path) byID.set(node.id, { id: node.id, name: node.name, kind: 'dir', path })
      }
    }
    return [...byID.values()]
  }, [currentCrumbs, lifecycleKey, pageByParent])

  useEffect(() => {
    onAvailabilityItemsChange?.(navigationAvailabilityItems)
  }, [navigationAvailabilityItems, onAvailabilityItemsChange])

  const childrenFor = useCallback((node: XDriveFileExplorerNavigationTreeNode) => {
    const page = pageByParent[String(node.id)]
    if (!page || page.lifecycleKey !== lifecycleKey) return []
    return page.children.map((candidate) => ({
      ...candidate,
      crumbs: [
        ...node.crumbs.map((crumb) => ({ ...crumb })),
        { id: candidate.id, name: candidate.name },
      ],
    }))
  }, [lifecycleKey, pageByParent])

  const commitParentPage = useCallback((
    parentID: number,
    value: {
      children: XDriveFileExplorerNavigationTreeNode[]
      nextCursor: string
      hasMore: boolean
      loaded: boolean
      generation: number
      lifecycleKey: string
    },
  ) => {
    const next = {
      ...pageByParentRef.current,
      [String(parentID)]: value,
    }
    pageByParentRef.current = next
    setPageByParent(next)
  }, [])

  const loadChildren = useCallback(async (
    node: XDriveFileExplorerNavigationTreeNode,
    append = false,
  ) => {
    const generation = loadDirectoryPageGenerationRef.current
    const requestLifecycleKey = lifecycleKeyRef.current
    const current = pageByParentRef.current[String(node.id)]
    const currentLifecycle = current?.lifecycleKey === requestLifecycleKey
    const appendCurrentGeneration =
      append && currentLifecycle && current?.generation === generation
    if (
      !append &&
      currentLifecycle &&
      current?.loaded &&
      current.generation === generation
    ) return
    if (
      appendCurrentGeneration &&
      (!current?.hasMore || !current.nextCursor)
    ) return
    if (loadingIDsRef.current.get(node.id) === generation) return

    loadingIDsRef.current.set(node.id, generation)
    setLoadingIDs((currentIDs) => new Set(currentIDs).add(node.id))
    try {
      const page = await loadDirectoryPage(
        node.id,
        appendCurrentGeneration ? current?.nextCursor : undefined,
      )
      if (
        generation !== loadDirectoryPageGenerationRef.current ||
        requestLifecycleKey !== lifecycleKeyRef.current
      ) return
      if (
        appendCurrentGeneration &&
        current?.nextCursor &&
        page.hasMore &&
        page.nextCursor === current.nextCursor
      ) {
        throw new Error('文件夹树分页游标重复。')
      }
      const merged = new Map<number, XDriveFileExplorerNavigationTreeNode>()
      if (appendCurrentGeneration && current) {
        for (const child of current.children) merged.set(child.id, child)
      }
      const latestNodeCrumbs =
        latestPathCrumbsByIDRef.current.get(node.id) ?? node.crumbs
      for (const directory of page.items) {
        merged.set(directory.id, {
          id: directory.id,
          name: directory.name,
          crumbs: [
            ...latestNodeCrumbs.map((crumb) => ({ ...crumb })),
            { id: directory.id, name: directory.name },
          ],
        })
      }
      commitParentPage(node.id, {
        children: [...merged.values()],
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        loaded: true,
        generation,
        lifecycleKey: requestLifecycleKey,
      })
    } catch (error) {
      if (
        generation === loadDirectoryPageGenerationRef.current &&
        requestLifecycleKey === lifecycleKeyRef.current
      ) onError?.(error)
    } finally {
      if (loadingIDsRef.current.get(node.id) === generation) {
        loadingIDsRef.current.delete(node.id)
        setLoadingIDs((currentIDs) => {
          const next = new Set(currentIDs)
          next.delete(node.id)
          return next
        })
      }
    }
  }, [commitParentPage, loadDirectoryPage, onError])

  const toggleExpanded = (node: XDriveFileExplorerNavigationTreeNode) => {
    const expanded = expandedIDs.has(node.id)
    setExpandedIDs((current) => {
      const next = new Set(current)
      if (expanded) next.delete(node.id)
      else next.add(node.id)
      return next
    })
    if (!expanded) void loadChildren(node)
  }

  const dragOverNode = (
    event: ReactDragEvent<HTMLElement>,
    node: XDriveFileExplorerNavigationTreeNode,
  ) => {
    if (dropDisabled) return
    const types = Array.from(event.dataTransfer.types)
    const internal = types.includes(XDRIVE_FILE_EXPLORER_DRAG_MIME) &&
      Boolean(onDropInternalItems)
    const external = types.includes('Files') &&
      Boolean(onExternalFilesDrop || onExternalFolderDrop)
    if (!internal && !external) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = internal && (event.ctrlKey || event.metaKey)
      ? 'copy'
      : external ? 'copy' : 'move'
    setDropTargetID(node.id)
  }

  const leaveDropTarget = (
    event: ReactDragEvent<HTMLElement>,
    nodeID: number,
  ) => {
    const related = event.relatedTarget
    if (
      related instanceof Node &&
      event.currentTarget.contains(related)
    ) return
    setDropTargetID((current) => current === nodeID ? null : current)
  }

  const dropOnNode = async (
    event: ReactDragEvent<HTMLElement>,
    node: XDriveFileExplorerNavigationTreeNode,
  ) => {
    if (dropDisabled) return
    event.preventDefault()
    event.stopPropagation()
    const dataTransfer = event.dataTransfer
    const target = { id: node.id, name: node.name }
    try {
      if (dataTransfer.types.includes('Files')) {
        if (onExternalFolderDrop) {
          const payload = await xDriveFileExplorerReadExternalDrop(dataTransfer)
          if (payload.directories.length > 0) {
            await onExternalFolderDrop(payload, target)
            return
          }
        }
        const droppedFiles = Array.from(dataTransfer.files)
        if (droppedFiles.length > 0 && onExternalFilesDrop) {
          await onExternalFilesDrop(droppedFiles, target)
          return
        }
      }

      if (onDropInternalItems) {
        const itemIDs = xDriveFileExplorerDecodeDragIDs(
          dataTransfer.getData(XDRIVE_FILE_EXPLORER_DRAG_MIME),
        )
        if (itemIDs.length > 0) {
          await onDropInternalItems(
            itemIDs,
            target,
            event.ctrlKey || event.metaKey ? 'copy' : 'move',
          )
        }
      }
    } finally {
      setDropTargetID(null)
    }
  }

  const renderItemVisual = (item: XDriveFileExplorerItem, edge = 22) => {
    const availability = getItemAvailability?.(item)
    return (
      <Box sx={{ width: edge, height: edge, flex: '0 0 auto', position: 'relative', overflow: 'visible', borderRadius: 0 }}>
        <XDriveFileExplorerThumbnail
          item={item}
          eligible={item.kind === 'file' && xDriveFileSupportsThumbnail(item.name, 'file')}
          fallback={(
            <XDriveFileExplorerItemIcon
              item={item}
              size={Math.max(18, edge - 4)}
              folderSize={Math.max(18, edge - 4)}
            />
          )}
        />
        {availability ? (
          <XDriveFileExplorerAvailabilityBadge availability={availability} overlay compact />
        ) : null}
      </Box>
    )
  }

  const renderNode = (node: XDriveFileExplorerNavigationTreeNode, depth: number) => {
    const children = childrenFor(node)
    const candidatePage = pageByParent[String(node.id)]
    const page = candidatePage?.lifecycleKey === lifecycleKey ? candidatePage : undefined
    const loaded = Boolean(page?.loaded)
    const hasMore = Boolean(page?.hasMore)
    const loading = loadingIDs.has(node.id)
    const expanded = expandedIDs.has(node.id)
    const expandable = !loaded || children.length > 0 || hasMore

    return (
      <Box
        key={node.id}
        role="treeitem"
        aria-expanded={expandable ? expanded : undefined}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: `${actionEdge}px minmax(${compactViewport ? 44 : 0}px, 1fr)`,
            alignItems: 'center',
            // Deep mobile paths must leave separate, usable expand/open targets.
            pl: 0.5 + (compactViewport ? Math.min(depth, 6) * 1.25 : depth * 1.75),
            pr: 0.5,
            minHeight: compactViewport ? 44 : 32,
          }}
        >
          {loading && !loaded ? (
            <Box sx={{ width: actionEdge, height: compactViewport ? 44 : 30, display: 'grid', placeItems: 'center' }}>
              <CircularProgress size={13} />
            </Box>
          ) : expandable ? (
            <IconButton
              size="small"
              aria-label={expanded ? `折叠 ${node.name}` : `展开 ${node.name}`}
              onClick={(event) => {
                event.stopPropagation()
                toggleExpanded(node)
              }}
              sx={{ width: actionEdge, height: compactViewport ? 44 : 28, flexShrink: 0, borderRadius: 0.5 }}
            >
              {expanded
                ? <ExpandMoreRoundedIcon sx={{ fontSize: 18 }} />
                : <ChevronRightRoundedIcon sx={{ fontSize: 18 }} />}
            </IconButton>
          ) : (
            <Box sx={{ width: actionEdge, height: compactViewport ? 44 : 28 }} />
          )}

          <ListItemButton
            aria-label={node.name}
            title={node.crumbs.map((crumb) => crumb.name).join('/')}
            onDragOver={(event) => dragOverNode(event, node)}
            onDragLeave={(event) => leaveDropTarget(event, node.id)}
            onDrop={(event) => { void dropOnNode(event, node) }}
            onClick={() => {
              void onNavigate(node.crumbs)
            }}
            sx={{
              minWidth: 0,
              minHeight: compactViewport ? 44 : 30,
              py: 0.25,
              px: 0.75,
              borderRadius: 0.5,
              gap: 0.75,
              bgcolor: dropTargetID === node.id ? 'action.hover' : undefined,
              outline: dropTargetID === node.id ? '2px solid' : undefined,
              outlineColor: dropTargetID === node.id ? 'primary.main' : undefined,
              outlineOffset: -2,
            }}
          >
            {renderItemVisual({ id: node.id, name: node.name, kind: 'dir' }, 20)}
            <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
              {node.name}
            </Typography>
          </ListItemButton>
        </Box>

        <Collapse in={expanded} timeout="auto" unmountOnExit>
          <Box role="group">
            {children.map((child) => renderNode(child, depth + 1))}
            {hasMore ? (
              <Box
                data-xdrive-file-explorer-tree-auto-load
                sx={{
                  ml: 0.5 + (compactViewport ? Math.min(depth + 1, 6) * 1.25 : (depth + 1) * 1.75),
                  mr: 0.5,
                }}
              >
                <XDriveAutoLoadSentinel
                  enabled
                  loading={loading}
                  label="正在加载更多文件夹…"
                  onLoad={() => loadChildren(node, true)}
                />
              </Box>
            ) : null}
          </Box>
        </Collapse>
      </Box>
    )
  }

  const displayedQuickAccessItems = useMemo(() => (
    sidebarPreferences.quickAccessSort === 'name'
      ? [...quickAccessItems].sort((left, right) => left.name.localeCompare(right.name))
      : quickAccessItems
  ), [quickAccessItems, sidebarPreferences.quickAccessSort])

  const setSectionVisible = (section: XDriveFileExplorerNavigationSection, visible: boolean) => {
    setSidebarPreferences((current) => ({
      ...current,
      visible: { ...current.visible, [section]: visible },
    }))
  }

  const reorderIDs = (ids: readonly number[], sourceID: number, targetID: number) => {
    if (sourceID === targetID) return [...ids]
    const next = ids.filter((id) => id !== sourceID)
    const targetIndex = next.indexOf(targetID)
    if (targetIndex < 0) return [...ids]
    next.splice(targetIndex, 0, sourceID)
    return next
  }

  const canPinCurrent = !trashActive && quickAccessEnabled && currentCrumbs.length > 1 && Boolean(onToggleCurrentQuickAccess)
  const savedSearchMatches = (id: number) => matchingSavedSearchIDs
    ? matchingSavedSearchIDs.includes(id)
    : activeSavedSearchID === id
  const organizationActionSx = {
    minWidth: compactViewport ? 44 : 0,
    minHeight: compactViewport ? 44 : 28,
    px: 1,
    py: 0.5,
    fontSize: '0.75rem',
    lineHeight: 1.4,
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
  }
  const organizationReadState = (label: string, knownCount: number) => (
    organizationLoading ? (
      <Stack direction="row" alignItems="center" spacing={0.75} role="status" sx={{ px: 0.75, py: 0.75 }}>
        <CircularProgress size={14} sx={{ flexShrink: 0 }} />
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          {`正在${knownCount > 0 ? '更新' : '加载'}${label}…`}
        </Typography>
      </Stack>
    ) : organizationError ? (
      <Box role="alert" sx={{ px: 0.75, py: 0.75 }}>
        <Typography variant="caption" color="error.main" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
          {`${label}读取失败：${organizationError}`}
        </Typography>
        {knownCount > 0 ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            以下显示上次成功读取的内容。
          </Typography>
        ) : null}
        {onRetryOrganization ? (
          <Button size="small" aria-label={`重新加载${label}`} onClick={() => { void onRetryOrganization() }} sx={organizationActionSx}>
            重试
          </Button>
        ) : null}
      </Box>
    ) : null
  )

  return (
    <Box
      data-xdrive-file-explorer-navigation-tree
      aria-label="文件夹导航"
      sx={{
        width: '100%',
        minWidth: 0,
        height: '100%',
        minHeight: 0,
        overflow: 'auto',
        overflowX: compactViewport ? 'hidden' : undefined,
        py: 0.75,
        bgcolor: 'background.paper',
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1, minHeight: compactViewport ? 44 : 28 }}>
        <Typography variant="caption" color="text.secondary" fontWeight={700}>侧边栏</Typography>
        <Tooltip title="排序和自定义侧边栏">
          <IconButton
            size="small"
            aria-label="排序和自定义侧边栏"
            onClick={(event) => setCustomizeAnchor(event.currentTarget)}
            sx={{ width: actionEdge, height: actionEdge, flexShrink: 0, borderRadius: 0.5 }}
          >
            <TuneRoundedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Stack>
      <Menu
        anchorEl={customizeAnchor}
        open={Boolean(customizeAnchor)}
        onClose={() => setCustomizeAnchor(null)}
      >
        <MenuItem disabled sx={{ fontSize: 12 }}>显示栏目</MenuItem>
        {([
          ['quickAccess', '快速访问', quickAccessEnabled],
          ['savedSearches', '智能文件夹', savedSearchesEnabled],
          ['tags', '标签', tagsEnabled],
          ['favorites', '收藏', favoritesEnabled],
          ['recent', '最近使用', recentEnabled],
          ['tree', '文件夹', true],
        ] as const).map(([section, label, available]) => (
          <MenuItem
            key={section}
            disabled={!available}
            onClick={() => setSectionVisible(section, !sidebarPreferences.visible[section])}
          >
            <Checkbox size="small" checked={available && sidebarPreferences.visible[section]} disabled={!available} />
            {label}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem disabled sx={{ fontSize: 12 }}>快速访问排序</MenuItem>
        <MenuItem
          selected={sidebarPreferences.quickAccessSort === 'manual'}
          onClick={() => setSidebarPreferences((current) => ({ ...current, quickAccessSort: 'manual' }))}
        >
          手动排序（可拖动）
        </MenuItem>
        <MenuItem
          selected={sidebarPreferences.quickAccessSort === 'name'}
          onClick={() => setSidebarPreferences((current) => ({ ...current, quickAccessSort: 'name' }))}
        >
          按名称排序
        </MenuItem>
      </Menu>

      {onNavigateTrash ? (
          <Box component="nav" aria-label="回收站" sx={{ px: 0.75, py: 0.5 }}>
            <ListItemButton
              selected={trashActive}
              aria-current={trashActive ? 'page' : undefined}
              onClick={() => { void onNavigateTrash() }}
              sx={{ minWidth: 0, minHeight: compactViewport ? 44 : 32, py: 0.25, pl: compactViewport ? 6.75 : 4.5, pr: 0.75, borderRadius: 0.5, gap: 0.75 }}
            >
              <DeleteOutlineRoundedIcon sx={{ fontSize: 19, color: trashActive ? 'primary.main' : 'text.secondary', flexShrink: 0 }} />
              <Typography variant="body2" noWrap sx={{ minWidth: 0, fontWeight: trashActive ? 600 : 400 }}>
                回收站
              </Typography>
            </ListItemButton>
          </Box>
      ) : null}

      {quickAccessEnabled && sidebarPreferences.visible.quickAccess ? (
        <Box
          component="nav"
          aria-label="快速访问"
          sx={{
            px: 0.75,
            py: 0.5,
            '& > :not(:first-child)': {
              display: expandedSections.quickAccess ? undefined : 'none',
            },
          }}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ minHeight: compactViewport ? 44 : 30 }}>
            <Stack direction="row" alignItems="center" spacing={0.25}>
              <IconButton
                size="small"
                aria-label={expandedSections.quickAccess ? '折叠快速访问' : '展开快速访问'}
                aria-expanded={expandedSections.quickAccess}
                onClick={() => toggleSection('quickAccess')}
                sx={{ width: actionEdge, height: actionEdge, flexShrink: 0, borderRadius: 0.5 }}
              >
                {expandedSections.quickAccess
                  ? <ExpandMoreRoundedIcon sx={{ fontSize: 17 }} />
                  : <ChevronRightRoundedIcon sx={{ fontSize: 17 }} />}
              </IconButton>
              <Typography variant="caption" fontWeight={700} color="text.secondary">
                快速访问
              </Typography>
            </Stack>
            {canPinCurrent ? (
              <Tooltip title={currentQuickAccessPinned ? '取消固定当前文件夹' : '固定当前文件夹'}>
                <span>
                  <IconButton
                    size="small"
                    aria-label={currentQuickAccessPinned ? '取消固定当前文件夹' : '固定当前文件夹'}
                    disabled={quickAccessBusyID !== null}
                    onClick={() => { void onToggleCurrentQuickAccess?.() }}
                    sx={{ width: actionEdge, height: actionEdge, flexShrink: 0, borderRadius: 0.5 }}
                  >
                    <PushPinRoundedIcon
                      sx={{
                        fontSize: 16,
                        transform: currentQuickAccessPinned ? 'none' : 'rotate(45deg)',
                        opacity: currentQuickAccessPinned ? 1 : 0.65,
                      }}
                    />
                  </IconButton>
                </span>
              </Tooltip>
            ) : null}
          </Stack>

          {quickAccessLoading && quickAccessItems.length === 0 ? (
            <Box sx={{ minHeight: compactViewport ? 44 : 32, display: 'grid', placeItems: 'center' }}>
              <CircularProgress size={14} />
            </Box>
          ) : quickAccessItems.length === 0 ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 0.75, py: 0.5 }}>
              暂无固定文件夹。打开文件夹的“更多操作”，选择“固定到快速访问”；也可固定当前文件夹。
            </Typography>
          ) : (
            <Stack spacing={0.25}>
              {displayedQuickAccessItems.map((item) => (
                <Box
                  key={item.id}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: `minmax(0, 1fr) ${secondaryTrack}px`,
                    alignItems: 'center',
                  }}
                >
                  <ListItemButton
                    selected={!trashActive && currentID === item.id}
                    title={item.path || item.name}
                    draggable={Boolean(onReorderQuickAccess) && sidebarPreferences.quickAccessSort === 'manual'}
                    aria-grabbed={draggedQuickAccessID === item.id}
                    onDragStart={(event) => {
                      if (!onReorderQuickAccess || sidebarPreferences.quickAccessSort !== 'manual') return
                      setDraggedQuickAccessID(item.id)
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('application/x-xdrive-sidebar-quick-access', String(item.id))
                    }}
                    onDragEnd={() => setDraggedQuickAccessID(null)}
                    onDragOver={(event) => {
                      if (draggedQuickAccessID === null) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                    }}
                    onDrop={(event) => {
                      if (draggedQuickAccessID === null || !onReorderQuickAccess || sidebarPreferences.quickAccessSort !== 'manual') return
                      event.preventDefault()
                      event.stopPropagation()
                      const ids = reorderIDs(displayedQuickAccessItems.map((entry) => entry.id), draggedQuickAccessID, item.id)
                      setDraggedQuickAccessID(null)
                      void onReorderQuickAccess(ids)
                    }}
                    onClick={() => { void onNavigateQuickAccess?.(item.id) }}
                    sx={{ minWidth: 0, minHeight: compactViewport ? 44 : 30, py: 0.25, pl: compactViewport ? 6.75 : 4.5, pr: 0.75, borderRadius: 0.5, gap: 0.75 }}
                  >
                    {renderItemVisual({ id: item.id, name: item.name, kind: 'dir', path: item.path }, 20)}
                    <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                      {item.name}
                    </Typography>
                  </ListItemButton>
                  <Tooltip title="取消固定">
                    <span>
                      <IconButton
                        size="small"
                        aria-label={`取消固定 ${item.name}`}
                        disabled={quickAccessBusyID !== null}
                        onClick={() => { void onUnpinQuickAccess?.(item.id) }}
                        sx={{ width: actionEdge, height: actionEdge, flexShrink: 0, borderRadius: 0.5 }}
                      >
                        <CloseRoundedIcon sx={{ fontSize: 15 }} />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
              ))}
            </Stack>
          )}
        </Box>
      ) : null}

      {savedSearchesEnabled && sidebarPreferences.visible.savedSearches ? (
        <Box
          component="nav"
          aria-label="智能文件夹"
          sx={{
            px: 0.75,
            py: 0.5,
            '& > :not(:first-child)': {
              display: expandedSections.savedSearches ? undefined : 'none',
            },
          }}
        >
          <Stack direction="row" alignItems="center" sx={{ minHeight: compactViewport ? 44 : 30, flexWrap: 'wrap', columnGap: 0.5 }}>
            <Stack direction="row" alignItems="center" spacing={0.25} sx={{ minWidth: 0, flex: '1 1 auto' }}>
              <IconButton
                size="small"
                aria-label={expandedSections.savedSearches ? '折叠智能文件夹' : '展开智能文件夹'}
                aria-expanded={expandedSections.savedSearches}
                onClick={() => toggleSection('savedSearches')}
                sx={{ width: actionEdge, height: actionEdge, flexShrink: 0, borderRadius: 0.5 }}
              >
                {expandedSections.savedSearches
                  ? <ExpandMoreRoundedIcon sx={{ fontSize: 17 }} />
                  : <ChevronRightRoundedIcon sx={{ fontSize: 17 }} />}
              </IconButton>
              <SearchRoundedIcon sx={{ fontSize: 15, color: 'text.secondary', flexShrink: 0 }} />
              <Typography variant="caption" fontWeight={700} color="text.secondary">智能文件夹</Typography>
            </Stack>
            {onSaveCurrentSearch ? (
              <Button
                size="small"
                aria-label="保存当前搜索"
                disabled={!canSaveCurrentSearch}
                onClick={onSaveCurrentSearch}
                sx={organizationActionSx}
              >
                保存当前搜索
              </Button>
            ) : null}
          </Stack>
          {organizationReadState('智能文件夹', savedSearches.length)}
          {savedSearches.length > 0 ? (
            <Stack spacing={0.25}>
              {savedSearches.map((search) => (
                <Box
                  key={search.id}
                  sx={{ display: 'grid', gridTemplateColumns: `minmax(0, 1fr) ${secondaryTrack}px`, alignItems: 'center' }}
                >
                  <ListItemButton
                    selected={savedSearchMatches(search.id)}
                    aria-label={search.name}
                    aria-current={activeSavedSearchID === search.id ? 'page' : undefined}
                    aria-describedby={`${organizationDescriptionID}-saved-${search.id}`}
                    draggable={Boolean(onReorderSavedSearches)}
                    aria-grabbed={draggedSavedSearchID === search.id}
                    onDragStart={(event) => {
                      if (!onReorderSavedSearches) return
                      setDraggedSavedSearchID(search.id)
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('application/x-xdrive-sidebar-saved-search', String(search.id))
                    }}
                    onDragEnd={() => setDraggedSavedSearchID(null)}
                    onDragOver={(event) => {
                      if (draggedSavedSearchID === null) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                    }}
                    onDrop={(event) => {
                      if (draggedSavedSearchID === null || !onReorderSavedSearches) return
                      event.preventDefault()
                      event.stopPropagation()
                      const ids = reorderIDs(savedSearches.map((entry) => entry.id), draggedSavedSearchID, search.id)
                      setDraggedSavedSearchID(null)
                      void onReorderSavedSearches(ids)
                    }}
                    onClick={() => { void onActivateSavedSearch?.(search) }}
                    sx={{ minWidth: 0, minHeight: compactViewport ? 44 : 30, py: 0.25, pl: compactViewport ? 6.75 : 4.5, pr: 0.75, borderRadius: 0.5, gap: 0.75 }}
                  >
                    <SearchRoundedIcon sx={{ fontSize: 18, color: savedSearchMatches(search.id) ? 'primary.main' : 'text.secondary', flexShrink: 0 }} />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{search.name}</Typography>
                      <Box id={`${organizationDescriptionID}-saved-${search.id}`}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          data-xdrive-saved-search-rule={search.id}
                          sx={{ display: 'block', overflowWrap: 'anywhere' }}
                        >
                          {(savedSearchRuleLabels?.(search)
                            ?? xDriveFileExplorerSavedSearchRuleLabels(search, { tagOptions: tags })).join(' · ')}
                        </Typography>
                        {savedSearchMatches(search.id) ? (
                          <Typography variant="caption" color="primary.main" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
                            当前搜索匹配此规则
                          </Typography>
                        ) : null}
                      </Box>
                    </Box>
                  </ListItemButton>
                  {onRenameSavedSearch || onReplaceSavedSearch || onDeleteSavedSearch ? (
                    <Tooltip title="智能文件夹选项">
                      <span>
                        <IconButton
                          size="small"
                          aria-label={`智能文件夹 ${search.name} 选项`}
                          onClick={(event) => setSavedSearchMenu({ anchor: event.currentTarget, search })}
                          sx={{ width: actionEdge, height: actionEdge, flexShrink: 0, borderRadius: 0.5 }}
                        >
                          <MoreHorizRoundedIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  ) : null}
                </Box>
              ))}
            </Stack>
          ) : null}
        </Box>
      ) : null}

      <Menu
        anchorEl={savedSearchMenu?.anchor ?? null}
        open={Boolean(savedSearchMenu)}
        onClose={() => setSavedSearchMenu(null)}
        slotProps={{ paper: { sx: {
          maxWidth: 'calc(100vw - 16px)',
          maxHeight: 'calc(100dvh - 16px)',
          '& .MuiMenuItem-root': { minHeight: compactViewport ? 44 : undefined, whiteSpace: 'normal', overflowWrap: 'anywhere' },
        } } }}
      >
        {onRenameSavedSearch ? (
          <MenuItem onClick={() => {
            const search = savedSearchMenu?.search
            setSavedSearchMenu(null)
            if (search) void onRenameSavedSearch(search)
          }}>
            重命名
          </MenuItem>
        ) : null}
        {onReplaceSavedSearch ? (
          <MenuItem
            disabled={!canReplaceSavedSearch}
            onClick={() => {
              const search = savedSearchMenu?.search
              setSavedSearchMenu(null)
              if (search) void onReplaceSavedSearch(search)
            }}
          >
            更新为当前搜索
          </MenuItem>
        ) : null}
        {onDeleteSavedSearch ? (
          <MenuItem
            sx={{ color: 'error.main' }}
            onClick={() => {
              const search = savedSearchMenu?.search
              setSavedSearchMenu(null)
              if (search) void onDeleteSavedSearch(search.id)
            }}
          >
            删除智能文件夹
          </MenuItem>
        ) : null}
      </Menu>

      {tagsEnabled && sidebarPreferences.visible.tags ? (
        <Box
          component="nav"
          aria-label="标签"
          sx={{
            px: 0.75,
            py: 0.5,
            '& > :not(:first-child)': {
              display: expandedSections.tags ? undefined : 'none',
            },
          }}
        >
          <Stack direction="row" alignItems="center" sx={{ minHeight: compactViewport ? 44 : 30, flexWrap: 'wrap', columnGap: 0.5 }}>
            <Stack direction="row" alignItems="center" spacing={0.25} sx={{ minWidth: 0, flex: '1 1 auto' }}>
              <IconButton
                size="small"
                aria-label={expandedSections.tags ? '折叠标签' : '展开标签'}
                aria-expanded={expandedSections.tags}
                onClick={() => toggleSection('tags')}
                sx={{ width: actionEdge, height: actionEdge, flexShrink: 0, borderRadius: 0.5 }}
              >
                {expandedSections.tags
                  ? <ExpandMoreRoundedIcon sx={{ fontSize: 17 }} />
                  : <ChevronRightRoundedIcon sx={{ fontSize: 17 }} />}
              </IconButton>
              <LocalOfferRoundedIcon sx={{ fontSize: 15, color: 'text.secondary', flexShrink: 0 }} />
              <Typography variant="caption" fontWeight={700} color="text.secondary">标签</Typography>
            </Stack>
            {onManageTags ? (
              <Button size="small" aria-label="管理标签" onClick={onManageTags} sx={organizationActionSx}>
                管理标签
              </Button>
            ) : null}
          </Stack>
          {organizationReadState('标签', tags.length)}
          {tags.length > 0 ? (
            <Stack spacing={0.25}>
              {tags.map((tag) => (
                <ListItemButton
                  key={tag.id}
                  selected={activeTagID === tag.id}
                  aria-label={tag.name}
                  aria-current={activeTagID === tag.id ? 'page' : undefined}
                  aria-describedby={`${organizationDescriptionID}-tag-${tag.id}`}
                  onClick={() => { void onActivateTag?.(tag) }}
                  sx={{ minWidth: 0, minHeight: compactViewport ? 44 : 30, py: 0.25, pl: compactViewport ? 6.75 : 4.5, pr: 0.75, borderRadius: 0.5, gap: 0.75 }}
                >
                  <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: tag.color || 'text.disabled', flexShrink: 0 }} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{tag.name}</Typography>
                    <Typography
                      id={`${organizationDescriptionID}-tag-${tag.id}`}
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', overflowWrap: 'anywhere' }}
                    >
                      {`共 ${tag.item_count} 项${activeTagID === tag.id ? ' · 已用于当前筛选' : ''}`}
                    </Typography>
                  </Box>
                </ListItemButton>
              ))}
            </Stack>
          ) : null}
        </Box>
      ) : null}

      {favoritesEnabled && sidebarPreferences.visible.favorites ? (
        <Box
          component="nav"
          aria-label="收藏"
          sx={{
            px: 0.75,
            py: 0.5,
            '& > :not(:first-child)': {
              display: expandedSections.favorites ? undefined : 'none',
            },
          }}
        >
          <Stack direction="row" alignItems="center" spacing={0.25} sx={{ minHeight: compactViewport ? 44 : 30 }}>
            <IconButton
              size="small"
              aria-label={expandedSections.favorites ? '折叠收藏' : '展开收藏'}
              aria-expanded={expandedSections.favorites}
              onClick={() => toggleSection('favorites')}
              sx={{ width: actionEdge, height: actionEdge, flexShrink: 0, borderRadius: 0.5 }}
            >
              {expandedSections.favorites
                ? <ExpandMoreRoundedIcon sx={{ fontSize: 17 }} />
                : <ChevronRightRoundedIcon sx={{ fontSize: 17 }} />}
            </IconButton>
            <StarRoundedIcon sx={{ fontSize: 15, color: 'text.secondary' }} />
            <Typography variant="caption" fontWeight={700} color="text.secondary">
              收藏
            </Typography>
          </Stack>
          {favoritesLoading && favoriteItems.length === 0 ? (
            <Box sx={{ minHeight: compactViewport ? 44 : 32, display: 'grid', placeItems: 'center' }}>
              <CircularProgress size={14} />
            </Box>
          ) : favoriteItems.length === 0 ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 0.75, py: 0.5 }}>
              暂无收藏文件。打开文件的“更多操作”，选择“添加到收藏”。文件夹可固定到快速访问。
            </Typography>
          ) : (
            <Stack spacing={0.25}>
              {favoriteItems.map((item) => (
                <Box
                  key={item.id}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: `minmax(0, 1fr) ${secondaryTrack}px`,
                    alignItems: 'center',
                  }}
                >
                  <ListItemButton
                    title={item.path || item.name}
                    onClick={() => { void onActivateFavorite?.(item.id) }}
                    sx={{ minWidth: 0, minHeight: compactViewport ? 44 : 30, py: 0.25, pl: compactViewport ? 6.75 : 4.5, pr: 0.75, borderRadius: 0.5, gap: 0.75 }}
                  >
                    {renderItemVisual({
                      id: item.id,
                      name: item.name,
                      kind: 'file',
                      size: item.size,
                      revision: item.revision,
                      updatedAt: item.updatedAt,
                      path: item.path,
                    })}
                    <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                      {item.name}
                    </Typography>
                  </ListItemButton>
                  <Tooltip title="取消收藏">
                    <span>
                      <IconButton
                        size="small"
                        aria-label={`取消收藏 ${item.name}`}
                        disabled={favoriteBusyID !== null}
                        onClick={() => { void onUnfavorite?.(item.id) }}
                        sx={{ width: actionEdge, height: actionEdge, flexShrink: 0, borderRadius: 0.5 }}
                      >
                        <StarRoundedIcon sx={{ fontSize: 15 }} />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
              ))}
            </Stack>
          )}
        </Box>
      ) : null}

      {recentEnabled && sidebarPreferences.visible.recent ? (
        <Box
          component="nav"
          aria-label="最近使用"
          sx={{
            px: 0.75,
            py: 0.5,
            '& > :not(:first-child)': {
              display: expandedSections.recent ? undefined : 'none',
            },
          }}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ minHeight: compactViewport ? 44 : 30 }}>
            <Stack direction="row" alignItems="center" spacing={0.25}>
              <IconButton
                size="small"
                aria-label={expandedSections.recent ? '折叠最近使用' : '展开最近使用'}
                aria-expanded={expandedSections.recent}
                onClick={() => toggleSection('recent')}
                sx={{ width: actionEdge, height: actionEdge, flexShrink: 0, borderRadius: 0.5 }}
              >
                {expandedSections.recent
                  ? <ExpandMoreRoundedIcon sx={{ fontSize: 17 }} />
                  : <ChevronRightRoundedIcon sx={{ fontSize: 17 }} />}
              </IconButton>
              <HistoryRoundedIcon sx={{ fontSize: 15, color: 'text.secondary' }} />
              <Typography variant="caption" fontWeight={700} color="text.secondary">
                最近使用
              </Typography>
            </Stack>
            {recentItems.length > 0 && onClearRecent ? (
              <Tooltip title="清空最近使用">
                <span>
                  <IconButton
                    size="small"
                    aria-label="清空最近使用"
                    disabled={recentLoading}
                    onClick={() => { void onClearRecent() }}
                    sx={{ width: actionEdge, height: actionEdge, flexShrink: 0, borderRadius: 0.5 }}
                  >
                    <CloseRoundedIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                </span>
              </Tooltip>
            ) : null}
          </Stack>

          {recentLoading && recentItems.length === 0 ? (
            <Box sx={{ minHeight: compactViewport ? 44 : 32, display: 'grid', placeItems: 'center' }}>
              <CircularProgress size={14} />
            </Box>
          ) : recentItems.length === 0 ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 0.75, py: 0.5 }}>
              暂无最近访问
            </Typography>
          ) : (
            <Stack spacing={0.25}>
              {recentItems.slice(0, 8).map((item) => (
                <ListItemButton
                  key={item.id}
                  selected={!trashActive && item.kind === 'dir' && currentID === item.id}
                  title={item.path || item.name}
                  onClick={() => { void onActivateRecent?.(item.id) }}
                  sx={{ minWidth: 0, minHeight: compactViewport ? 44 : 30, py: 0.25, pl: compactViewport ? 6.75 : 4.5, pr: 0.75, borderRadius: 0.5, gap: 0.75 }}
                >
                  {renderItemVisual({
                    id: item.id,
                    name: item.name,
                    kind: item.kind,
                    size: item.size,
                    revision: item.revision,
                    updatedAt: item.updatedAt,
                    path: item.path,
                  })}
                  <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                    {item.name}
                  </Typography>
                </ListItemButton>
              ))}
            </Stack>
          )}
        </Box>
      ) : null}

      {sidebarPreferences.visible.tree ? (
      <Box component="nav" aria-label="文件夹" sx={{ px: 0.75, py: 0.5 }}>
        <Stack direction="row" alignItems="center" spacing={0.25} sx={{ minHeight: compactViewport ? 44 : 30 }}>
          <IconButton
            size="small"
            aria-label={expandedSections.tree ? '折叠文件夹树' : '展开文件夹树'}
            aria-expanded={expandedSections.tree}
            onClick={() => toggleSection('tree')}
            sx={{ width: actionEdge, height: actionEdge, flexShrink: 0, borderRadius: 0.5 }}
          >
            {expandedSections.tree
              ? <ExpandMoreRoundedIcon sx={{ fontSize: 17 }} />
              : <ChevronRightRoundedIcon sx={{ fontSize: 17 }} />}
          </IconButton>
          <Typography variant="caption" fontWeight={700} color="text.secondary">
            文件夹
          </Typography>
        </Stack>
        <Box
          role="tree"
          aria-label="文件夹树"
          sx={{ display: expandedSections.tree ? 'block' : 'none' }}
        >
          {rootNode ? renderNode(rootNode, 0) : null}
        </Box>
      </Box>
      ) : null}
    </Box>
  )
}

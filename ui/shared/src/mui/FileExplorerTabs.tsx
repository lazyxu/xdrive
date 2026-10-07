import { useState } from 'react'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import RestoreRoundedIcon from '@mui/icons-material/RestoreRounded'
import {
  Box,
  ButtonBase,
  Divider,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type {
  XDriveFileExplorerNavigationTabSummary,
  XDriveFileExplorerTabDropPosition,
} from './FileExplorerNavigation'

export function XDriveFileExplorerTabs({
  tabs,
  activeTabID,
  canNewTab = true,
  canCloseTab = true,
  canRestoreClosedTab = false,
  onActivate,
  onNewTab,
  onCloseTab,
  onReorderTab,
  onDuplicateTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onRestoreClosedTab,
}: {
  tabs: readonly XDriveFileExplorerNavigationTabSummary[]
  activeTabID: string
  canNewTab?: boolean
  canCloseTab?: boolean
  canRestoreClosedTab?: boolean
  onActivate: (id: string) => void
  onNewTab: () => void
  onCloseTab: (id: string) => void
  onReorderTab?: (
    sourceID: string,
    targetID: string,
    position: XDriveFileExplorerTabDropPosition,
  ) => void
  onDuplicateTab?: (id: string) => void
  onCloseOtherTabs?: (id: string) => void
  onCloseTabsToRight?: (id: string) => void
  onRestoreClosedTab?: () => void
}) {
  const [draggedTabID, setDraggedTabID] = useState<string | null>(null)
  const [dragTarget, setDragTarget] = useState<{
    id: string
    position: XDriveFileExplorerTabDropPosition
  } | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    tabID: string
    mouseX: number
    mouseY: number
  } | null>(null)

  const closeContextMenu = () => setContextMenu(null)
  const contextTabIndex = contextMenu
    ? tabs.findIndex((tab) => tab.id === contextMenu.tabID)
    : -1

  const openContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    tabID: string,
  ) => {
    event.preventDefault()
    setContextMenu({
      tabID,
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
    })
  }

  const runContextAction = (action: () => void) => {
    closeContextMenu()
    action()
  }

  return (
    <>
      <Box
        role="tablist"
        aria-label="文件标签页"
        data-xdrive-file-explorer-tabs
        sx={{
          minHeight: 36,
          display: 'flex',
          alignItems: 'stretch',
          overflowX: 'auto',
          overflowY: 'hidden',
          bgcolor: 'background.default',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeTabID
          const currentDrop = dragTarget?.id === tab.id ? dragTarget : null
          return (
            <Box
              key={tab.id}
              draggable={Boolean(onReorderTab) && tabs.length > 1}
              onDragStart={(event) => {
                if (!onReorderTab) return
                setDraggedTabID(tab.id)
                setDragTarget(null)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', tab.id)
              }}
              onDragOver={(event) => {
                if (!onReorderTab || !draggedTabID || draggedTabID === tab.id) {
                  return
                }
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                const rect = event.currentTarget.getBoundingClientRect()
                setDragTarget({
                  id: tab.id,
                  position: event.clientX < rect.left + rect.width / 2
                    ? 'before'
                    : 'after',
                })
              }}
              onDrop={(event) => {
                if (
                  !onReorderTab ||
                  !draggedTabID ||
                  draggedTabID === tab.id
                ) return
                event.preventDefault()
                const rect = event.currentTarget.getBoundingClientRect()
                const position: XDriveFileExplorerTabDropPosition =
                  event.clientX < rect.left + rect.width / 2
                    ? 'before'
                    : 'after'
                onReorderTab(draggedTabID, tab.id, position)
                setDraggedTabID(null)
                setDragTarget(null)
              }}
              onDragEnd={() => {
                setDraggedTabID(null)
                setDragTarget(null)
              }}
              onContextMenu={(event) => openContextMenu(event, tab.id)}
              sx={{
                position: 'relative',
                minWidth: 0,
                flex: '0 1 220px',
                maxWidth: 260,
                display: 'flex',
                alignItems: 'center',
                borderRight: 1,
                borderColor: 'divider',
                bgcolor: active ? 'background.paper' : 'transparent',
                boxShadow: active
                  ? 'inset 0 -2px 0 var(--mui-palette-primary-main)'
                  : 'none',
                '&::before': currentDrop ? {
                  content: '""',
                  position: 'absolute',
                  top: 4,
                  bottom: 4,
                  width: 2,
                  bgcolor: 'primary.main',
                  left: currentDrop.position === 'before' ? 0 : undefined,
                  right: currentDrop.position === 'after' ? 0 : undefined,
                  zIndex: 2,
                } : undefined,
              }}
            >
              <ButtonBase
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => onActivate(tab.id)}
                onMouseDown={(event) => {
                  if (event.button === 1 && canCloseTab) event.preventDefault()
                }}
                onAuxClick={(event) => {
                  if (event.button !== 1 || !canCloseTab) return
                  event.preventDefault()
                  onCloseTab(tab.id)
                }}
                sx={{
                  minWidth: 0,
                  flex: 1,
                  height: '100%',
                  justifyContent: 'flex-start',
                  gap: 0.75,
                  px: 1,
                  borderRadius: 0,
                }}
              >
                <FolderRoundedIcon sx={{ fontSize: 17, color: '#ffcb3d', flexShrink: 0 }} />
                <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                  {tab.label}
                </Typography>
              </ButtonBase>

              {canCloseTab ? (
                <Tooltip title="关闭标签页">
                  <IconButton
                    size="small"
                    aria-label={`关闭标签页 ${tab.label}`}
                    onClick={() => onCloseTab(tab.id)}
                    sx={{ width: 26, height: 26, mr: 0.5, borderRadius: 1, flexShrink: 0 }}
                  >
                    <CloseRoundedIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
              ) : null}
            </Box>
          )
        })}

        <Tooltip title="新建标签页">
          <span>
            <IconButton
              size="small"
              aria-label="新建文件标签页"
              disabled={!canNewTab}
              onClick={onNewTab}
              sx={{ width: 34, height: 34, mx: 0.25, borderRadius: 1, flexShrink: 0 }}
            >
              <AddRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Menu
        open={Boolean(contextMenu)}
        onClose={closeContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu
          ? { left: contextMenu.mouseX, top: contextMenu.mouseY }
          : undefined}
      >
        <MenuItem
          disabled={!contextMenu || !canNewTab || !onDuplicateTab}
          onClick={() => {
            if (contextMenu && onDuplicateTab) {
              runContextAction(() => onDuplicateTab(contextMenu.tabID))
            }
          }}
        >
          <ListItemIcon><ContentCopyRoundedIcon fontSize="small" /></ListItemIcon>
          复制标签
        </MenuItem>
        <MenuItem
          disabled={!contextMenu || !canCloseTab}
          onClick={() => {
            if (contextMenu) runContextAction(() => onCloseTab(contextMenu.tabID))
          }}
        >
          <ListItemIcon><CloseRoundedIcon fontSize="small" /></ListItemIcon>
          关闭标签页
        </MenuItem>
        <MenuItem
          disabled={
            !contextMenu ||
            !canCloseTab ||
            tabs.length <= 1 ||
            !onCloseOtherTabs
          }
          onClick={() => {
            if (contextMenu && onCloseOtherTabs) {
              runContextAction(() => onCloseOtherTabs(contextMenu.tabID))
            }
          }}
        >
          关闭其他标签页
        </MenuItem>
        <MenuItem
          disabled={
            !contextMenu ||
            !canCloseTab ||
            contextTabIndex < 0 ||
            contextTabIndex >= tabs.length - 1 ||
            !onCloseTabsToRight
          }
          onClick={() => {
            if (contextMenu && onCloseTabsToRight) {
              runContextAction(() => onCloseTabsToRight(contextMenu.tabID))
            }
          }}
        >
          关闭右侧标签页
        </MenuItem>
        <Divider />
        <MenuItem
          disabled={!canRestoreClosedTab || !onRestoreClosedTab}
          onClick={() => {
            if (onRestoreClosedTab) runContextAction(onRestoreClosedTab)
          }}
        >
          <ListItemIcon><RestoreRoundedIcon fontSize="small" /></ListItemIcon>
          恢复关闭的标签页
        </MenuItem>
      </Menu>
    </>
  )
}

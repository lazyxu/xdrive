import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import { Box, ButtonBase, IconButton, Tooltip, Typography } from '@mui/material'
import type { XDriveFileExplorerNavigationTabSummary } from './FileExplorerNavigation'

export function XDriveFileExplorerTabs({
  tabs,
  activeTabID,
  canNewTab = true,
  canCloseTab = true,
  onActivate,
  onNewTab,
  onCloseTab,
}: {
  tabs: readonly XDriveFileExplorerNavigationTabSummary[]
  activeTabID: string
  canNewTab?: boolean
  canCloseTab?: boolean
  onActivate: (id: string) => void
  onNewTab: () => void
  onCloseTab: (id: string) => void
}) {
  return (
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
        return (
          <Box
            key={tab.id}
            sx={{
              minWidth: 0,
              flex: '0 1 220px',
              maxWidth: 260,
              display: 'flex',
              alignItems: 'center',
              borderRight: 1,
              borderColor: 'divider',
              bgcolor: active ? 'background.paper' : 'transparent',
              boxShadow: active ? 'inset 0 -2px 0 var(--mui-palette-primary-main)' : 'none',
            }}
          >
            <ButtonBase
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onActivate(tab.id)}
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
  )
}

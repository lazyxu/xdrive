import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import DriveFolderUploadRoundedIcon from '@mui/icons-material/DriveFolderUploadRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import RestoreFromTrashRoundedIcon from '@mui/icons-material/RestoreFromTrashRounded'
import ShareRoundedIcon from '@mui/icons-material/ShareRounded'
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import TabRoundedIcon from '@mui/icons-material/TabRounded'
import UploadRoundedIcon from '@mui/icons-material/UploadRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import type { XDriveFileExplorerMenuItem } from './FileExplorer'
import { XDriveFileExplorerCommandButton } from './FileExplorer'

export function xDriveFileExplorerStandardItemMenuItems({
  kind,
  primaryDisabled = false,
  onOpen,
  onOpenInNewTab,
  onToggleQuickAccess,
  quickAccessPinned = false,
  quickAccessDisabled = false,
  onToggleFavorite,
  favorite = false,
  favoriteDisabled = false,
  onSystemOpen,
  systemOpenLabel = '使用系统打开',
  onDownload,
  downloadLabel = '下载',
  onShowContainingFolder,
  onReveal,
  revealLabel = '在文件资源管理器中显示',
  onShare,
  onHistory,
  onRename,
  onDelete,
}: {
  kind: 'dir' | 'file'
  primaryDisabled?: boolean
  onOpen?: () => void
  onOpenInNewTab?: () => void
  onToggleQuickAccess?: () => void
  quickAccessPinned?: boolean
  quickAccessDisabled?: boolean
  onToggleFavorite?: () => void
  favorite?: boolean
  favoriteDisabled?: boolean
  onSystemOpen?: () => void
  systemOpenLabel?: string
  onDownload?: () => void
  downloadLabel?: string
  onShowContainingFolder?: () => void
  onReveal?: () => void
  revealLabel?: string
  onShare?: () => void
  onHistory?: () => void
  onRename?: () => void
  onDelete: () => void
}): XDriveFileExplorerMenuItem[] {
  const items: XDriveFileExplorerMenuItem[] = []

  if (kind === 'dir') {
    if (onOpen) {
      items.push({
        id: 'open',
        label: '打开',
        icon: <FolderOpenRoundedIcon fontSize="small" />,
        disabled: primaryDisabled,
        disabledReason: primaryDisabled ? '当前文件操作尚未结束，请稍后重试。' : undefined,
        onSelect: onOpen,
      })
    }
    if (onOpenInNewTab) {
      items.push({
        id: 'open-new-tab',
        label: '在新标签页中打开',
        icon: <TabRoundedIcon fontSize="small" />,
        disabled: primaryDisabled,
        disabledReason: primaryDisabled ? '当前文件操作尚未结束，请稍后重试。' : undefined,
        onSelect: onOpenInNewTab,
      })
    }
    if (onToggleQuickAccess) {
      items.push({
        id: 'toggle-quick-access',
        label: quickAccessPinned ? '从快速访问取消固定' : '固定到快速访问',
        icon: <PushPinRoundedIcon fontSize="small" />,
        disabled: primaryDisabled || quickAccessDisabled,
        disabledReason: primaryDisabled ? '当前文件操作尚未结束，请稍后重试。'
          : quickAccessDisabled ? '快速访问正在更新，请稍后重试。' : undefined,
        onSelect: onToggleQuickAccess,
      })
    }
    if (onReveal) {
      items.push({
        id: 'reveal',
        label: revealLabel,
        icon: <OpenInNewRoundedIcon fontSize="small" />,
        disabled: primaryDisabled,
        disabledReason: primaryDisabled ? '当前文件操作尚未结束，请稍后重试。' : undefined,
        onSelect: onReveal,
      })
    }
  } else {
    if (onOpen) {
      items.push({
        id: 'open',
        label: '打开',
        icon: <VisibilityRoundedIcon fontSize="small" />,
        disabled: primaryDisabled,
        disabledReason: primaryDisabled ? '当前文件操作尚未结束，请稍后重试。' : undefined,
        onSelect: onOpen,
      })
    }
    if (onToggleFavorite) {
      items.push({
        id: 'toggle-favorite',
        label: favorite ? '取消收藏' : '添加到收藏',
        icon: favorite
          ? <StarRoundedIcon fontSize="small" />
          : <StarBorderRoundedIcon fontSize="small" />,
        disabled: primaryDisabled || favoriteDisabled,
        disabledReason: primaryDisabled ? '当前文件操作尚未结束，请稍后重试。'
          : favoriteDisabled ? '收藏状态正在更新，请稍后重试。' : undefined,
        onSelect: onToggleFavorite,
      })
    }
    if (onSystemOpen) {
      items.push({
        id: 'system-open',
        label: systemOpenLabel,
        icon: <OpenInNewRoundedIcon fontSize="small" />,
        disabled: primaryDisabled,
        disabledReason: primaryDisabled ? '当前文件操作尚未结束，请稍后重试。' : undefined,
        onSelect: onSystemOpen,
      })
    }
    if (onDownload) {
      items.push({
        id: 'download',
        label: downloadLabel,
        icon: <DownloadRoundedIcon fontSize="small" />,
        disabled: primaryDisabled,
        disabledReason: primaryDisabled ? '当前文件操作尚未结束，请稍后重试。' : undefined,
        onSelect: onDownload,
      })
    }
    if (onReveal) {
      items.push({
        id: 'reveal',
        label: revealLabel,
        icon: <FolderOpenRoundedIcon fontSize="small" />,
        disabled: primaryDisabled,
        disabledReason: primaryDisabled ? '当前文件操作尚未结束，请稍后重试。' : undefined,
        onSelect: onReveal,
      })
    }
  }

  // Share the same Owner capability-link dialog for files and non-root folders.
  // Preserve the file menu's original Share -> History ordering.
  if (onShare) {
    items.push({
      id: 'share',
      label: '分享',
      icon: <ShareRoundedIcon fontSize="small" />,
      onSelect: onShare,
    })
  }
  if (kind === 'file' && onHistory) {
    items.push({
      id: 'history',
      label: '历史版本',
      icon: <HistoryRoundedIcon fontSize="small" />,
      onSelect: onHistory,
    })
  }

  if (onShowContainingFolder) {
    items.push({
      id: 'show-containing-folder',
      label: '显示所在文件夹',
      icon: <FolderOpenRoundedIcon fontSize="small" />,
      disabled: primaryDisabled,
        disabledReason: primaryDisabled ? '当前文件操作尚未结束，请稍后重试。' : undefined,
      onSelect: onShowContainingFolder,
    })
  }

  if (onRename) {
    items.push({
      id: 'rename',
      label: '重命名',
      icon: <EditRoundedIcon fontSize="small" />,
      dividerBefore: true,
      onSelect: onRename,
    })
  }
  items.push({
    id: 'delete',
    label: '删除',
    icon: <DeleteOutlineRoundedIcon fontSize="small" />,
    danger: true,
    onSelect: onDelete,
  })
  return items
}

export function xDriveFileExplorerBackgroundMenuItems({
  onCreateFolder,
  onUpload,
  onUploadFolder,
  uploadDisabled = false,
  onRefresh,
}: {
  onCreateFolder: () => void
  onUpload: () => void
  onUploadFolder?: () => void
  uploadDisabled?: boolean
  onRefresh: () => void
}): XDriveFileExplorerMenuItem[] {
  return [
    {
      id: 'new-folder',
      label: '新建文件夹',
      icon: <CreateNewFolderRoundedIcon fontSize="small" />,
      onSelect: onCreateFolder,
    },
    {
      id: 'upload',
      label: '上传文件',
      icon: <UploadRoundedIcon fontSize="small" />,
      disabled: uploadDisabled,
      disabledReason: uploadDisabled ? '当前上传操作尚未完成，请稍后重试。' : undefined,
      onSelect: onUpload,
    },
    ...(onUploadFolder ? [{
      id: 'upload-folder',
      label: '上传文件夹',
      icon: <DriveFolderUploadRoundedIcon fontSize="small" />,
      disabled: uploadDisabled,
      disabledReason: uploadDisabled ? '当前上传操作尚未完成，请稍后重试。' : undefined,
      onSelect: onUploadFolder,
    }] : []),
    {
      id: 'refresh',
      label: '刷新',
      icon: <RefreshRoundedIcon fontSize="small" />,
      dividerBefore: true,
      onSelect: onRefresh,
    },
  ]
}

export function XDriveFileExplorerTrashCommandButton({
  onClick,
}: {
  onClick: () => void
}) {
  return (
    <XDriveFileExplorerCommandButton
      startIcon={<RestoreFromTrashRoundedIcon />}
      onClick={onClick}
    >
      回收站
    </XDriveFileExplorerCommandButton>
  )
}

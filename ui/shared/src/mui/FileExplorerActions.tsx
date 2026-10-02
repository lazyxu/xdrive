import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import RestoreFromTrashRoundedIcon from '@mui/icons-material/RestoreFromTrashRounded'
import ShareRoundedIcon from '@mui/icons-material/ShareRounded'
import UploadRoundedIcon from '@mui/icons-material/UploadRounded'
import type { XDriveFileExplorerMenuItem } from './FileExplorer'
import { XDriveFileExplorerCommandButton } from './FileExplorer'

export function xDriveFileExplorerStandardItemMenuItems({
  kind,
  primaryDisabled = false,
  onOpen,
  onDownload,
  downloadLabel = '下载',
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
  onDownload?: () => void
  downloadLabel?: string
  onReveal?: () => void
  revealLabel?: string
  onShare?: () => void
  onHistory?: () => void
  onRename: () => void
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
        onSelect: onOpen,
      })
    }
    if (onReveal) {
      items.push({
        id: 'reveal',
        label: revealLabel,
        icon: <OpenInNewRoundedIcon fontSize="small" />,
        disabled: primaryDisabled,
        onSelect: onReveal,
      })
    }
  } else {
    if (onOpen) {
      items.push({
        id: 'open',
        label: '打开',
        icon: <OpenInNewRoundedIcon fontSize="small" />,
        disabled: primaryDisabled,
        onSelect: onOpen,
      })
    }
    if (onDownload) {
      items.push({
        id: 'download',
        label: downloadLabel,
        icon: <DownloadRoundedIcon fontSize="small" />,
        disabled: primaryDisabled,
        onSelect: onDownload,
      })
    }
    if (onReveal) {
      items.push({
        id: 'reveal',
        label: revealLabel,
        icon: <FolderOpenRoundedIcon fontSize="small" />,
        disabled: primaryDisabled,
        onSelect: onReveal,
      })
    }
    if (onShare) {
      items.push({
        id: 'share',
        label: '分享',
        icon: <ShareRoundedIcon fontSize="small" />,
        onSelect: onShare,
      })
    }
    if (onHistory) {
      items.push({
        id: 'history',
        label: '历史版本',
        icon: <HistoryRoundedIcon fontSize="small" />,
        onSelect: onHistory,
      })
    }
  }

  items.push({
    id: 'rename',
    label: '重命名',
    icon: <EditRoundedIcon fontSize="small" />,
    dividerBefore: true,
    onSelect: onRename,
  })
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
  uploadDisabled = false,
  onRefresh,
}: {
  onCreateFolder: () => void
  onUpload: () => void
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
      onSelect: onUpload,
    },
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

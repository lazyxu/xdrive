import AudioFileRoundedIcon from '@mui/icons-material/AudioFileRounded'
import CodeRoundedIcon from '@mui/icons-material/CodeRounded'
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import FolderZipRoundedIcon from '@mui/icons-material/FolderZipRounded'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import MovieRoundedIcon from '@mui/icons-material/MovieRounded'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded'
import ViewCarouselRoundedIcon from '@mui/icons-material/ViewCarouselRounded'
import type { XDriveFileExplorerFileKind } from './FileExplorer'

// Public capability pages import only these pure presentation helpers, never
// the authenticated FileExplorer shell, clipboard, mutation or data adapters.
type XDriveFileExplorerIconItem = {
  name: string
  kind: 'dir' | 'file'
  fileKind?: XDriveFileExplorerFileKind
}

const imageExtensions = new Set(['arw', 'avif', 'bmp', 'cr3', 'dng', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'livp', 'nef', 'png', 'tif', 'tiff', 'webp'])
const videoExtensions = new Set(['3g2', '3gp', 'avi', 'm2ts', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'mts', 'webm'])
const audioExtensions = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav', 'wma'])
const documentExtensions = new Set(['doc', 'docx', 'odt', 'rtf'])
const spreadsheetExtensions = new Set(['csv', 'ods', 'xls', 'xlsx'])
const presentationExtensions = new Set(['odp', 'ppt', 'pptx'])
const archiveExtensions = new Set(['7z', 'bz2', 'gz', 'rar', 'tar', 'tgz', 'xz', 'zip'])
const codeExtensions = new Set([
  'c', 'cc', 'cpp', 'css', 'go', 'h', 'hpp', 'html', 'java', 'js', 'json', 'jsx',
  'kt', 'md', 'php', 'py', 'rb', 'rs', 'sh', 'sql', 'swift', 'toml', 'ts', 'tsx',
  'xml', 'yaml', 'yml',
])
const textExtensions = new Set(['ini', 'log', 'text', 'txt'])

function explorerExtension(name: string) {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

export function xDriveFileKind(name: string, kind: 'dir' | 'file'): XDriveFileExplorerFileKind {
  if (kind === 'dir') return 'folder'
  const extension = explorerExtension(name)
  if (imageExtensions.has(extension)) return 'image'
  if (videoExtensions.has(extension)) return 'video'
  if (audioExtensions.has(extension)) return 'audio'
  if (extension === 'pdf') return 'pdf'
  if (documentExtensions.has(extension)) return 'document'
  if (spreadsheetExtensions.has(extension)) return 'spreadsheet'
  if (presentationExtensions.has(extension)) return 'presentation'
  if (archiveExtensions.has(extension)) return 'archive'
  if (codeExtensions.has(extension)) return 'code'
  if (textExtensions.has(extension)) return 'text'
  return 'file'
}

export function xDriveFileTypeLabel(name: string, kind: 'dir' | 'file') {
  if (kind === 'dir') return '文件夹'
  const extension = explorerExtension(name)
  if (extension === 'livp') return 'LIVP 实况照片'
  const fileKind = xDriveFileKind(name, kind)
  switch (fileKind) {
    case 'image': return extension ? `${extension.toUpperCase()} 图像` : '图像'
    case 'video': return extension ? `${extension.toUpperCase()} 视频` : '视频'
    case 'audio': return extension ? `${extension.toUpperCase()} 音频` : '音频'
    case 'pdf': return 'PDF 文档'
    case 'document': return extension ? `${extension.toUpperCase()} 文档` : '文档'
    case 'spreadsheet': return extension ? `${extension.toUpperCase()} 工作表` : '工作表'
    case 'presentation': return extension ? `${extension.toUpperCase()} 演示文稿` : '演示文稿'
    case 'archive': return extension ? `${extension.toUpperCase()} 压缩文件` : '压缩文件'
    case 'code': return extension ? `${extension.toUpperCase()} 文件` : '代码文件'
    case 'text': return '文本文档'
    default: return extension ? `${extension.toUpperCase()} 文件` : '文件'
  }
}

export function xDriveFileSupportsThumbnail(name: string, kind: 'dir' | 'file') {
  const fileKind = xDriveFileKind(name, kind)
  return fileKind === 'image' || fileKind === 'video'
}

const xDriveWindowsFolderYellow = '#ffcb3d'

export function XDriveFileExplorerItemIcon({
  item,
  size = 21,
  folderSize = size,
}: {
  item: XDriveFileExplorerIconItem
  size?: number
  folderSize?: number
}) {
  const fileKind = item.fileKind ?? xDriveFileKind(item.name, item.kind)
  if (fileKind === 'folder') return <FolderRoundedIcon sx={{ fontSize: folderSize, color: xDriveWindowsFolderYellow }} />
  if (fileKind === 'image') return <ImageRoundedIcon sx={{ fontSize: size, color: 'text.secondary' }} />
  if (fileKind === 'video') return <MovieRoundedIcon sx={{ fontSize: size, color: 'text.secondary' }} />
  if (fileKind === 'audio') return <AudioFileRoundedIcon sx={{ fontSize: size, color: 'text.secondary' }} />
  if (fileKind === 'pdf') return <PictureAsPdfRoundedIcon sx={{ fontSize: size, color: 'text.secondary' }} />
  if (fileKind === 'spreadsheet') return <TableChartRoundedIcon sx={{ fontSize: size, color: 'text.secondary' }} />
  if (fileKind === 'presentation') return <ViewCarouselRoundedIcon sx={{ fontSize: size, color: 'text.secondary' }} />
  if (fileKind === 'archive') return <FolderZipRoundedIcon sx={{ fontSize: size, color: 'text.secondary' }} />
  if (fileKind === 'document' || fileKind === 'text') return <DescriptionRoundedIcon sx={{ fontSize: size, color: 'text.secondary' }} />
  if (fileKind === 'code') return <CodeRoundedIcon sx={{ fontSize: size, color: 'text.secondary' }} />
  return <InsertDriveFileRoundedIcon sx={{ fontSize: size, color: 'text.secondary' }} />
}


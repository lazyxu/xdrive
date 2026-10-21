import { forwardRef } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'
import { Box, ButtonBase, Stack, Typography } from '@mui/material'
import type { BoxProps } from '@mui/material'
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

// Keep the Owner and public read-only Explorer's details geometry in one
// presentation-only module; no authenticated FileExplorer state is imported.
export const xDriveFileExplorerDetailsNormalRowHeight = 36
export const xDriveFileExplorerDetailsHeaderHeight = 32
export const xDriveFileExplorerDetailsMobileRowHeight = 52

// Read-only presentation is shared by the authenticated Owner Explorer and
// the capability-scoped public Explorer. Never import Owner actions or API.
export function XDriveFileExplorerItemName({ name, grid }: { name: string; grid: boolean }) {
  return grid ? (
    <Typography variant="body2" dir="auto" title={name}
      sx={{ unicodeBidi: 'plaintext', width: '100%', overflowWrap: 'anywhere',
        display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
        overflow: 'hidden', lineHeight: 1.25 }}>
      {name}
    </Typography>
  ) : (
    <Typography variant="body2" noWrap dir="auto" title={name}
      sx={{ unicodeBidi: 'plaintext' }}>{name}</Typography>
  )
}

export function XDriveFileExplorerDetailsNameCell({
  visual, label, prefix, suffix, compact = false,
}: {
  visual: ReactNode
  label: ReactNode
  prefix?: ReactNode
  suffix?: ReactNode
  compact?: boolean
}) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" minWidth={0}>
      {prefix}
      <Box sx={{ width: 24, height: 24, flex: '0 0 24px', overflow: 'hidden', borderRadius: 0 }}>
        {visual}
      </Box>
      <Box sx={{ minWidth: 0, flex: compact ? 1 : undefined }}>{label}</Box>
      {suffix}
    </Stack>
  )
}

// Neutral, layout-only Details cells shared by Owner and Share.
// Mutations, session state and data loading are deliberately outside this leaf.
export function XDriveFileExplorerDetailsRowCell({
  columnKey, rightAligned = false, children,
}: {
  columnKey: string
  rightAligned?: boolean
  children: ReactNode
}) {
  return (
    <Box role="cell" sx={{
      minWidth: 0,
      overflow: 'hidden',
      position: columnKey === 'name' ? 'relative' : undefined,
      textAlign: rightAligned ? 'right' : 'left',
    }}>
      {children}
    </Box>
  )
}

export function xDriveFileExplorerDetailsHeaderGeometry(gridTemplateColumns: string, headerHeight = xDriveFileExplorerDetailsHeaderHeight) {
  return {
    position: 'sticky' as const,
    top: 0,
    zIndex: 1,
    display: 'grid' as const,
    gridTemplateColumns,
    minHeight: headerHeight,
    alignItems: 'center' as const,
    px: 1.5,
    bgcolor: 'background.default',
    borderBottom: 1,
    borderColor: 'divider',
    color: 'text.secondary',
    fontSize: 12,
    fontWeight: 500,
  }
}

/**
 * The same *unprivileged* item surface for authenticated FileExplorer and
 * capability-scoped public shares. Only DOM/presentation attributes can enter
 * here; no API client, token, clipboard, drag/drop implementation or actions.
 *
 * Keep ButtonBase for the account explorer's original keyboard/touch behavior
 * and Box for the public read-only explorer's original keyboard behavior.
 * Callers own selection, events, authorized data and every allowed action.
 */
export type XDriveFileExplorerItemSurfaceProps =
  Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
    children: ReactNode
    ownerInteraction?: boolean
    surfaceMode: 'details' | 'grid'
    selected?: boolean
    dropTarget?: boolean
    columns?: string
    detailsRowHeight?: number
    gridMinItemHeight?: number
    gridMaxItemWidth?: number
    gridItemPadding?: number
    gridItemGap?: number
    gridEstimatedRowHeight?: number
    sx?: BoxProps['sx']
  }

export const XDriveFileExplorerItemSurface = forwardRef<HTMLDivElement, XDriveFileExplorerItemSurfaceProps>(
  function XDriveFileExplorerItemSurface({
    children, ownerInteraction = false, surfaceMode, selected = false, dropTarget = false,
    columns, detailsRowHeight = xDriveFileExplorerDetailsNormalRowHeight,
    gridMinItemHeight = 124, gridMaxItemWidth = 180,
    gridItemPadding = 1, gridItemGap = 0.75, gridEstimatedRowHeight = 140,
    sx, ...elementProps
  }, ref) {
    const grid = surfaceMode === 'grid'
    const visualSx = {
      width: '100%',
      minWidth: 0,
      display: grid ? 'flex' : 'grid',
      gridTemplateColumns: grid ? undefined : columns,
      flexDirection: grid ? 'column' : undefined,
      minHeight: grid ? gridMinItemHeight : detailsRowHeight,
      maxWidth: grid ? gridMaxItemWidth : undefined,
      justifySelf: grid ? 'center' : undefined,
      boxSizing: 'border-box',
      position: grid ? 'relative' : undefined,
      alignItems: 'center',
      justifyContent: grid ? 'flex-start' : 'start',
      px: grid ? undefined : 1.5,
      py: grid ? undefined : 0,
      p: grid ? gridItemPadding : undefined,
      gap: grid ? gridItemGap : 0,
      borderRadius: grid ? 1 : '4px',
      textAlign: grid ? 'center' : 'left',
      bgcolor: dropTarget ? 'action.hover' : selected ? 'action.selected' : 'transparent',
      outline: dropTarget ? '2px solid' : undefined,
      outlineColor: 'primary.main',
      outlineOffset: -2,
      contentVisibility: grid ? 'auto' : undefined,
      containIntrinsicSize: grid
        ? String(gridMaxItemWidth) + 'px ' + String(gridEstimatedRowHeight) + 'px'
        : undefined,
      cursor: ownerInteraction ? undefined : 'default',
      '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
      '&:focus-visible': {
        outline: '2px solid',
        outlineColor: 'primary.main',
        outlineOffset: -2,
      },
    }
    const combinedSx = [visualSx, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])] as BoxProps['sx']
    return ownerInteraction
      ? <ButtonBase ref={ref} component="div" {...elementProps} sx={combinedSx}>{children}</ButtonBase>
      : <Box ref={ref} {...elementProps} sx={combinedSx}>{children}</Box>
  },
)

// Owner and public Share use one neutral Grid visual/title layout.
// No authenticated API, mutation or capability is imported into this component.
export function XDriveFileExplorerGridTileContent({
  thumbnailWidth, thumbnailHeight, visual, overlay, label,
}: {
  thumbnailWidth: number
  thumbnailHeight: number
  visual: ReactNode
  overlay?: ReactNode
  label: ReactNode
}) {
  return (
    <>
      <Box sx={{
        width: thumbnailWidth, height: thumbnailHeight,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', borderRadius: 0, position: 'relative', flex: '0 0 auto',
      }}>
        {visual}
        {overlay}
      </Box>
      <Box data-xdrive-file-explorer-grid-name sx={{
        width: '100%', minHeight: 32, display: 'flex',
        alignItems: 'flex-start', justifyContent: 'center',
      }}>
        {label}
      </Box>
    </>
  )
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


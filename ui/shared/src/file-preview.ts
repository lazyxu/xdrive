export type XDriveFileTextPreview = {
  text: string
  truncated: boolean
  size: number
}

export type XDriveByteProgressHandler = (
  loadedBytes: number,
  totalBytes?: number,
) => void

export type XDriveLivePhotoMotionSource =
  | string
  | {
      url: string
      dispose?: () => void
    }

export type XDriveFilePreviewKind = 'none' | 'text' | 'image' | 'video' | 'audio' | 'pdf' | 'live_photo'

export type XDriveFilePreviewMediaTransform = {
  rotationDegrees?: 0 | 90 | 180 | 270 | number
  flipHorizontal?: boolean
  flipVertical?: boolean
  cropX?: number
  cropY?: number
  cropWidth?: number
  cropHeight?: number
  exposureEV?: number
  contrast?: number
  saturation?: number
  trimStartMS?: number
  trimEndMS?: number
}

export function xDriveFilePreviewHasTransform(
  value?: XDriveFilePreviewMediaTransform | null,
) {
  if (!value) return false
  return Boolean(
    value.rotationDegrees ||
    value.flipHorizontal ||
    value.flipVertical ||
    Math.abs(value.cropX || 0) > 0.000001 ||
    Math.abs(value.cropY || 0) > 0.000001 ||
    Math.abs((value.cropWidth ?? 1) - 1) > 0.000001 ||
    Math.abs((value.cropHeight ?? 1) - 1) > 0.000001 ||
    Math.abs(value.exposureEV || 0) > 0.000001 ||
    Math.abs(value.contrast || 0) > 0.000001 ||
    Math.abs(value.saturation || 0) > 0.000001 ||
    (value.trimStartMS || 0) > 0 ||
    (value.trimEndMS || 0) > 0
  )
}

export type XDriveFilePreviewTarget = {
  id: string | number
  name: string
  kind: 'dir' | 'file'
  mimeType?: string
  size?: number
  revision?: string | number
}

const xDriveTextPreviewExtensions = new Set([
  'bash', 'bat', 'c', 'cc', 'cfg', 'cmd', 'conf', 'cpp', 'cs', 'css', 'csv', 'fish',
  'go', 'gql', 'gradle', 'graphql', 'h', 'hpp', 'ini', 'java', 'js', 'json', 'jsonl',
  'jsx', 'kt', 'kts', 'less', 'log', 'md', 'markdown', 'properties', 'proto', 'ps1',
  'py', 'rb', 'rs', 'scss', 'sh', 'sql', 'text', 'toml', 'ts', 'tsv', 'tsx', 'txt',
  'xml', 'yaml', 'yml', 'zsh',
])

const xDriveTextPreviewBasenames = new Set([
  'copying', 'dockerfile', 'license', 'makefile', 'readme',
  '.editorconfig', '.gitattributes', '.gitignore',
])

const xDriveImagePreviewExtensions = new Set([
  'avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'tif', 'tiff', 'webp',
])

const xDriveVideoPreviewExtensions = new Set([
  'avi', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'webm',
])

const xDriveAudioPreviewExtensions = new Set([
  'aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav', 'wma',
])

function xDrivePreviewExtension(name: string) {
  const base = name.trim().toLowerCase()
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1)
}

export function xDriveFileSupportsTextPreview(name: string, kind: 'dir' | 'file') {
  if (kind !== 'file') return false
  const base = name.trim().toLowerCase()
  if (xDriveTextPreviewBasenames.has(base)) return true
  return xDriveTextPreviewExtensions.has(xDrivePreviewExtension(base))
}

export function xDriveClassifyFilePreview(
  target: Pick<XDriveFilePreviewTarget, 'name' | 'kind' | 'mimeType'>,
): XDriveFilePreviewKind {
  if (target.kind !== 'file') return 'none'
  if (xDriveFileSupportsTextPreview(target.name, target.kind)) return 'text'

  const extension = xDrivePreviewExtension(target.name)
  if (extension === 'livp') return 'live_photo'

  // Binary previewability must stay aligned with the Server's strict extension
  // allowlist. MIME metadata may describe a file, but must never broaden the
  // set of originals that can receive a signed preview ticket.
  if (extension === 'pdf') return 'pdf'
  if (xDriveImagePreviewExtensions.has(extension)) return 'image'
  if (xDriveVideoPreviewExtensions.has(extension)) return 'video'
  if (xDriveAudioPreviewExtensions.has(extension)) return 'audio'
  return 'none'
}

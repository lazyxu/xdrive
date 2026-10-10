export type XDriveFileTextPreview = {
  text: string
  truncated: boolean
  size: number
}

export type XDriveByteProgressHandler = (
  loadedBytes: number,
  totalBytes?: number,
  // '' is authoritative opaque; data:image/png mask is authoritative alpha;
  // null is unknown and must never paint a rectangular overlay.
  alphaMask?: string | null,
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

/** Whether the current target has usable content on screen, independently of its URL ticket. */
export type XDriveFilePreviewPresentationState = 'loading' | 'ready' | 'failed'

const xDriveTextPreviewExtensions = new Set([
  'asm', 'astro', 'bash', 'bat', 'c', 'cc', 'cfg', 'cjs', 'cljs', 'clj', 'cmd', 'conf',
  'cpp', 'cs', 'css', 'csv', 'cxx', 'dart', 'erl', 'ex', 'exs', 'fish', 'fs', 'fsx',
  'go', 'gql', 'gradle', 'graphql', 'groovy', 'h', 'hpp', 'hrl', 'hs', 'hxx', 'ini',
  'htm', 'html', 'java', 'js', 'json', 'jsonl', 'jsx', 'kt', 'kts', 'less', 'lock',
  'log', 'lua', 'm', 'md', 'markdown', 'mjs', 'mk', 'mm', 'nix', 'patch', 'php',
  'pl', 'pm', 'properties', 'proto', 'ps1', 'py', 'r', 'rb', 'rs', 's', 'scala',
  'scss', 'sh', 'sol', 'sql', 'svelte', 'svg', 'swift', 'tex', 'text', 'tf',
  'tfvars', 'toml', 'ts', 'tsv', 'tsx', 'txt', 'vb', 'vbs', 'vue', 'xml', 'yaml',
  'yml', 'zig', 'zsh',
])

const xDriveTextPreviewBasenames = new Set([
  'cmakelists.txt', 'copying', 'dockerfile', 'gemfile', 'jenkinsfile', 'license',
  'makefile', 'procfile', 'rakefile', 'readme',
  '.babelrc', '.browserslistrc', '.dockerignore', '.editorconfig', '.env',
  '.eslintignore', '.eslintrc', '.gitattributes', '.gitignore', '.gitmodules',
  '.npmignore', '.npmrc', '.prettierignore', '.prettierrc', '.stylelintrc', '.yarnrc',
])

const xDriveImagePreviewExtensions = new Set([
  'arw', 'avif', 'bmp', 'cr3', 'dng', 'gif', 'heic', 'heif', 'jpeg', 'jpg',
  'nef', 'png', 'tif', 'tiff', 'webp',
])

const xDriveEmbeddedRawPreviewExtensions = new Set(['arw', 'cr3', 'dng', 'nef'])

export function xDriveFileUsesRawCompatibilityPreview(name: string): boolean {
  return xDriveEmbeddedRawPreviewExtensions.has(xDrivePreviewExtension(name))
}

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
  if (
    xDriveTextPreviewBasenames.has(base) ||
    base.startsWith('.env.') ||
    base.startsWith('.eslintrc.') ||
    base.startsWith('.prettierrc.') ||
    base.startsWith('.stylelintrc.')
  ) return true
  return xDriveTextPreviewExtensions.has(xDrivePreviewExtension(base))
}

export function xDriveClassifyFilePreview(
  target: Pick<XDriveFilePreviewTarget, 'name' | 'kind' | 'mimeType'>,
): XDriveFilePreviewKind {
  if (target.kind !== 'file') return 'none'
  if (xDriveFileSupportsTextPreview(target.name, target.kind)) return 'text'

  const extension = xDrivePreviewExtension(target.name)
  if (extension === 'livp') return 'live_photo'

  // MIME metadata never broadens eligibility. RAW extensions use the existing
  // authenticated 1280px derived-JPEG endpoint, NOT an original-file ticket.
  // Other binary image extensions use the Server's strict original allowlist.
  if (extension === 'pdf') return 'pdf'
  if (xDriveImagePreviewExtensions.has(extension)) return 'image'
  if (xDriveVideoPreviewExtensions.has(extension)) return 'video'
  if (xDriveAudioPreviewExtensions.has(extension)) return 'audio'
  return 'none'
}

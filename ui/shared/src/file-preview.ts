export type XDriveFileTextPreview = {
  text: string
  truncated: boolean
  size: number
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

export function xDriveFileSupportsTextPreview(name: string, kind: 'dir' | 'file') {
  if (kind !== 'file') return false
  const base = name.trim().toLowerCase()
  if (xDriveTextPreviewBasenames.has(base)) return true
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return false
  return xDriveTextPreviewExtensions.has(base.slice(dot + 1))
}

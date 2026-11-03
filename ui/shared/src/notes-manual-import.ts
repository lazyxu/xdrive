/** One explicit Apple Notes Markdown export per action.
 * Neither a matching title nor a similar body proves an Apple Notes identity.
 * Paths are from user-selected files only; no remote fetch or filesystem reads.
 */
export type XDriveNotesManualFile = {
  name: string
  size: number
  type?: string
  webkitRelativePath?: string
}

export type XDriveNotesManualReference<T extends XDriveNotesManualFile> = {
  source: string
  asset: T
}

export type XDriveNotesManualPlan<T extends XDriveNotesManualFile> = {
  title: string
  file: T
  references: XDriveNotesManualReference<T>[]
  rewrite: (paths: ReadonlyMap<string, string>) => string
}

const markdownExtension = /\.(?:md|markdown)$/i
const supportedImageExtension = /\.(?:png|jpe?g|gif|webp|heic)$/i
const notesMaxMarkdownBytes = 1_048_576
const notesMaxImages = 100
const notesMaxImageBytes = 20 * 1_048_576
const notesMaxTotalImages = 200 * 1_048_576
const pathControl = /[\u0000-\u001f\u007f\\]/
const assetURL = /^_assets\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:png|jpg|gif|webp|heic)$/i

function fail(reason: string): never {
  throw new Error(reason)
}

function uploadRelativeName(file: XDriveNotesManualFile, root: string): string {
  const rel = file.webkitRelativePath || file.name
  if (!rel || rel.startsWith('/') || pathControl.test(rel)) {
    return fail('导入文件的本地路径无效。')
  }
  const parts = rel.split('/')
  if (parts.some(p => !p || p === '.' || p === '..')) {
    return fail('导入文件包含非法目录。')
  }
  if (root && parts[0] === root) return parts.slice(1).join('/')
  return file.name // Explicitly selected individual files have no folder information.
}

function normalizeMarkdownAsset(source: string, mdDirectory: string): string {
  let text = source.trim()
  if (text.startsWith('<') && text.endsWith('>')) text = text.slice(1, -1)
  if (!text || text.includes('?') || text.includes('#') || pathControl.test(text) ||
      text.startsWith('/') || text.startsWith('//') ||
      /^[a-z][\w+.-]*:/i.test(text)) {
    return fail('Markdown 图片路径不是可导入的本地相对路径：' + source)
  }
  let decoded: string
  try { decoded = decodeURIComponent(text) } catch {
    return fail('Markdown 图片路径包含无效的 URL 编码。')
  }
  if (pathControl.test(decoded) || decoded.startsWith('/') || decoded.includes('?') ||
      decoded.includes('#')) {
    return fail('Markdown 图片路径含有不安全的字符：' + source)
  }
  const stack = mdDirectory ? mdDirectory.split('/') : []
  for (const segment of decoded.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!stack.length) return fail('Markdown 图片路径越出了导入文件夹：' + source)
      stack.pop()
    } else {
      if (segment.includes(':') || segment === '.' || pathControl.test(segment)) {
        return fail('Markdown 图片路径含有非法目录：' + source)
      }
      stack.push(segment)
    }
  }
  if (!stack.length) return fail('Markdown 图片路径无效：' + source)
  return stack.join('/')
}

function markdownImageURLs(markdown: string): string[] {
  const urls: string[] = []
  let fenced: string | null = null
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fence) {
      const marker = fence[1][0]
      if (!fenced) fenced = marker
      else if (fenced === marker) fenced = null
      continue
    }
    if (fenced) continue
    const pattern = /!\[[^\]\r\n]{0,180}\]\((<[^>\r\n]{1,500}>|[^)\r\n]{1,500})\)/g
    for (const m of line.matchAll(pattern)) {
      urls.push(m[1])
    }
  }
  return [...new Set(urls)]
}

export function xDriveNotesSelectManualExport<T extends XDriveNotesManualFile>(
  files: readonly T[],
): { markdownFile: T; assets: T[] } {
  if (!files.length || files.length > 200) fail('请选择一条 Markdown 及其图片（最多 200 个文件）。')
  const notes = files.filter(file => markdownExtension.test(file.name))
  if (notes.length !== 1) fail('每次只能导入一条 .md/.markdown 备忘录；请单独选择。')
  const markdownFile = notes[0]
  if (markdownFile.size <= 0 || markdownFile.size > notesMaxMarkdownBytes) {
    fail('Markdown 文件必须为 1 MiB 以内的非空 UTF-8 文本。')
  }
  const assets = files.filter(file => file !== markdownFile && supportedImageExtension.test(file.name))
  if (assets.length > notesMaxImages) fail('单条备忘录最多可导入 100 张图片。')
  if (assets.some(file => file.size <= 0 || file.size > notesMaxImageBytes)) {
    fail('每张图片必须不大于 20 MiB 且非空。')
  }
  if (assets.reduce((sum, file) => sum + file.size, 0) > notesMaxTotalImages) {
    fail('本次图片总量超过 200 MiB，请分批整理后再导入。')
  }
  return { markdownFile, assets }
}

export function xDriveNotesPlanManualExport<T extends XDriveNotesManualFile>(
  markdown: string, markdownFile: T, assets: readonly T[],
): XDriveNotesManualPlan<T> {
  const title = markdownFile.name.replace(markdownExtension, '').trim()
  if (!title || pathControl.test(title) || new TextEncoder().encode(title).length > 255) {
    fail('Markdown 文件名不是有效的备忘录标题。')
  }
  const markdownBytes = new TextEncoder().encode(markdown)
  if (!markdownBytes.length || markdownBytes.length > notesMaxMarkdownBytes) {
    fail('Markdown 内容必须为 1 MiB 以内的非空 UTF-8 文本。')
  }
  const browserPath = markdownFile.webkitRelativePath || ''
  const root = browserPath.includes('/') ? browserPath.split('/')[0] : ''
  const mdPath = uploadRelativeName(markdownFile, root)
  const mdDirectory = mdPath.includes('/') ? mdPath.slice(0, mdPath.lastIndexOf('/')) : ''
  const indexed = new Map<string, T>()
  const basename = new Map<string, T[]>()
  for (const asset of assets) {
    const path = uploadRelativeName(asset, root)
    if (indexed.has(path)) fail('导入文件夹中存在重名图片路径：' + path)
    indexed.set(path, asset)
    const list = basename.get(asset.name) ?? []
    list.push(asset)
    basename.set(asset.name, list)
  }

  const references = markdownImageURLs(markdown).map(source => {
    const local = normalizeMarkdownAsset(source, mdDirectory)
    let asset = indexed.get(local)
    if (!asset) {
      const matches = basename.get(local.slice(local.lastIndexOf('/') + 1)) ?? []
      if (matches.length !== 1) {
        fail(matches.length
          ? '存在同名图片，无法确定 Markdown 引用对应的文件：' + source
          : '缺少 Markdown 引用的本地图片：' + source)
      }
      asset = matches[0]
    }
    return { source, asset }
  })

  // Reject text that would overflow after the Server assigns longer immutable
  // _assets/<note-uuid>/<asset-uuid> paths, before creating any cloud note.
  const estimated = new Map(references.map(x => [x.source,
    '_assets/00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000000.heic']))
  const rewrite = (paths: ReadonlyMap<string, string>) => {
    let fenced: string | null = null
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
    const output = lines.map(line => {
      const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/)
      if (fence) {
        const marker = fence[1][0]
        if (!fenced) fenced = marker
        else if (fenced === marker) fenced = null
        return line
      }
      if (fenced) return line
      return line.replace(/!\[([^\]\r\n]{0,180})\]\((<[^>\r\n]{1,500}>|[^)\r\n]{1,500})\)/g,
        (full, alt: string, source: string) => {
          const target = paths.get(source)
          if (!target) return fail('仍有图片未上传成功：' + source)
          if (!assetURL.test(target)) return fail('服务器返回的笔记图片相对路径无效。')
          return '![' + alt + '](' + target + ')'
        })
    }).join('\n')
    if (new TextEncoder().encode(output).length > notesMaxMarkdownBytes) {
      fail('导入后的 Markdown 超过 1 MiB；请缩短正文或图片引用。')
    }
    return output
  }
  rewrite(estimated)
  return { file: markdownFile, title, references, rewrite }
}

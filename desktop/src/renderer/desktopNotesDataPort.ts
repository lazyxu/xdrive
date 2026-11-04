import type {
  XDriveNoteDetail, XDriveNoteSource, XDriveNoteSummary,
  XDriveNotesDataPort, XDriveNoteVersion,
} from '../../../ui/shared/src/mui/NotesPage'

/** Only eight explicit Notes operations cross Electron IPC. No Server token,
 * origin selection, arbitrary URL or general-purpose HTTP proxy is exposed. */
export type DesktopNotesAgentPort = Pick<
  Window['xdriveDesktop']['agent'],
  'cloudNotesInitialize' | 'cloudNotesList' | 'cloudNotesRead' |
  'cloudNotesCreate' | 'cloudNotesUpdate' | 'cloudNotesDelete' |
  'cloudNotesVersions' | 'cloudNotesReadVersion' | 'cloudDownload' |
  'cloudNotesUploadImage' | 'cloudNotesReadImage'
>

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const sha256 = /^[0-9a-f]{64}$/i
const maxMarkdownBytes = 1_048_576
const noteAsset = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(?:png|jpg|gif|webp|heic)$/
function checkedAssetPath(noteID: string, path: string): { filename: string; mime: string } {
  const prefix = '_assets/' + noteID + '/'
  if (typeof path !== 'string' || !path.startsWith(prefix) || path.length > 160) {
    throw new Error('非法备忘录图片路径。')
  }
  const filename = path.slice(prefix.length)
  if (!noteAsset.test(filename)) throw new Error('图片不是该备忘录的不可变资源。')
  const extension = filename.slice(filename.lastIndexOf('.') + 1)
  const mime: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', heic: 'image/heic',
  }
  return { filename, mime: mime[extension] }
}

const encoder = new TextEncoder()

function checkedID(id: string) {
  if (!uuid.test(id)) throw new Error('备忘录标识不合法。')
  return id
}

function checkedRevision(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('备忘录版本不合法。')
  }
  return value
}

function checkedMarkdown(value: string) {
  if (typeof value !== 'string' || encoder.encode(value).byteLength > maxMarkdownBytes ||
      value.includes('\u0000')) {
    throw new Error('Markdown 必须是最多 1 MiB 的 UTF-8 正文。')
  }
  return value
}

function checkedTitle(title: string) {
  if (typeof title !== 'string' || !title.trim() ||
      encoder.encode(title).byteLength > 255 ||
      /[\u0000-\u001f\u007f]/.test(title)) {
    throw new Error('备忘录标题为空或含有非法字符。')
  }
  return title
}

function checkedRow(row: AgentNotesRow): XDriveNoteSummary {
  if (!row || !uuid.test(row.id) ||
      (row.source !== 'mine' && row.source !== 'ios_notes') ||
      !Number.isSafeInteger(row.node_id) || row.node_id < 1 ||
      !Number.isSafeInteger(row.revision) || row.revision < 1 ||
      !Number.isSafeInteger(row.bytes) || row.bytes < 0 ||
      row.bytes > maxMarkdownBytes ||
      !sha256.test(row.sha256) ||
      typeof row.created_at !== 'string' || typeof row.updated_at !== 'string') {
    throw new Error('Agent Notes 返回了无效的 Owner 文件收据。')
  }
  checkedTitle(row.title)
  return row
}

function unwrap<T>(response: DesktopResult<T>): T {
  if (!response.ok) {
    const error = new Error(response.error.message || '备忘录 Agent 请求失败。') as
      Error & { status?: number; code?: string }
    error.status = response.error.status
    error.code = response.error.code
    throw error
  }
  return response.data
}

export function createDesktopNotesDataPort(
  agent: DesktopNotesAgentPort,
  ownerScopeKey: string,
  ownerCurrent: () => boolean,
  imagesEnabled = false,
): XDriveNotesDataPort {
  if (!ownerScopeKey.trim() || !ownerCurrent()) {
    throw new Error('当前 Desktop Owner 未经验证。')
  }
  const checkOwner = (signal?: AbortSignal) => {
    signal?.throwIfAborted()
    if (!ownerCurrent()) throw new Error('Desktop Owner 已切换，请重新打开备忘录。')
  }
  let bootstrap: Promise<void> | null = null
  function ready() {
    checkOwner()
    if (!bootstrap) {
      bootstrap = agent.cloudNotesInitialize().then(reply => {
        checkOwner()
        const nodes = unwrap(reply)
        for (const id of [nodes.system_node_id, nodes.notes_node_id,
          nodes.ios_backup_node_id, nodes.my_notes_node_id]) {
          if (!Number.isSafeInteger(id) || id <= 0) {
            throw new Error('Agent 未能验证当前 Owner 的备忘录目录。')
          }
        }
      }).catch(error => {
        bootstrap = null
        throw error
      })
    }
    return bootstrap
  }
  async function read<T>(
    perform: () => Promise<DesktopResult<T>>,
    signal?: AbortSignal,
  ): Promise<T> {
    checkOwner(signal)
    const result = await perform()
    checkOwner(signal)
    return unwrap(result)
  }
  async function write<T>(
    perform: () => Promise<DesktopResult<T>>,
  ): Promise<T> {
    checkOwner()
    // A mutation is sent at most once. A lost ACK is unknown, never a reason
    // for automatic replay, especially when Apple backups lack a stable ID.
    const result = await perform()
    checkOwner()
    return unwrap(result)
  }

  return {
    ownerScopeKey,
    async listNotes(source: XDriveNoteSource, query: string, offset: number, signal?: AbortSignal) {
      if (source !== 'mine' && source !== 'ios_notes' ||
          encoder.encode(query).byteLength > 200 ||
          !Number.isSafeInteger(offset) || offset < 0 ||
          offset > 10_000_000 || offset % 50 !== 0) {
        throw new Error('备忘录来源、查询或分页参数不合法。')
      }
      await ready()
      checkOwner(signal)
      const page = await read(() => agent.cloudNotesList(source, query, offset), signal)
      if (!Array.isArray(page.items) || page.items.length > 50 ||
          !Number.isSafeInteger(page.next_offset) || page.next_offset < 0 ||
          (page.next_offset !== 0 && page.next_offset !== offset + 50)) {
        throw new Error('Agent 返回了无效的备忘录分页。')
      }
      const items = page.items.map(checkedRow)
      if (items.some(item => item.source !== source) ||
          new Set(items.map(item => item.id)).size !== items.length) {
        throw new Error('备忘录分页包含错误来源或重复条目。')
      }
      return { items, next_offset: page.next_offset }
    },
    async readNote(id: string, signal?: AbortSignal): Promise<XDriveNoteDetail> {
      await ready()
      const note = await read(() => agent.cloudNotesRead(checkedID(id)), signal)
      const row = checkedRow(note)
      if (row.id.toLowerCase() !== id.toLowerCase() ||
          encoder.encode(checkedMarkdown(note.markdown)).byteLength !== row.bytes) {
        throw new Error('Agent 返回了不匹配的 Markdown 原件。')
      }
      return { ...row, markdown: note.markdown }
    },
    async createNote(value) {
      checkedTitle(value.title)
      checkedMarkdown(value.markdown)
      await ready()
      const row = checkedRow(await write(() => agent.cloudNotesCreate(value)))
      if (row.source !== 'mine' || row.title !== value.title ||
          row.bytes !== encoder.encode(value.markdown).byteLength) {
        throw new Error('新建笔记收据与提交内容不一致，请核对云端。')
      }
      return row
    },
    async saveNote(id, value) {
      checkedID(id)
      checkedTitle(value.title)
      checkedMarkdown(value.markdown)
      checkedRevision(value.expected_revision)
      await ready()
      const row = checkedRow(await write(() => agent.cloudNotesUpdate(id, value)))
      if (row.id.toLowerCase() !== id.toLowerCase() || row.source !== 'mine' ||
          row.title !== value.title ||
          row.bytes !== encoder.encode(value.markdown).byteLength ||
          row.revision < value.expected_revision) {
        throw new Error('笔记保存收据不匹配，请确认远端版本。')
      }
      return row
    },
    async deleteNote(id, revision) {
      checkedID(id)
      checkedRevision(revision)
      await ready()
      await write(() => agent.cloudNotesDelete(id, revision))
    },
    async listVersions(id, signal): Promise<XDriveNoteVersion[]> {
      await ready()
      const page = await read(() => agent.cloudNotesVersions(checkedID(id)), signal)
      if (!Number.isSafeInteger(page.node_id) || page.node_id <= 0 ||
          !Array.isArray(page.items) || page.items.length > 100) {
        throw new Error('无效的备忘录历史索引。')
      }
      const ids = new Set<number>()
      return page.items.map(entry => {
        if (!Number.isSafeInteger(entry.id) || entry.id <= 0 ||
            !Number.isSafeInteger(entry.revision) || entry.revision <= 0 ||
            !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 ||
            entry.bytes > maxMarkdownBytes || !sha256.test(entry.sha256) ||
            ids.has(entry.id)) throw new Error('无效的备忘录历史版本收据。')
        ids.add(entry.id)
        return entry
      })
    },
    async readVersion(nodeID, versionID, signal) {
      checkedRevision(nodeID)
      checkedRevision(versionID)
      await ready()
      const value = await read(
        () => agent.cloudNotesReadVersion(nodeID, versionID), signal)
      return checkedMarkdown(value.markdown)
    },
    // An old Agent still serves text Notes. The shared page must NEVER
    // display upload/image actions until the same Owner's Agent explicitly
    // advertises cloud-notes-images.
    ...(imagesEnabled ? {
      async uploadImage(noteID: string, file: File): Promise<{ relative_path: string }> {
        const id = checkedID(noteID)
        if (id !== id.toLowerCase() || !file || file.size <= 0 ||
            file.size > 20 * 1_048_576 ||
            !/\.(?:png|jpe?g|gif|webp|heic)$/i.test(file.name)) {
          throw new Error('图片无效或超过 20 MiB。')
        }
        await ready()
        checkOwner()
        const data = await file.arrayBuffer()
        checkOwner()
        if (data.byteLength !== file.size || data.byteLength <= 0) {
          throw new Error('备忘录图片在读取期间发生变化。')
        }
        const receipt = await write(() => agent.cloudNotesUploadImage(id, data))
        const match = checkedAssetPath(id, receipt.relative_path)
        if (!Number.isSafeInteger(receipt.node_id) || receipt.node_id <= 0 ||
            receipt.filename !== match.filename || receipt.bytes !== data.byteLength ||
            receipt.content_type !== match.mime || !sha256.test(receipt.sha256)) {
          throw new Error('图片上传结果不确定，请核对备忘录后再重试。')
        }
        return { relative_path: receipt.relative_path }
      },
      async readImageBlob(noteID: string, path: string, signal?: AbortSignal): Promise<Blob> {
        const id = checkedID(noteID)
        if (id !== id.toLowerCase()) throw new Error('备忘录图片来源无效。')
        const { mime } = checkedAssetPath(id, path)
        await ready()
        const result = await read(() => agent.cloudNotesReadImage(id, path), signal)
        if (!result || result.content_type !== mime || !sha256.test(result.sha256) ||
            !Number.isSafeInteger(result.bytes) || result.bytes <= 0 ||
            result.bytes > 20 * 1_048_576 || typeof result.image !== 'string' ||
            result.image.length > Math.ceil(20 * 1_048_576 / 3) * 4 + 4 ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(result.image)) {
          throw new Error('备忘录图片回执的格式或大小无效。')
        }
        let data: Uint8Array
        try {
          const decoded = atob(result.image)
          data = Uint8Array.from(decoded, char => char.charCodeAt(0))
        } catch {
          throw new Error('备忘录图片编码无效。')
        }
        if (data.byteLength !== result.bytes) {
          throw new Error('备忘录图片长度与回执不一致。')
        }
        // The Go Client has already verified the Server ETag. The Renderer
        // independently validates the returned bytes before making a Blob URL.
        const owned = new ArrayBuffer(data.byteLength)
        new Uint8Array(owned).set(data)
        const digest = await crypto.subtle.digest('SHA-256', owned)
        checkOwner(signal)
        const hash = Array.from(new Uint8Array(digest),
          value => value.toString(16).padStart(2, '0')).join('')
        if (hash.toLowerCase() !== result.sha256.toLowerCase()) {
          throw new Error('备忘录图片内容校验失败。')
        }
        return new Blob([owned], { type: mime })
      },
    } : {}),
    async exportNote(nodeID, filename) {
      checkedRevision(nodeID)
      if (typeof filename !== 'string' || !filename.toLowerCase().endsWith('.md') ||
        !uuid.test(filename.slice(0, -3))) {
        throw new Error('笔记导出文件名不合法。')
      }
      await ready()
      const response = await write(() => agent.cloudDownload(nodeID, filename))
      if (!response.saved) throw new Error('笔记尚未保存到本地文件。')
    },
  }
}

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
  'cloudNotesVersions' | 'cloudNotesReadVersion' | 'cloudDownload'
>

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const sha256 = /^[0-9a-f]{64}$/i
const maxMarkdownBytes = 1_048_576
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

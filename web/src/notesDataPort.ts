import type {
  XDriveNotesDataPort, XDriveNoteSource,
} from '../../ui/shared/src/mui/NotesPage'
import type { XDriveApi } from './api'
import {
  xDriveNotesPlanManualExport, xDriveNotesSelectManualExport,
} from '../../ui/shared/src/notes-manual-import'
import { xDriveNotesSafeRelativeAsset } from '../../ui/shared/src/notes-markdown-policy'

/** Web/PWA adapter for the exact verified Server Owner. Do not accept a
 * profile guessed from a local username or an unverified browser session.
 * Desktop/DSM supply their own host adapter to this same Notes page. */
export function createXDriveWebNotesPort(
  api: XDriveApi,
  ownerScopeKey: string,
): XDriveNotesDataPort {
  if (!ownerScopeKey.trim()) {
    throw new Error('必须先验证当前 xDrive Server 和账户身份。')
  }
  let bootstrap: ReturnType<XDriveApi['notesInitialize']> | null = null
  const ready = () => {
    if (!bootstrap) {
      bootstrap = api.notesInitialize().catch(error => {
        bootstrap = null
        throw error
      })
    }
    return bootstrap
  }
  const ownedID = (value: string) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw new Error('非法备忘录标识')
    }
    return value
  }

  return {
    ownerScopeKey,
    async listNotes(source: XDriveNoteSource, query: string, offset: number,
                    signal?: AbortSignal) {
      await ready()
      signal?.throwIfAborted()
      return api.notesList(source, query, offset, signal)
    },
    async readNote(id: string, signal?: AbortSignal) {
      await ready()
      signal?.throwIfAborted()
      return api.notesRead(ownedID(id), signal)
    },
    async createNote(value) {
      await ready()
      return api.notesCreate(value)
    },
    async importIOSMarkdown(input) {
      await ready()
      return api.notesImportIOS({ ...input, external_id: '' })
    },
    /** Import one selected Apple Notes .md export and all its referenced
     * local images. Only this deliberate user action can create or update a
     * readonly iOS snapshot; ordinary note CRUD never edits iOS backups. */
    async importIOSMarkdownBundle(files, signal) {
      const { markdownFile, assets } = xDriveNotesSelectManualExport(files)
      signal?.throwIfAborted()
      const bytes = await markdownFile.arrayBuffer()
      signal?.throwIfAborted()
      let markdown: string
      try {
        markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        throw new Error('Markdown 文件不是有效的 UTF-8 编码。')
      }
      const plan = xDriveNotesPlanManualExport(markdown, markdownFile, assets)
      await ready()
      signal?.throwIfAborted()
      if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
        throw new Error('当前浏览器不支持安全的导入会话标识。请使用 HTTPS。')
      }
      // A fresh browser import gets a fresh identity. Never derive it from a
      // title/body: two Apple Notes may have identical names and contents.
      const external_id = 'manual:' + crypto.randomUUID()
      let created: Awaited<ReturnType<XDriveApi['notesImportIOS']>> | null = null
      try {
        created = await api.notesImportIOS({
          title: plan.title, markdown, external_id,
        }, signal)
        signal?.throwIfAborted()
        if (created.source !== 'ios_notes' || created.title !== plan.title ||
            created.revision <= 0 || created.node_id <= 0) {
          throw new Error('服务器返回的 iOS 备忘录来源或文件信息无效。')
        }
        const noteID = ownedID(created.id)
        const assetPaths = new Map<string, string>()
        const uploaded = new Map<File, string>()
        for (const reference of plan.references) {
          signal?.throwIfAborted()
          let relative = uploaded.get(reference.asset)
          if (!relative) {
            const receipt = await api.notesImportIOSImage(noteID, reference.asset, signal)
            signal?.throwIfAborted()
            relative = receipt.relative_path
            const uuid = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}'
            if (!xDriveNotesSafeRelativeAsset(relative) ||
                !new RegExp('^_assets/' + uuid + '/' + uuid +
                  '\\.(?:png|jpg|gif|webp|heic)
    async deleteNote(id, expectedRevision) {
      await ready()
      return api.notesDelete(ownedID(id), expectedRevision)
    },
    async listVersions(id: string, signal?: AbortSignal) {
      await ready()
      signal?.throwIfAborted()
      return (await api.notesVersions(ownedID(id), signal)).items
    },
    async readVersion(nodeID: number, versionID: number, signal?: AbortSignal) {
      await ready()
      signal?.throwIfAborted()
      return api.notesReadVersion(nodeID, versionID, signal)
    },
    async uploadImage(noteID, file) {
      await ready()
      return api.notesUploadImage(ownedID(noteID), file)
    },
    async readImageBlob(noteID, relativePath, signal) {
      await ready()
      signal?.throwIfAborted()
      return api.notesImageBlob(ownedID(noteID), relativePath, signal)
    },
    async exportNote(nodeID, _filename) {
      await ready()
      const node = await api.node(nodeID)
      // Server owns File Download permissions, content and transfer progress.
      // Filename is authoritative from the Node and not a client-provided path.
      await api.download(node)
    },
  }
}
, 'i').test(relative) ||
                !relative.toLowerCase().startsWith('_assets/' + noteID.toLowerCase() + '/') ||
                receipt.node_id <= 0 || receipt.bytes !== reference.asset.size ||
                !/^[0-9a-f]{64}$/i.test(receipt.sha256)) {
              throw new Error('服务器返回的图片归属、大小或 SHA-256 无效。')
            }
            uploaded.set(reference.asset, relative)
          }
          assetPaths.set(reference.source, relative)
        }
        if (!plan.references.length) return created
        const revised = plan.rewrite(assetPaths)
        if (revised === markdown) return created
        signal?.throwIfAborted()
        const updated = await api.notesImportIOS({
          title: plan.title, markdown: revised, external_id,
        }, signal)
        signal?.throwIfAborted()
        if (updated.source !== 'ios_notes' || updated.id !== created.id ||
            updated.node_id !== created.node_id ||
            updated.revision <= created.revision) {
          throw new Error('服务器没有在原备忘录上完成图片引用的版本更新。')
        }
        return updated
      } catch (error) {
        if (signal?.aborted) throw error
        if (created) {
          throw new Error('已创建只读 iOS 备份，但图片上传或引用更新未全部完成。' +
            '请先在 iOS 备份中核对笔记 ' + created.id +
            '，避免重复导入。' +
            (error instanceof Error ? ' 原因：' + error.message : ''))
        }
        throw error
      }
    },
    async saveNote(id, value) {
      await ready()
      return api.notesSave(ownedID(id), value)
    },
    async deleteNote(id, expectedRevision) {
      await ready()
      return api.notesDelete(ownedID(id), expectedRevision)
    },
    async listVersions(id: string, signal?: AbortSignal) {
      await ready()
      signal?.throwIfAborted()
      return (await api.notesVersions(ownedID(id), signal)).items
    },
    async readVersion(nodeID: number, versionID: number, signal?: AbortSignal) {
      await ready()
      signal?.throwIfAborted()
      return api.notesReadVersion(nodeID, versionID, signal)
    },
    async uploadImage(noteID, file) {
      await ready()
      return api.notesUploadImage(ownedID(noteID), file)
    },
    async readImageBlob(noteID, relativePath, signal) {
      await ready()
      signal?.throwIfAborted()
      return api.notesImageBlob(ownedID(noteID), relativePath, signal)
    },
    async exportNote(nodeID, _filename) {
      await ready()
      const node = await api.node(nodeID)
      // Server owns File Download permissions, content and transfer progress.
      // Filename is authoritative from the Node and not a client-provided path.
      await api.download(node)
    },
  }
}

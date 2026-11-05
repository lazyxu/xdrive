import type {
  XDriveNotesDataPort, XDriveNoteDetail, XDriveNoteSummary,
} from '../../ui/shared/src/mui/NotesPage'
import type { XDriveSynologyBackupLocalClient } from '../../ui/shared/src/synology-backup-adapter'
import { xDriveNotesPlanManualExport, xDriveNotesSelectManualExport } from '../../ui/shared/src/notes-manual-import'

/** DSM renders the same Notes page as Desktop. Only the package's fixed,
 * authenticated HTTPS CGI may access the owning Backup-only Agent. */
export function createXDriveDSMNotesPort(
  cgi: XDriveSynologyBackupLocalClient, ownerScope: string,
  imagesEnabled = false,
): XDriveNotesDataPort {
  if (!/^[a-f0-9]{64}$/.test(ownerScope)) {
    throw new Error('当前 DSM Server Owner 未经验证')
  }
  let bootstrap: Promise<void> | null = null
  const notesByNode = new Map<number, string>()

  const verify = async (signal?: AbortSignal): Promise<void> => {
    const current = await cgi.serverConnection(signal)
    if (!current.configured || current.must_change_password ||
        current.owner_scope !== ownerScope) {
      notesByNode.clear()
      bootstrap = null
      throw new Error('DSM Owner 已变化，请重新进入备忘录')
    }
  }
  const call = async <T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    await verify(signal)
    const result = await read()
    await verify(signal)
    return result
  }
  const remember = <T extends XDriveNoteSummary>(note: T): T => {
    if (note.node_id > 0 && (note.source === 'mine' || note.source === 'ios_notes')) {
      notesByNode.set(note.node_id, note.id)
    }
    return note
  }
  const initialized = (): Promise<void> => {
    if (!bootstrap) {
      bootstrap = call(() => cgi.notesNamespace(ownerScope)).catch(error => {
        bootstrap = null
        throw error
      })
    }
    return bootstrap
  }
  const ensure = async () => {
    await initialized()
  }

  return {
    ownerScopeKey: 'dsm:' + ownerScope,
    async importIOSMarkdown(value) {
      await ensure()
      const row = await call(() => cgi.notesImportIOS(ownerScope,
        value.title, value.markdown, ''))
      if (row.source !== 'ios_notes' || row.title !== value.title || row.revision !== 1) {
        throw new Error('iOS 备份导入收据与当前 Owner 不一致')
      }
      return remember(row)
    },
    ...(imagesEnabled ? {
      async importIOSMarkdownBundle(files: readonly File[], signal?: AbortSignal) {
        const { markdownFile, assets } = xDriveNotesSelectManualExport(files)
        await verify(signal)
        const bytes = await markdownFile.arrayBuffer()
        signal?.throwIfAborted()
        if (bytes.byteLength !== markdownFile.size) throw new Error('Markdown 文件读取期间发生变化')
        let markdown: string
        try {
          markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        } catch {
          throw new Error('Markdown 文件不是有效的 UTF-8 编码')
        }
        const plan = xDriveNotesPlanManualExport(markdown, markdownFile, assets)
        await ensure()
        if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
          throw new Error('当前 DSM 浏览器不支持安全的导入会话标识')
        }
        const externalID = 'manual:' + crypto.randomUUID()
        let created: XDriveNoteSummary | null = null
        try {
          created = remember(await call(() => cgi.notesImportIOS(
            ownerScope, plan.title, markdown, externalID, signal), signal))
          if (created.source !== 'ios_notes' || created.title !== plan.title ||
              created.node_id <= 0 || created.revision < 1) {
            throw new Error('服务器返回的 iOS 备份收据无效')
          }
          const noteID = created.id
          const assetPaths = new Map<string, string>()
          const uploaded = new Map<File, string>()
          for (const reference of plan.references) {
            await verify(signal)
            let relative = uploaded.get(reference.asset)
            if (!relative) {
              const data = await reference.asset.arrayBuffer()
              signal?.throwIfAborted()
              if (data.byteLength !== reference.asset.size || data.byteLength < 1 ||
                  data.byteLength > 20 * 1_048_576) {
                throw new Error('图片在读取期间发生变化或超过 20 MiB')
              }
              const receipt = await call(() => cgi.notesImportIOSImage(
                ownerScope, noteID, reference.asset, signal), signal)
              relative = receipt.relative_path
              uploaded.set(reference.asset, relative)
            }
            assetPaths.set(reference.source, relative)
          }
          if (!plan.references.length) return created
          const revised = plan.rewrite(assetPaths)
          if (revised === markdown) return created
          const updated = remember(await call(() => cgi.notesImportIOS(
            ownerScope, plan.title, revised, externalID, signal), signal))
          if (updated.source !== 'ios_notes' || updated.id !== created.id ||
              updated.node_id !== created.node_id || updated.revision <= created.revision) {
            throw new Error('iOS 备份未完成图片引用的版本更新')
          }
          return updated
        } catch (error) {
          if (signal?.aborted) throw error
          if (created) {
            throw new Error('已创建只读 iOS 备份，但图片或引用未全部完成。请在 iOS 备份中核对笔记 ' +
              created.id + '，避免重复导入。' +
              (error instanceof Error ? ' 原因：' + error.message : ''))
          }
          throw error
        }
      },
      async uploadImage(noteID: string, file: File) {
        await ensure()
        const result = await call(() => cgi.notesUploadImage(ownerScope, noteID, file))
        return { relative_path: result.relative_path }
      },
      async readImageBlob(noteID: string, path: string, signal?: AbortSignal): Promise<Blob> {
        await ensure()
        return call(() => cgi.notesReadImage(noteID, path, signal), signal)
      },
    } : {}),
    async listNotes(source, query, offset, signal) {
      await ensure()
      const result = await call(() => cgi.notesList(source, query, offset, signal), signal)
      result.items.forEach(remember)
      return result
    },
    async readNote(id, signal) {
      await ensure()
      return remember(await call<XDriveNoteDetail>(() => cgi.notesRead(id, signal), signal))
    },
    async createNote(value) {
      await ensure()
      return remember(await call(() =>
        cgi.notesCreate(ownerScope, value.title, value.markdown)))
    },
    async saveNote(id, value) {
      await ensure()
      try {
        return remember(await call(() => cgi.notesSave(
          ownerScope, id, value.title, value.markdown, value.expected_revision)))
      } catch (failure) {
        if (failure instanceof Error && failure.message.includes('HTTP 409')) {
          const conflict = new Error('云端版本或 Owner 已变化；本地草稿保留，请核对最新笔记')
          ;(conflict as Error & { status: number }).status = 409
          throw conflict
        }
        throw failure
      }
    },
    async deleteNote(id, expectedRevision) {
      await ensure()
      await call(() => cgi.notesDelete(ownerScope, id, expectedRevision))
      for (const [nodeID, mapped] of notesByNode) {
        if (mapped === id) notesByNode.delete(nodeID)
      }
    },
    async listVersions(id, signal) {
      await ensure()
      const result = await call(() => cgi.notesVersions(id, signal), signal)
      return result.items
    },
    async readVersion(nodeID, versionID, signal) {
      await ensure()
      return call(() => cgi.notesHistory(nodeID, versionID, signal), signal)
    },
    async exportNote(nodeID, filename) {
      await ensure()
      const id = notesByNode.get(nodeID)
      if (!id) throw new Error('先打开此备忘录以验证导出来源')
      const note = remember(await call<XDriveNoteDetail>(() => cgi.notesRead(id)))
      if (note.node_id !== nodeID) throw new Error('备忘录已变化，请重新打开')
      const blob = new Blob([note.markdown], { type: 'text/markdown;charset=utf-8' })
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = filename.replace(/[/\\\u0000-\u001f\u007f]/g, '_').slice(0, 255) || 'note.md'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      // Delay revocation until the browser has begun the file save.
      window.setTimeout(() => URL.revokeObjectURL(href), 30_000)
    },
  }
}

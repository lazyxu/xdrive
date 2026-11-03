import type {
  XDriveNotesDataPort, XDriveNoteDetail, XDriveNoteSummary,
} from '../../ui/shared/src/mui/NotesPage'
import type { XDriveSynologyBackupLocalClient } from '../../ui/shared/src/synology-backup-adapter'

/** DSM renders the same Notes page as Desktop. Only the package's fixed,
 * authenticated HTTPS CGI may access the owning Backup-only Agent. */
export function createXDriveDSMNotesPort(
  cgi: XDriveSynologyBackupLocalClient, ownerScope: string,
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

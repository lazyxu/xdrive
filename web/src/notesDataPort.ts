import type {
  XDriveNotesDataPort, XDriveNoteSource,
} from '../../ui/shared/src/mui/NotesPage'
import type { XDriveApi } from './api'

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

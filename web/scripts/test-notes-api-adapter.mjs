import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(here, '../src/notesDataPort.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
})
assert.equal(compiled.diagnostics?.length ?? 0, 0, 'Web Notes adapter must transpile')
const { createXDriveWebNotesPort } = await import('data:text/javascript;base64,' +
  Buffer.from(compiled.outputText).toString('base64'))

const calls = []
const example = {
  id: '12345678-1234-1234-1234-123456789abc',
  title: 'Test', source: 'mine', node_id: 42,
  revision: 1, sha256: 'a'.repeat(64), bytes: 5,
  created_at: '', updated_at: '', markdown: '# Test',
}
const api = {
  async notesInitialize() {
    calls.push('initialize')
    return { notes_node_id: 1, my_notes_node_id: 2, ios_backup_node_id: 3 }
  },
  async notesList(source, query, offset) {
    calls.push(['list', source, query, offset])
    return { items: [example], next_offset: 0 }
  },
  async notesRead(id) { calls.push(['read', id]); return example },
  async notesCreate(value) { calls.push(['create', value]); return example },
  async notesImportIOS(value) {
    calls.push(['ios-import', value])
    return { ...example, source: 'ios_notes' }
  },
  async notesSave(id, value) { calls.push(['save', id, value]); return example },
  async notesDelete(id, revision) { calls.push(['delete', id, revision]) },
  async notesVersions(id) {
    calls.push(['versions', id])
    return { items: [{ id: 55, revision: 1, bytes: 5, sha256: example.sha256 }] }
  },
  async notesUploadImage(id, file) {
    calls.push(['image-upload', id, file.name])
    return { relative_path: '_assets/' + id + '/12345678-1234-1234-1234-123456789abc.png' }
  },
  async notesImageBlob(id, relativePath) {
    calls.push(['image-read', id, relativePath])
    return new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
  },
  async notesReadVersion(node, version) {
    calls.push(['history', node, version])
    return 'old content'
  },
  async node(id) { calls.push(['node', id]); return { id, name: 'note.md' } },
  async download(node) { calls.push(['download', node.id]) },
}
assert.throws(() => createXDriveWebNotesPort(api, ''), /验证/)
const port = createXDriveWebNotesPort(api, 'server:owner:root')
assert.equal(port.ownerScopeKey, 'server:owner:root')
assert.deepEqual((await port.listNotes('mine', 'Test', 0)).items, [example])
assert.deepEqual(await port.readNote(example.id), example)
await port.createNote({ title: 'Test', markdown: '# Test' })
const imported = await port.importIOSMarkdown({ title: 'Apple Notes', markdown: '# Backup' })
assert.equal(imported.source, 'ios_notes')
await port.saveNote(example.id, {
  title: 'Test', markdown: '# Updated', expected_revision: 1,
})
assert.equal((await port.listVersions(example.id))[0].revision, 1)
assert.equal(await port.readVersion(42, 55), 'old content')
const fakeFile = { name: 'picture.png', size: 12 }
const imageReceipt = await port.uploadImage(example.id, fakeFile)
assert.equal(imageReceipt.relative_path,
  '_assets/' + example.id + '/12345678-1234-1234-1234-123456789abc.png')
const imageBlob = await port.readImageBlob(example.id, imageReceipt.relative_path)
assert.equal(imageBlob.type, 'image/png')
await port.exportNote(42, 'forged-name.txt')
await port.deleteNote(example.id, 1)
assert.equal(calls.filter(c => c === 'initialize').length, 1,
  'exact Owner namespace initialized once, not once per API call')
assert.deepEqual(calls.find(c => Array.isArray(c) && c[0] === 'save')[2],
  { title: 'Test', markdown: '# Updated', expected_revision: 1 })
assert.deepEqual(calls.find(c => Array.isArray(c) && c[0] === 'delete').slice(2), [1])
assert.deepEqual(calls.find(c => Array.isArray(c) && c[0] === 'download'), ['download', 42])
assert.deepEqual(calls.find(c => Array.isArray(c) && c[0] === 'ios-import')[1],
  { title: 'Apple Notes', markdown: '# Backup', external_id: '' },
  'manual imports must never manufacture a stable native Notes identifier')
assert.deepEqual(calls.find(c => Array.isArray(c) && c[0] === 'image-upload'), ['image-upload', example.id, 'picture.png'])
assert.deepEqual(calls.find(c => Array.isArray(c) && c[0] === 'image-read'),
  ['image-read', example.id, imageReceipt.relative_path])
await assert.rejects(() => port.readNote('../other-owner'), /非法备忘录标识/)

// Two concurrent Notes components for the same verified Owner must share one
// namespace initialization. A genuine transient failure must permit retry.
let bootstrapCalls = 0
const sharedBootstrap = createXDriveWebNotesPort({
  ...api,
  async notesInitialize() {
    bootstrapCalls++
    await Promise.resolve()
    return { notes_node_id: 1, my_notes_node_id: 2, ios_backup_node_id: 3 }
  },
}, 'other-server:owner-42')
await Promise.all([
  sharedBootstrap.listNotes('mine', '', 0),
  sharedBootstrap.listNotes('ios_notes', '', 0),
])
assert.equal(bootstrapCalls, 1, 'concurrent Owner reads duplicated namespace POST')
let attempts = 0
const transient = createXDriveWebNotesPort({
  ...api,
  async notesInitialize() {
    attempts++
    if (attempts === 1) throw new Error('temporary network loss')
    return { notes_node_id: 1, my_notes_node_id: 2, ios_backup_node_id: 3 }
  },
}, 'owner-42:retry')
await assert.rejects(transient.listNotes('mine', '', 0), /temporary network loss/)
assert.equal((await transient.listNotes('mine', '', 0)).items.length, 1)
assert.equal(attempts, 2, 'temporary bootstrap failure permanently poisoned Notes port')


const sourceApi = readFileSync(resolve(here, '../src/api.ts'), 'utf8')
for (const route of [
  '/api/v1/notes/namespace', '/api/v1/notes/ios/import',
  '/api/v1/notes/', '/api/v1/files/',
]) assert.ok(sourceApi.includes(route), 'must use canonical Server API: ' + route)
assert.match(sourceApi, /notesReadVersion\(/)
assert.match(sourceApi, /notesUploadImage\(/)
assert.match(sourceApi, /notesImageBlob\(/)
const notesUI = readFileSync(resolve(here, '../../ui/shared/src/mui/NotesPage.tsx'), 'utf8')
assert.match(notesUI, /port\.uploadImage\(noteID, file\)/)
assert.match(notesUI, /port\.readImageBlob\(selected\.id, path/)
assert.match(notesUI, /URL\.revokeObjectURL/)
assert.match(notesUI, /label="搜索标题或正文"/)
assert.match(notesUI, /port\.importIOSMarkdown\(\{ title, markdown \}\)/)
assert.match(notesUI, /勿重复导入/)
assert.match(notesUI, /new TextDecoder\('utf-8', \{ fatal: true \}\)/)
assert.match(sourceApi, /size > 20 \* 1024 \* 1024/)
assert.match(sourceApi, /redirect: 'error'/)
assert.match(sourceApi, /total > 1_048_576/)
console.log('Web Notes adapter, Owner bootstrap and revision contracts: PASS')

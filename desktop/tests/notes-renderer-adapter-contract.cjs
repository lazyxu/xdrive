const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const file = 'desktop/src/renderer/desktopNotesDataPort.ts'
const source = fs.readFileSync(path.join(root, file), 'utf8')

function loadPort() {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  assert.deepEqual(ast.parseDiagnostics.map(d =>
    ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  })
  assert.deepEqual(compiled.diagnostics?.map(d =>
    ts.flattenDiagnosticMessageText(d.messageText, '\n')) || [], [])
  const module = { exports: {} }
  // All imports are type-only: the JavaScript has no runtime access to
  // Electron, Server tokens, global fetch or the filesystem.
  new Function('module', 'exports', compiled.outputText)(module, module.exports)
  return module.exports.createDesktopNotesDataPort
}

const create = loadPort()
const noteID = '12345678-1234-1234-1234-123456789abc'
const markdown = '# Hello'
const sha = crypto.createHash('sha256').update(markdown).digest('hex')
const row = Object.freeze({
  id: noteID, source: 'mine', title: 'Hello', node_id: 21, revision: 1,
  sha256: sha, bytes: Buffer.byteLength(markdown, 'utf8'),
  created_at: '2026-11-03T01:00:00Z', updated_at: '2026-11-03T01:00:00Z',
})

function fakeAgent(calls) {
  const ok = data => ({ ok: true, data })
  return {
    cloudNotesInitialize: async () => {
      calls.push(['namespace'])
      return ok({ system_node_id: 8, notes_node_id: 9,
        ios_backup_node_id: 10, my_notes_node_id: 11 })
    },
    cloudNotesList: async (source, query, offset) => {
      calls.push(['list', source, query, offset])
      return ok({ items: source === 'mine' ? [row] : [], next_offset: 0 })
    },
    cloudNotesRead: async id => {
      calls.push(['read', id])
      return ok({ ...row, markdown })
    },
    cloudNotesCreate: async value => {
      calls.push(['create', value])
      return ok({ ...row, title: value.title,
        bytes: Buffer.byteLength(value.markdown, 'utf8') })
    },
    cloudNotesUpdate: async (id, value) => {
      calls.push(['update', id, value])
      return ok({ ...row, title: value.title, revision: value.expected_revision + 1,
        bytes: Buffer.byteLength(value.markdown, 'utf8') })
    },
    cloudNotesDelete: async (id, revision) => {
      calls.push(['delete', id, revision])
      return ok(undefined)
    },
    cloudNotesVersions: async id => {
      calls.push(['versions', id])
      return ok({ node_id: row.node_id,
        items: [{ id: 44, revision: 1, sha256: sha, bytes: row.bytes }] })
    },
    cloudNotesReadVersion: async (nodeID, versionID) => {
      calls.push(['history', nodeID, versionID])
      return ok({ markdown: '# Previous' })
    },
    cloudDownload: async (nodeID, name) => {
      calls.push(['download', nodeID, name])
      return ok({ saved: true })
    },
  }
}

test('Desktop Notes shares one typed Owner port and one namespace initialization', async () => {
  const calls = []
  const port = create(fakeAgent(calls), 'server:owner:session-1', () => true)
  assert.equal(port.ownerScopeKey, 'server:owner:session-1')
  assert.equal((await port.listNotes('mine', 'Hello', 0)).items[0].id, noteID)
  assert.deepEqual(await port.readNote(noteID), { ...row, markdown })
  const saved = await port.createNote({ title: 'Hello', markdown })
  assert.equal(saved.source, 'mine')
  await port.saveNote(noteID, { title: 'Hello', markdown, expected_revision: 1 })
  assert.equal((await port.listVersions(noteID))[0].revision, 1)
  assert.equal(await port.readVersion(row.node_id, 44), '# Previous')
  await port.exportNote(row.node_id, noteID + '.md')
  await port.deleteNote(noteID, 2)
  assert.equal(calls.filter(c => c[0] === 'namespace').length, 1)
  assert.deepEqual(calls.find(c => c[0] === 'update')[2],
    { title: 'Hello', markdown, expected_revision: 1 })
  assert.deepEqual(calls.find(c => c[0] === 'delete').slice(1), [noteID, 2])
  assert.deepEqual(calls.find(c => c[0] === 'download').slice(1),
    [row.node_id, noteID + '.md'])
  assert.equal(port.uploadImage, undefined,
    'No image upload must appear without a real Agent image capability')
})

test('Desktop Notes preserves 409 for shared Markdown editor and rejects stale Owner', async () => {
  let current = true
  const calls = []
  const agent = fakeAgent(calls)
  agent.cloudNotesUpdate = async () => ({
    ok: false, error: { status: 409, code: 'revision_conflict', message: 'conflict' },
  })
  const port = create(agent, 'server:owner:session-2', () => current)
  await assert.rejects(() => port.saveNote(noteID,
    { title: 'Hello', markdown, expected_revision: 1 }),
  error => error.status === 409 && error.code === 'revision_conflict')
  current = false
  const count = calls.length
  await assert.rejects(() => port.listNotes('mine', '', 0), /Owner 已切换/)
  assert.equal(calls.length, count, 'switched Owner must not initiate another IPC call')
  assert.throws(() => create(agent, '', () => true), /Owner 未经验证/)
})

test('Desktop Notes rejects forged pagination, revision, parent and content', async () => {
  const agent = fakeAgent([])
  const port = create(agent, 'server:owner:session-3', () => true)
  await assert.rejects(() => port.readNote('../foreign-owner'), /标识不合法/)
  await assert.rejects(() => port.listNotes('mine', 'x', 5), /分页参数不合法/)
  await assert.rejects(() => port.saveNote(noteID,
    { title: 'Hello', markdown, expected_revision: 0 }), /版本不合法/)
  const badList = fakeAgent([])
  badList.cloudNotesList = async () => ({ ok: true, data: {
    items: [{ ...row, source: 'ios_notes' }], next_offset: 0,
  } })
  await assert.rejects(() =>
    create(badList, 'server:owner:session-4', () => true).listNotes('mine', '', 0),
  /错误来源/)
  const badRead = fakeAgent([])
  badRead.cloudNotesRead = async () => ({
    ok: true, data: { ...row, bytes: 99, markdown },
  })
  await assert.rejects(() =>
    create(badRead, 'server:owner:session-5', () => true).readNote(noteID),
  /不匹配/)
  const badAck = fakeAgent([])
  badAck.cloudNotesInitialize = async () => ({
    ok: true, data: { system_node_id: 0, notes_node_id: 0,
      ios_backup_node_id: 0, my_notes_node_id: 0 },
  })
  await assert.rejects(() =>
    create(badAck, 'server:owner:session-6', () => true).listNotes('mine', '', 0),
  /未能验证/)
})

test('Desktop Notes stays within explicit Agent IPC and verified Host capabilities', () => {
  const app = fs.readFileSync(path.join(root, 'desktop/src/renderer/App.tsx'), 'utf8')
  const shared = fs.readFileSync(path.join(root,
    'ui/shared/src/mui/XDriveAppPageOutlet.tsx'), 'utf8')
  assert.match(app, /createDesktopNotesDataPort\(/)
  assert.match(app, /capabilities\.includes\('cloud-notes'\)/)
  assert.match(app, /showNotes: Boolean\(desktopNotesPort\)/)
  assert.match(app, /notesPage: desktopNotesPort/)
  assert.match(shared, /case 'notes':/)
  assert.doesNotMatch(source, /fetch\(|accessToken|refreshToken|http:\/\//)
})

test('Notes IPC writes never replay ambiguous POST/PUT/DELETE after a missing ACK', () => {
  const client = fs.readFileSync(path.join(root,
    'desktop/src/main/agent_client.cts'), 'utf8')
  const slice = (start, end) => client.slice(
    client.indexOf(start), client.indexOf(end, client.indexOf(start) + start.length))
  const create = slice('  cloudNotesCreate(write: AgentNotesWrite)', '  cloudNotesUpdate(')
  const update = slice('  cloudNotesUpdate(', '  cloudNotesDelete(')
  const remove = slice('  cloudNotesDelete(', '  cloudNotesVersions(')
  for (const [name, body] of [['create', create], ['update', update], ['delete', remove]]) {
    assert.match(body, /30_000, undefined, false\)/,
      name + ' must disable automatic transport replay')
  }
  const request = client.slice(client.indexOf('  private async request<T>('))
  assert.match(request, /mayRetryUncertainResult = true/)
  assert.match(request, /attempt < \(mayRetryUncertainResult \? 2 : 1\)/)
  assert.match(request, /if \(response\.status === 401 && attempt === 0 && mayRetryUncertainResult\)/)
  assert.match(request, /if \(!mayRetryUncertainResult\) \{\s*throw new AgentIPCError\('notes_commit_uncertain'/)
  assert.match(request, /if \(attempt === 0\) continue/,
    'non-Notes requests keep their existing safe transport behavior')
})

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const load = relative => fs.readFileSync(path.join(root, relative), 'utf8')

function parse(file) {
  const source = load(file)
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)
  const errors = syntax.parseDiagnostics.filter(x => x.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors.map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [],
    file + ' must parse as valid TypeScript')
  return source
}

const ipcPaths = [
  ['/v1/cloud/notes/namespace', 'POST'],
  ['/v1/cloud/notes', 'GET'],
  ['/v1/cloud/notes/{id}', 'GET'],
  ['/v1/cloud/notes', 'POST'],
  ['/v1/cloud/notes/{id}', 'PUT'],
  ['/v1/cloud/notes/{id}', 'DELETE'],
  ['/v1/cloud/notes/{id}/versions', 'GET'],
  ['/v1/cloud/notes/version-content', 'GET'],
]

test('Eight fixed Owner Notes operations stay within authenticated Agent IPC', () => {
  const ipc = load('cmd/xdrive-agent/desktop_ipc.go')
  const handlers = load('cmd/xdrive-agent/desktop_ipc_notes.go')
  const controller = load('cmd/xdrive-agent/cloud_notes.go')
  for (const [path, method] of ipcPaths) {
    assert.ok(ipc.includes('"' + method + ' ' + path + '"'),
      'missing allowlisted Notes endpoint: ' + method + ' ' + path)
  }
  assert.match(ipc, /capabilities = append\(capabilities, "cloud-notes"\)/)
  // DSM Backup-only is allowed ONLY via an explicit method+UUID Notes fence.
  // Do not regress to unconditional access or an arbitrary cloud proxy.
  const runtime = load('cmd/xdrive-agent/desktop_ipc_runtime_mode.go')
  assert.match(ipc, /restrictBackupOnlyEndpoints\(h\.backupOnly, mux\)/)
  assert.match(runtime, /func backupOnlyAllowedNotesRequest\(method, path string\) bool/)
  assert.match(runtime, /return validBackupOnlyNoteID\(id\)/)
  assert.match(runtime, /func fullAgentOnlyRequest\(method, path string\) bool/)
  assert.match(handlers, /port, ok := h\.ctrl\.\(desktopIPCNotesPort\)/)
  assert.match(handlers, /desktopIPCNotesPort/)
  assert.doesNotMatch(handlers, /http\.Proxy|ReverseProxy|proxyURL|fetch\(/)
  for (const name of [
    'CloudNotesInitialize', 'CloudNotesList', 'CloudNotesRead', 'CloudNotesCreate',
    'CloudNotesUpdate', 'CloudNotesDelete', 'CloudNotesVersions', 'CloudNotesReadVersion',
  ]) {
    assert.ok(controller.includes(name), name + ' must delegate to verified Owner Agent')
  }
  assert.match(controller, /c\.cloudClient\(\)/)
  assert.match(ipc, /return desktopIPCAuth\(token,/)
  assert.match(handlers, /NotesMaxMarkdownBytes/)
})

test('Electron Main, preload and Renderer types agree on eight capability-checked calls', () => {
  const main = parse('desktop/src/main/index.cts')
  const client = parse('desktop/src/main/agent_client.cts')
  const preload = parse('desktop/src/preload/index.cts')
  const globals = parse('desktop/src/renderer/global.d.ts')
  const actions = [
    'initialize', 'list', 'read', 'create', 'update', 'delete', 'versions', 'version-content',
  ]
  for (const action of actions) {
    assert.ok(main.includes("'agent:cloud-notes-" + action + "'"))
    assert.ok(preload.includes("'agent:cloud-notes-" + action + "'"))
  }
  assert.match(main, /requireAgentCapability\(hello, 'cloud-notes'\)/)
  assert.match(main, /new TextEncoder\(\)\.encode\(input\.markdown\)\.length > 1_048_576/)
  assert.match(main, /notesRevision\(input\.expected_revision\)/)
  assert.match(main, /notesID\(noteID\)/)
  assert.match(client, /cloudNotesReadVersion\(/)
  assert.match(client, /cloudNotesDelete\(/)
  assert.match(globals, /type AgentNotesRow = \{/)
  assert.match(globals, /cloudNotesInitialize: \(\) => Promise<DesktopResult<AgentNotesNamespace>>/)
  assert.match(globals, /cloudNotesUpdate:/)
  assert.match(globals, /cloudNotesVersions:/)
  assert.match(globals, /cloudNotesReadVersion:/)
})

test('Notes does not introduce an arbitrary renderer Server proxy', () => {
  const main = load('desktop/src/main/index.cts')
  const preload = load('desktop/src/preload/index.cts')
  assert.doesNotMatch(main, /ipcMain\.handle\('agent:cloud-notes-proxy'/)
  assert.doesNotMatch(preload, /cloudNotesRequest:|cloudNotesProxy:/)
})

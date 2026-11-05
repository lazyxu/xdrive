const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')

function loadManualImportPolicy() {
  const helperSource = fs.readFileSync(path.join(root,
    'ui/shared/src/notes-manual-import.ts'), 'utf8')
  const helperCompiled = ts.transpileModule(helperSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  })
  assert.deepEqual((helperCompiled.diagnostics || []).filter(d =>
    d.category === ts.DiagnosticCategory.Error).map(d =>
      ts.flattenDiagnosticMessageText(d.messageText, '\\n')), [])
  const helperModule = { exports: {} }
  new Function('module', 'exports', helperCompiled.outputText)(
    helperModule, helperModule.exports)
  return helperModule.exports
}

const manualImportPolicy = loadManualImportPolicy()
const localRequire = id => {
  if (id === '../../../ui/shared/src/notes-manual-import') return manualImportPolicy
  throw new Error('Unexpected Desktop Notes runtime import: ' + id)
}
const file = path.join(root, 'desktop/src/renderer/desktopNotesDataPort.ts')
const source = fs.readFileSync(file, 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
})
assert.deepEqual((transpiled.diagnostics || []).filter(d =>
  d.category === ts.DiagnosticCategory.Error).map(d =>
    ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
const moduleObject = { exports: {} }
new Function('module', 'exports', 'require', transpiled.outputText)(moduleObject, moduleObject.exports, localRequire)
const createPort = moduleObject.exports.createDesktopNotesDataPort

const noteID = '12345678-1234-1234-1234-123456789abc'
const imageName = '00000000-0000-4000-8000-000000000000.gif'
const asset = '_assets/' + noteID + '/' + imageName
const imageBytes = Buffer.from('GIF89a')
const digest = crypto.createHash('sha256').update(imageBytes).digest('hex')
const ok = data => ({ ok: true, data })

function imageAgent(calls) {
  return {
    cloudNotesInitialize: async () => ok({
      system_node_id: 4, notes_node_id: 5, ios_backup_node_id: 6, my_notes_node_id: 7,
    }),
    cloudNotesUploadImage: async (id, array) => {
      calls.push(['upload', id, Buffer.from(array)])
      return ok({
        node_id: 12, relative_path: asset, filename: imageName,
        content_type: 'image/gif', bytes: imageBytes.length, sha256: digest,
      })
    },
    cloudNotesReadImage: async (id, relative) => {
      calls.push(['read', id, relative])
      return ok({
        image: imageBytes.toString('base64'), bytes: imageBytes.length,
        content_type: 'image/gif', sha256: digest,
      })
    },
  }
}

function fakeImage(bytes = imageBytes, name = 'notes.gif') {
  return {
    name,
    size: bytes.length,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    },
  }
}

test('Notes image capability is opt-in and never exposed on the text-only Agent', () => {
  const port = createPort(imageAgent([]), 'owner:epoch-1', () => true)
  assert.equal(port.uploadImage, undefined)
  assert.equal(port.readImageBlob, undefined)
})

test('Desktop Notes image upload/read uses exact Owner asset and verifies bytes', async () => {
  const calls = []
  let current = true
  const port = createPort(imageAgent(calls), 'owner:epoch-2', () => current, true)
  assert.ok(port.uploadImage)
  assert.ok(port.readImageBlob)
  assert.deepEqual(await port.uploadImage(noteID, fakeImage()), { relative_path: asset })
  assert.equal(calls[0][0], 'upload')
  assert.equal(calls[0][1], noteID)
  assert.deepEqual(calls[0][2], imageBytes)
  const blob = await port.readImageBlob(noteID, asset)
  assert.equal(blob.type, 'image/gif')
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), imageBytes)
  assert.equal(calls.filter(c => c[0] === 'read').length, 1)

  current = false
  const before = calls.length
  await assert.rejects(() => port.uploadImage(noteID, fakeImage()), /Owner 已切换/)
  await assert.rejects(() => port.readImageBlob(noteID, asset), /Owner 已切换/)
  assert.equal(calls.length, before, 'Owner switch must not contact the old Agent')
})

test('Desktop Notes refuses remote URLs, cross-Note paths and forged image receipts', async () => {
  const calls = []
  const agent = imageAgent(calls)
  const port = createPort(agent, 'owner:epoch-3', () => true, true)
  for (const hostile of [
    'https://evil.example/note.gif',
    '_assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/' + imageName,
    '_assets/' + noteID + '/../' + imageName,
  ]) {
    await assert.rejects(() => port.readImageBlob(noteID, hostile), /图片/)
  }
  assert.equal(calls.filter(c => c[0] === 'read').length, 0)

  agent.cloudNotesReadImage = async () => ok({
    image: imageBytes.toString('base64'), bytes: imageBytes.length,
    content_type: 'image/gif', sha256: '0'.repeat(64),
  })
  await assert.rejects(() => port.readImageBlob(noteID, asset), /校验失败/)

  agent.cloudNotesUploadImage = async () => ok({
    node_id: 12, relative_path: '_assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/' + imageName,
    filename: imageName, content_type: 'image/gif', bytes: imageBytes.length, sha256: digest,
  })
  await assert.rejects(() => port.uploadImage(noteID, fakeImage()), /图片/)
  await assert.rejects(() => port.uploadImage(noteID, fakeImage(Buffer.alloc(0))), /图片无效/)
})

test('Electron provides only named image IPC gated by the same Notes Owner capability', () => {
  const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
  const main = read('desktop/src/main/index.cts')
  const preload = read('desktop/src/preload/index.cts')
  const globals = read('desktop/src/renderer/global.d.ts')
  const app = read('desktop/src/renderer/App.tsx')
  const agent = read('desktop/src/main/agent_client.cts')
  for (const action of ['upload-image', 'read-image']) {
    assert.match(main, new RegExp("agent:cloud-notes-" + action))
    assert.match(preload, new RegExp("agent:cloud-notes-" + action))
  }
  assert.match(main, /requireAgentCapability\(hello, 'cloud-notes-images'\)/)
  assert.match(app, /capabilities\.includes\('cloud-notes-images'\)/)
  assert.match(globals, /cloudNotesUploadImage:/)
  assert.match(globals, /cloudNotesReadImage:/)
  assert.match(agent, /mayRetryUncertainResult = true/)
  const write = agent.slice(agent.indexOf('  cloudNotesUploadImage('),
    agent.indexOf('  cloudNotesReadImage('))
  assert.match(write, /120_000, undefined, false\)/,
    'image upload cannot replay after an uncertain commit ACK')
  assert.doesNotMatch(source, /accessToken|refreshToken|fetch\(/)
})

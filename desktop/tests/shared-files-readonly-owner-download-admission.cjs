'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
function load(file, deps = {}) {
  const js = ts.transpileModule(read(file), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', js)(mod.exports, mod, name => {
    if (!Object.prototype.hasOwnProperty.call(deps, name)) throw Error('Unexpected import: ' + name)
    return deps[name]
  })
  return mod.exports
}
const verified = load('ui/shared/src/mui/FileExplorerVerifiedOwnerSelection.ts')
const filename = 'ui/shared/src/mui/FileExplorerReadOnlyDownloadAdmission.ts'
const admit = load(filename, { './FileExplorerVerifiedOwnerSelection': verified })
  .xDriveFileExplorerReadOnlyDownloadReason

const row = { id: 15, revision: 7, name: 'photo.jpg', type: 'file', size: 1024 }
const selected = { id: 15, revision: 7, name: 'photo.jpg', kind: 'file', size: 1024 }
const input = overrides => ({
  selected: [selected],
  rows: [row],
  ownerCurrent: true,
  scopeVerified: true,
  downloadActive: false,
  maxBytes: 32 << 20,
  sizeLimitLabel: '32 MiB',
  ...overrides,
})

test('current verified Owner/Node/revision admits one read-only original save', () => {
  assert.equal(admit(input()), null)
  assert.deepEqual(input().rows, [row], 'admission must not modify current Owner rows')
})

test('unverified or busy Owner refuses before checking Node data', () => {
  assert.match(admit(input({ ownerCurrent: false })), /目录尚未验证/)
  assert.match(admit(input({ scopeVerified: false })), /目录尚未验证/)
  assert.match(admit(input({ downloadActive: true })), /已有正在执行/)
  assert.match(admit(input({ selected: [selected, selected] })), /单个文件/)
  assert.match(admit(input({ count: 2 })), /单个文件/)
})

test('stale or forged revision, Node, name, type and byte size all fail closed', () => {
  for (const forged of [
    { ...selected, id: '15' },
    { ...selected, id: 16 },
    { ...selected, revision: 8 },
    { ...selected, revision: '7' },
    { ...selected, name: 'different.jpg' },
    { ...selected, size: 1500 },
    { ...selected, kind: 'dir' },
  ]) {
    assert.notEqual(admit(input({ selected: [forged] })), null, JSON.stringify(forged))
  }
  assert.match(admit(input({ rows: [{ ...row, type: 'dir' }] })), /不属于当前/)
})

test('empty, oversize, unsafe or invalid file size does not attempt network download', () => {
  for (const size of [0, -1, 32 << 20 | 1, Number.MAX_SAFE_INTEGER + 1, NaN]) {
    assert.match(admit(input({ selected: [{ ...selected, size }] })), /1 B～32 MiB/,
      String(size))
  }
  assert.match(admit(input({ maxBytes: 0 })), /1 B～32 MiB/)
  assert.equal(admit(input({ selected: [{ ...selected, size: 32 << 20 }],
    rows: [{ ...row, size: 32 << 20 }] })), null, 'boundary size must be permitted')
})

test('DSM remains authenticated and read-only; admission does not create file-edit or CGI RPC', () => {
  const page = read('ui/shared/src/mui/SynologyOwnerFilesPage.tsx')
  const source = read(filename)
  assert.match(page, /xDriveFileExplorerReadOnlyDownloadReason\(\{/)
  assert.match(page, /isCurrentOwner\(\)/)
  assert.match(page, /rows: itemsRef\.current/)
  assert.match(page, /XDRIVE_SYNOLOGY_OWNER_DOWNLOAD_MAX_BYTES/)
  assert.match(page, /xDriveSynologyFetchVerifiedDownload\(client, item, controller\.signal/)
  assert.doesNotMatch(source, /fetch\s*\(|ipcRenderer|window\.|backup\.cgi|cloudUpload|createFolder|setFileAvailability/)
  assert.match(read('ui/shared/src/mui/index.tsx'), /export \* from '\.\/FileExplorerReadOnlyDownloadAdmission'/)
})

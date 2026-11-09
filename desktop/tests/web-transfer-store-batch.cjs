const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

// Evaluate the actual production resume eligibility helper, not a second
// mock implementation, before loading the isolated TransferStore VM.
function loadPwaUploadResume() {
  const filename = path.join(repo, 'web', 'src', 'pwaUploadResume.ts')
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  new Function('module', 'exports', compiled)(module, module.exports)
  return module.exports.xDriveCanResumeBrowserUpload
}

function loadWebTransferStore() {
  let source = fs.readFileSync(path.join(repo, 'web', 'src', 'transfers.ts'), 'utf8')
  source = source
    .replace("import { xDriveNormalizeTransferTask, xDriveTransferActive } from '../../ui/shared/src'\n", '')
    .replace("import type { XDriveTransferTask } from '../../ui/shared/src'\n", '')
    .replace("import { xDriveCanResumeBrowserUpload } from './pwaUploadResume'\n", '')
    .replace(
      'export const webTransferStore = new WebTransferStore()',
      'globalThis.__WebTransferStore = WebTransferStore',
    )

  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText

  let persisted = '[]'
  const writes = []
  const context = {
    console,
    Date,
    Error,
    JSON,
    Math,
    Map,
    Set,
    localStorage: {
      getItem: () => persisted,
      setItem: (key, value) => {
        writes.push({ key, value })
        persisted = value
      },
    },
    xDriveNormalizeTransferTask: (item) => item,
    xDriveCanResumeBrowserUpload: loadPwaUploadResume(),
    xDriveTransferActive: (item) => (
      item.state === 'queued' ||
      item.state === 'running' ||
      item.state === 'retrying' ||
      item.state === 'cancelling'
    ),
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(compiled, context)
  return { Store: context.__WebTransferStore, writes }
}

test('Web TransferStore batches lifecycle persistence and listener publication', () => {
  const { Store, writes } = loadWebTransferStore()
  const store = new Store()

  let publications = 0
  store.subscribe(() => { publications += 1 })
  const groupID = store.startGroup({
    fileName: 'archive.zip',
    path: 'archive.zip',
    bytesTotal: 300,
    itemsTotal: 3,
    kind: 'download',
    direction: 'download',
  })
  const childIDs = store.startChildren(groupID, [
    { fileName: 'a.bin', relativePath: 'a.bin', bytesTotal: 100 },
    { fileName: 'b.bin', relativePath: 'b.bin', bytesTotal: 100 },
    { fileName: 'c.bin', relativePath: 'c.bin', bytesTotal: 100 },
  ])

  writes.length = 0
  publications = 0
  let trims = 0
  const originalTrim = store.trimHistory.bind(store)
  store.trimHistory = () => {
    trims += 1
    return originalTrim()
  }

  store.batchUpdates(() => {
    for (const childID of childIDs) {
      store.begin(childID)
      store.progress(childID, 50, 100)
    }
    store.updateGroup(groupID, {
      scanComplete: true,
      bytesDone: 150,
      bytesTotal: 300,
      itemsTotal: 3,
      itemsCompleted: 0,
      itemsFailed: 0,
      itemsRunning: 3,
      itemsQueued: 0,
    })
  })

  assert.equal(trims, 1, 'one snapshot batch must trim history once')
  assert.equal(writes.length, 1, 'one snapshot batch must persist transfer history once')
  assert.equal(publications, 1, 'one snapshot batch must publish listeners once')

  const items = store.snapshot()
  for (const childID of childIDs) {
    const child = items.find((item) => item.id === childID)
    assert.equal(child?.state, 'running')
    assert.equal(child?.bytes_done, 50)
    assert.equal(child?.bytes_total, 100)
  }
  const group = items.find((item) => item.id === groupID)
  assert.equal(group?.bytes_done, 150)
  assert.equal(group?.items_running, 3)

  writes.length = 0
  publications = 0
  trims = 0
  store.progress(childIDs[0], 75, 100)
  assert.equal(trims, 1, 'ordinary single transfer updates must still trim immediately')
  assert.equal(writes.length, 1, 'ordinary single transfer updates must still persist immediately')
  assert.equal(publications, 1, 'ordinary single transfer updates must still publish immediately')
})

test('nested Web TransferStore batches flush only at the outer boundary', () => {
  const { Store, writes } = loadWebTransferStore()
  const store = new Store()
  const groupID = store.startGroup({
    fileName: 'archive.zip',
    itemsTotal: 2,
    kind: 'download',
    direction: 'download',
  })
  const childIDs = store.startChildren(groupID, [
    { fileName: 'a.bin', relativePath: 'a.bin', bytesTotal: 100 },
    { fileName: 'b.bin', relativePath: 'b.bin', bytesTotal: 100 },
  ])
  let publications = 0
  store.subscribe(() => { publications += 1 })
  writes.length = 0
  publications = 0

  store.batchUpdates(() => {
    store.batchUpdates(() => {
      store.progress(childIDs[0], 25, 100)
    })
    store.progress(childIDs[1], 40, 100)
  })

  assert.equal(writes.length, 1)
  assert.equal(publications, 1)
  const items = store.snapshot()
  assert.equal(items.find((item) => item.id === childIDs[0])?.bytes_done, 25)
  assert.equal(items.find((item) => item.id === childIDs[1])?.bytes_done, 40)
})


test('Web CAS byte receipts persist on completed direct and managed uploads only', () => {
  const { Store, writes } = loadWebTransferStore()
  const store = new Store()
  const create = (fileName, kind = 'upload') => store.create({ fileName, kind, bytesTotal: 4096 })
  const instant = create('instant')
  store.complete(instant, 4096, 4096, 0)
  const partial = create('partial')
  store.complete(partial, 4096, 4096, 1024)
  const ordinary = create('ordinary')
  store.complete(ordinary, 4096, 4096, 4096)
  const skipped = create('skipped')
  store.completeSkipped(skipped, 4096)
  const unknown = create('legacy')
  store.complete(unknown, 4096, 4096)
  const malformed = create('invalid')
  store.complete(malformed, 4096, 4096, 4097)
  const download = create('download', 'download')
  store.complete(download, 4096, 4096, 0)
  const groupID = store.startGroup({ fileName: 'folder', bytesTotal: 4096 })
  const [childID] = store.startChildren(groupID, [{ fileName: 'child', relativePath: 'child', bytesTotal: 4096 }])
  store.finishLifecycle(childID, { state: 'completed', transferredBytes: 0 })
  store.finishLifecycle(groupID, { state: 'completed' })

  const items = store.snapshot()
  const get = (id) => items.find((item) => item.id === id)
  assert.equal(get(instant).upload_transferred_bytes, 0)
  assert.equal(get(partial).upload_transferred_bytes, 1024)
  assert.equal(get(ordinary).upload_transferred_bytes, 4096)
  assert.equal(get(skipped).upload_skipped, true)
  assert.equal(get(skipped).upload_transferred_bytes, undefined)
  assert.equal(get(unknown).upload_transferred_bytes, undefined)
  assert.equal(get(malformed).upload_transferred_bytes, undefined)
  assert.equal(get(download).upload_transferred_bytes, undefined)
  assert.equal(get(childID).upload_transferred_bytes, 0)
  assert.equal(get(groupID).upload_transferred_bytes, undefined)
  assert.ok(writes.some(({ value }) => value.includes('"upload_transferred_bytes":0')),
    'verified instant-upload receipt must survive persisted history')
})

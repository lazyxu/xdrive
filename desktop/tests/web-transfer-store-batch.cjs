const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function loadWebTransferStore() {
  let source = fs.readFileSync(path.join(repo, 'web', 'src', 'transfers.ts'), 'utf8')
  source = source
    .replace("import { xDriveNormalizeTransferTask, xDriveTransferActive } from '../../ui/shared/src'\n", '')
    .replace("import type { XDriveTransferTask } from '../../ui/shared/src'\n", '')
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
  store.setScope('test-user')

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
  store.setScope('test-user')
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


test('Web TransferStore baseline does not invent speed and unchanged polling is a no-op', () => {
  const { Store, writes } = loadWebTransferStore()
  const store = new Store()
  store.setScope('baseline-user')
  const id = store.create({
    fileName: 'resume.bin',
    kind: 'upload',
    bytesTotal: 100,
  })

  store.baseline(id, 80, 100)
  let item = store.snapshot().find((entry) => entry.id === id)
  assert.equal(item?.bytes_done, 80)
  assert.equal(item?.instant_bytes_per_second, 0)

  writes.length = 0
  let publications = 0
  const unsubscribe = store.subscribe(() => { publications += 1 })
  publications = 0
  store.progress(id, 80, 100)
  assert.equal(writes.length, 0)
  assert.equal(publications, 0)
  unsubscribe()
})

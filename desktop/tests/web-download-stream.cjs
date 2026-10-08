const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function loadDownloadSink() {
  const filename = path.join(repo, 'web', 'src', 'downloadSink.ts')
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const mod = { exports: {} }
  const execute = new Function('exports', 'module', 'require', output)
  execute(mod.exports, mod, require)
  return { source, ...mod.exports }
}

test('Web direct-to-disk sink streams a large logical response with one in-flight write', async () => {
  const { xDriveWriteWebDownloadToSink } = loadDownloadSink()
  const chunkSize = 64 * 1024
  const chunkCount = 128
  let nextChunk = 0
  let writes = 0
  let inFlight = 0
  let maxInFlight = 0
  let closeCalls = 0
  let abortCalls = 0
  const progress = []

  const body = new ReadableStream({
    pull(controller) {
      if (nextChunk >= chunkCount) {
        controller.close()
        return
      }
      controller.enqueue(new Uint8Array(chunkSize).fill(nextChunk % 251))
      nextChunk += 1
    },
  })
  const sink = {
    kind: 'file-system',
    settled: false,
    writable: {
      async write(chunk) {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await Promise.resolve()
        writes += 1
        assert.equal(chunk.byteLength, chunkSize)
        inFlight -= 1
      },
      async close() {
        closeCalls += 1
      },
      async abort() {
        abortCalls += 1
      },
    },
  }

  const completed = await xDriveWriteWebDownloadToSink(
    body,
    sink,
    async () => {
      throw new Error('streaming path must not materialize a fallback Blob')
    },
    (done) => progress.push(done),
  )

  assert.equal(completed, chunkSize * chunkCount)
  assert.equal(progress.at(-1), completed)
  assert.equal(writes, chunkCount)
  assert.equal(maxInFlight, 1)
  assert.equal(closeCalls, 1)
  assert.equal(abortCalls, 0)
  assert.equal(sink.settled, true)
})

test('Web download sink treats save-picker cancellation as a non-transfer outcome', async () => {
  const { xDriveOpenWebDownloadSink } = loadDownloadSink()
  const original = globalThis.showSaveFilePicker
  globalThis.showSaveFilePicker = async () => {
    const error = new Error('cancelled')
    error.name = 'AbortError'
    throw error
  }
  try {
    assert.deepEqual(await xDriveOpenWebDownloadSink('large.zip'), { kind: 'cancelled' })
  } finally {
    if (original === undefined) delete globalThis.showSaveFilePicker
    else globalThis.showSaveFilePicker = original
  }
})

test('Web download sink preserves Blob fallback when File System Access is unavailable', async () => {
  const { xDriveOpenWebDownloadSink } = loadDownloadSink()
  const original = globalThis.showSaveFilePicker
  delete globalThis.showSaveFilePicker
  try {
    assert.deepEqual(await xDriveOpenWebDownloadSink('legacy.bin'), { kind: 'blob' })
  } finally {
    if (original !== undefined) globalThis.showSaveFilePicker = original
  }
})

test('Web direct-to-disk sink aborts the destination when a chunk write fails', async () => {
  const { xDriveWriteWebDownloadToSink } = loadDownloadSink()
  let writes = 0
  let closes = 0
  let aborts = 0
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]))
      controller.enqueue(new Uint8Array([4, 5, 6]))
      controller.close()
    },
  })
  const sink = {
    kind: 'file-system',
    settled: false,
    writable: {
      async write() {
        writes += 1
        if (writes === 2) throw new Error('disk full')
      },
      async close() {
        closes += 1
      },
      async abort() {
        aborts += 1
      },
    },
  }

  await assert.rejects(
    xDriveWriteWebDownloadToSink(body, sink, async () => new Blob()),
    /disk full/,
  )
  assert.equal(writes, 2)
  assert.equal(closes, 0)
  assert.equal(aborts, 1)
  assert.equal(sink.settled, true)
})

test('Web download wiring opens the save sink before archive work and skips success feedback on cancel', () => {
  const { source: sinkSource } = loadDownloadSink()
  const api = fs.readFileSync(path.join(repo, 'web', 'src', 'api.ts'), 'utf8')
  const explorer = fs.readFileSync(path.join(repo, 'web', 'src', 'WebFileExplorer.tsx'), 'utf8')
  const dialogs = fs.readFileSync(path.join(repo, 'web', 'src', 'fileDialogAdapters.ts'), 'utf8')

  assert.equal(sinkSource.includes('BlobPart[]'), false, 'direct sink helper must not retain an aggregate chunk array')
  assert.ok(api.includes('xDriveWriteWebDownloadToSink('), 'authenticated download must use the direct sink helper')
  assert.ok(api.includes("if (downloadSink.kind === 'file-system')"), 'authenticated download must branch to direct-to-disk writing')
  assert.ok(api.includes('const chunks: BlobPart[] = []'), 'archive Blob fallback must remain available until native archive handoff lands')
  assert.ok(api.includes("if (downloadSink.kind === 'blob')"), 'single-file and version downloads must detect the non-File-System-Access path')
  assert.ok(api.includes('/download-ticket'), 'single-file and version downloads must request short-lived native download tickets')
  assert.ok(api.includes('xDriveStartBrowserDownload(this.nativeDownloadURL(ticket.url), node.name)'), 'ticket downloads must hand off to the browser instead of materializing a Blob')

  const archiveStart = api.indexOf('async downloadArchive(ids: number[], filename: string)')
  const archiveGroup = api.indexOf('const groupID = this.startTransferGroup', archiveStart)
  const archiveSink = api.indexOf('const downloadSink = await xDriveOpenWebDownloadSink(filename)', archiveStart)
  assert.ok(
    archiveStart >= 0 && archiveSink > archiveStart && archiveSink < archiveGroup,
    'archive save picker must run before transfer creation and asynchronous prepare work',
  )

  assert.ok(explorer.includes('if (!saved) return'), 'cancelled FileExplorer downloads must not show success feedback')
  assert.ok(dialogs.includes('api.downloadVersion(node, version).then(() => undefined)'), 'version adapter must discard the saved boolean cleanly')
})

test('Web download progress reporter coalesces fast chunk bookkeeping and preserves time/flush visibility', () => {
  const {
    xDriveCreateWebDownloadProgressReporter,
    xDriveWebDownloadProgressByteStep,
    xDriveWebDownloadProgressIntervalMs,
  } = loadDownloadSink()

  assert.equal(xDriveWebDownloadProgressByteStep, 8 * 1024 * 1024)
  assert.equal(xDriveWebDownloadProgressIntervalMs, 100)

  let now = 0
  const published = []
  const reporter = xDriveCreateWebDownloadProgressReporter(
    (done) => published.push(done),
    { now: () => now },
  )
  const chunkSize = 64 * 1024
  const chunkCount = (1 << 30) / chunkSize
  for (let index = 1; index <= chunkCount; index += 1) {
    reporter.progress(index * chunkSize)
  }
  assert.equal(published.length, 128, '1 GiB / 64 KiB fast stream must publish once per 8 MiB')
  assert.equal(published.at(-1), 1 << 30)
  assert.equal(reporter.flush(), false, 'exact terminal byte step must not publish twice')

  now = 0
  const slow = []
  const slowReporter = xDriveCreateWebDownloadProgressReporter(
    (done) => slow.push(done),
    { now: () => now },
  )
  slowReporter.progress(chunkSize)
  assert.deepEqual(slow, [])
  now = 100
  slowReporter.progress(chunkSize * 2)
  assert.deepEqual(slow, [chunkSize * 2], 'slow streams must publish at the 100 ms cadence')

  const tail = []
  now = 0
  const tailReporter = xDriveCreateWebDownloadProgressReporter(
    (done) => tail.push(done),
    { now: () => now },
  )
  tailReporter.progress(4 * 1024 * 1024)
  assert.deepEqual(tail, [])
  assert.equal(tailReporter.flush(), true)
  assert.deepEqual(tail, [4 * 1024 * 1024], 'failure flush must preserve the latest valid byte count')
})

test('Web authenticated download wires one coalesced progress reporter across direct and Blob paths', () => {
  const api = fs.readFileSync(path.join(repo, 'web', 'src', 'api.ts'), 'utf8')
  const methodStart = api.indexOf('private async downloadAuthenticated(')
  const methodEnd = api.indexOf('async function sha256Buffer', methodStart)
  assert.ok(methodStart >= 0 && methodEnd > methodStart)
  const method = api.slice(methodStart, methodEnd)

  assert.ok(method.includes('xDriveCreateWebDownloadProgressReporter((done) => {'))
  assert.ok(method.includes('transferProgress?.progress(done)'), 'direct-to-disk path must use coalesced progress')
  assert.ok(method.includes('transferProgress?.progress(completed)'), 'Blob stream path must use coalesced progress')
  assert.equal(
    method.includes('webTransferStore.progress(transferID, completed, total)'),
    false,
    'Blob chunks must not persist TransferStore progress directly',
  )
  assert.ok(method.includes('transferProgress?.flush()'), 'failure path must flush the latest valid bytes')
  assert.ok(method.includes('webTransferStore.complete(transferID, completed, total || completed)'))
})


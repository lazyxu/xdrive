const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')

const file = path.join(root, 'web/src/nativeFileShare.ts')
const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
new Function('module', 'exports', js)(mod, mod.exports)
const { XDRIVE_NATIVE_SHARE_MAX_BYTES: MAX, xDriveReadBoundedNativeShareBlob: read } = mod.exports

test('native Web Share file reading is opt-in, bounded and never partial', async () => {
  assert.equal(MAX, 16 * 1024 * 1024)
  const result = await read(new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { 'Content-Type': 'image/png; charset=binary', 'Content-Length': '3' },
  }))
  assert.equal(result.size, 3)
  assert.equal(result.type, 'image/png')
  assert.deepEqual([...new Uint8Array(await result.arrayBuffer())], [1, 2, 3])
  await assert.rejects(read(new Response(new Uint8Array([1, 2]), {
    status: 206,
    headers: { 'Content-Range': 'bytes 0-1/100' },
  })), /不完整/)
})

test('declared oversized payload rejects before accumulating a blob', async () => {
  const payload = new Response(new Uint8Array([1]), {
    headers: { 'Content-Length': String(MAX + 1) },
  })
  await assert.rejects(read(payload), /太大/)
})

test('unknown-length malicious transfer aborts after the small budget and cancels the reader', async () => {
  let cancelled = false
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]))
      controller.enqueue(new Uint8Array([4, 5, 6]))
    },
    cancel() { cancelled = true },
  }), { status: 200, headers: { 'Content-Type': 'application/octet-stream' } })
  await assert.rejects(read(response, undefined, 4), /太大/)
  assert.equal(cancelled, true)
})

test('aborted native share discards bytes, not a partial File', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(read(new Response(new Uint8Array([1, 2, 3])), controller.signal), {
    name: 'AbortError',
  })
})

test('native file share is a separate authenticated API path, not an implicit download or share link', () => {
  const api = fs.readFileSync(path.join(root, 'web/src/api.ts'), 'utf8')
  const start = api.indexOf('async prepareNativeShareFile(nodeID: number, signal?: AbortSignal)')
  const end = api.indexOf('async downloadVersion(node: Node, version: FileVersion)', start)
  assert.ok(start > 0 && end > start)
  const flow = api.slice(start, end)
  for (const token of [
    'this.request<Node>(`/api/v1/nodes/${nodeID}`, { signal })',
    'XDRIVE_NATIVE_SHARE_MAX_BYTES',
    'this.ensureFresh(signal)',
    '/api/v1/files/${nodeID}/content',
    'Authorization:',
    'cache: \'no-store\'',
    'this.refresh(true, signal)',
    'xDriveReadBoundedNativeShareBlob(response, signal)',
    'lifecycleEpoch !== this.transferSessionEpoch',
    'blob.size !== node.size',
    'new File([blob], node.name',
  ]) assert.ok(flow.includes(token), 'missing native file security contract: ' + token)
  assert.equal(/navigator\.share\s*\(\s*\{/.test(flow), false,
    'network must finish before the next explicit user gesture launches share')
  assert.equal(flow.includes('xDriveStartBrowserDownload'), false)
})

test('Mobile Files requires capability detection and invokes OS share directly in a second onClick', () => {
  const mobile = fs.readFileSync(path.join(root, 'web/src/MobileFiles.tsx'), 'utf8')
  const adapter = fs.readFileSync(path.join(root, 'web/src/WebFileExplorer.tsx'), 'utf8')
  assert.match(adapter, /onPrepareNativeShareFile=\{\(entry, signal\) => api\.prepareNativeShareFile\(Number\(entry\.id\), signal\)\}/)
  assert.match(mobile, /onPrepareNativeShareFile\?: \(entry: Pick<XDriveFileExplorerItem, 'id' \| 'name' \| 'kind'>/)
  assert.match(mobile, /typeof navigator\.share === 'function'/)
  assert.match(mobile, /typeof navigator\.canShare === 'function'/)
  assert.match(mobile, /nativeShareControllerRef\.current\?\.abort\(\)/)
  assert.match(mobile, /data-mobile-files-native-share-entry="directory"/)
  assert.match(mobile, /data-mobile-files-native-share-entry="collection"/)
  assert.match(mobile, /data-mobile-files-native-share-confirm/)
  const start = mobile.indexOf('const invokeNativeShare = () =>')
  const end = mobile.indexOf('const runCollectionAction =', start)
  const click = mobile.slice(start, end)
  assert.ok(start > 0 && end > start)
  assert.ok(click.includes('navigator.share({ title: nativeShare.file.name, files: [nativeShare.file] })'))
  assert.equal(click.includes('await '), false, 'the user activation must not await file content')
  assert.match(mobile, /系统不支持分享此文件/)
  assert.match(mobile, /分享链接/)
})

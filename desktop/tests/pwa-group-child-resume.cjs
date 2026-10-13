'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const compile = (file, imports, storage) => {
  const code = ts.transpileModule(read(file), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  const module = { exports: {} }
  new Function('exports', 'module', 'require', 'localStorage', code)(
    module.exports, module, name => {
      if (!Object.hasOwn(imports, name)) throw Error('unexpected import: ' + name)
      return imports[name]
    }, storage)
  return module.exports
}
const helper = compile('web/src/pwaUploadResume.ts', {}, null)
function storage() {
  const values = new Map()
  return {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, val) { values.set(key, val) },
    removeItem(key) { values.delete(key) },
    values,
  }
}
const runtime = (s) => compile('web/src/transfers.ts', {
  '../../ui/shared/src': {
    xDriveTransferActive: item => ['queued','running','retrying','cancelling'].includes(item.state),
    xDriveNormalizeTransferTask: item => ({
      ...item, scope: item.scope === 'group' ? 'group' : 'item',
      root_id: item.root_id || item.parent_id || item.id,
    }),
  },
  './pwaUploadResume': helper,
}, s).webTransferStore
const find = (store, id) => store.snapshot().find(t => t.id === id)
function groupWithChildren(store) {
  const group = store.startGroup({ fileName: 'family', bytesTotal: 17*1024*1024+4, itemsTotal: 2 })
  const [first, second] = store.startChildren(group, [
    { fileName:'live.mov', relativePath:'family/live.mov', bytesTotal:17*1024*1024 },
    { fileName:'a.jpg', relativePath:'family/nested/a.jpg', bytesTotal:4 },
  ])
  store.begin(group)
  store.begin(first)
  return {group, first, second}
}

test('S4B2-B3A: a failed nested child is retryable after reload, but the group remains partial', () => {
  const s = storage(), store = runtime(s)
  store.setSessionKey('https://drive.example:user-A')
  const {group, first, second} = groupWithChildren(store)
  const modified = 1700000000000
  store.setUploadResumeContext(first, group, 42, 'live.mov', 17*1024*1024, modified)
  store.setUploadResumeManifest(first, 'a'.repeat(64))
  store.progress(first, 8*1024*1024, 17*1024*1024)
  store.fail(first, Error('TCP connection dropped'))
  store.finishLifecycle(first, {state:'failed', error:'Network failed'})
  store.finishLifecycle(second, {state:'cancelled'})
  store.updateGroup(group, {
    scanComplete:true, bytesDone:8*1024*1024, bytesTotal:17*1024*1024+4,
    itemsTotal:2, itemsCompleted:0, itemsFailed:1, itemsRunning:0, itemsQueued:0,
  })
  store.finishLifecycle(group, {state:'failed'})
  const restarted = runtime(s)
  restarted.setSessionKey('https://drive.example:user-A')
  const task = find(restarted, first)
  assert.equal(task.state, 'failed')
  assert.equal(task.retryable, true)
  assert.equal(task.parent_id, group)
  assert.equal(task.cloud_parent_id, 42, 'resolved cloud ID, never relative path')
  assert.equal(task.relative_path, 'family/live.mov')
  assert.equal(task.resume_file_last_modified, modified)
  assert.equal(task.resume_manifest_sha256, 'a'.repeat(64))
  assert.equal(find(restarted, second).retryable, false, 'sibling was never uploaded')
  assert.equal(find(restarted, second).state, 'cancelled')
  assert.equal(find(restarted, group).state, 'failed',
    'restoring one child must never falsely complete the whole group')
  assert.equal(find(restarted, group).items_queued, 0)
  assert.equal(helper.xDrivePwaResumeFileError(task,
    {name:'live.mov', size:17*1024*1024, lastModified:modified}), null)
  restarted.markUploadReselected(first)
  assert.equal(find(restarted, first).retryable, false)
  assert.equal(find(restarted, first).resume_manifest_sha256, undefined)
  assert.equal(find(restarted, group).state, 'failed')
  const reread = runtime(s)
  reread.setSessionKey('https://drive.example:user-A')
  assert.equal(find(reread, first).retryable, false, 'do not resurrect consumed retry')
  reread.setSessionKey('https://drive.example:user-B')
  assert.deepEqual(reread.snapshot(), [], 'same origin but different user is isolated')
})

test('S4B2-B3A: unmatched or cancelled grouped children cannot acquire resume identity', () => {
  const s = storage(), store = runtime(s)
  store.setSessionKey('https://drive.example:user-A')
  const {group, first, second} = groupWithChildren(store)
  for (const [groupID,parentID,name,size,lastModified] of [
    ['wrong',42,'live.mov',17*1024*1024,1700000000000],
    [group,0,'live.mov',17*1024*1024,1700000000000],
    [group,42,'other.mov',17*1024*1024,1700000000000],
    [group,42,'live.mov',12,1700000000000],
    [group,42,'live.mov',17*1024*1024,-1],
  ]) store.setUploadResumeContext(first,groupID,parentID,name,size,lastModified)
  store.setUploadResumeManifest(first,'a'.repeat(64))
  store.fail(first,Error('network'))
  store.finishLifecycle(first,{state:'failed'})
  assert.equal(find(store,first).retryable,false)
  assert.equal(find(store,first).resume_manifest_sha256,undefined)
  store.setUploadResumeContext(second,group,42,'a.jpg',4,1700000000000)
  store.setUploadResumeManifest(second,'b'.repeat(64))
  store.finishLifecycle(second,{state:'cancelled'})
  assert.equal(find(store,second).retryable,false)
  assert.equal(find(store,second).resume_manifest_sha256,undefined)
})

test('S4B2-B3A: only fail-mode group children receive metadata; completed children discard digest', () => {
  const s = storage(), store = runtime(s)
  store.setSessionKey('https://drive.example:user-A')
  const {group, first, second} = groupWithChildren(store)
  store.setUploadResumeContext(first,group,42,'live.mov',17*1024*1024,1700000000000)
  store.setUploadResumeManifest(first,'c'.repeat(64))
  store.finishLifecycle(first,{state:'completed'})
  assert.equal(find(store,first).resume_manifest_sha256,undefined)
  assert.equal(find(store,first).retryable,false)
  assert.equal(find(store,first).state,'completed')
  store.setUploadResumeManifest(second,'d'.repeat(64))
  assert.equal(find(store,second).resume_manifest_sha256,undefined,
    'unbound child must not obtain a retry fingerprint')
})

test('S4B2-B3A: shared Web folder API owns child failure without marking parent completed', () => {
  const api = read('web/src/api.ts')
  const controller = read('ui/shared/src/mui/FileExplorerUploadController.ts')
  const app = read('web/src/App.tsx')
  const popover = read('ui/shared/src/mui/TransferCenter.tsx')
  for (const needle of [
    'webTransferStore.setUploadResumeContext(',
    'if (conflictPolicy === \'fail\' && (!managedExternally || Boolean(groupID)))',
    'webTransferStore.setUploadResumeManifest(activeTransferID, manifestSHA256)',
    'webTransferStore.fail(activeTransferID, error)',
    'manifestSHA256 !== expectedResumeManifestSHA256',
  ]) assert.ok(api.includes(needle),needle)
  assert.ok(controller.includes("aggregate.processed += 1"))
  assert.ok(controller.includes("await finishQuietly(childID, { state: 'cancelled' })"))
  assert.ok(controller.includes("'partial'"))
  assert.ok(app.includes('api.uploadWithConflictPolicy(task.cloud_parent_id, file, \'fail\''))
  assert.ok(popover.includes('重新选择原文件'))
  assert.ok(!api.includes('skipWaiting('))
})

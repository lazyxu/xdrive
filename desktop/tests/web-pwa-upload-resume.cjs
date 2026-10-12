const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const helperSource = read('web/src/pwaUploadResume.ts')
function compile(filename, source, dependencies = {}, localStorage) {
  const js = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', 'localStorage', js)(
    mod, mod.exports, (name) => {
      if (!(name in dependencies)) throw Error('Unexpected dependency ' + name)
      return dependencies[name]
    }, localStorage,
  )
  return mod.exports
}
const helper = compile('pwaUploadResume.ts', helperSource)
const { xDriveCanResumeBrowserUpload: canResume, xDrivePwaResumeFileError: reason } = helper
const now = Date.now()
const candidate = (overrides = {}) => ({
  id: 'web-old',
  file_name: 'original.mov', bytes_total: 8 * 1024 * 1024 + 3,
  cloud_parent_id: 42, resume_file_last_modified: 1700000000000,
  resume_conflict_policy: 'fail', resume_manifest_sha256: 'a'.repeat(64),
  scope: 'item', kind: 'upload',
  direction: 'upload', state: 'failed', started_at: new Date(now - 3600000).toISOString(),
  ...overrides,
})

test('S4B: only same-account target and original fail-on-conflict upload may be reselected', () => {
  assert.equal(canResume(candidate(), now), true)
  for (const changed of [
    { direction: 'download' }, { kind: 'hydration' }, { scope: 'group' },
    { state: 'cancelled' }, { state: 'completed' },
    { cloud_parent_id: undefined }, { cloud_parent_id: 0 }, { cloud_parent_id: -1 },
    { resume_conflict_policy: 'overwrite' }, { resume_conflict_policy: 'skip' },
    { resume_conflict_policy: 'keep_both' }, { resume_file_last_modified: undefined },
    { resume_manifest_sha256: undefined }, { resume_manifest_sha256: 'invalid' },
    { file_name: '' }, { bytes_total: NaN },
  ]) assert.equal(canResume(candidate(changed), now), false, JSON.stringify(changed))
})

test('S4B: file name, size and lastModified must ALL match before HTTP', () => {
  const same = { name: 'original.mov', size: 8 * 1024 * 1024 + 3, lastModified: 1700000000000 }
  assert.equal(reason(candidate(), same, now), null)
  for (const different of [
    { ...same, name: 'other.mov' }, { ...same, size: same.size - 1 },
    { ...same, lastModified: same.lastModified + 1000 },
  ]) assert.match(reason(candidate(), different, now), /不一致|未发送/)
  assert.match(reason(candidate(), null, now), /未选择/)
})

test('S4B: expired Server 24h sessions and future/garbled timestamps cannot resume', () => {
  for (const changed of [
    { started_at: new Date(now - 25 * 3600000).toISOString() },
    { started_at: new Date(now + 60000).toISOString() },
    { started_at: 'garbled' },
  ]) assert.equal(canResume(candidate(changed), now), false)
})

function makeStorage(state = new Map()) {
  return {
    state,
    getItem(key) { return state.get(key) ?? null },
    setItem(key, value) { state.set(key, value) },
    removeItem(key) { state.delete(key) },
  }
}
function runtime(storage) {
  const transferActive = x => ['queued', 'running', 'retrying', 'cancelling'].includes(x.state)
  return compile('web/src/transfers.ts', read('web/src/transfers.ts'), {
    '../../ui/shared/src': {
      xDriveNormalizeTransferTask: t => ({ ...t, scope: t.scope || 'item', root_id: t.root_id || t.id }),
      xDriveTransferActive: transferActive,
    },
    './pwaUploadResume': helper,
  }, storage).webTransferStore
}

test('S4B: real Web transfer store persists identity but no local file, bytes or auth token', () => {
  const storage = makeStorage(), app = runtime(storage)
  app.setSessionKey('https://drive.example:user-A')
  const id = app.create({
    fileName: 'original.mov', cloudParentID: 42, kind: 'upload',
    bytesTotal: 8 * 1024 * 1024 + 3,
    resumeFileLastModified: 1700000000000, resumeConflictPolicy: 'fail',
  })
  app.setUploadResumeManifest(id, 'a'.repeat(64))
  app.fail(id, Error('network down'))
  const saved = JSON.stringify([...storage.state.entries()])
  assert.match(saved, /resume_file_last_modified/)
  assert.doesNotMatch(saved, /Bearer|refresh_token|base64|fileBytes/)
  const item = app.snapshot().find(x => x.id === id)
  assert.equal(item.retryable, true, 'recoverable upload must offer an actionable reselect')
  app.markUploadReselected(id)
  assert.equal(app.snapshot().find(x => x.id === id).retryable, false,
    'old attempt is not resurrected or shown as complete')
  assert.equal(app.snapshot().find(x => x.id === id).resume_manifest_sha256, undefined,
    'successful resume invalidates the old manifest')
  const afterRefresh = runtime(storage)
  afterRefresh.setSessionKey('https://drive.example:user-A')
  assert.equal(afterRefresh.snapshot().find(x => x.id === id).retryable, false,
    'refresh must not resurrect a successfully consumed upload')
})

test('S4B: refreshing current account restores failed upload; another account never sees it', () => {
  const storage = makeStorage()
  const app = runtime(storage)
  app.setSessionKey('https://drive.example:user-A')
  const id = app.create({
    fileName: 'original.mov', cloudParentID: 42, kind: 'upload',
    bytesTotal: 100, resumeFileLastModified: 1700000000000,
    resumeConflictPolicy: 'fail',
  })
  app.setUploadResumeManifest(id, 'a'.repeat(64))
  const restarted = runtime(storage)
  restarted.setSessionKey('https://drive.example:user-A')
  const old = restarted.snapshot().find(t => t.id === id)
  assert.equal(old.state, 'failed')
  assert.equal(old.retryable, true)
  restarted.setSessionKey('https://drive.example:user-B')
  assert.deepEqual(restarted.snapshot(), [])
})

test('S4B: API uses the original metadata and re-hashes actual bytes before resume', () => {
  const api = read('web/src/api.ts')
  const app = read('web/src/App.tsx')
  const popover = read('ui/shared/src/mui/TransferCenter.tsx')
  const docs = read('docs/pwa-delivery.md')
  assert.ok(api.includes("resumeFileLastModified: conflictPolicy === 'fail' ? file.lastModified : undefined"))
  assert.ok(api.includes("chunk_sha256: chunkHashes"))
  assert.ok(api.includes("session.received_chunks.map"))
  assert.ok(app.includes('xDrivePwaResumeFileError(task, file)'))
  assert.ok(app.includes("api.uploadWithConflictPolicy(task.cloud_parent_id, file, 'fail'"))
  assert.ok(app.includes('task.resume_manifest_sha256)'))
  assert.ok(api.includes('manifestSHA256 !== expectedResumeManifestSHA256'))
  assert.ok(api.includes('webTransferStore.setUploadResumeManifest'))
  assert.ok(app.includes('webTransferStore.markUploadReselected(task.id)'))
  const resumeCall = app.indexOf('const result = await api.uploadWithConflictPolicy(task.cloud_parent_id')
  const consumeOld = app.indexOf('webTransferStore.markUploadReselected(task.id)')
  assert.ok(resumeCall >= 0 && consumeOld > resumeCall,
    'original failure must remain retryable through file re-hash and Server errors')
  assert.ok(app.includes('data-xdrive-pwa-upload-resume-picker'))
  assert.ok(popover.includes('重新选择原文件'))
  assert.ok(docs.includes('PWA-S4B'))
})

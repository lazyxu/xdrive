const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function loadSharedExternalSources() {
  const filename = path.join(__dirname, '..', '..', 'ui', 'shared', 'src', 'external-sources.ts')
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
  return mod.exports
}

const shared = loadSharedExternalSources()

function source(overrides = {}) {
  return {
    id: 1,
    name: '来源',
    kind: 'synology_photos',
    direction: 'push',
    sync_mode: 'backup',
    run_mode: 'scan',
    status: 'active',
    revision: 1,
    created_at: '2026-09-26T00:00:00Z',
    updated_at: '2026-09-26T00:00:00Z',
    ...overrides,
  }
}

test('shared external-source state ordering is connector neutral', () => {
  assert.deepEqual(
    shared.getExternalSourceState({ source: source({ status: 'paused' }) }),
    { key: 'paused', tone: 'neutral', label: '已暂停' },
  )

  assert.deepEqual(
    shared.getExternalSourceState({
      source: source({ run_requested_at: '2026-09-26T01:00:00Z' }),
    }),
    { key: 'pending', tone: 'busy', label: '等待执行' },
  )

  assert.deepEqual(
    shared.getExternalSourceState({
      source: source({ last_error: 'boom' }),
    }),
    { key: 'error', tone: 'bad', label: '异常' },
  )

  assert.deepEqual(
    shared.getExternalSourceState({
      source: source({ kind: 'yike_photos', direction: 'pull' }),
      credential: { configured: false },
    }),
    { key: 'credential_missing', tone: 'warning', label: 'Cookie 未配置' },
  )

  assert.deepEqual(
    shared.getExternalSourceState({
      source: source({ kind: 'yike_photos', direction: 'pull' }),
      credential: { configured: true },
    }),
    { key: 'credential_ready', tone: 'good', label: 'Cookie 已配置' },
  )
})

test('shared external-source trigger gating matches connector execution model', () => {
  assert.deepEqual(
    shared.getExternalSourceTriggerState({
      source: source(),
    }),
    {
      ready: true,
      label: '提交请求，由群晖 source-agent 下一次任务检查执行',
    },
  )

  assert.deepEqual(
    shared.getExternalSourceTriggerState({
      source: source({ kind: 'yike_photos', direction: 'pull' }),
      credential: { configured: false },
    }),
    {
      ready: false,
      label: '请先配置 Cookie',
    },
  )

  assert.deepEqual(
    shared.getExternalSourceTriggerState({
      source: source({ kind: 'yike_photos', direction: 'pull' }),
      credential: { configured: true },
      latestRun: { status: 'running' },
    }),
    {
      ready: false,
      label: '来源正在运行',
    },
  )
})

test('shared connector profiles own credential and trigger semantics', () => {
  assert.deepEqual(shared.externalSourceConnectorProfile('synology_photos'), {
    kind: 'synology_photos',
    label: '群晖 Photos',
    direction: 'push',
    credential: null,
    manualTriggerExecutor: 'source_agent',
    defaultName: '群晖 Photos',
    defaultIgnoreRules: '@eaDir/\n\\#recycle/\n',
  })
  assert.deepEqual(shared.externalSourceConnectorProfile('yike_photos'), {
    kind: 'yike_photos',
    label: '一刻相册',
    direction: 'pull',
    credential: 'cookie',
    manualTriggerExecutor: 'pull_worker',
    defaultName: '一刻相册',
    defaultIgnoreRules: '',
  })

  const unknown = shared.externalSourceConnectorProfile('future_connector')
  assert.equal(unknown.label, 'future_connector')
  assert.equal(unknown.credential, null)
})

test('shared source card view derives display data once for both UIs', () => {
  const row = {
    source: source({
      run_mode: 'scan',
      last_run_at: '2026-09-26T18:32:00Z',
    }),
    latestRun: {
      status: 'completed',
      scanned_items: 128493,
      scanned_bytes: 2800000000000,
    },
  }
  const view = shared.externalSourceCardView(row)
  assert.equal(view.modeLabel, 'Push · 仅扫描')
  assert.equal(view.lastActivityLabel, '上次扫描')
  assert.equal(view.lastActivityAt, '2026-09-26T18:32:00Z')
  assert.equal(view.scannedItems, 128493)
  assert.equal(view.scannedBytes, 2800000000000)
  assert.equal(view.connector.manualTriggerExecutor, 'source_agent')
  assert.equal(view.trigger.ready, true)
})

test('shared external-source defaults preserve connector-specific setup rules', () => {
  assert.deepEqual(shared.externalSourceDefaults('yike_photos'), {
    kind: 'yike_photos',
    name: '一刻相册',
    direction: 'pull',
    ignoreRules: '',
  })
  assert.deepEqual(shared.externalSourceDefaults('synology_photos'), {
    kind: 'synology_photos',
    name: '群晖 Photos',
    direction: 'push',
    ignoreRules: '@eaDir/\n\\#recycle/\n',
  })
  assert.equal(shared.externalSourceModeLabel(source()), 'Push · 仅扫描')
  assert.equal(shared.externalSourceKindLabel('yike_photos'), '一刻相册')
  assert.equal(shared.externalSourceRunStatusLabel('partial'), '部分完成')
})

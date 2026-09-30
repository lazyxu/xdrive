const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function loadSharedModule(filename) {
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

function loadSharedExternalSources() {
  const root = path.join(__dirname, '..', '..', 'ui', 'shared', 'src')
  return {
    ...loadSharedModule(path.join(root, 'external-sources.ts')),
    ...loadSharedModule(path.join(root, 'synology-dsm-guide.ts')),
  }
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

test('shared external-source defaults and schedule labels stay connector-neutral', () => {
  const defaults = shared.externalSourceDefaults('synology_photos')
  assert.equal(defaults.scheduleType, 'interval')
  assert.equal(defaults.scheduleExpression, '6h')
  assert.ok(defaults.scheduleTimezone)

  assert.equal(shared.externalSourceScheduleLabel(source({
    schedule_type: 'interval',
    schedule_expression: '6h',
  })), '每 6h')
  assert.equal(shared.externalSourceScheduleLabel(source({
    schedule_type: 'cron',
    schedule_expression: '0 3 * * *',
    schedule_timezone: 'Asia/Shanghai',
  })), 'Cron 0 3 * * * · Asia/Shanghai')
  assert.equal(shared.externalSourceScheduleLabel(source({
    schedule_type: 'manual',
  })), '仅手动')
  assert.equal(shared.externalSourceScheduleLabel(source()), '兼容默认间隔')
})

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

  assert.deepEqual(
    shared.getExternalSourceState({
      source: source({ kind: 'synology_photos', direction: 'pull' }),
      credential: { configured: false },
    }),
    { key: 'credential_missing', tone: 'warning', label: 'DSM 凭据未配置' },
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
    }),
    {
      ready: true,
      label: '立即唤醒 Pull worker 扫描此来源；定时轮询作为兜底',
    },
  )

  assert.deepEqual(
    shared.getExternalSourceTriggerState({
      source: source({ kind: 'synology_photos', direction: 'pull' }),
      credential: { configured: false },
    }),
    {
      ready: false,
      label: '请先配置 DSM 凭据',
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

test('shared run detail exposes live progress and cancellation state', () => {
  const running = shared.externalSourceRunDetailView({
    id: 'run-1',
    source_id: 1,
    source_revision: 1,
    mode: 'sync',
    trigger: 'manual',
    status: 'running',
    scanned_items: 120,
    scanned_bytes: 1200,
    ignored_items: 0,
    ignored_bytes: 0,
    new_items: 10,
    new_bytes: 1000,
    changed_items: 0,
    changed_bytes: 0,
    moved_items: 0,
    unchanged_items: 110,
    unchanged_bytes: 200,
    missing_items: 0,
    missing_bytes: 0,
    planned_transfer_items: 10,
    planned_transfer_bytes: 1000,
    processed_transfer_items: 4,
    processed_transfer_bytes: 400,
    created_items: 4,
    updated_items: 0,
    skipped_items: 110,
    transferred_items: 4,
    transferred_bytes: 400,
    failed_items: 0,
    active_transfer_path: 'Library/big.mp4 [9]',
    active_transfer_bytes: 100,
    active_transfer_total_bytes: 200,
    started_at: '2026-09-27T10:00:00Z',
  })
  assert.equal(running.progress.percent, 50)
  assert.match(running.progress.label, /已处理 4 \/ 已发现 10 项/)
  assert.equal(running.progress.activePath, 'Library/big.mp4 [9]')
  assert.equal(running.progress.cancelling, false)

  const cancelling = shared.externalSourceRunDetailView({
    ...{
      id: 'run-2', source_id: 1, source_revision: 1, mode: 'scan', trigger: 'manual', status: 'running',
      scanned_items: 5, scanned_bytes: 50, ignored_items: 0, ignored_bytes: 0, new_items: 0, new_bytes: 0,
      changed_items: 0, changed_bytes: 0, moved_items: 0, unchanged_items: 5, unchanged_bytes: 50,
      missing_items: 0, missing_bytes: 0, planned_transfer_items: 0, planned_transfer_bytes: 0,
      processed_transfer_items: 0, processed_transfer_bytes: 0,
      created_items: 0, updated_items: 0, skipped_items: 5, transferred_items: 0, transferred_bytes: 0,
      failed_items: 0, active_transfer_bytes: 0, active_transfer_total_bytes: 0,
      started_at: '2026-09-27T10:00:00Z',
    },
    cancel_requested_at: '2026-09-27T10:01:00Z',
  })
  assert.equal(cancelling.progress.percent, undefined)
  assert.equal(cancelling.progress.label, '正在取消…')
  assert.equal(cancelling.progress.cancelling, true)
})

test('shared trigger action label promotes retries without hiding pending state', () => {
  assert.equal(shared.externalSourceTriggerActionLabel({ source: source() }), '立即扫描')
  assert.equal(shared.externalSourceTriggerActionLabel({
    source: source(),
    latestRun: { failed_items: 3 },
  }), '重试失败项')
  assert.equal(shared.externalSourceTriggerActionLabel({
    source: source({ run_requested_at: '2026-09-26T01:00:00Z' }),
    latestRun: { failed_items: 3 },
  }), '已请求')
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

  assert.deepEqual(shared.externalSourceConnectorProfile('synology_photos', 'pull'), {
    kind: 'synology_photos',
    label: '群晖 Photos',
    direction: 'pull',
    credential: 'synology_dsm',
    manualTriggerExecutor: 'pull_worker',
    defaultName: '群晖 Photos Pull',
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
      failed_items: 2,
    },
  }
  const view = shared.externalSourceCardView(row)
  assert.equal(view.modeLabel, 'Push · 仅扫描')
  assert.equal(view.lastActivityLabel, '上次扫描')
  assert.equal(view.lastActivityAt, '2026-09-26T18:32:00Z')
  assert.equal(view.scannedItems, 128493)
  assert.equal(view.scannedBytes, 2800000000000)
  assert.equal(view.failedItems, 2)
  assert.equal(view.connector.manualTriggerExecutor, 'source_agent')
  assert.equal(view.trigger.ready, true)
})

test('shared source detail suppresses stale errors while a run is pending or active', () => {
  const running = shared.externalSourceDetailView({
    source: source({ last_error: 'previous scan failed' }),
    latestRun: { status: 'running' },
  })
  assert.equal(running.state.key, 'running')
  assert.equal(running.error, undefined)

  const pending = shared.externalSourceDetailView({
    source: source({
      last_error: 'previous scan failed',
      run_requested_at: '2026-09-28T02:25:23Z',
    }),
  })
  assert.equal(pending.state.key, 'pending')
  assert.equal(pending.error, undefined)

  const failed = shared.externalSourceDetailView({
    source: source({ last_error: 'current scan failed' }),
  })
  assert.equal(failed.state.key, 'error')
  assert.equal(failed.error, 'current scan failed')
})

test('shared source detail view keeps connector and credential semantics aligned', () => {
  const row = {
    source: source({
      kind: 'yike_photos',
      direction: 'pull',
      run_mode: 'sync',
      target_node_id: 42,
      last_run_at: '2026-09-26T17:10:00Z',
      last_success_at: '2026-09-26T16:00:00Z',
      ignore_rules: '*.tmp',
      revision: 7,
    }),
    credential: { configured: true },
  }

  const detail = shared.externalSourceDetailView(row)
  assert.equal(detail.kindLabel, '一刻相册')
  assert.equal(detail.modeLabel, 'Pull · 同步')
  assert.equal(detail.targetNodeID, 42)
  assert.equal(detail.lastRunAt, '2026-09-26T17:10:00Z')
  assert.equal(detail.lastSuccessAt, '2026-09-26T16:00:00Z')
  assert.deepEqual(detail.credential, { label: 'Cookie', configured: true })
  assert.equal(detail.revision, 7)
  assert.equal(detail.ignoreRules, '*.tmp')
})

test('shared run detail view defines one metric order for Web and Desktop', () => {
  const detail = shared.externalSourceRunDetailView({
    id: 'run-1',
    source_id: 1,
    source_revision: 7,
    mode: 'sync',
    trigger: 'manual',
    status: 'completed',
    scanned_items: 100,
    scanned_bytes: 1000,
    ignored_items: 1,
    ignored_bytes: 10,
    new_items: 2,
    new_bytes: 20,
    changed_items: 3,
    changed_bytes: 30,
    moved_items: 4,
    unchanged_items: 90,
    unchanged_bytes: 900,
    missing_items: 5,
    missing_bytes: 50,
    planned_transfer_items: 6,
    planned_transfer_bytes: 60,
    created_items: 2,
    updated_items: 3,
    skipped_items: 0,
    transferred_items: 5,
    transferred_bytes: 50,
    failed_items: 1,
    started_at: '2026-09-26T18:00:00Z',
    finished_at: '2026-09-26T18:05:00Z',
  })

  assert.equal(detail.statusLabel, '已完成')
  assert.equal(detail.modeLabel, '同步')
  assert.equal(detail.triggerLabel, '手动触发')
  assert.equal(detail.startedAt, '2026-09-26T18:00:00Z')
  assert.equal(detail.finishedAt, '2026-09-26T18:05:00Z')
  assert.equal(detail.durationLabel, '5 分')
  assert.equal(detail.successItems, 99)
  assert.equal(detail.failedItems, 1)
  assert.deepEqual(detail.metrics.map((metric) => metric.key), [
    'scanned',
    'ignored',
    'new',
    'changed',
    'moved',
    'unchanged',
    'missing',
    'planned_transfer',
    'created',
    'updated',
    'skipped',
    'transferred',
    'failed',
  ])
  assert.deepEqual(detail.metrics[0], { key: 'scanned', label: '扫描', items: 100, bytes: 1000 })
  assert.deepEqual(detail.metrics[12], { key: 'failed', label: '失败', items: 1 })
})

test('shared Synology DSM guide binds the exact Source and keeps secrets out of scheduled task', () => {
  const guide = shared.synologyDsmSetupGuide({
    sourceID: 42,
    sourceName: '家庭照片',
    serverURL: 'https://drive.example.com',
    xdriveUsername: 'alice',
  })

  assert.equal(guide.sourceID, 42)
  assert.match(guide.subtitle, /Source #42/)
  const bind = guide.steps.find((step) => step.id === 'bind')
  assert.ok(bind)
  assert.match(bind.command, /setup --source-id 42/)
  assert.equal(bind.command.includes('--target'), false)
  assert.equal(bind.command.includes('--name'), false)

  const scheduler = guide.steps.find((step) => step.id === 'task-script')
  assert.ok(scheduler)
  assert.match(scheduler.command, /run --due --interval 6h/)
  assert.equal(scheduler.command.includes('XD_PASSWORD'), false)

  assert.deepEqual(
    guide.steps.filter((step) => step.visual).map((step) => step.visual),
    ['task-create', 'task-schedule', 'task-script'],
  )
})

test('shared Source collection labels are connector-neutral', () => {
  assert.equal(shared.externalSourceCollectionKindLabel('album'), '相册')
  assert.equal(shared.externalSourceCollectionKindLabel('smart'), 'smart')
  assert.equal(shared.externalSourceCollectionStateLabel('active'), '正常')
  assert.equal(shared.externalSourceCollectionStateLabel('missing'), '远端已不存在')
  assert.equal(shared.externalSourceCollectionStateTone('active'), 'good')
  assert.equal(shared.externalSourceCollectionStateTone('missing'), 'warning')
  assert.equal(shared.externalSourceCollectionStateTone('other'), 'neutral')
})

test('pull source defaults use sync mode instead of silently falling back to scan-only', () => {
  assert.equal(shared.externalSourceDefaults('yike_photos', 'pull').runMode, 'sync')
  assert.equal(shared.externalSourceDefaults('synology_photos', 'pull').runMode, 'sync')
  assert.equal(shared.externalSourceDefaults('synology_photos', 'push').runMode, 'scan')
})

test('Web and Desktop create flows consume the shared run-mode default', () => {
  const repo = path.join(__dirname, '..', '..')
  const web = fs.readFileSync(path.join(repo, 'web', 'src', 'ExternalSources.tsx'), 'utf8')
  const desktop = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8')

  assert.equal((web.match(/run_mode: defaults\.runMode/g) || []).length, 2)
  assert.match(desktop, /useState<'scan' \| 'sync'>\(initialSourceDefaults\.runMode\)/)
  assert.equal((desktop.match(/setSourceCreateRunMode\(defaults\.runMode\)/g) || []).length, 2)
})
test('shared external-source defaults preserve connector-specific setup rules', () => {
  const scheduleTimezone = shared.defaultExternalSourceTimezone()
  assert.deepEqual(shared.externalSourceDefaults('yike_photos'), {
    kind: 'yike_photos',
    name: '一刻相册',
    direction: 'pull',
    runMode: 'sync',
    ignoreRules: '',
    scheduleType: 'interval',
    scheduleExpression: '6h',
    scheduleTimezone,
  })
  assert.deepEqual(shared.externalSourceDefaults('synology_photos'), {
    kind: 'synology_photos',
    name: '群晖 Photos',
    direction: 'push',
    runMode: 'scan',
    ignoreRules: '@eaDir/\n\\#recycle/\n',
    scheduleType: 'interval',
    scheduleExpression: '6h',
    scheduleTimezone,
  })
  assert.deepEqual(shared.externalSourceDefaults('synology_photos', 'pull'), {
    kind: 'synology_photos',
    name: '群晖 Photos Pull',
    direction: 'pull',
    runMode: 'sync',
    ignoreRules: '',
    scheduleType: 'interval',
    scheduleExpression: '6h',
    scheduleTimezone,
  })
  assert.equal(shared.externalSourceModeLabel(source()), 'Push · 仅扫描')
  assert.equal(shared.externalSourceKindLabel('yike_photos'), '一刻相册')
  assert.equal(shared.externalSourceRunStatusLabel('partial'), '部分完成')
})


test('shared create presets distinguish Synology Push, Synology Pull, and Yike Pull', () => {
  assert.deepEqual(
    shared.externalSourceCreateOptions.map((item) => [item.value, item.kind, item.direction]),
    [
      ['synology_push', 'synology_photos', 'push'],
      ['synology_pull', 'synology_photos', 'pull'],
      ['yike_pull', 'yike_photos', 'pull'],
    ],
  )
  assert.equal(shared.externalSourceCreateOption('synology_pull').label, '群晖 Photos · Pull')
  assert.equal(shared.externalSourceCreatePresetFor('synology_photos', 'push'), 'synology_push')
  assert.equal(shared.externalSourceCreatePresetFor('synology_photos', 'pull'), 'synology_pull')
  assert.equal(shared.externalSourceCreatePresetFor('yike_photos', 'pull'), 'yike_pull')
})

test('shared Synology space normalization is deterministic', () => {
  assert.deepEqual(shared.normalizeSynologyPhotoSpaces(['shared', 'personal', 'shared']), ['personal', 'shared'])
  assert.deepEqual(shared.normalizeSynologyPhotoSpaces(['shared']), ['shared'])
  assert.deepEqual(shared.normalizeSynologyPhotoSpaces([]), [])
})

test('shared saved credential mask is display-only', () => {
  assert.equal(shared.externalSourceSavedCredentialMask, '••••••••••••')
  assert.equal(shared.isExternalSourceSavedCredentialMask(shared.externalSourceSavedCredentialMask), true)
  assert.equal(shared.isExternalSourceSavedCredentialMask('BDUSS=real-cookie'), false)
  assert.equal(shared.isExternalSourceSavedCredentialMask(''), false)
})

test('shared Yike credential test messages are actionable', () => {
  assert.equal(shared.externalSourceCredentialTestErrorLabel('yike_auth_failed'), '一刻相册登录已失效，请重新获取 Cookie')
  assert.equal(shared.externalSourceCredentialTestErrorLabel('yike_rate_limited'), '一刻相册请求过于频繁，请稍后重试')
  assert.equal(
    shared.externalSourceCredentialTestErrorLabel('yike_target_contains_unmanaged_data'),
    '固定的一刻相册目录中已有未归属文件，请先移动或整理该目录后再重新添加来源',
  )
  assert.equal(
    shared.externalSourceCredentialTestErrorLabel('yike_target_path_conflict'),
    '固定的一刻相册路径被同名文件占用，请先整理“同步文件夹 / 一刻相册”路径后重试',
  )
  assert.equal(
    shared.externalSourceCredentialTestSuccessLabel({ valid: true, kind: 'yike_photos', account_name: 'Alice', account_external_id: '123' }),
    '连接成功：Alice（123）',
  )
  assert.equal(shared.externalSourceCredentialTestErrorLabel('synology_auth_failed'), 'Synology DSM 登录失败，请检查地址、用户名和密码')
  assert.equal(shared.externalSourceCredentialTestErrorLabel('synology_timeout'), '连接 Synology DSM 超时，请稍后重试')
})


test('shared Yike Cookie guide gives the full-header workflow', () => {
  assert.equal(shared.yikeManagedTargetLabel, '同步文件夹 / 一刻相册 / uid_<百度UID>_<账号名称>')
  assert.match(shared.yikeConnectorNotice, /未公开接口/)
  assert.match(shared.yikeConnectorNotice, /不会上传、删除或修改/)
  assert.match(shared.yikeRateLimitNotice, /约 2 次\/秒/)
  assert.match(shared.yikeRateLimitNotice, /50005/)
  assert.match(shared.yikeRateLimitNotice, /不限制照片\/视频文件本身的下载速度/)
  assert.equal(shared.yikeCookieHelp.title, '如何获取 Cookie')
  assert.equal(shared.yikeCookieHelp.steps.length, 8)
  assert.match(shared.yikeCookieHelp.summary, /完整 Cookie/)
  assert.match(shared.yikeCookieHelp.steps[4], /photo\.baidu\.com\/youai/)
  assert.match(shared.yikeCookieHelp.steps[7], /测试连接/)
})

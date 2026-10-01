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
      source: source({ kind: 'yike_photos', direction: 'pull' }),
      latestRun: { status: 'running', cancel_requested_at: '2026-09-26T01:01:00Z' },
    }),
    { key: 'running', tone: 'busy', label: '正在取消…' },
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
      label: '立即唤醒 Pull worker 扫描此同步文件夹；定时轮询作为兜底',
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
      label: '同步文件夹正在运行',
    },
  )

  assert.deepEqual(
    shared.getExternalSourceTriggerState({
      source: source({ kind: 'yike_photos', direction: 'pull' }),
      credential: { configured: true },
      latestRun: { status: 'running', cancel_requested_at: '2026-09-26T01:01:00Z' },
    }),
    {
      ready: false,
      label: '同步文件夹正在取消',
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
  assert.equal(cancelling.statusLabel, '正在取消…')
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
  assert.match(guide.subtitle, /同步文件夹 #42/)
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
  const web = fs.readFileSync(path.join(repo, 'web', 'src', 'ExternalSources.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8')
  const desktop = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'sourceManagerAdapter.ts'), 'utf8')

  assert.equal((web.match(/run_mode: defaults\.runMode/g) || []).length, 2)
  assert.equal((desktop.match(/run_mode: defaults\.runMode/g) || []).length, 2)
  assert.ok(web.includes('<XDriveSourceManager'), 'Web must mount the shared Source manager')
  assert.ok(desktop.includes('<XDriveSourceManager'), 'Desktop must mount the shared Source manager')
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


test('shared create presets distinguish Synology Photos, File Station, and Yike Pull', () => {
  assert.deepEqual(
    shared.externalSourceCreateOptions.map((item) => [item.value, item.kind, item.direction]),
    [
      ['synology_push', 'synology_photos', 'push'],
      ['synology_pull', 'synology_photos', 'pull'],
      ['synology_files_pull', 'synology_files', 'pull'],
      ['yike_pull', 'yike_photos', 'pull'],
    ],
  )
  assert.equal(shared.externalSourceCreateOption('synology_pull').label, '群晖 Photos · Pull')
  assert.equal(shared.externalSourceCreatePresetFor('synology_photos', 'push'), 'synology_push')
  assert.equal(shared.externalSourceCreatePresetFor('synology_photos', 'pull'), 'synology_pull')
  assert.equal(shared.externalSourceCreatePresetFor('synology_files', 'pull'), 'synology_files_pull')
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
    '固定的一刻相册目录中已有未归属文件，请先移动或整理该目录后再重新添加同步文件夹',
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
  assert.equal(shared.externalSourceCredentialTestErrorLabel('synology_http_forbidden'), 'Synology DSM 或应用入口拒绝访问（HTTP 403），这不代表密码错误')
  assert.equal(shared.externalSourceCredentialTestErrorLabel('synology_multiple_login'), 'Synology DSM 检测到重复登录，请稍后重试')
  assert.equal(shared.externalSourceCredentialTestErrorLabel('synology_permission_denied'), 'Synology DSM 账号没有访问所需服务的权限')
  assert.equal(shared.externalSourceCredentialTestErrorLabel('synology_otp_required'), 'Synology DSM 要求两步验证/OTP，当前连接器尚未提供 OTP')
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

test('credential diagnostics append backend detail', () => {
  assert.equal(
    shared.externalSourceCredentialTestErrorLabel(
      'synology_tls_unknown_authority',
      'DSM HTTPS 证书不受 xDrive Server 信任',
    ),
    'Synology DSM HTTPS 证书不受信任：DSM HTTPS 证书不受 xDrive Server 信任',
  )
  assert.equal(
    shared.externalSourceCredentialTestErrorLabel('synology_connection_refused'),
    'Synology DSM 端口拒绝连接',
  )
})

test('shared DSM address help explains certificate matching', () => {
  assert.match(shared.synologyDsmAddressHelp, /5001/)
  assert.match(shared.synologyDsmAddressHelp, /https:\/\/IP:5001/)
  assert.match(shared.synologyDsmAddressHelp, /证书/)
  assert.match(shared.synologyDsmAddressHelp, /域名/)
})


test('Web and Desktop reuse shared source summary card presentation', () => {
  const repo = path.join(__dirname, '..', '..')
  const sharedCard = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceSummaryCard.tsx'), 'utf8')
  const web = fs.readFileSync(path.join(repo, 'web', 'src', 'ExternalSources.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8')
  const desktop = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'sourceManagerAdapter.ts'), 'utf8')
  const desktopStyles = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'styles.css'), 'utf8')

  for (const token of [
    'XDriveSourceSummaryCard',
    'XDriveStatusBadge',
    'statusTone',
    'metaAction',
    'actions',
    'details',
    'after',
  ]) {
    assert.ok(sharedCard.includes(token), `shared source summary card missing: ${token}`)
  }

  assert.equal((web.match(/<XDriveSourceSummaryCard/g) || []).length, 1, 'Web should render source summaries through the shared card')
  assert.equal((desktop.match(/<XDriveSourceSummaryCard/g) || []).length, 1, 'Desktop should render source summaries through the shared card')
  assert.equal(web.includes('<Card key={row.source.id}'), false, 'Web should not retain its local source card shell')
  assert.equal(desktop.includes('className="source-card"'), false, 'Desktop should not retain its local source card shell')
  assert.equal(desktopStyles.includes('.source-card {'), false, 'Desktop should not retain duplicate source card styling')
  assert.equal(desktopStyles.includes('.source-card-actions {'), false, 'Desktop should not retain duplicate source action styling')
  assert.equal(desktopStyles.includes('.source-card-header, }'), false, 'Desktop source-card cleanup must not leave an invalid responsive selector')
})


test('Web and Desktop reuse shared source collection presentation', () => {
  const repo = path.join(__dirname, '..', '..')
  const sharedCollection = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceCollection.tsx'), 'utf8')
  const web = fs.readFileSync(path.join(repo, 'web', 'src', 'ExternalSources.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8')
  const desktop = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'sourceManagerAdapter.ts'), 'utf8')

  for (const token of [
    'XDriveSourceCollectionSummary',
    'XDriveSourceCollectionItem',
    'externalSourceCollectionKindLabel',
    'externalSourceCollectionStateLabel',
    'externalSourceCollectionStateTone',
    'formatExternalSourceTime',
    '远端缺失',
    '原始路径',
  ]) {
    assert.ok(sharedCollection.includes(token), `shared source collection presentation missing: ${token}`)
  }

  assert.equal((web.match(/<XDriveSourceCollectionSummary\b/g) || []).length, 1, 'Web should reuse shared collection summary')
  assert.equal((desktop.match(/<XDriveSourceCollectionSummary\b/g) || []).length, 1, 'Desktop should reuse shared collection summary')
  assert.equal((web.match(/<XDriveSourceCollectionItem\b/g) || []).length, 1, 'Web should reuse shared collection item')
  assert.equal((desktop.match(/<XDriveSourceCollectionItem\b/g) || []).length, 1, 'Desktop should reuse shared collection item')
  assert.ok(desktop.includes('wideAt="md"'), 'Desktop collection presentation should preserve the wider breakpoint')
  assert.equal(web.includes('externalSourceCollectionKindLabel(collection.kind)'), false, 'Web should not retain local collection summary presentation')
  assert.equal(desktop.includes('externalSourceCollectionKindLabel(collection.kind)'), false, 'Desktop should not retain local collection summary presentation')
  assert.equal(web.includes("item.state === 'synced' ? 'good'"), false, 'Web should not retain local collection item state presentation')
  assert.equal(desktop.includes("item.state === 'synced' ? 'good'"), false, 'Desktop should not retain local collection item state presentation')
})


test('Web and Desktop reuse shared source schedule fields', () => {
  const repo = path.join(__dirname, '..', '..')
  const sharedSchedule = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceScheduleFields.tsx'), 'utf8')
  const web = fs.readFileSync(path.join(repo, 'web', 'src', 'ExternalSources.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8')
  const desktop = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'sourceManagerAdapter.ts'), 'utf8')

  for (const token of [
    'XDriveSourceScheduleFields',
    '调度方式',
    '固定间隔',
    'Cron 表达式',
    '运行间隔',
    'IANA 时区',
    'onScheduleTypeChange',
    'onExpressionChange',
    'onTimezoneChange',
  ]) {
    assert.ok(sharedSchedule.includes(token), `shared Source schedule fields missing: ${token}`)
  }

  assert.equal((web.match(/<XDriveSourceScheduleFields\b/g) || []).length, 2, 'Web create/settings should reuse shared schedule fields')
  assert.equal((desktop.match(/<XDriveSourceScheduleFields\b/g) || []).length, 2, 'Desktop create/settings should reuse shared schedule fields')
  assert.ok(desktop.includes('wideAt="md"'), 'Desktop should preserve its md schedule breakpoint')
  assert.equal(web.includes('label="调度方式"'), false, 'Web should not keep local schedule fields')
  assert.equal(desktop.includes('label="调度方式"'), false, 'Desktop should not keep local schedule fields')
})


test('Web and Desktop reuse shared source ignore-rules field', () => {
  const repo = path.join(__dirname, '..', '..')
  const sharedIgnore = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceIgnoreRulesField.tsx'), 'utf8')
  const web = fs.readFileSync(path.join(repo, 'web', 'src', 'ExternalSources.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8')
  const desktop = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'sourceManagerAdapter.ts'), 'utf8')

  for (const token of ['XDriveSourceIgnoreRulesField', '忽略规则', 'gitignore 风格规则', 'spellCheck: false', 'monospace']) {
    assert.ok(sharedIgnore.includes(token), `shared Source ignore-rules field missing: ${token}`)
  }

  assert.equal((web.match(/<XDriveSourceIgnoreRulesField\b/g) || []).length, 2, 'Web create/settings should reuse shared ignore-rules field')
  assert.equal((desktop.match(/<XDriveSourceIgnoreRulesField\b/g) || []).length, 2, 'Desktop create/settings should reuse shared ignore-rules field')
  assert.equal(web.includes('label="忽略规则"'), false, 'Web should not retain local ignore-rules field')
  assert.equal(desktop.includes('<span>忽略规则</span>\n                  <textarea'), false, 'Desktop create should not retain local ignore-rules textarea')
  assert.equal(desktop.includes('<span>忽略规则</span>\n                            <textarea'), false, 'Desktop settings should not retain local ignore-rules textarea')
})


test('Web and Desktop reuse shared source basic fields', () => {
  const repo = path.join(__dirname, '..', '..')
  const sharedFields = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceBasicFields.tsx'), 'utf8')
  const web = fs.readFileSync(path.join(repo, 'web', 'src', 'ExternalSources.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8')
  const desktop = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'sourceManagerAdapter.ts'), 'utf8')
  const desktopStyles = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'styles.css'), 'utf8')

  for (const token of [
    'XDriveSourcePresetField',
    'XDriveSourceNameField',
    'XDriveSourceRunModeField',
    'XDriveSourceStatusField',
    'externalSourceCreateOptions',
    'XDriveSourceKindIcon',
    '同步文件夹类型',
    '同步文件夹名称',
    '运行模式',
    '启用',
    '暂停',
  ]) {
    assert.ok(sharedFields.includes(token), `shared Source basic fields missing: ${token}`)
  }

  assert.equal((web.match(/<XDriveSourcePresetField\b/g) || []).length, 1, 'Web create should reuse shared Source preset field')
  assert.equal((desktop.match(/<XDriveSourcePresetField\b/g) || []).length, 1, 'Desktop create should reuse shared Source preset field')
  assert.equal((web.match(/<XDriveSourceNameField\b/g) || []).length, 2, 'Web create/settings should reuse shared Source name field')
  assert.equal((desktop.match(/<XDriveSourceNameField\b/g) || []).length, 2, 'Desktop create/settings should reuse shared Source name field')
  assert.equal((web.match(/<XDriveSourceRunModeField\b/g) || []).length, 2, 'Web create/settings should reuse shared Source run-mode field')
  assert.equal((desktop.match(/<XDriveSourceRunModeField\b/g) || []).length, 2, 'Desktop create/settings should reuse shared Source run-mode field')
  assert.equal((web.match(/<XDriveSourceStatusField\b/g) || []).length, 1, 'Web settings should reuse shared Source status field')
  assert.equal((desktop.match(/<XDriveSourceStatusField\b/g) || []).length, 1, 'Desktop settings should reuse shared Source status field')

  assert.equal(desktop.includes('<input value={sourceCreateName}'), false, 'Desktop create should not keep native Source name input')
  assert.equal(desktop.includes('<select value={sourceCreateRunMode}'), false, 'Desktop create should not keep native Source run-mode select')
  assert.equal(desktop.includes('<input value={sourceEditName}'), false, 'Desktop settings should not keep native Source name input')
  assert.equal(desktop.includes('<select value={sourceEditRunMode}'), false, 'Desktop settings should not keep native Source run-mode select')
  assert.equal(desktop.includes('<select value={sourceEditStatus}'), false, 'Desktop settings should not keep native Source status select')

  for (const legacy of [
    '.source-panel',
    '.source-list',
    '.source-create',
    '.source-settings',
    '.source-target',
    '.source-run-detail',
  ]) {
    assert.equal(desktopStyles.includes(legacy), false, `Desktop must not retain legacy Source CSS: ${legacy}`)
  }
})


test('Web and Desktop reuse shared source credential fields', () => {
  const repo = path.join(__dirname, '..', '..')
  const sharedFields = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceCredentialFields.tsx'), 'utf8')
  const web = fs.readFileSync(path.join(repo, 'web', 'src', 'ExternalSources.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8')
  const desktop = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'sourceManagerAdapter.ts'), 'utf8')

  for (const token of [
    'XDriveSourceCookieField',
    'XDriveSourceTargetField',
    'XDriveStoredCredentialField',
    'XDriveSynologyDsmCredentialFields',
    '一刻相册 Cookie',
    'DSM 地址',
    'DSM 用户名',
    'DSM 密码',
    '更新 DSM 地址',
    '留空则保持当前配置不变',
    '目标目录',
    'expiresInSeconds = 30',
    'onReveal',
    'onHide',
    'synologyDsmAddressHelp',
  ]) {
    assert.ok(sharedFields.includes(token), `shared Source credential fields missing: ${token}`)
  }

  assert.equal((web.match(/<XDriveSourceCookieField\b/g) || []).length, 2, 'Web create/settings should reuse shared Cookie field')
  assert.equal((desktop.match(/<XDriveSourceCookieField\b/g) || []).length, 2, 'Desktop create/settings should reuse shared Cookie field')
  assert.equal((web.match(/<XDriveSynologyDsmCredentialFields\b/g) || []).length, 2, 'Web create/settings should reuse shared DSM field group')
  assert.equal((desktop.match(/<XDriveSynologyDsmCredentialFields\b/g) || []).length, 2, 'Desktop create/settings should reuse shared DSM field group')
  assert.equal((web.match(/<XDriveSourceTargetField\b/g) || []).length, 1, 'Web settings should reuse shared target field')
  assert.equal((desktop.match(/<XDriveSourceTargetField\b/g) || []).length, 1, 'Desktop settings should reuse shared target field')
  assert.equal((web.match(/<XDriveStoredCredentialField\b/g) || []).length, 2, 'Web settings should reuse shared stored-credential fields')
  assert.equal((desktop.match(/<XDriveStoredCredentialField\b/g) || []).length, 2, 'Desktop settings should reuse shared stored-credential fields')
  assert.ok(web.includes('revealSourceCredential'), 'Web settings should reveal credentials only on demand')
  assert.ok(desktop.includes('revealSourceCredential'), 'Desktop settings should reveal credentials only on demand')

  assert.equal(web.includes('synologyDsmAddressHelp'), false, 'Web should not maintain DSM address help locally')
  assert.equal(desktop.includes('synologyDsmAddressHelp'), false, 'Desktop should not maintain DSM address help locally')
  assert.equal(desktop.includes('<span>DSM 地址</span>'), false, 'Desktop create should not keep native DSM address input')
  assert.equal(desktop.includes('<span>更新 DSM 地址</span>'), false, 'Desktop settings should not keep native DSM address input')
  assert.equal(desktop.includes('<span>一刻相册 Cookie</span>'), false, 'Desktop should not keep native Cookie input labels')
})


test('Web and Desktop reuse shared Synology connector-config fields', () => {
  const repo = path.join(__dirname, '..', '..')
  const sharedFields = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceConnectorConfigFields.tsx'), 'utf8')
  const web = fs.readFileSync(path.join(repo, 'web', 'src', 'ExternalSources.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8')
  const desktop = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'sourceManagerAdapter.ts'), 'utf8')

  for (const token of [
    'XDriveSynologyPhotoSpacesField',
    'XDriveSynologyFileRootsField',
    '同步空间',
    'File Station 根目录',
    'synologyPhotoSpaceOptions',
    'normalizeSynologyPhotoSpaces',
    '每行一个 DSM 绝对目录',
  ]) {
    assert.ok(sharedFields.includes(token), `shared connector-config fields missing: ${token}`)
  }

  assert.equal((web.match(/<XDriveSynologyPhotoSpacesField\b/g) || []).length, 2, 'Web Photos create/settings should reuse shared space field')
  assert.equal((desktop.match(/<XDriveSynologyPhotoSpacesField\b/g) || []).length, 2, 'Desktop Photos create/settings should reuse shared space field')
  assert.equal((web.match(/<XDriveSynologyFileRootsField\b/g) || []).length, 2, 'Web File Station create/settings should reuse shared roots field')
  assert.equal((desktop.match(/<XDriveSynologyFileRootsField\b/g) || []).length, 2, 'Desktop File Station create/settings should reuse shared roots field')
  assert.equal(web.includes('create-source-spaces-label'), false, 'Web should not retain local Photos space selector')
  assert.equal(web.includes('settings-source-spaces-label'), false, 'Web should not retain local settings space selector')
  assert.equal(web.includes('label="File Station 根目录"'), false, 'Web should not retain local File Station roots field')
  assert.equal(desktop.includes('<span>File Station 根目录</span>'), false, 'Desktop should not retain native File Station roots field')
  assert.equal(desktop.includes('synologyPhotoSpaceOptions.map'), false, 'Desktop should not retain local Photos space options')
})


test('Desktop source details reuse shared description and section primitives', () => {
  const repo = path.join(__dirname, '..', '..')
  const desktop = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8') + fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'sourceManagerAdapter.ts'), 'utf8')
  const styles = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'styles.css'), 'utf8')
  const description = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'DescriptionGrid.tsx'), 'utf8')

  assert.ok(description.includes('columns?: 2 | 3 | 4'), 'shared description grid should support the three-column run metrics layout')
  assert.ok(description.includes("fullColumnsAt?: 'md' | 'lg'"), 'shared description grid should support a desktop full-column breakpoint')
  assert.ok(desktop.includes('<XDriveDescriptionGrid columns={4} fullColumnsAt="md">'), 'Desktop source details should use the shared four-column description grid')
  assert.ok(desktop.includes('<XDriveDescriptionGrid columns={3} fullColumnsAt="md" sx={{ p: 1.25 }}>'), 'Desktop run metrics should use the shared three-column description grid')
  assert.ok(desktop.includes('title="相册与集合"'), 'Desktop collection section should use the shared section header')
  assert.ok(desktop.includes('title="同步历史"'), 'Desktop history section should use the shared section header')

  for (const legacy of ['source-detail-grid', 'source-run-grid', 'source-ignore', 'source-run-heading']) {
    assert.equal(desktop.includes(`className="${legacy}"`), false, `Desktop should not retain local ${legacy} markup`)
    assert.equal(styles.includes(`.${legacy}`), false, `Desktop should not retain local ${legacy} CSS`)
  }
})

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(repo, 'ui/shared/src/mui/SourceManager.tsx'), 'utf8')
const settingsDialog = fs.readFileSync(path.join(repo, 'ui/shared/src/mui/SourceManagerSettingsDialog.tsx'), 'utf8')
const ast = ts.createSourceFile('SourceManager.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

// Compile the actual controller handlers rather than copying their logic into a
// mock. React setters and the Server/Agent port are the only supplied boundaries.
function handler(name, context) {
  let expression
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) {
      expression = node.initializer?.getText(ast)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(expression, 'missing production handler: ' + name)
  const compiled = ts.transpileModule('module.exports = ' + expression + ';', {
    fileName: 'settings-handler.tsx',
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    reportDiagnostics: true,
  })
  assert.deepEqual((compiled.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error), [])
  const module = { exports: {} }
  const names = Object.keys(context)
  new Function('module', 'exports', ...names, compiled.outputText)(
    module, module.exports, ...names.map((key) => context[key]),
  )
  return module.exports
}

function pending() {
  let resolve
  let reject
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))
const profile = () => ({ credential: 'synology_dsm' })
const defaults = () => ({ scheduleTimezone: 'UTC' })
const message = (error) => error.message

function sourceRow(id, kind = 'synology_files', revision = 1) {
  return {
    source: {
      id, name: '同步文件夹 ' + id, kind, direction: 'pull',
      sync_mode: 'backup', run_mode: 'sync', status: 'active', revision,
      schedule_type: 'interval', schedule_expression: '6h',
      schedule_timezone: 'UTC', ignore_rules: '',
      target_path: '/My Files/' + id,
    },
    credential: { configured: true },
  }
}

function fixture(adapter) {
  const state = {
    setting: null,
    settingsConnectorConfig: null,
    settingsConnectorLoading: false,
    settingsConnectorError: '',
    settingsValues: {},
    settingsNameError: '',
    settingsSpacesError: '',
    settingsRootsError: '',
    settingsCredentialReveal: null,
    revealingSettingsCredential: false,
    testingSettingsCredential: false,
    settingsCredentialTest: null,
    settingsCredentialTestError: '',
    clearCookieConfirmOpen: false,
  }
  const context = {
    adapter,
    settingsSessionRef: { current: 0 },
    externalSourceConnectorProfile: profile,
    externalSourceDefaults: defaults,
    sourceActionErrorMessage: message,
    emptySourceSettingsValues: () => ({ name: '' }),
  }
  for (const key of Object.keys(state)) {
    const setterName = 'set' + key[0].toUpperCase() + key.slice(1)
    context[setterName] = (next) => {
      state[key] = typeof next === 'function' ? next(state[key]) : next
    }
  }
  context.loadSettingsConnectorConfig = handler('loadSettingsConnectorConfig', context)
  return {
    state, context,
    open: handler('openSettings', { ...context, savingSettings: false }),
    close: handler('closeSettings', { ...context, savingSettings: false }),
  }
}

test('late Source A connector config cannot change Source B after switching settings', async () => {
  const a = pending()
  const b = pending()
  const h = fixture({
    sourceConnectorConfig: (id) => id === 1 ? a.promise : b.promise,
  })
  h.open(sourceRow(1))
  h.open(sourceRow(2))
  b.resolve({ revision: 3, configured: true, payload: { roots: ['/b'] } })
  await flush()
  a.resolve({ revision: 1, configured: true, payload: { roots: ['/a'] } })
  await flush()
  assert.equal(h.state.setting.source.id, 2)
  assert.deepEqual(h.state.settingsValues.roots, ['/b'])
  assert.deepEqual(h.state.settingsConnectorConfig.payload.roots, ['/b'])
  assert.equal(h.state.settingsConnectorLoading, false)
  assert.equal(h.state.settingsConnectorError, '')
})

test('closing settings invalidates the pending scope read and clears the form', async () => {
  const read = pending()
  const h = fixture({ sourceConnectorConfig: () => read.promise })
  h.open(sourceRow(1))
  assert.equal(h.state.settingsConnectorLoading, true)
  h.close()
  read.resolve({ revision: 1, configured: true, payload: { roots: ['/unexpected'] } })
  await flush()
  assert.equal(h.state.setting, null)
  assert.deepEqual(h.state.settingsValues, { name: '' })
  assert.equal(h.state.settingsConnectorConfig, null)
  assert.equal(h.state.settingsConnectorLoading, false)
})

test('loading error can be retried without losing the already edited source name', async () => {
  const first = pending()
  const second = pending()
  let calls = 0
  const h = fixture({ sourceConnectorConfig: () => ++calls === 1 ? first.promise : second.promise })
  const row = sourceRow(1)
  h.open(row)
  h.context.setSettingsValues((current) => ({ ...current, name: '已修改名称' }))
  first.reject(new Error('DSM temporarily unavailable'))
  await flush()
  assert.equal(h.state.settingsConnectorError, 'DSM temporarily unavailable')
  assert.equal(h.state.settingsConnectorLoading, false)
  assert.equal(h.state.settingsConnectorConfig, null)
  h.context.loadSettingsConnectorConfig(row)
  second.resolve({ revision: 4, configured: true, payload: { roots: ['/existing'] } })
  await flush()
  assert.equal(h.state.settingsValues.name, '已修改名称')
  assert.deepEqual(h.state.settingsValues.roots, ['/existing'])
  assert.equal(h.state.settingsConnectorError, '')
})

test('native form submission cannot save an unloaded or failed connector scope', async () => {
  const row = sourceRow(1, 'synology_photos')
  for (const condition of [
    { settingsConnectorLoading: true, settingsConnectorError: '', settingsConnectorConfig: null },
    { settingsConnectorLoading: false, settingsConnectorError: 'network failed', settingsConnectorConfig: null },
  ]) {
    let updates = 0
    let prevented = false
    const save = handler('saveSettings', {
      setting: row,
      savingSettings: false,
      settingsValues: { name: 'Changed name', spaces: ['personal', 'shared'] },
      externalSourceConnectorProfile: profile,
      adapter: { updateSource: async () => { updates += 1 } },
      ...condition,
    })
    await save({ preventDefault() { prevented = true } })
    assert.equal(prevented, true)
    assert.equal(updates, 0)
  }
})

function saveFixture(roots) {
  const row = sourceRow(21)
  const state = fixture({ sourceConnectorConfig: async () => ({}) })
  let persisted = { ...row.source }
  let connector = { revision: 8, configured: true, payload: { roots: ['/existing'] } }
  const steps = []
  const adapter = {
    async updateSource(id, revision, input) {
      assert.equal(id, 21)
      assert.equal(revision, persisted.revision)
      assert.equal(Object.prototype.hasOwnProperty.call(input, 'target_path'), false)
      persisted = { ...persisted, ...input, revision: revision + 1 }
      steps.push({ type: 'source', payload: input })
      return persisted
    },
    async setSourceConnectorConfig(id, revision, input) {
      assert.equal(id, 21)
      assert.equal(revision, connector.revision)
      connector = { revision: revision + 1, configured: true, payload: { ...input } }
      steps.push({ type: 'scope', payload: input })
      return connector
    },
    async sourceOverview() {
      return [{ source: persisted, credential: { configured: true } }]
    },
  }
  const context = {
    ...state.context,
    adapter,
    setting: row,
    settingsValues: {
      name: '  更新后的名称  ', sync_mode: 'backup', run_mode: 'sync',
      status: 'active', schedule_type: 'manual', schedule_expression: '',
      schedule_timezone: 'UTC', ignore_rules: '*.tmp',
      roots,
    },
    settingsConnectorConfig: connector,
    settingsConnectorLoading: false,
    settingsConnectorError: '',
    savingSettings: false,
    settingsCredentialPayload: () => null,
    normalizeSynologyFileRoots: (input) => [...new Set(input)],
    synologyFileRootsValidationError: () => '',
    normalizeSynologyPhotoSpaces: (input) => input,
    showActionError: (_title, error) => { throw error },
    testSettingsCredential: async () => ({ ok: true }),
    setSavingSettings: (value) => { state.saving = value },
    setFeedback: (value) => { state.feedback = value },
    load: async () => { steps.push({ type: 'refresh' }) },
  }
  return { state, adapter, context, steps, getPersisted: () => persisted, getConnector: () => connector }
}

test('renaming without a scope change never rewrites the connector roots or target path', async () => {
  const h = saveFixture(['/existing'])
  const save = handler('saveSettings', h.context)
  await save({ preventDefault() {} })
  assert.deepEqual(h.steps.map((entry) => entry.type), ['source', 'refresh'])
  assert.equal(h.getPersisted().name, '更新后的名称')
  assert.equal(h.getPersisted().target_path, '/My Files/21')
  assert.deepEqual(h.getConnector().payload.roots, ['/existing'])
  assert.equal(h.state.state.setting, null)
  assert.equal(h.state.feedback, '同步文件夹设置已保存')
})

test('explicit root change uses pause -> connector scope -> resume then can be reopened', async () => {
  const h = saveFixture(['/new-root'])
  const save = handler('saveSettings', h.context)
  await save({ preventDefault() {} })
  assert.deepEqual(h.steps.map((entry) => entry.type), ['source', 'scope', 'source', 'refresh'])
  assert.equal(h.steps[0].payload.status, 'paused')
  assert.deepEqual(h.steps[1].payload.roots, ['/new-root'])
  assert.equal(h.steps[2].payload.status, 'active')
  assert.equal(h.getPersisted().status, 'active')
  assert.equal(h.getPersisted().target_path, '/My Files/21')
  const reopen = fixture({
    sourceConnectorConfig: async () => h.getConnector(),
  })
  reopen.open({ source: h.getPersisted(), credential: { configured: true } })
  await flush()
  assert.equal(reopen.state.settingsValues.name, '更新后的名称')
  assert.deepEqual(reopen.state.settingsValues.roots, ['/new-root'])
  assert.equal(reopen.state.settingsConnectorLoading, false)
})

test('Cancel remains guarded during save and old credential reveals never appear in a new session', async () => {
  const secret = pending()
  const h = fixture({
    sourceConnectorConfig: async () => ({ revision: 1, configured: true, payload: { roots: ['/safe'] } }),
    revealSourceCredential: async () => secret.promise,
  })
  const a = sourceRow(1)
  h.open(a)
  await flush()
  const reveal = handler('revealSettingsCredential', {
    ...h.context,
    setting: a,
  })
  const request = reveal()
  assert.equal(h.state.revealingSettingsCredential, true)
  const guardedClose = handler('closeSettings', { ...h.context, savingSettings: true })
  guardedClose()
  assert.equal(h.state.setting.source.id, 1)
  h.close()
  h.open(sourceRow(2))
  secret.resolve({ field: 'password', value: 'old-secret', expires_in_seconds: 30 })
  await request
  assert.equal(h.state.settingsCredentialReveal, null)
  assert.equal(h.state.revealingSettingsCredential, false)
})

test('the shared mobile settings dialog blocks unsafe saves and offers explicit retry', () => {
  for (const token of [
    'connectorConfigLoading',
    'connectorConfigError',
    'onRetryConnectorConfig',
    '重试加载配置',
    "profile?.credential === 'synology_dsm'",
    'disabled={saving} onClick={onCancel}',
  ]) {
    assert.ok(settingsDialog.includes(token), 'settings presentation missing: ' + token)
  }
})

'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

function mapper() {
  const compiled = ts.transpileModule(read('ui/shared/src/core-dependency-error.ts'), {
    fileName: 'core-dependency-error.ts',
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  })
  assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)
  const mod = { exports: {} }
  new Function('module', 'exports', compiled.outputText)(mod, mod.exports)
  return mod.exports.xDriveCoreDependencyErrorMessage
}

test('PG/Worker status codes are actionable and never reveal raw DSNs, paths or credentials', () => {
  const safe = mapper()
  const secrets = 'password=VERY_PRIVATE_PASSWORD postgresql://secret:pass@localhost /host-control/secret'
  for (const service of ['postgres', 'worker']) {
    for (const operation of ['refresh', 'save', 'rollback']) {
      const name = service === 'postgres' ? 'PostgreSQL 连接池' : '后台 Worker'
      for (const [status, expected] of [
        [400, '参数'], [401, '重新登录'], [403, '管理员'], [404, '管理接口'],
        [408, '超时或限流'], [409, '版本冲突'], [422, '参数'], [429, '超时或限流'],
        [500, '可信确认'], [501, '管理接口'], [502, '可信确认'],
        [503, '可信确认'], [504, '可信确认'],
      ]) {
        const result = safe({status, message: secrets}, service, operation)
        assert.match(result, new RegExp(expected))
        assert.ok(result.startsWith(name))
        assert.doesNotMatch(result, /VERY_PRIVATE_PASSWORD|\/host-control|postgresql:\/\//)
      }
      const raw = safe(new Error('HTTP 409 ' + secrets), service, operation)
      assert.match(raw, /版本冲突/)
      assert.doesNotMatch(raw, /VERY_PRIVATE_PASSWORD/)
      const nested = safe({response: {status: 403}, message: secrets}, service, operation)
      assert.match(nested, /管理员/)
      assert.doesNotMatch(nested, /VERY_PRIVATE_PASSWORD/)
    }
  }
})

test('unknown failures do not claim no write happened, and never echo exception text', () => {
  const safe = mapper()
  const secret = new Error('token=DO_NOT_PRINT_THIS /private/data/host')
  for (const service of ['postgres', 'worker']) {
    assert.match(safe(secret, service, 'save'), /可能已经提交/)
    assert.match(safe(secret, service, 'rollback'), /可能已经提交/)
    assert.match(safe(secret, service, 'refresh'), /读取失败/)
    assert.match(safe(new Error('Failed to fetch'), service, 'save'), /无法连接/)
    for (const operation of ['save', 'rollback', 'refresh']) {
      assert.doesNotMatch(safe(secret, service, operation), /DO_NOT_PRINT_THIS|\/private\/data/)
    }
  }
})

test('shared UI uses only fixed error messages while preserving version-guarded writes', () => {
  for (const [filename, kind, write] of [
    ['PostgresPoolConfigPanel.tsx', 'postgres', 'savePostgresPoolConfig'],
    ['SourceWorkerConfigPanel.tsx', 'worker', 'saveSourceWorkerConfig'],
  ]) {
    const body = read('ui/shared/src/mui/' + filename)
    assert.match(body, /import \{ xDriveCoreDependencyErrorMessage \} from '\.\.\/core-dependency-error'/)
    for (const operation of ['refresh', 'save', 'rollback']) {
      assert.ok(body.includes(`xDriveCoreDependencyErrorMessage(err, '${kind}', '${operation}')`))
    }
    assert.doesNotMatch(body, /setError\(err instanceof Error \? err\.message/)
    assert.match(body, new RegExp('source\\.' + write + '\\(\\{ revision: config\\.revision, desired \\}\\)'))
    assert.match(body, /singlePage && isDraftDirty/)
    assert.match(body, /setHistoryLoading\(false\)/)
  }
})


test('system dependency inventory errors are actionable and never show raw transport details', () => {
  const safe = mapper()
  const sensitive = 'token=SECRET_DO_NOT_ECHO /etc/xdrive/db-url postgresql://pw:secret@db'
  for (const [status, expected] of [
    [401, '重新登录'], [403, '管理员'], [404, '管理接口'],
    [429, '超时或限流'], [503, '可信确认'],
  ]) {
    const text = safe({status, message: sensitive}, 'system', 'refresh')
    assert.match(text, new RegExp(expected))
    assert.ok(text.startsWith('系统依赖'))
    assert.doesNotMatch(text, /SECRET_DO_NOT_ECHO|\/etc\/xdrive|postgresql:\/\//)
  }
  const unknown = safe(new Error(sensitive), 'system', 'refresh')
  assert.match(unknown, /读取失败/)
  assert.doesNotMatch(unknown, /SECRET_DO_NOT_ECHO|\/etc\/xdrive/)
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  assert.match(page, /xDriveCoreDependencyErrorMessage\(err, 'system', 'refresh'\)/)
  assert.doesNotMatch(page, /setError\(err instanceof Error \? err\.message : '读取依赖状态失败'\)/)
  assert.match(page, /cachedSnapshotRef\.current = next/)
  assert.match(page, /setRefreshing\(true\)/)
  assert.match(page, /snapshot && visibleError/)
})

'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'desktop/src/renderer/DesktopFileExplorer.tsx')
const source = fs.readFileSync(filename, 'utf8')

function actualMessageHelper() {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration = null
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) &&
        statement.name?.text === 'desktopFileAvailabilityProbeMessage') declaration = statement
  }
  assert.ok(declaration, 'missing actual Desktop Agent error classifier')
  const code = ts.transpileModule(declaration.getText(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText
  return new Function(code + '\nreturn desktopFileAvailabilityProbeMessage')()
}

test('D01/D02 Agent availability errors distinguish outage, upgrade, ordinary read failure', () => {
  const label = actualMessageHelper()
  for (const code of ['agent_unavailable', 'invalid_discovery']) {
    assert.match(label(code), /Agent 不可用/)
  }
  for (const code of ['unsupported_capability', 'unsupported_ipc_version']) {
    assert.match(label(code), /Agent 不支持.*升级/)
  }
  for (const code of ['not_found', 'permission_denied', 'desktop_error', undefined]) {
    assert.match(label(code), /状态读取失败/)
    assert.match(label(code), /不表示文件已损坏/)
    assert.doesNotMatch(label(code), /ACL|403|已删除/)
  }
})

test('D02 failing batch discards stale CfAPI proof without changing Files navigation or forcing Agent restart', () => {
  const begin = source.indexOf('const requestID = ++availabilityRequestRef.current')
  const end = source.indexOf('const hydrationProgressByPath = useMemo(', begin)
  assert.ok(begin >= 0 && end > begin)
  const block = source.slice(begin, end)
  assert.match(block, /const rejectProbe = \(code\?: string\) => \{/)
  assert.match(block, /if \(cancelled \|\| requestID !== availabilityRequestRef.current\) return/)
  assert.match(block, /setAvailabilityByID\(new Map\(\)\)/)
  assert.match(block, /setAvailabilityReadFailure\(desktopFileAvailabilityProbeMessage\(code\)\)/)
  assert.match(block, /if \(!result.ok\) \{\s*rejectProbe\(result.error.code\)/)
  assert.match(block, /catch \{[\s\S]*rejectProbe\(\)/)
  assert.match(block, /setAvailabilityByID\(next\)\s*setAvailabilityReadFailure\(null\)/)
  assert.match(block, /return \(\) => \{\s*cancelled = true/)
  assert.match(source, /setAvailabilityReadFailure\(null\)\s*setNavigationAvailabilityItems\(\[\]\)/)
  assert.equal((source.match(/getFileAvailabilityBatch\(batchPaths\)/g) || []).length, 1,
    'no additional data transport or per-item polling')
  assert.doesNotMatch(block, /ensureRunning\(|setInterval\(|getTransfers\(/)
})

test('D01/D02 error is visible and actionable while preserving the existing task feedback slot', () => {
  assert.match(source, /data-xdrive-desktop-availability-probe-error/)
  assert.match(source, /role="status"\s*aria-live="polite"/)
  assert.match(source, /\{actionFeedback\}[\s\S]*data-xdrive-desktop-availability-probe-error/)
  assert.match(source, /onClick=\{\(\) => setAvailabilityRefreshToken\(\(value\) => value \+ 1\)\}/)
  assert.match(source, /重试状态查询/)
  assert.match(source, /\)\s*: actionFeedback\}\s*viewMode=\{viewMode\}/)
  assert.match(source, /getItemStatus=\{fileAvailabilitySupported \? getItemStatus : undefined\}/)
  assert.match(source, /getItemAvailability=\{fileAvailabilitySupported \? getItemAvailability : undefined\}/)
  assert.match(source, /onRefresh=\{trashActive \? \(\) => \{ void trash.refresh\(\) \} : refresh\}/)
  assert.doesNotMatch(source, /FileUnavailableIsCorrupt|guessPermissionFromFilename/)
})

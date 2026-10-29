'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const file = path.resolve(__dirname, '../../ui/shared/src/mui/DiagnosticsPage.tsx')
const source = fs.readFileSync(file, 'utf8')
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const method = ast.statements.find(node => ts.isFunctionDeclaration(node) &&
  node.name?.text === 'xDriveDiagnosticsSummaryPresentation')
assert.ok(method?.body, 'test must execute the REAL shared Diagnostics presentation')

const compiled = ts.transpileModule(method.getText(ast), {
  fileName: file,
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics || [])
  .filter(d => d.category === ts.DiagnosticCategory.Error)
  .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
const mod = { exports: {} }
new Function('module', 'exports', compiled.outputText)(mod, mod.exports)
const summary = mod.exports.xDriveDiagnosticsSummaryPresentation

test('DSM partial checks never claim a green system-wide pass', () => {
  const result = summary(2, 0, 0, 0, true)
  assert.equal(result.tone, 'neutral')
  assert.equal(result.label, '已检查')
  assert.equal(result.title, '已检查可用接口')
  assert.match(result.text, /2 项检查正常；其他系统能力未检测/)
  assert.match(result.emptyIssuesMessage, /其他系统能力未检测/)
})

test('no completed scoped check remains unknown, not green', () => {
  const result = summary(0, 0, 0, 0, true)
  assert.equal(result.tone, 'neutral')
  assert.equal(result.label, '未检查')
  assert.equal(result.title, '未完成健康检查')
  assert.match(result.text, /不能将未检查的能力视为正常/)
})

test('scoped warnings and failures keep their real risk level', () => {
  const warning = summary(2, 0, 1, 0, true)
  assert.equal(warning.tone, 'warning')
  assert.equal(warning.title, '已检查接口需要注意')
  const failure = summary(2, 1, 0, 1, true)
  assert.equal(failure.tone, 'bad')
  assert.equal(failure.label, '异常')
  assert.match(failure.text, /1 项异常/)
})

test('full Desktop diagnostic presentation retains its established semantics', () => {
  assert.equal(summary(5, 0, 0, 0, false).tone, 'good')
  assert.equal(summary(5, 0, 0, 0, false).title, '系统状态正常')
  assert.equal(summary(5, 1, 1, 0, false).title, '系统总体正常')
  assert.equal(summary(5, 0, 0, 2, false).tone, 'bad')
})

test('a completely empty full-scope report is never counted as healthy', () => {
  const result = summary(0, 0, 0, 0, false)
  assert.equal(result.tone, 'neutral')
  assert.equal(result.label, '未检查')
  assert.match(result.text, /不能将未检查的能力视为正常/)
})

test('informational-only checks are not counted as verified healthy', () => {
  const scoped = summary(2, 2, 0, 0, true)
  assert.equal(scoped.tone, 'neutral')
  assert.match(scoped.text, /0 项正常、2 项提示/)
  const full = summary(2, 2, 0, 0, false)
  assert.equal(full.tone, 'neutral')
  assert.equal(full.label, '仅提示')
  assert.match(full.text, /没有确认通过的项目/)
})

test('the actual shared UI uses the computed badge, summary and empty state', () => {
  assert.match(source, /const summary = xDriveDiagnosticsSummaryPresentation\(/)
  assert.match(source, /tone=\{summary\.tone\} label=\{summary\.label\}/)
  assert.match(source, /\{summary\.title\}/)
  assert.match(source, /\{summary\.text\}/)
  assert.match(source, /message=\{summary\.emptyIssuesMessage\}/)
  assert.doesNotMatch(source, /scopeNotice \? '正在检查' \: '系统状态正常'/)
})

'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const panels = [
  ['ui/shared/src/mui/PostgresPoolConfigPanel.tsx', 'PostgresPool'],
  ['ui/shared/src/mui/SourceWorkerConfigPanel.tsx', 'SourceWorker'],
]

for (const [file, name] of panels) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  const slice = (from, to) => {
    const start = source.indexOf('const ' + from + ' = async () => {')
    const end = source.indexOf('const ' + to + ' = async () => {', start + 1)
    assert.ok(start >= 0 && end > start, name + ' has separate ' + from + ' and ' + to)
    return source.slice(start, end)
  }
  test(name + ' superseded history GET cannot leave the loading indicator stuck', () => {
    const reload = slice('reload', 'save')
    const save = slice('save', 'rollback')
    const rollback = source.slice(source.indexOf('const rollback = async () => {'))
    assert.match(reload, /const epoch = \+\+epochRef\.current[\s\S]*?setHistoryLoading\(\(section === 'history' \|\| section === 'all'\)/)
    assert.match(reload, /if \(epoch === epochRef\.current\) \{\s*setLoading\(false\)\s*setHistoryLoading\(false\)/)
    for (const [action, section] of [['save', save], ['rollback', rollback]]) {
      assert.match(section, /const epoch = \+\+epochRef\.current\s*setBusy\(true\)\s*[\s\S]*?setHistoryLoading\(false\)/,
        action + ' must settle any invalidated older history request')
    }
    assert.match(source, /if \(active && epoch === epochRef\.current\) setHistoryLoading\(false\)/)
    assert.match(source, /\(singlePage && isDraftDirty\)/)
    assert.match(source, new RegExp('load' + name + 'Revisions\\(\\)'))
  })
  test(name + ' shared TSX remains parseable after loading-state fix', () => {
    const parsed = ts.transpileModule(source, {
      fileName: file, reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext },
    })
    assert.equal((parsed.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)
  })
}

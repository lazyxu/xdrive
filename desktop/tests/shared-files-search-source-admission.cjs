'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const file = 'ui/shared/src/file-explorer-search.ts'
const source = fs.readFileSync(path.join(root, file), 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: file, reportDiagnostics: true,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  },
})
assert.deepEqual((compiled.diagnostics || [])
  .filter(x => x.category === ts.DiagnosticCategory.Error)
  .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])
const mod = { exports: {} }
new Function('exports', 'module', compiled.outputText)(mod.exports, mod)
const project = mod.exports.xDriveFileExplorerProjectSearchSources

test('authenticated Source UI allows only exact positive ID and visible name', () => {
  const raw = [
    { id: 13, name: '家庭 NAS', token: 'PRIVATE', local_path: '/secret',
      password: 'SECRET', source_type: 'sftp', root_fingerprint: 'SHA' },
    { id: 21, name: 'Photo Files', credential: 'SECRET' },
  ]
  const projected = project(raw)
  assert.deepEqual(projected, [
    { id: 13, name: '家庭 NAS' }, { id: 21, name: 'Photo Files' },
  ])
  assert.notStrictEqual(projected[0], raw[0])
  assert.equal(raw[0].local_path, '/secret',
    'the read-only projection must never mutate authenticated Host rows')
  assert.doesNotMatch(JSON.stringify(projected), /secret|PRIVATE|token|password|root_fingerprint/i)
  assert.deepEqual(project([]), [], 'a genuinely empty authorized Sources read remains empty')
})

test('malformed or ambiguous Source identities fail the entire read, never ready empty', () => {
  const valid = { id: 13, name: '合法来源' }
  const invalid = [
    // [] is a legitimate verified empty list, tested above.
    null, undefined, 'not-an-array', { items: [] },
    [{ ...valid, id: 0 }],
    [{ ...valid, id: -1 }],
    [{ ...valid, id: '13' }],
    [{ ...valid, id: 1.5 }],
    [{ ...valid, id: Number.MAX_SAFE_INTEGER + 1 }],
    [{ ...valid, name: '' }],
    [{ ...valid, name: '  ' }],
    [{ ...valid, name: 13 }],
    [{ ...valid, name: 'source\nforged' }],
    [{ ...valid, name: 'source\rforged' }],
    [{ ...valid, name: 'a'.repeat(513) }],
    [valid, { ...valid, name: 'duplicate same Source ID' }],
    [valid, null],
  ]
  for (const row of invalid) {
    assert.throws(() => project(row),
      error => error.message === 'Invalid authenticated Files search sources',
      'source admission must not echo untrusted paths, names, credentials or raw errors')
  }
})

test('real Web and Desktop Files both execute the same admission and handle Host errors', () => {
  const desktop = fs.readFileSync(path.join(root, 'desktop/src/renderer/DesktopFileExplorer.tsx'), 'utf8')
  const web = fs.readFileSync(path.join(root, 'web/src/WebFileExplorer.tsx'), 'utf8')
  const hook = fs.readFileSync(path.join(root, 'ui/shared/src/mui/FileExplorerOwnerSourceOptions.ts'), 'utf8')
  assert.match(desktop, /xDriveFileExplorerProjectSearchSources\(result\.data\)/)
  assert.match(web, /xDriveFileExplorerProjectSearchSources\(await api\.sources\(\)\)/)
  assert.match(desktop, /onError: error => onError\(error instanceof Error/)
  assert.match(hook, /status: 'error', options: EMPTY_SOURCE_OPTIONS/)
  assert.match(hook, /if \(!active \|\| !isCurrent\(\)\) return/)
  assert.doesNotMatch(source, /window\.xdriveDesktop|ipcRenderer|fetch\s*\(|backup\.cgi/)
})

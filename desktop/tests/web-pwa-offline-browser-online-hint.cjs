const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'web/src/PwaOfflineDirectoryBrowser.tsx'), 'utf8')
// Evaluate the real production helper from the TSX AST, not a test copy.
const ast = ts.createSourceFile('PwaOfflineDirectoryBrowser.tsx', source,
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const fn = ast.statements.find(item => ts.isFunctionDeclaration(item) &&
  item.name?.text === 'xDrivePwaHistoricalOnlineHint')
assert.ok(fn, 'missing real protected offline-history capability probe')
const js = ts.transpileModule(fn.getText(ast) +
  '\nexports.readOnline = xDrivePwaHistoricalOnlineHint;', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function actualHint(navigator) {
  const output = {}
  new Function('exports', 'navigator', js)(output, navigator)
  return output.readOnline()
}

test('iOS PWA offline-history startup accepts a supported true/false online hint', () => {
  assert.equal(actualHint({ onLine: true }), true)
  assert.equal(actualHint({ onLine: false }), false)
})

test('iOS PWA denied navigator.onLine getter does not crash the historical viewer', () => {
  const restricted = {}
  Object.defineProperty(restricted, 'onLine', {
    get() { throw new Error('SecurityError: navigator.onLine denied') },
  })
  assert.doesNotThrow(() => actualHint(restricted))
  assert.equal(actualHint(restricted), false, 'unknown is not an authenticated online proof')
  assert.equal(actualHint(undefined), false)
  assert.equal(actualHint({ onLine: undefined }), false)
  assert.equal(actualHint({ onLine: 'online' }), false)
})

test('actual offline-history component uses guarded initial state and live events', () => {
  assert.match(source, /useState\(xDrivePwaHistoricalOnlineHint\)/)
  assert.doesNotMatch(source, /useState\(\(\) => navigator\.onLine\)/)
  assert.match(source, /window\.addEventListener\('online', markOnline\)/)
  assert.match(source, /window\.addEventListener\('offline', markOffline\)/)
  assert.match(source, /if \(!online \|\| !owner \|\| !selected \|\| !hasSession\) return/)
  assert.match(source, /xDrivePwaVerifiedIdentityMatches\(owner, me\)/)
  assert.match(source, /await api\.listRange\(selected\.id, 0, 1,/)
  assert.match(source, /xDrivePwaObserveOfflinePurge\(reset\)/)
  assert.doesNotMatch(source, /skipWaiting\s*\(|localStorage\.(?:setItem|getItem)|xdrive_refresh/)
})

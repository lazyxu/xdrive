'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const file = 'ui/shared/src/mui/CoreDependencyDetail.tsx'
const source = fs.readFileSync(path.join(root, file), 'utf8')
const effectStart = source.indexOf("  useEffect(() => {\n    if (activeTab === 'status')")
const effectEnd = source.indexOf('  }, [activeTab, service.id, editorBusy])', effectStart)
const effect = source.slice(effectStart, effectEnd)

test('core dependency deep link scrolls once, not after every Save/rollback busy transition', () => {
  assert.ok(effectStart >= 0 && effectEnd > effectStart)
  assert.match(source, /const lastScrolledAnchorRef = useRef<string \| null>\(null\)/)
  assert.match(effect, /const anchorKey = `\$\{service\.id\}:\$\{activeTab\}`/)
  const guard = effect.indexOf('if (lastScrolledAnchorRef.current === anchorKey) return')
  const scroll = effect.indexOf("target.scrollIntoView({ block: 'start', behavior: 'auto' })")
  assert.ok(guard >= 0 && scroll > guard, 'the one-time key must guard scrolling')
  assert.equal((effect.match(/scrollIntoView\(/g) || []).length, 1)
  assert.doesNotMatch(effect, /\?\.scrollIntoView/)
})

test('deferred history header can still scroll after initial config loading settles', () => {
  assert.match(effect, /if \(activeTab === 'status'\) \{\s*lastScrolledAnchorRef\.current = null/)
  assert.match(effect, /activeTab === 'verify' \? 'verify'/)
  assert.match(effect, /activeTab === 'config' \? 'config' : 'history'/)
  const lookup = effect.indexOf('const target = document.getElementById(')
  const missing = effect.indexOf('if (!target) return')
  const claimed = effect.indexOf('lastScrolledAnchorRef.current = anchorKey')
  assert.ok(lookup >= 0 && missing > lookup && claimed > missing,
    'missing history anchor must not be marked as already scrolled')
  assert.match(source, /\}, \[activeTab, service\.id, editorBusy\]\)/)
})

test('shared TSX remains parseable for Web/Mobile/Desktop', () => {
  const result = ts.transpileModule(source, {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext },
  })
  const diagnostics = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
  assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; '))
})

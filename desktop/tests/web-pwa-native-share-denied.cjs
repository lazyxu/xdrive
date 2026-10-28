'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'ui/shared/src/mui/NativeShareCapability.ts')
const source = fs.readFileSync(filename, 'utf8')
const code = ts.transpileModule(source, {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function detectIn(navigator) {
  const mod = { exports: {} }
  // Inject only browser capability observations; no share operation or API request.
  new Function('module', 'exports', 'navigator', code)(mod, mod.exports, navigator)
  return mod.exports.xDriveCanUseNativeShare
}

test('missing, incomplete and available native share capabilities use real observed APIs', () => {
  const absent = detectIn(undefined)
  assert.equal(absent('link'), false)
  assert.equal(absent('file'), false)
  const none = detectIn({})
  assert.equal(none('link'), false)
  assert.equal(none('file'), false)
  const linkOnly = detectIn({ share: () => Promise.resolve() })
  assert.equal(linkOnly('link'), true)
  assert.equal(linkOnly('file'), false)
  const files = detectIn({ share: () => Promise.resolve(), canShare: () => true })
  assert.equal(files('link'), true)
  assert.equal(files('file'), true)
})

test('Safari-denied optional navigator.share getter never prevents Files or ShareDialog render', () => {
  const nav = {}
  let reads = 0
  Object.defineProperty(nav, 'share', {
    get() { reads++; throw new Error('WebKit SecurityError: share getter denied') },
  })
  const detect = detectIn(nav)
  assert.doesNotThrow(() => detect('link'))
  assert.doesNotThrow(() => detect('file'))
  assert.equal(detect('link'), false)
  assert.equal(detect('file'), false)
  assert.ok(reads >= 4, 'denied capability was genuinely read, not guessed from UA')
})

test('denied canShare getter still permits ordinary link sharing but never offers file sharing', () => {
  const nav = { share: () => Promise.resolve() }
  Object.defineProperty(nav, 'canShare', {
    get() { throw new Error('WebKit SecurityError: canShare getter denied') },
  })
  const detect = detectIn(nav)
  assert.equal(detect('link'), true)
  assert.doesNotThrow(() => detect('file'))
  assert.equal(detect('file'), false)
})

test('both shared link dialog and mobile authenticated file sharing use the fail-closed detector', () => {
  const shareDialog = fs.readFileSync(path.join(root, 'ui/shared/src/mui/ShareDialog.tsx'), 'utf8')
  const mobileFiles = fs.readFileSync(path.join(root, 'web/src/MobileFiles.tsx'), 'utf8')
  assert.match(shareDialog, /compactTouch && xDriveCanUseNativeShare\('link'\)/)
  assert.match(mobileFiles, /props\.onPrepareNativeShareFile && xDriveCanUseNativeShare\('file'\)/)
  assert.match(mobileFiles, /navigator\.canShare\(\{ files: \[file\] \}\)/,
    'the prepared file still needs a true per-file canShare check')
  assert.match(mobileFiles, /navigator\.share\(\{ title: nativeShare\.file\.name, files: \[nativeShare\.file\] \}\)/,
    'the real user-click share operation must not be replaced by detection')
  assert.doesNotMatch(source, /userAgent|platform|localStorage|sessionStorage|fetch\(/)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'web/src/webStartupSearchParams.ts'), 'utf8')
const main = fs.readFileSync(path.join(root, 'web/src/main.tsx'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function read(variant) {
  const exported = {}
  const sandbox = { exports: exported, URLSearchParams }
  if (variant !== 'absent-window') {
    if (variant === 'denied-window') {
      Object.defineProperty(sandbox, 'window', {
        get() { throw new Error('window getter denied') },
      })
    } else {
      const win = {}
      if (variant === 'denied-location') {
        Object.defineProperty(win, 'location', {
          get() { throw new Error('location getter denied') },
        })
      } else {
        const location = {}
        if (variant === 'denied-search') {
          Object.defineProperty(location, 'search', {
            get() { throw new Error('search getter denied') },
          })
        } else if (variant === 'nonstr') {
          Object.defineProperty(location, 'search', {
            value: { toString() { throw new Error('unsafe coercion') } },
          })
        } else {
          location.search = variant
        }
        win.location = location
      }
      sandbox.window = win
    }
  }
  vm.runInNewContext(compiled, sandbox)
  return sandbox.exports.xDriveWebStartupSearchParams()
}

test('Web entry uses guarded hint and never directly evaluates location.search', () => {
  assert.match(main, /import\s*\{\s*xDriveWebStartupSearchParams\s*\}\s*from\s*['"]\.\/webStartupSearchParams['"]/) 
  assert.match(main, /const perfSearch = xDriveWebStartupSearchParams\(\)/)
  assert.doesNotMatch(main, /new URLSearchParams\(window\.location\.search\)/)
  assert.match(main, /VITE_XDRIVE_FILE_EXPLORER_PERF === '1'/)
  assert.match(main, /VITE_XDRIVE_GALLERY_PERF === '1'/)
})

test('Safari restricted Window or Location getter yields no performance entry', () => {
  for (const variant of ['absent-window', 'denied-window', 'denied-location', 'denied-search', 'nonstr']) {
    const result = read(variant)
    assert.equal(result.toString(), '', variant)
    assert.equal(result.get('xdriveGalleryPerf'), null, variant)
  }
})

test('normal browser query retains existing diagnostic harness routing parameters', () => {
  const result = read('?xdriveGalleryPerf=gallery&xdriveFileExplorerPerf=scroll&xdriveLargeTransferSample=synthetic')
  assert.equal(result.get('xdriveGalleryPerf'), 'gallery')
  assert.equal(result.get('xdriveFileExplorerPerf'), 'scroll')
  assert.equal(result.get('xdriveLargeTransferSample'), 'synthetic')
})

test('a plain search remains a read-only UI hint without network, credentials or caching', () => {
  const result = read('?xdriveGalleryPerf=abc')
  assert.equal(result.get('xdriveGalleryPerf'), 'abc')
  assert.doesNotMatch(source, /fetch\(|document\.cookie|localStorage|sessionStorage|serviceWorker|Authorization/)
})

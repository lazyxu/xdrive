const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const repoRoot = path.join(__dirname, '..', '..')
const webSource = fs.readFileSync(path.join(repoRoot, 'web/src/WebFileExplorer.tsx'), 'utf8')
function compile(relative) {
  const filename = path.join(repoRoot, relative)
  return ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
}
const keyboard = { exports: {} }
new Function('module', 'exports', compile('ui/shared/src/file-explorer-keyboard.ts'))(
  keyboard, keyboard.exports,
)
const helperJS = compile('web/src/webFilesKeyboardProfile.ts')
function profileFrom(navigatorObject, deniedGlobal = false) {
  const module = { exports: {} }
  const context = vm.createContext({
    module, exports: module.exports,
    require: name => {
      assert.equal(name, '../../ui/shared/src/file-explorer-keyboard')
      return keyboard.exports
    },
  })
  if (deniedGlobal) {
    Object.defineProperty(context, 'navigator', {
      configurable: true,
      get() { throw new Error('navigator denied') },
    })
  } else if (navigatorObject !== undefined) {
    Object.defineProperty(context, 'navigator', {
      configurable: true, value: navigatorObject,
    })
  }
  vm.runInContext(helperJS, context)
  return module.exports.xDriveWebFilesKeyboardProfile()
}

// The full Web Explorer is imported before React renders any Files page. Its
// module-level keyboard hint must be guarded rather than accessing Safari's
// optional navigator properties directly during module initialization.
test('Web FileExplorer module startup uses the guarded keyboard hint', () => {
  assert.match(webSource, /import\s*\{\s*xDriveWebFilesKeyboardProfile\s*\}\s*from\s*['"]\.\/webFilesKeyboardProfile['"]/)
  assert.match(webSource, /const FILE_KEYBOARD_PROFILE = xDriveWebFilesKeyboardProfile\(\)/)
  assert.doesNotMatch(webSource, /navigator\.(?:platform|userAgent)/)
})

test('Safari blocked or absent navigator cannot crash Files module startup', () => {
  assert.equal(profileFrom(undefined), 'web')
  assert.equal(profileFrom(undefined, true), 'web')
  assert.equal(profileFrom({
    get platform() { throw new Error('platform denied') },
    get userAgent() { throw new Error('UA denied') },
  }), 'web')
})

test('Safari independent denied getters preserve the still available shortcut hint', () => {
  let platformReads = 0
  let uaReads = 0
  assert.equal(profileFrom({
    get platform() { platformReads++; throw new Error('platform denied') },
    get userAgent() { uaReads++; return 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0)' },
  }), 'macos')
  assert.equal(platformReads, 1)
  assert.equal(uaReads, 1)
  assert.equal(profileFrom({
    platform: 'Win32',
    get userAgent() { throw new Error('UA denied') },
  }), 'windows')
})

test('Non-string hints fail closed; normal Web/Mac/Windows shortcuts stay intact', () => {
  assert.equal(profileFrom({ platform: { toString() { throw Error('coercion') } }, userAgent: 42 }), 'web')
  assert.equal(profileFrom({ platform: 'MacIntel', userAgent: '' }), 'macos')
  assert.equal(profileFrom({ platform: 'Win32', userAgent: 'Mozilla/5.0' }), 'windows')
  assert.equal(profileFrom({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0' }), 'web')
})

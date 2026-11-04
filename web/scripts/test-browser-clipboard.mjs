import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

const here = dirname(fileURLToPath(import.meta.url))
const code = readFileSync(resolve(here, '../src/browserClipboard.ts'), 'utf8')
const built = ts.transpileModule(code, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
})
assert.equal(built.diagnostics?.length ?? 0, 0)
const { xDriveBrowserCopyText } = await import('data:text/javascript;base64,' +
  Buffer.from(built.outputText).toString('base64'))

const original = new Map(['navigator', 'document', 'HTMLElement'].map(key =>
  [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
const setGlobal = (key, value) => Object.defineProperty(globalThis, key, {
  configurable: true, writable: true, value,
})
function fakeDocument(copyResult = true) {
  const state = { appended: false, removed: false, selected: false, focused: false, text: '' }
  class Focusable {
    isConnected = true
    focus(options) { state.restored = options }
  }
  const priorFocus = new Focusable()
  const doc = {
    activeElement: priorFocus,
    body: { appendChild(node) { state.appended = true; state.text = node.value } },
    createElement(tag) {
      assert.equal(tag, 'textarea')
      return {
        value: '', readOnly: false, style: {},
        setAttribute(name, value) { state[name] = value },
        focus() { state.focused = true },
        select() { state.selected = true },
        setSelectionRange(start, end) { state.range = [start, end] },
        remove() { state.removed = true },
      }
    },
    execCommand(command) {
      assert.equal(command, 'copy')
      assert.ok(state.appended && state.focused && state.selected)
      return copyResult
    },
  }
  return { doc, state, Focusable }
}
try {
  const plain = fakeDocument()
  setGlobal('document', plain.doc)
  setGlobal('HTMLElement', plain.Focusable)
  const nativeCalls = []
  setGlobal('navigator', { clipboard: { async writeText(value) { nativeCalls.push(value) } } })
  await xDriveBrowserCopyText('/共享/2026/日志.txt')
  assert.deepEqual(nativeCalls, ['/共享/2026/日志.txt'])
  assert.equal(plain.state.appended, false, 'secure contexts must use native clipboard')

  // HTTP LAN host: navigator.clipboard is missing, but synchronous selection
  // still works inside a user-initiated context menu event.
  const lan = fakeDocument()
  setGlobal('navigator', {})
  setGlobal('document', lan.doc)
  setGlobal('HTMLElement', lan.Focusable)
  await xDriveBrowserCopyText('/相册/1.jpg\n/我的文件/2.txt')
  assert.equal(lan.state.text, '/相册/1.jpg\n/我的文件/2.txt')
  assert.equal(lan.state.removed, true)
  assert.deepEqual(lan.state.range, [0, '/相册/1.jpg\n/我的文件/2.txt'.length])
  assert.deepEqual(lan.state.restored, { preventScroll: true })
  assert.equal(lan.state['aria-hidden'], 'true')

  // A rejected Promise must not claim success; retry the browser selection path.
  const denied = fakeDocument()
  setGlobal('document', denied.doc)
  setGlobal('HTMLElement', denied.Focusable)
  setGlobal('navigator', { clipboard: { writeText: async () => { throw new Error('NotAllowedError') } } })
  await xDriveBrowserCopyText('readme.md')
  assert.equal(denied.state.text, 'readme.md')
  assert.equal(denied.state.removed, true)

  // Restricted clipboard getters are treated like an unavailable API.
  const restricted = fakeDocument()
  setGlobal('document', restricted.doc)
  setGlobal('HTMLElement', restricted.Focusable)
  setGlobal('navigator', { get clipboard() { throw new Error('SecurityError') } })
  await xDriveBrowserCopyText('safe')
  assert.equal(restricted.state.text, 'safe')

  const blocked = fakeDocument(false)
  setGlobal('document', blocked.doc)
  setGlobal('HTMLElement', blocked.Focusable)
  setGlobal('navigator', {})
  await assert.rejects(xDriveBrowserCopyText('not copied'), /当前浏览器无法写入剪贴板/)
  assert.equal(blocked.state.removed, true, 'failure must remove transient textarea')

  setGlobal('document', undefined)
  await assert.rejects(xDriveBrowserCopyText('no DOM'), /当前浏览器无法写入剪贴板/)

  const files = readFileSync(resolve(here, '../src/WebFileExplorer.tsx'), 'utf8')
  assert.match(files, /xDriveBrowserCopyText\(text\)/)
  assert.doesNotMatch(files, /navigator\.clipboard\.writeText/, 'copy-path must use guarded helper')
  console.log('Web Files Copy Path: secure clipboard, HTTP LAN fallback, failures and cleanup passed')
} finally {
  for (const [key, descriptor] of original) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
}

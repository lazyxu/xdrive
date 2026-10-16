const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')
const { act } = Renderer

const root = path.join(__dirname, '..', '..')
const filename = path.join(root, 'ui/shared/src/mui/FileNameDialog.tsx')
const source = fs.readFileSync(filename, 'utf8')
function actualDialog() {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText
  const material = new Proxy({}, { get: (_, name) => String(name) })
  const module = { exports: {} }
  new Function('module', 'exports', 'require', output)(module, module.exports, name => {
    if (name === 'react') return React
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime')
    if (name === '@mui/material') return material
    if (name === './ActionButton') return { XDriveActionButton: 'ActionButton' }
    if (name === './DialogContent') return { XDriveDialogContent: 'DialogContent' }
    if (name === './DialogTitle') return {
      XDriveDialogTitle: 'DialogTitle', xDriveDialogPaperProps: { sx: {} },
    }
    throw new Error('Unexpected rename dialog import: ' + name)
  })
  return module.exports.XDriveFileNameDialog
}

const Dialog = actualDialog()
async function mounted(action, overrides = {}) {
  let renderer
  let props = {
    open: true,
    mode: 'rename',
    initialValue: '原名.txt',
    lifecycleKey: 'account-A:folder-1',
    onSubmit: async () => {},
    onClose: () => {},
    ...overrides,
  }
  try {
    await act(async () => { renderer = Renderer.create(React.createElement(Dialog, props)) })
    const input = () => renderer.root.findAll(n => n.type === 'TextField' && n.props.label === '名称')[0]
    const form = () => renderer.root.findAll(n => n.type === 'Box' && n.props.component === 'form')[0]
    assert.ok(input(), 'shared actual dialog has input')
    assert.ok(form(), 'shared actual dialog has the existing single submit form')
    await action({
      input, form,
      async change(value) {
        await act(async () => { input().props.onChange({ target: { value } }) })
      },
      async submit() {
        await act(async () => {
          form().props.onSubmit({ preventDefault() {} })
          await Promise.resolve()
          await Promise.resolve()
        })
      },
      async update(next) {
        props = { ...props, ...next }
        await act(async () => { renderer.update(React.createElement(Dialog, props)) })
      },
    })
  } finally {
    if (renderer) await act(async () => { renderer.unmount() })
  }
}

test('U05: shared mobile FileNameDialog retains draft and restores focus after 403 then 409', async () => {
  const requests = [], errors = [], closes = [], focuses = []
  await mounted(async h => {
    h.input().props.inputRef.current = { focus: () => focuses.push('input') }
    await h.change('待审查.txt')
    await h.submit()
    assert.equal(h.input().props.value, '待审查.txt')
    assert.equal(h.input().props.disabled, false)
    assert.match(h.input().props.helperText, /403/)
    assert.equal(focuses.length, 1, '403 should return keyboard focus to editable draft')
    await h.submit()
    assert.equal(h.input().props.value, '待审查.txt')
    assert.match(h.input().props.helperText, /409/)
    assert.equal(focuses.length, 2, '409 must return focus without selecting another Node')
    await h.change('新名称.txt')
    assert.equal(h.input().props.error, false, 'editing clears old denial without resetting draft')
    await h.submit()
    assert.deepEqual(requests, ['待审查.txt', '待审查.txt', '新名称.txt'])
    assert.deepEqual(errors, ['403 forbidden', '409 conflict'])
    assert.equal(closes.length, 1, 'only successful Server confirmation can close')
  }, { onSubmit: async name => {
    requests.push(name)
    if (requests.length === 1) throw new Error('403 forbidden')
    if (requests.length === 2) throw new Error('409 conflict')
  }, onError: e => errors.push(e.message), onClose: () => closes.push(true) })
})

test('U05: 255 UTF-8-byte rejection focuses draft without sending a request', async () => {
  let sends = 0, focuses = 0
  await mounted(async h => {
    h.input().props.inputRef.current = { focus: () => { focuses += 1 } }
    await h.change('相'.repeat(86))
    await h.submit()
    assert.equal(h.input().props.value, '相'.repeat(86))
    assert.match(h.input().props.helperText, /255.*UTF-8/)
    assert.equal(h.input().props.disabled, false)
    assert.equal(focuses, 1)
    assert.equal(sends, 0)
  }, { onSubmit: async () => { sends += 1 } })
})

test('U05: foreign account denial cannot refocus or reopen the old dialog', async () => {
  let rejectOld, focusCount = 0, errors = 0, closes = 0
  const oldRequest = new Promise((_, reject) => { rejectOld = reject })
  await mounted(async h => {
    h.input().props.inputRef.current = { focus: () => { focusCount += 1 } }
    await h.change('account-A.txt')
    await act(async () => {
      h.form().props.onSubmit({ preventDefault() {} })
      await Promise.resolve()
    })
    assert.equal(h.input().props.disabled, true)
    await h.update({ lifecycleKey: 'account-B:folder-1', open: false })
    await act(async () => { rejectOld(new Error('old account 403')); await Promise.resolve() })
    assert.equal(focusCount, 0)
    assert.equal(errors, 0)
    assert.equal(closes, 0)
  }, { onSubmit: async () => { await oldRequest },
    onError: () => { errors += 1 }, onClose: () => { closes += 1 } })
})

test('U05 focus repair does not change the shared Server name validation or Desktop inline owner', () => {
  assert(source.includes('if (open && !submitting && error) inputRef.current?.focus()'))
  assert(source.includes('inputRef={inputRef}'))
  assert(source.includes('const maxBytes = mode === \'saved-search\' ? 128 : 255'))
  assert(source.includes('await onSubmit(normalized)'))
  const sharedExplorer = fs.readFileSync(path.join(root,'ui/shared/src/mui/FileExplorer.tsx'),'utf8')
  assert(sharedExplorer.includes('renameInputRef.current?.focus()'),
    'Wide Web/Desktop continue using their existing inline ref and error focus')
})

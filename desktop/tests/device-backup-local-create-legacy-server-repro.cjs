'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const React = require('react')
const Renderer = require('react-test-renderer')
const ts = require('typescript')

const sourceFile = path.resolve(__dirname, '../../ui/shared/src/mui/DeviceBackupLocalCreateDialog.tsx')
const source = fs.readFileSync(sourceFile, 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: sourceFile,
  reportDiagnostics: true,
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
})
assert.deepEqual((compiled.diagnostics || [])
  .filter(item => item.category === ts.DiagnosticCategory.Error)
  .map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')), [])

const mui = Object.fromEntries([
  'Alert', 'Button', 'Dialog', 'DialogActions', 'DialogContent', 'DialogTitle',
  'Stack', 'TextField', 'Typography',
].map(name => [name, ({ children, ...props }) => React.createElement(name, props, children)]))
const moduleRef = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  moduleRef,
  moduleRef.exports,
  request => {
    if (request === 'react') return React
    if (request === 'react/jsx-runtime') return require('react/jsx-runtime')
    if (request === '@mui/material') return mui
    throw new Error('Unexpected local backup dialog test dependency: ' + request)
  },
)
const Dialog = moduleRef.exports.XDriveDeviceBackupLocalCreateDialog
assert.equal(typeof Dialog, 'function')

async function act(fn = () => {}) {
  await Renderer.act(async () => {
    fn()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function mount(actions) {
  const notices = []
  let closed = 0
  let renderer
  await act(() => {
    renderer = Renderer.create(React.createElement(Dialog, {
      open: true,
      actions,
      onClose: () => { closed++ },
      onFinished: message => { notices.push(message) },
    }))
  })
  return {
    renderer,
    notices,
    get closed() { return closed },
    async typeName(name) {
      const fields = renderer.root.findAllByType('TextField')
      const field = fields.find(item => item.props.label === '同步文件夹名称')
      assert.ok(field, 'actual local folder name field must be mounted')
      await act(() => field.props.onChange({ target: { value: name } }))
    },
    async clickCreate() {
      const button = renderer.root.findAllByType('Button')
        .find(item => item.props.children === '创建并选择本机目录')
      assert.ok(button, 'actual submit action must be mounted')
      await act(() => button.props.onClick())
    },
    snapshot: () => JSON.stringify(renderer.toJSON()),
    unmount: () => act(() => renderer.unmount()),
  }
}

test('Reproduce reported 下载 create error: legacy Server denial never opens native Root picker', async () => {
  const calls = []
  const actions = {
    create: async (name, targetNodeID) => {
      calls.push({ action: 'create', name, targetNodeID })
      throw new Error('xdrive API: Valid Source configuration is required. (400)')
    },
    authorize: async id => {
      calls.push({ action: 'authorize', id })
      return { cancelled: false }
    },
    discard: async (id, revision) => {
      calls.push({ action: 'discard', id, revision })
    },
  }
  const ui = await mount(actions)
  try {
    await ui.typeName('下载')
    await ui.clickCreate()
    assert.deepEqual(calls, [{ action: 'create', name: '下载', targetNodeID: 0 }])
    assert.equal(ui.closed, 0)
    assert.deepEqual(ui.notices, [])
    const message = ui.snapshot()
    assert.match(message, /本机备份草稿创建失败/)
    assert.match(message, /Server 拒绝当前本机 Push 来源配置/)
    assert.match(message, /Valid Source configuration is required/)
    assert.match(message, /本机待完成授权/)
    assert.match(message, /不能通过手选普通云端目录绕过/)
    await act()
    assert.equal(calls.length, 1, 'must not retry with a user-picked target or silently authorize')
  } finally {
    await ui.unmount()
  }
})

test('Compatible managed Source acknowledgement proceeds to separate local Root permission', async () => {
  const calls = []
  const ui = await mount({
    create: async (name, targetNodeID) => {
      calls.push({ action: 'create', name, targetNodeID })
      return { id: 42, revision: 1 }
    },
    authorize: async id => {
      calls.push({ action: 'authorize', id })
      return { cancelled: false }
    },
    discard: async id => {
      calls.push({ action: 'discard', id })
    },
  })
  try {
    await ui.typeName('下载')
    await ui.clickCreate()
    assert.deepEqual(calls, [
      { action: 'create', name: '下载', targetNodeID: 0 },
      { action: 'authorize', id: 42 },
    ])
    assert.equal(ui.closed, 1)
    assert.equal(ui.notices.length, 1)
    assert.match(ui.notices[0], /本机目录已授权/)
    assert.doesNotMatch(ui.snapshot(), /本机备份草稿创建失败/)
  } finally {
    await ui.unmount()
  }
})

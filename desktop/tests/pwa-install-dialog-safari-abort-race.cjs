'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')

const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'web/src/PwaInstallDialog.tsx')
const source = fs.readFileSync(filename, 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
})
assert.deepEqual((compiled.diagnostics || [])
  .filter(d => d.category === ts.DiagnosticCategory.Error)
  .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function harness({ deniedConstructor = false, abortThrows = false, denialAfterRead = false } = {}) {
  const waiting = deferred()
  let checked = 0, aborted = 0
  const snap = Object.freeze({
    displayMode: 'browser', platformHint: 'ios',
    secureContext: true, serviceWorkerSupported: true,
    promptAvailable: false, installedEventObserved: false,
    lastPromptOutcome: null,
  })
  class Controller {
    constructor() {
      if (deniedConstructor) throw new Error('Safari denied AbortController')
      let reads = 0
      this.signal = {
        get aborted() {
          reads++
          if (denialAfterRead && reads > 1) throw new Error('Safari denied signal getter')
          return false
        },
      }
    }
    abort() {
      aborted++
      if (abortThrows) throw new Error('Safari denied controller.abort()')
    }
  }
  const mui = {}
  for (const name of [
    'Alert', 'Box', 'Button', 'Dialog', 'DialogActions', 'DialogContent',
    'DialogTitle', 'Divider', 'Stack', 'TextField', 'Typography',
  ]) mui[name] = props => React.createElement('test-' + name, props, props.children)
  mui.useMediaQuery = () => false
  const mocks = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    '@mui/material': mui,
    './pwaInstall': {
      checkXDrivePwaAssets: () => { checked++; return waiting.promise },
      requestXDrivePwaInstall: async () => 'unavailable',
      subscribeXDrivePwaInstall: () => () => {},
      xDrivePwaInstallSnapshot: () => snap,
    },
    './PwaUpdateSection': { __esModule: true, default: () => null },
    './pwaDeviceEvidence': { collectXDrivePwaS5DeviceEvidence: async () => ({}) },
  }
  const exports = { exports: {} }
  new Function('module', 'exports', 'require', 'AbortController', compiled.outputText)(
    exports, exports.exports,
    name => {
      assert.ok(Object.hasOwn(mocks, name), 'unexpected component dependency: ' + name)
      return mocks[name]
    }, Controller,
  )
  const Dialog = exports.exports.default
  let view
  const render = async open => {
    await act(async () => {
      const element = React.createElement(Dialog, { open, onClose: () => {} })
      if (view) view.update(element)
      else view = create(element)
    })
  }
  const click = async () => {
    await act(async () => {
      const button = view.root.findByProps({ 'data-xdrive-pwa-check': true })
      button.props.onClick()
    })
  }
  const json = () => JSON.stringify(view.toJSON())
  const action = () => view.root.findByProps({ 'data-xdrive-pwa-check': true })
  return {
    waiting, render, click, json, action,
    get checked() { return checked }, get aborted() { return aborted },
  }
}

test('denied controller constructor never begins a public resource HEAD', async () => {
  const h = harness({ deniedConstructor: true })
  await h.render(true)
  await h.click()
  assert.equal(h.checked, 0)
  assert.match(h.json(), /未开始公开资源检测/)
  assert.equal(h.action().props.disabled, false, 'dialog cannot strand busy state')
})

test('a denied AbortController.abort during dialog close cannot surface stale results after reopen', async () => {
  const h = harness({ abortThrows: true })
  await h.render(true)
  await h.click()
  assert.equal(h.checked, 1)
  await h.render(false)
  assert.ok(h.aborted >= 1)
  await h.render(true)
  await act(async () => {
    h.waiting.resolve([{ id: 'manifest', label: 'OLD', detail: 'STALE', state: 'pass' }])
    await h.waiting.promise
  })
  assert.doesNotMatch(h.json(), /STALE/)
  assert.equal(h.action().props.disabled, false)
})

test('a rejected asset check reports failure without leaving a hanging spinner', async () => {
  const h = harness()
  await h.render(true)
  await h.click()
  await act(async () => {
    h.waiting.reject(new Error('restricted fetch adapter'))
    await h.waiting.promise.catch(() => {})
  })
  assert.match(h.json(), /本次公开资源检测失败/)
  assert.equal(h.action().props.disabled, false)
})

test('denied signal getter after admission cannot promote the response to success', async () => {
  const h = harness({ denialAfterRead: true })
  await h.render(true)
  await h.click()
  await act(async () => {
    h.waiting.resolve([{ id: 'manifest', label: 'FORBIDDEN', detail: 'BAD', state: 'pass' }])
    await h.waiting.promise
  })
  assert.match(h.json(), /无法读取检测取消状态/)
  assert.doesNotMatch(h.json(), /FORBIDDEN|BAD/)
})

test('normal diagnostics still render the exact already-observed public results', async () => {
  const h = harness()
  await h.render(true)
  await h.click()
  await act(async () => {
    h.waiting.resolve([{ id: 'manifest', label: 'Manifest', detail: 'MIME OK', state: 'pass' }])
    await h.waiting.promise
  })
  assert.equal(h.checked, 1)
  assert.match(h.json(), /MIME OK/)
  assert.equal(h.action().props.disabled, false)
})

test('source does not force SW activation or cache private User files', () => {
  assert.doesNotMatch(source, /skipWaiting\s*\(|caches\.open\s*\(|Authorization/)
  assert.ok(source.includes('inspectionGeneration.current'))
})

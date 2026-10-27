const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const TestRenderer = require('react-test-renderer')
const { act } = TestRenderer

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'web/src/PwaInstallDialog.tsx'), 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: 'PwaInstallDialog.tsx',
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function harness({ lastPromptOutcome = null } = {}) {
  const assetCheck = deferred()
  const deviceEvidence = deferred()
  const nativeInstall = deferred()
  const snapshot = Object.freeze({
    displayMode: 'browser', platformHint: 'ios',
    secureContext: true, serviceWorkerSupported: true,
    promptAvailable: true, installedEventObserved: false,
    lastPromptOutcome,
  })
  const mui = {}
  for (const name of [
    'Alert', 'Box', 'Button', 'Dialog', 'DialogActions', 'DialogContent',
    'DialogTitle', 'Divider', 'Stack', 'TextField', 'Typography',
  ]) {
    mui[name] = props => React.createElement('test-' + name, props, props.children)
  }
  mui.useMediaQuery = () => false
  const mocks = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    '@mui/material': mui,
    './pwaInstall': {
      checkXDrivePwaAssets: () => assetCheck.promise,
      requestXDrivePwaInstall: () => nativeInstall.promise,
      subscribeXDrivePwaInstall: () => () => {},
      xDrivePwaInstallSnapshot: () => snapshot,
    },
    './PwaUpdateSection': { __esModule: true, default: () => null },
    './pwaDeviceEvidence': {
      collectXDrivePwaS5DeviceEvidence: () => deviceEvidence.promise,
    },
  }
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compiled)(
    mod, mod.exports, id => {
      assert.ok(Object.hasOwn(mocks, id), 'Unexpected component dependency: ' + id)
      return mocks[id]
    },
  )
  const Dialog = mod.exports.default
  let renderer
  const render = async open => {
    await act(async () => {
      const element = React.createElement(Dialog, { open, onClose: () => {} })
      if (renderer) renderer.update(element)
      else renderer = TestRenderer.create(element)
    })
  }
  const find = prop => renderer.root.findAll(
    node => node.type === 'test-Button' && node.props[prop] !== undefined,
  )[0]
  const click = prop => {
    const button = find(prop)
    assert.ok(button, 'Missing UI action ' + prop)
    button.props.onClick()
  }
  return { render, click, find, assetCheck, deviceEvidence, nativeInstall,
    output: () => JSON.stringify(renderer.toJSON()) }
}

test('S5 PWA: restarting installation asset check cannot strand in-flight evidence generation', async () => {
  const h = harness()
  await h.render(true)
  await act(async () => { h.click('data-xdrive-pwa-s5-evidence-create') })
  assert.equal(h.find('data-xdrive-pwa-s5-evidence-create').props.disabled, true)
  await act(async () => { h.click('data-xdrive-pwa-check') })
  await act(async () => {
    h.deviceEvidence.resolve({ case_id: 'S5-02', physical_device_acceptance: 'NOT_RUN' })
    await h.deviceEvidence.promise
  })
  assert.equal(h.find('data-xdrive-pwa-s5-evidence-create').props.disabled, false)
  assert.match(h.output(), /physical_device_acceptance/)
  assert.match(h.output(), /NOT_RUN/)
  await act(async () => {
    h.assetCheck.resolve([{ id: 'manifest', state: 'pass', label: 'Manifest', detail: 'OK' }])
    await h.assetCheck.promise
  })
  assert.match(h.output(), /Manifest/)
})

test('S5 PWA: restarting public inspection cannot discard an in-flight native install outcome', async () => {
  const h = harness()
  await h.render(true)
  await act(async () => { h.click('data-xdrive-pwa-prompt') })
  await act(async () => { h.click('data-xdrive-pwa-check') })
  await act(async () => {
    h.nativeInstall.resolve('accepted')
    await h.nativeInstall.promise
  })
  assert.match(h.output(), /系统已接受安装请求/)
  await act(async () => {
    h.assetCheck.resolve([])
    await h.assetCheck.promise
  })
})

test('S5 PWA: closing dialog invalidates pending public inspection and device evidence', async () => {
  const h = harness()
  await h.render(true)
  await act(async () => { h.click('data-xdrive-pwa-s5-evidence-create') })
  await act(async () => { h.click('data-xdrive-pwa-check') })
  await h.render(false)
  await act(async () => {
    h.deviceEvidence.resolve({ case_id: 'S5-02', private: 'stale' })
    h.assetCheck.resolve([{ id: 'manifest', state: 'fail', label: 'old' }])
    await Promise.all([h.deviceEvidence.promise, h.assetCheck.promise])
  })
  await h.render(true)
  assert.equal(h.find('data-xdrive-pwa-s5-evidence-create').props.disabled, false)
  assert.doesNotMatch(h.output(), /private|stale/)
  assert.doesNotMatch(h.output(), /"old"/)
})

test('S5 PWA: closing and reopening clears completed installation and HEAD diagnostics', async () => {
  const h = harness()
  await h.render(true)
  await act(async () => {
    h.click('data-xdrive-pwa-prompt')
    h.click('data-xdrive-pwa-check')
  })
  await act(async () => {
    h.nativeInstall.resolve('accepted')
    h.assetCheck.resolve([{
      id: 'manifest', state: 'pass', label: '上一轮资源检测', detail: '旧部署资源正常',
    }])
    await Promise.all([h.nativeInstall.promise, h.assetCheck.promise])
  })
  assert.match(h.output(), /系统已接受安装请求/)
  assert.match(h.output(), /上一轮资源检测/)
  await h.render(false)
  await h.render(true)
  assert.doesNotMatch(h.output(), /系统已接受安装请求/,
    'an old install prompt outcome must not appear in a new dialog session')
  assert.doesNotMatch(h.output(), /上一轮资源检测|旧部署资源正常/,
    'a previous public HEAD result must not be reported as a fresh check')
})

test('S5 PWA: globally retained native install outcome is not fresh dialog evidence', async () => {
  const h = harness({ lastPromptOutcome: 'accepted' })
  await h.render(true)
  assert.doesNotMatch(h.output(), /系统已接受安装请求/,
    'a prior Browser install result must not be shown as this opening\'s prompt result')
})

test('S5 PWA: an install response arriving after close cannot revive prompt feedback', async () => {
  const h = harness()
  await h.render(true)
  await act(async () => { h.click('data-xdrive-pwa-prompt') })
  await h.render(false)
  await h.render(true)
  await act(async () => {
    h.nativeInstall.resolve('accepted')
    await h.nativeInstall.promise
  })
  assert.doesNotMatch(h.output(), /系统已接受安装请求/,
    'generation fence must reject stale prompt result after reopen')
})

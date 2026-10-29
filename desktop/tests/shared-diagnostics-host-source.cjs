'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')

const root = path.resolve(__dirname, '../..')
const file = 'ui/shared/src/mui/DiagnosticsHostController.tsx'
const source = fs.readFileSync(path.join(root, file), 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: file, reportDiagnostics: true,
  compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
})
assert.deepEqual((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
  .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
const fake = name => props => React.createElement(name, props, props.children)
const mod = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  mod, mod.exports, request => {
    if (request === 'react') return React
    if (request === 'react/jsx-runtime') return require('react/jsx-runtime')
    if (request === './DiagnosticsPage') return { XDriveDiagnosticsPage: fake('diagnostics-page') }
    if (request === './StatusAlert') return { XDriveStatusAlert: fake('diagnostic-error') }
    throw Error('Unexpected platform-specific diagnostic dependency: ' + request)
  })
const Controller = mod.exports.XDriveDiagnosticsHostController
const report = (platform = 'synology') => ({
  platform, arch: 'test', generated_at: new Date(0).toISOString(),
  checks: [{ name: 'DSM session', status: 'PASS', detail: 'authorized' }],
  summary: { pass: 1, warn: 0, fail: 0 },
})
const visible = renderer => renderer.root.findByType('diagnostics-page').props

test('generic Diagnostics controller uses the real Host source and scoped shared MUI', async () => {
  const signals = []
  const source = {
    read: async signal => { signals.push(signal); return report() },
    scopeNotice: 'only authenticated DSM-local checks',
    failureMessage: 'unknown Host error',
  }
  let renderer
  await Renderer.act(async () => {
    renderer = Renderer.create(React.createElement(Controller, { source }))
  })
  assert.equal(signals.length, 1)
  assert.deepEqual(visible(renderer).diagnostics, report())
  assert.equal(visible(renderer).scopeNotice, source.scopeNotice)
  assert.equal(visible(renderer).busy, '')
  await Renderer.act(async () => {
    visible(renderer).onRun()
  })
  assert.equal(signals.length, 2)
  assert.equal(signals[0].aborted, true)
  Renderer.act(() => renderer.unmount())
  assert.equal(signals[1].aborted, true)
})

test('changing Host source aborts old reads and ignores their late success', async () => {
  let resolveA, resolveB, oldSignal
  const sourceA = {
    read: signal => { oldSignal = signal; return new Promise(resolve => { resolveA = resolve }) },
    scopeNotice: 'old owner', failureMessage: 'old denied',
  }
  const sourceB = {
    read: () => new Promise(resolve => { resolveB = resolve }),
    scopeNotice: 'current owner', failureMessage: 'current denied',
  }
  let renderer
  await Renderer.act(async () => {
    renderer = Renderer.create(React.createElement(Controller, { source: sourceA }))
  })
  await Renderer.act(async () => {
    renderer.update(React.createElement(Controller, { source: sourceB }))
  })
  assert.equal(oldSignal.aborted, true)
  await Renderer.act(async () => { resolveA(report('old')) })
  assert.equal(visible(renderer).diagnostics, null)
  assert.equal(visible(renderer).scopeNotice, 'current owner')
  await Renderer.act(async () => { resolveB(report('current')) })
  assert.equal(visible(renderer).diagnostics.platform, 'current')
  Renderer.act(() => renderer.unmount())
})

test('read failures never display raw Agent errors or invented healthy summaries', async () => {
  const source = {
    read: () => Promise.reject(Error('/root/private/Owner token BAD')),
    scopeNotice: 'limited real checks', failureMessage: 'Host diagnostics unavailable',
  }
  let renderer
  await Renderer.act(async () => {
    renderer = Renderer.create(React.createElement(Controller, { source }))
  })
  assert.equal(visible(renderer).diagnostics, null)
  assert.equal(visible(renderer).scopeNotice, source.scopeNotice)
  const error = renderer.root.findByType('diagnostic-error')
  assert.equal(error.props.children, source.failureMessage)
  assert.equal(renderer.toJSON().toString().includes('/root/private'), false)
  Renderer.act(() => renderer.unmount())
})

test('the routed DSM Host has no independent diagnostics page or permission fallback', () => {
  const outlet = fs.readFileSync(path.join(root, 'ui/shared/src/mui/XDriveAppPageOutlet.tsx'), 'utf8')
  const dsm = fs.readFileSync(path.join(root, 'web/src/synologyHost.ts'), 'utf8')
  assert.match(outlet, /services\.diagnosticsSource/)
  assert.match(outlet, /<XDriveDiagnosticsHostController/)
  assert.doesNotMatch(outlet, /<XDriveSynologyDiagnosticsPanel|else if \(local\) page = <XDriveSynologyDiagnosticsPanel/)
  assert.match(dsm, /diagnosticsSource: \{/)
  assert.match(dsm, /read: signal => local\.diagnostics\(signal\)/)
  assert.doesNotMatch(source, /window\.xdriveDesktop|backup\.cgi|fetch\s*\(/)
})

'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

function transpile(file) {
  if (file.endsWith('.d.ts')) {
    // Declaration files have no JS output; check original TS syntax without emit.
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.ES2022, true)
    assert.equal(source.parseDiagnostics.length, 0)
    return ''
  }
  const result = ts.transpileModule(read(file), {
    // TypeScript's transpileModule cannot emit .cts with a forced CommonJS module;
    // use an equivalent .ts parser name for syntax-only regression checks.
    fileName: file.endsWith('.cts') ? file.replace(/\.cts$/, '.ts') : file,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
  assert.equal(errors.length, 0, errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'))
  return result.outputText
}

test('A3d2 typed shared Server probe validates original response states, never runtime GO', () => {
  const compiled = transpile('ui/shared/src/service-dependencies.ts')
  const exports = {}
  vm.runInNewContext(compiled, { exports, module: { exports } }, { timeout: 1000 })
  const valid = exports.xDriveValidBaiduJSAPI4LoaderProbe
  assert.equal(typeof valid, 'function')
  const base = {
    state: 'loader_accepted', revision: 17,
    checked_at: '2026-10-19T10:00:00Z',
    loader_accepted: true, runtime_enabled: false,
    detail: 'fixed server-side description',
  }
  assert.equal(valid(base, 17), true)
  for (const input of [
    { ...base, revision: 18 },
    { ...base, runtime_enabled: true },
    { ...base, state: 'unknown' },
    { ...base, state: 'denied', loader_accepted: true },
    { ...base, state: 'unavailable', loader_accepted: true },
    { ...base, state: 'loader_accepted', loader_accepted: false },
    { ...base, checked_at: 'not a time' },
    { ...base, detail: 'x'.repeat(257) },
    null, [],
  ]) {
    assert.equal(valid(input, 17), false)
  }
  assert.equal(valid({ ...base, state: 'denied', loader_accepted: false }, 17), true)
  assert.equal(valid({ ...base, state: 'unavailable', loader_accepted: false }, 17), true)
})

test('A3d2 shared Web/Mobile Web admin verification calls fixed Server route, not dynamic SDK', () => {
  const panel = read('ui/shared/src/mui/BaiduJSAPIDesiredPanel.tsx')
  const parent = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const web = read('web/src/api.ts')
  const app = read('web/src/App.tsx')
  transpile('ui/shared/src/mui/BaiduJSAPIDesiredPanel.tsx')
  transpile('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  transpile('web/src/api.ts')
  transpile('web/src/App.tsx')
  assert.match(panel, /data-xdrive-baidu-jsapi4-live-probe/)
  assert.match(panel, /verifyBaiduJSAPI4Loader\(expected\)/)
  assert.match(panel, /xDriveValidBaiduJSAPI4LoaderProbe\(result, expected\)/)
  assert.match(panel, /!config\.desired_enabled/)
  assert.match(panel, /!config\.configured/)
  assert.match(panel, /probeResult\.state === 'loader_accepted'/)
  assert.match(parent, /verifyBaiduJSAPI4Loader\?:/)
  assert.match(web, /adminVerifyBaiduJSAPI4Loader\(revision: number\)/)
  assert.match(web, /method: 'POST', body: JSON\.stringify\(\{ revision \}\)/)
  assert.match(web, /\/api\/v1\/admin\/services\/baidu-jsapi\/verify-loader/)
  assert.match(app, /verifyBaiduJSAPI4Loader: \(revision: number\) => api\.adminVerifyBaiduJSAPI4Loader/)
  assert.doesNotMatch(panel, /fetch\(|_BMapService\/api\?v=4\.0|_BMapSecurityConfig/)
  const probeCode = panel.slice(
    panel.indexOf('const verifyLoader = async'),
    panel.indexOf('const verified ='),
  )
  assert.doesNotMatch(probeCode, /browser_ak\\s*:/)
})

test('A3d2 Desktop Agent/Main/Preload/Renderer carry only revision, never AK or URL', () => {
  const client = read('internal/client/client.go')
  const cloud = read('cmd/xdrive-agent/cloud_admin_baidu_jsapi_loader.go')
  const agent = read('cmd/xdrive-agent/desktop_ipc_admin_baidu_jsapi.go')
  const routes = read('cmd/xdrive-agent/desktop_ipc.go')
  const main = read('desktop/src/main/index.cts')
  const agentClient = read('desktop/src/main/agent_client.cts')
  const preload = read('desktop/src/preload/index.cts')
  const types = read('desktop/src/renderer/global.d.ts')
  const app = read('desktop/src/renderer/App.tsx')
  for (const file of [
    'desktop/src/main/index.cts', 'desktop/src/main/agent_client.cts',
    'desktop/src/preload/index.cts', 'desktop/src/renderer/global.d.ts',
    'desktop/src/renderer/App.tsx',
  ]) transpile(file)
  assert.match(client, /VerifyAdminBaiduJSAPI4Loader/)
  assert.match(client, /map\[string\]uint64\{"revision": revision\}/)
  assert.match(cloud, /cli\.VerifyAdminBaiduJSAPI4Loader\(ctx, revision\)/)
  assert.match(agent, /decodeDesktopIPCJSONLimit\(w, r, &input, 128\)/)
  assert.match(agent, /CloudVerifyAdminBaiduJSAPI4Loader\(r\.Context\(\), \*input\.Revision\)/)
  assert.match(routes, /"POST \/v1\/cloud\/admin-baidu-jsapi\/verify-loader"/)
  assert.match(agentClient, /cloudVerifyAdminBaiduJSAPI4Loader\(revision: number\)/)
  assert.match(main, /agent:cloud-verify-admin-baidu-jsapi-loader/)
  assert.match(main, /requireAgentCapability\(hello, 'admin-services'\)/)
  assert.match(preload, /cloudVerifyAdminBaiduJSAPI4Loader/)
  assert.match(types, /cloudVerifyAdminBaiduJSAPI4Loader/)
  assert.match(app, /verifyBaiduJSAPI4Loader: async \(revision: number\) =>/)
  assert.doesNotMatch(cloud, /BrowserAK|ak\s*:/)
  const probeHandler = agent.slice(
    agent.indexOf('func (h *desktopIPCHandler) cloudVerifyAdminBaiduJSAPI4Loader'),
    agent.indexOf('type desktopIPCBaiduJSAPIInput struct'),
  )
  assert.doesNotMatch(probeHandler, /ProxyURL|BrowserAK\\s*:/)
  assert.doesNotMatch(preload, /BMAP_PROXY_URL|_BMapSecurityConfig/)
})

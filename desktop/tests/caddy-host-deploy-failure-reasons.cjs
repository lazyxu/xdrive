'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..', '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const helper = 'ui/shared/src/mui/caddyHostDeployFailure.ts'
const code = ts.transpileModule(read(helper), {
  fileName: helper,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
})
const diagnostics = (code.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
assert.deepEqual(diagnostics, [])
const mod = { exports: {} }
new Function('exports', 'module', code.outputText)(mod.exports, mod)
const reason = mod.exports.caddyHostDeployFailureMessage

test('Host deploy failure distinguishes installer busy, refusal, interruption, and verification', () => {
  assert.match(reason({ error: 'installer-busy' }), /服务端正在升级/)
  assert.match(reason({ error: 'deploy-refused' }), /宿主机拒绝部署/)
  assert.match(reason({ error: 'interrupted-deploy', rolled_back: true }), /已恢复验证/)
  assert.match(reason({ error: 'interrupted-deploy', rolled_back: false }), /恢复未确认/)
  assert.match(reason({ error: 'caddy-deploy-or-verify-failed', rolled_back: true }), /已验证恢复/)
  assert.match(reason({ error: 'caddy-deploy-or-verify-failed', rolled_back: false }), /恢复未确认/)
})

test('Unknown Host diagnostics never appear directly or fabricate rollback success', () => {
  const hostile = 'secret=DO-NOT-LEAK /home/user/.xd/config/.env'
  const text = reason({ error: hostile, rolled_back: true })
  assert.match(text, /原因尚未确认/)
  assert.doesNotMatch(text, /DO-NOT-LEAK|\.env|已恢复/)
})

test('Web/Mobile shared Caddy and Desktop Agent carry fixed error codes end-to-end', () => {
  const ui = read('ui/shared/src/mui/CaddyDetailV1.tsx')
  const agent = read('desktop/src/main/agent_client.cts')
  const shared = read('ui/shared/src/service-dependencies.ts')
  assert.match(ui, /caddyHostDeployFailureMessage\(status\)/)
  assert.match(ui, /caddyHostDeployFailureMessage\(next\)/)
  assert.match(agent, /error\?: string \/\/ Fixed Host code/)
  assert.match(shared, /error\?: string \/\/ Strictly enumerated/)
})

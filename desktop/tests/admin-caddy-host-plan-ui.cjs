const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const transpiled = ts.transpileModule(read('ui/shared/src/mui/CaddyHostPlanValidation.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const mod = { exports: {} }
new Function('module', 'exports', transpiled)(mod, mod.exports)
const verify = mod.exports.verifyCaddyHTTPSHostPlan

const good = {
  credential_revision: 0,
  desired_revision: 7,
  domain: '',
  domain_enabled: false,
  lan_enabled: true,
  lan_ip: '192.168.2.4',
  protocol: 'xdrive.caddy.https.host-plan.v1',
}

test('host-plan is a strict seven-field nonsecret draft, never a deployed gateway', () => {
  assert.equal(verify(good), good)
  const dual = { ...good, domain: 'drive.example.com', domain_enabled: true, credential_revision: 8 }
  assert.equal(verify(dual), dual)
  const domainOnly = { ...dual, lan_enabled: false, lan_ip: '' }
  assert.equal(verify(domainOnly), domainOnly)
  for (const change of [
    { credential_revision: 0, domain_enabled: true, domain: 'drive.example.com' },
    { desired_revision: NaN }, { desired_revision: 0 },
    { desired_revision: 1.5 }, { desired_revision: Number.MAX_SAFE_INTEGER + 3 },
    { credential_revision: true }, { domain_enabled: 1 },
    { domain: 'https://drive.example.com' }, { lan_enabled: false },
    { lan_ip: '8.8.8.8' }, { lan_ip: '192.168.02.4' },
    { lan_ip: '192.168.2.256' }, { lan_ip: '127.0.0.1' },
    { lan_ip: '::1' }, { lan_ip: '192.168.2.4/24' },
    { protocol: 'xdrive.caddy.https.host-plan.v2' },
    { apply_supported: true }, { applied_revision: 7 },
    { access_key_secret: 'must-never-be-forwarded' },
  ]) {
    assert.throws(() => verify({ ...good, ...change }), /安全合同/, JSON.stringify(change))
  }
  const missing = { ...good }
  delete missing.lan_ip
  assert.throws(() => verify(missing), /安全合同/)
  assert.throws(() => verify(null), /安全合同/)
  assert.throws(() => verify([]), /安全合同/)
})

test('shared system dependencies exposes only authenticated readonly plan transport', () => {
  const router = read('internal/api/router.go')
  const server = read('internal/api/admin_caddy_host_plan.go')
  const go = read('internal/client/admin_caddy_host_plan.go')
  const controller = read('cmd/xdrive-agent/cloud_caddy_host_plan.go')
  const ipc = read('cmd/xdrive-agent/desktop_ipc_caddy_host_plan.go')
  const ipcRouter = read('cmd/xdrive-agent/desktop_ipc.go')
  const main = read('desktop/src/main/index.cts')
  const agent = read('desktop/src/main/agent_client.cts')
  const preload = read('desktop/src/preload/index.cts')
  const renderer = read('desktop/src/renderer/App.tsx')
  const web = read('web/src/App.tsx')
  const api = read('web/src/api.ts')
  const panel = read('ui/shared/src/mui/CaddyPreflightPanel.tsx')
  assert.match(router, /admin\.Use\(s\.requireAdmin\(\)\)/)
  assert.match(router, /admin\.GET\("\/services\/caddy\/https\/host-plan", s\.adminCaddyHTTPSHostPlan\)/)
  assert.match(server, /sameCaddyPreflightSnapshot\(snapshot, current\)/)
  assert.match(go, /http\.MethodGet, "\/api\/v1\/admin\/services\/caddy\/https\/host-plan"/)
  assert.match(controller, /CloudAdminCaddyHTTPSHostPlan/)
  assert.match(ipc, /http\.MethodNotAllowed|http\.StatusNotImplemented/)
  assert.match(ipcRouter, /GET \/v1\/cloud\/admin-caddy-https\/host-plan/)
  assert.match(agent, /cloudAdminCaddyHTTPSHostPlan/)
  assert.match(main, /requireAgentCapability\(hello, 'admin-services'\)/)
  assert.match(main, /agent:cloud-admin-caddy-https-host-plan/)
  assert.match(preload, /agent:cloud-admin-caddy-https-host-plan/)
  assert.match(renderer, /loadCaddyHTTPSHostPlan/)
  assert.match(web, /loadCaddyHTTPSHostPlan/)
  assert.match(api, /adminCaddyHTTPSHostPlan/)
  // Backend plan remains available for trusted maintenance tooling, but the
  // Caddy settings page no longer duplicates its saved target preview.
  assert.doesNotMatch(panel, /verifyCaddyHTTPSHostPlan\(next\)/)
  assert.doesNotMatch(panel, /data-xdrive-caddy-host-plan/)
  assert.match(panel, /data-xdrive-admin-caddy-preflight/)
  assert.match(panel, /onClick=\{\(\) => \{ void check\(\) \}\}/)
  assert.doesNotMatch(panel, /启动 Docker|执行 Caddy Apply|重启服务端/)
  assert.doesNotMatch(controller + ipc + go, /docker\.sock|exec\.Command|docker compose/)
})

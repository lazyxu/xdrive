'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..', '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const files = [
  'ui/shared/src/mui/CaddyDetailV1.tsx',
  'ui/shared/src/mui/CaddyHTTPSDesiredPanel.tsx',
  'ui/shared/src/mui/CaddyAliDNSPanel.tsx',
  'ui/shared/src/mui/CaddyPreflightPanel.tsx',
]

test('Caddy v1.1 compact follow-up: all settings are flat, no history/difference/disclosure UI', () => {
  const owner = read(files[0])
  const https = read(files[1])
  const alidns = read(files[2])
  const preflight = read(files[3])
  assert.match(owner, /data-xdrive-caddy-single-page="true"/)
  assert.match(owner, /id="caddy-v1-config"/)
  assert.match(owner, /id="caddy-v1-evidence"/)
  assert.match(owner, /activeTab === 'config' \|\| activeTab === 'history' \? 'caddy-v1-config'/)
  assert.match(owner, /<XDriveCaddyPreflightPanel source=\{source\} refreshID=\{evidenceRevision\}/)
  for (const v of ['showHistory', 'historyOpen', 'evidenceOpen', 'showEvidence',
    'caddy-v1-history', 'XDriveCaddyHostBaselinePreviewPanel',
    'data-xdrive-caddy-v1-runtime-desired-drift', '运行与目标配置存在差异',
    'caddy-v1-evidence-toggle', 'caddy-v1-history-toggle']) {
    assert.equal(owner.includes(v), false, 'deleted component ' + v)
  }
  assert.doesNotMatch(alidns, /manageOpen|setManageOpen|data-xdrive-caddy-alidns-manage/)
  assert.match(alidns, /XDriveSensitiveField label="AccessKey ID"/)
  assert.match(alidns, /XDriveSensitiveField label="AccessKey Secret"/)
  assert.match(preflight, /执行预检/)
  assert.doesNotMatch(preflight, /hostPlan|data-xdrive-caddy-host-plan|caddy-rescue-ingress-advisory/)
  assert.match(https, /data-xdrive-caddy-running-lan-ip/)
})

test('Caddy displays verified facts only; no yellow unsupported evidence or repeated prose', () => {
  const owner = read(files[0])
  const https = read(files[1])
  const alidns = read(files[2])
  const preflight = read(files[3])
  assert.match(owner, /hostDomainVerified \|\| independentDomainVerified \|\| lanVerified/)
  assert.match(https, /config.host_lan_tls_state === 'verified'/)
  assert.match(owner, /保存更新宿主机 \.env；生效需另行重新部署 Caddy/)
  for (const obsolete of ['公网实际可达：未验证', '当前设备信任 Caddy Local CA',
    '生效待核验', '生效另验', '生效未确认', 'Applied Receipt ·',
    '尚无绑定管理双修订的可信 Applied Receipt', '期望配置未应用']) {
    assert.equal(owner.includes(obsolete), false, 'unverified permanent status: ' + obsolete)
    assert.equal(alidns.includes(obsolete), false, 'unverified AliDNS status: ' + obsolete)
  }
  assert.doesNotMatch(alidns, /color="warning"/)
  assert.doesNotMatch(preflight, /warning.main|color="warning"/)
  assert.doesNotMatch(preflight, /公网实际可达：未验证|生效待核验/)
  assert.doesNotMatch(owner + preflight, /applyCaddy|restartCaddy|docker restart|InsecureSkipVerify/)
})

test('UI cleanup preserves atomic CAS and credential/Host security, never auto-probes', () => {
  const owner = read(files[0])
  const ali = read(files[2])
  const preflight = read(files[3])
  assert.match(owner, /source.saveCaddyConfiguration\(input\)/)
  assert.match(owner, /result.host_applied !== false/)
  assert.match(owner, /result.apply_supported !== false/)
  assert.match(owner, /savePendingRef.current/)
  assert.match(ali, /XDriveSensitiveField/)
  assert.match(ali, /Math.min\(30, shown.expires_in_seconds\)/)
  assert.match(ali, /document.addEventListener\('visibilitychange'/)
  assert.match(ali, /window.addEventListener\('blur'/)
  assert.match(ali, /onReveal=\{\(\) => \{ void reveal\(\) \}\}/)
  assert.match(preflight, /const check = async \(\) =>/)
  assert.match(preflight, /onClick=\{\(\) => \{ void check\(\) \}\}/)
  assert.match(preflight, /verifyCaddyPreflightContract\(next\)/)
  assert.match(preflight, /const verifyAliDNSRead = async \(\) =>/)
  assert.doesNotMatch(owner, /loadCaddyHTTPSPreflight\(\)/)
})

test('four edited TSX modules remain parseable', () => {
  for (const file of files) {
    const result = ts.transpileModule(read(file), {
      fileName: file,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext },
      reportDiagnostics: true,
    })
    const errors = (result.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error)
    assert.equal(errors.length, 0, file + ': ' + errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, '\n')).join('; '))
  }
})

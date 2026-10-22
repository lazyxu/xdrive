'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('SD-CADDY-FLAT: one always-visible flow, no drift notice, folds or history', () => {
  const page = read('ui/shared/src/mui/CaddyDetailV1.tsx')
  for (const anchor of ['caddy-v1-overview', 'caddy-v1-config', 'caddy-v1-evidence'])
    assert.ok(page.includes(anchor), anchor)
  assert.match(page, /data-xdrive-caddy-single-page="true"/)
  assert.match(page, /<XDriveCaddyPreflightPanel source=\{source\}/)
  assert.match(page, /activeTab === 'config' \|\| activeTab === 'history' \? 'caddy-v1-config'/)
  for (const old of [
    'showEvidence', 'evidenceOpen', 'historyOpen', 'showHistory', '配置历史',
    'caddy-v1-history', 'section="history"', 'XDriveCaddyHostBaselinePreviewPanel',
    '运行与目标配置存在差异', 'data-xdrive-caddy-v1-runtime-desired-drift',
    '公网实际可达：未验证', '当前设备信任 Caddy Local CA', '生效未确认',
    'data-xdrive-caddy-v1-applied-axis', 'data-xdrive-caddy-v1-domain-evidence-source',
  ]) assert.ok(!page.includes(old), old)
  assert.match(page, /service\.installation_state === 'observed'/)
  assert.match(page, /service\.health_state === 'failed'/)
  assert.doesNotMatch(page, /source\.deploy|applyCaddy|restartCaddy/)
})

test('SD-CADDY-FLAT: runtime proof only beside its field, no generic amber explanation', () => {
  const page = read('ui/shared/src/mui/CaddyHTTPSDesiredPanel.tsx')
  assert.match(page, /config\.host_observed && config\.host_lan_configured === true/)
  assert.match(page, /config\.host_lan_tls_state === 'verified'/)
  assert.match(page, /config\.host_observed && config\.host_https_configured === true/)
  assert.match(page, /config\.host_tls_state === 'verified'/)
  assert.match(page, /data-xdrive-caddy-lan-runtime/)
  assert.match(page, /data-xdrive-caddy-domain-runtime/)
  assert.match(page, /color="error.main" data-xdrive-caddy-lan-error/)
  assert.match(page, /color="error.main" data-xdrive-caddy-domain-error/)
  for (const old of ['生效待核验', 'config.requirement', '本机 TLS 验证不等于公网 HTTPS 可访问']) {
    assert.ok(!page.includes(old), old)
  }
  assert.match(page, /\(lanEnabled \|\| enabled\)/)
  assert.match(page, /saveCaddyHTTPSConfig\(\{/)
})

test('SD-CADDY-FLAT: secret edit always present, reveal remains opt-in, timed and revocable', () => {
  const alidns = read('ui/shared/src/mui/CaddyAliDNSPanel.tsx')
  const page = read('ui/shared/src/mui/CaddyDetailV1.tsx')
  assert.doesNotMatch(alidns, /manageOpen|收起管理|data-xdrive-caddy-alidns-manage/)
  assert.match(alidns, /label="AccessKey ID（新值）"/)
  assert.match(alidns, /label="AccessKey Secret（新值）"/)
  assert.equal((alidns.match(/type="password" autoComplete="new-password"/g) || []).length, 2)
  assert.match(alidns, /disabled={!canEdit \|\| !config.configured \|\| !source.revealCaddyAliDNS}/)
  assert.match(alidns, /Math.min\(30, shown.expires_in_seconds\)/)
  assert.match(alidns, /window.addEventListener\('blur', hide\)/)
  assert.match(alidns, /document.addEventListener\('visibilitychange', conceal\)/)
  assert.match(alidns, /setKeyID\(''\)/)
  assert.match(alidns, /setKeySecret\(''\)/)
  assert.match(alidns, /setPendingClear\(true\)/)
  assert.match(page, /source\.saveCaddyConfiguration\(input\)/)
  assert.match(page, /result\.host_applied !== false/)
  assert.match(page, /result\.apply_supported !== false/)
})

test('SD-CADDY-FLAT: manual preflight shows verified and actual blockers, no unsupported states', () => {
  const preflight = read('ui/shared/src/mui/CaddyPreflightPanel.tsx')
  assert.match(preflight, /onClick=\{\(\) => \{ void check\(\) \}\}/)
  assert.match(preflight, /onClick=\{\(\) => \{ void verifyAliDNSRead\(\) \}\}/)
  assert.match(preflight, /item\.state === 'pass'/)
  assert.match(preflight, /item\.state === 'blocked' \|\| item\.state === 'missing'/)
  assert.match(preflight, /result\.host_live_config_state === 'observed-local'/)
  assert.match(preflight, /result\.host_instance_generation === 'same-instance-local'/)
  assert.doesNotMatch(preflight, /<Accordion|data-xdrive-caddy-host-plan|public HTTPS available/i)
  assert.doesNotMatch(preflight, /查看宿主机应用计划|安全应用、重启与自动回滚功能尚未开放/)
  const check = preflight.slice(preflight.indexOf('  const check = async () => {'),
    preflight.indexOf('  const verifyAliDNSRead = async () => {'))
  assert.doesNotMatch(check, /setResult\(null\)/)
  assert.doesNotMatch(preflight, /applyCaddy|restartCaddy|InsecureSkipVerify/)
})

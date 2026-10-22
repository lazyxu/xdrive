'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')

test('Caddy has one permanently open page; old verify/history links map to visible sections', () => {
  const parent = read('ui', 'shared', 'src', 'mui', 'ServiceDependenciesPage.tsx')
  const page = read('ui', 'shared', 'src', 'mui', 'CaddyDetailV1.tsx')
  assert.match(parent, /<XDriveCaddyDetailV1/)
  assert.match(page, /data-xdrive-caddy-single-page="true"/)
  for (const anchor of ['caddy-v1-overview', 'caddy-v1-config', 'caddy-v1-evidence']) {
    assert.match(page, new RegExp(anchor))
  }
  assert.match(page, /activeTab === 'verify' \? 'caddy-v1-evidence'/)
  assert.match(page, /activeTab === 'config' \|\| activeTab === 'history' \? 'caddy-v1-config'/)
  assert.match(page, /scrollIntoView\(\{ block: 'start', behavior: 'auto' \}\)/)
  for (const obsolete of ['caddy-v1-history', 'showHistory', 'historyOpen',
    'showEvidence', 'evidenceOpen', 'caddy-v1-evidence-toggle', 'caddy-v1-history-toggle',
    'section="history"', 'XDriveCaddyHostBaselinePreviewPanel',
    'data-xdrive-caddy-v1-runtime-desired-drift', '<Tabs', '<Accordion']) {
    assert.equal(page.includes(obsolete), false, 'obsolete Caddy UI: ' + obsolete)
  }
})

test('Caddy top-level state shows only independently verified facts without false green unknowns', () => {
  const page = read('ui', 'shared', 'src', 'mui', 'CaddyDetailV1.tsx')
  assert.match(page, /const healthy = service\.installation_state === 'observed'/)
  assert.match(page, /const bad = service\.health_state === 'failed'/)
  assert.match(page, /host_observed === true/)
  assert.match(page, /host_lan_tls_state === 'verified'/)
  assert.match(page, /caddy_local_domain_https_state === 'verified'/)
  assert.match(page, /\{\(hostDomainVerified \|\| independentDomainVerified \|\| lanVerified\) && \(/)
  assert.match(page, /data-xdrive-caddy-v1-domain-evidence-source/)
  assert.match(page, /data-xdrive-caddy-v1-saved-lan-target/)
  for (const obsolete of ['公网实际可达：未验证', '当前设备信任 Caddy Local CA',
    '生效待核验', '生效未确认', 'Applied Receipt ·', '运行与目标配置存在差异']) {
    assert.equal(page.includes(obsolete), false, 'no persistent unsupported evidence: ' + obsolete)
  }
  assert.match(page, /<XDriveCaddyPreflightPanel source=\{source\} refreshID=\{evidenceRevision\}/)
  assert.match(page, /id="caddy-v1-evidence"/)
})

test('Always-visible config retains atomic CAS, fail-closed deployment and secret lifecycle', () => {
  const page = read('ui', 'shared', 'src', 'mui', 'CaddyDetailV1.tsx')
  const https = read('ui', 'shared', 'src', 'mui', 'CaddyHTTPSDesiredPanel.tsx')
  const alidns = read('ui', 'shared', 'src', 'mui', 'CaddyAliDNSPanel.tsx')
  assert.match(page, /<XDriveCaddyHTTPSDesiredPanel source=\{source\} refreshID=\{atomicRefreshID\}/)
  assert.match(page, /inlineEdit atomicMode atomicSaving=\{savingAtomic\} onAtomicDraft=\{setHTTPSDraft\}/)
  assert.match(page, /<XDriveCaddyAliDNSPanel source=\{source\} refreshID=\{atomicRefreshID\}/)
  assert.match(page, /atomicMode atomicSaving=\{savingAtomic\} onAtomicDraft=\{setAliDraft\}/)
  assert.match(page, /source\.saveCaddyConfiguration\(input\)/)
  assert.match(page, /result\.host_applied !== false/)
  assert.match(page, /result\.apply_supported !== false/)
  assert.match(page, /data-xdrive-caddy-v11-save-only/)
  assert.match(page, /data-xdrive-caddy-v1-deploy-gate/)
  assert.match(page, /保存仅更新管理配置，不会重新部署 Caddy/)
  assert.doesNotMatch(page, /applyCaddy|restartCaddy|source\.deploy|docker restart/)
  assert.match(https, /data-xdrive-caddy-running-lan-ip/)
  assert.match(https, /host_lan_tls_state === 'verified'/)
  assert.doesNotMatch(alidns, /manageOpen|setManageOpen|data-xdrive-caddy-alidns-manage/)
  assert.match(alidns, /Math\.min\(30, shown\.expires_in_seconds\)/)
  assert.match(alidns, /document\.addEventListener\('visibilitychange'/)
  assert.match(alidns, /window\.addEventListener\('blur'/)
  assert.match(alidns, /XDriveSensitiveField/)
  assert.match(alidns, /revealedValue=\{active \? shown\?\.access_key_id/)
})

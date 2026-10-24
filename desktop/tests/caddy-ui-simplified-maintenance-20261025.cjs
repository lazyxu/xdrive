'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('Caddy owns one full refresh; children do not add active refresh buttons', () => {
  const parent = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const detail = read('ui/shared/src/mui/CaddyDetailV1.tsx')
  const https = read('ui/shared/src/mui/CaddyHTTPSDesiredPanel.tsx')
  const alidns = read('ui/shared/src/mui/CaddyAliDNSPanel.tsx')
  assert.match(parent, /pageActions=\{selectedPage === 'caddy' \? null : \(/)
  assert.match(detail, /onClick=\{refreshAllCaddy\}/)
  assert.match(detail, /setAtomicRefreshID\(\(value\) => value \+ 1\)/)
  assert.match(detail, /setHistoryRefreshID\(\(value\) => value \+ 1\)/)
  assert.match(detail, /hasUnsavedEdits \|\| dirtyAtomic/)
  assert.match(https, /\{!inlineEdit && <Button size="small" variant="text"/)
  assert.match(https, /inlineEdit \? <Typography variant="caption"/)
  assert.match(alidns, /atomicMode \? <Typography variant="caption"/)
})

test('Caddy stays expanded; live TLS failures and unknowns have visible explanations', () => {
  const owner = read('ui/shared/src/mui/CaddyDetailV1.tsx')
  const https = read('ui/shared/src/mui/CaddyHTTPSDesiredPanel.tsx')
  assert.match(owner, /data-xdrive-caddy-single-page="true"/)
  assert.doesNotMatch(owner, /Accordion|collapse|showHistory|setHistoryOpen/)
  assert.match(owner, /domainRequested \|\| lanRequested/)
  assert.match(owner, /domainTLSFailure/)
  assert.match(owner, /lanTLSFailure/)
  assert.match(owner, /本机域名 TLS 检查失败/)
  assert.match(owner, /本机 IP TLS 尚未确认/)
  assert.match(https, /!inlineEdit && <Typography variant="subtitle2"/)
  assert.match(https, /\(lanEnabled \|\| !!lanIP\) && !validPrivateLANIP\(lanIP\)/)
})

test('Save is direct but Host restart and deployment require explicit confirmation', () => {
  const owner = read('ui/shared/src/mui/CaddyDetailV1.tsx')
  const ali = read('ui/shared/src/mui/CaddyAliDNSPanel.tsx')
  assert.match(owner, /data-xdrive-caddy-v11-save-only onClick=\{\(\) => \{ void saveAtomic\(\) \}\}/)
  assert.doesNotMatch(owner, /confirmAtomic|setConfirmAtomic/)
  assert.match(owner, /<XDriveConfirmDialog open=\{confirmDeploy\}/)
  assert.match(owner, /<XDriveConfirmDialog open=\{confirmDiscard\}/)
  assert.match(owner, /result\.host_applied !== false/)
  assert.match(owner, /savePendingRef.current/)
  assert.match(owner, /保存只更新配置；有变更时再点击/)
  assert.match(ali, /setPendingClear\(true\)/)
  assert.match(ali, /<XDriveConfirmDialog open=\{confirmClear\}/)
  assert.match(ali, /Math.min\(30, shown.expires_in_seconds\)/)
})

test('History shows all Host terminal results with archive timestamps and fixed errors', () => {
  const owner = read('ui/shared/src/mui/CaddyDetailV1.tsx')
  assert.match(owner, /typeof item\.recorded_at !== 'string'/)
  assert.match(owner, /Number\.isFinite\(ms\)/)
  assert.match(owner, /\{historyItems\.map\(\(item\) => \(/)
  assert.doesNotMatch(owner, /historyItems\.slice\(0, 10\)/)
  assert.match(owner, /caddyHistoryTime\(item\)/)
  assert.match(owner, /caddyHostDeployFailureMessage\(item\)/)
  assert.match(owner, /data-xdrive-caddy-host-terminal-history/)
})

test('Shared Web, Mobile Web and Desktop TSX sources parse', () => {
  for (const file of [
    'ui/shared/src/mui/ServiceDependenciesPage.tsx',
    'ui/shared/src/mui/CaddyDetailV1.tsx',
    'ui/shared/src/mui/CaddyHTTPSDesiredPanel.tsx',
    'ui/shared/src/mui/CaddyAliDNSPanel.tsx',
  ]) {
    const parsed = ts.transpileModule(read(file), {
      fileName: file, reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext },
    })
    assert.equal((parsed.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0,
      'TSX parse failure: ' + file)
  }
})

'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const fixture = read('desktop/scripts/system-dependencies-real-chromium.tsx')
const browser = read('desktop/scripts/system-dependencies-real-chromium.cjs')
const workflow = read('.github/workflows/system-dependencies-real-chromium.yml')

test('actual shared System Dependencies TSX browser fixture has no second UI or production services', () => {
  const result = ts.transpileModule(fixture, {
    fileName: 'system-dependencies-real-chromium.tsx',
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  assert.deepEqual((result.diagnostics || [])
    .filter(x => x.category === ts.DiagnosticCategory.Error)
    .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])
  assert.match(fixture, /import \{ XDriveServiceDependenciesPage \} from/)
  assert.match(fixture, /<XDriveServiceDependenciesPage source=/)
  assert.match(fixture, /XDRIVE_SYSTEM_DEPENDENCY_IDS\.map/)
  assert.match(fixture, /ocr_reason: 'runner_unavailable'/)
  assert.match(fixture, /loadPhotoAutoConfig:/)
  assert.match(fixture, /loadPhotoHostConfig:/)
  assert.match(fixture, /loadPhotoHostPreflight:/)
  assert.match(fixture, /hostChecks/)
  assert.match(fixture, /apply_supported: false/)
  assert.match(fixture, /failNext/)
  assert.match(fixture, /swapServer/)
  assert.doesNotMatch(fixture, /docker\.sock|adminStopHost|Bearer |api\/v1\/admin\/|localStorage\.setItem/)
})

test('Chromium tests real MUI component at 320/390/1280 including fenced source and unsaved state', () => {
  for (const needle of [
    'esbuild.build(', 'chromium.launch(', 'real Chromium executable required',
    'system-dependencies-real-chromium.tsx',
    'data-xdrive-system-dependencies-overview', 'data-xdrive-ocr-auto-state',
    '检测宿主与模型（只读）', 'hostProbe.click()',
    'data-xdrive-photo-smart-ocr-fixture-state', 'SYNTHETIC_SECRET_MUST_NEVER_RENDER',
    '离开未保存的系统依赖配置？', 'releaseB()', 'noOverflow(page)',
    'summary.externalRequests === 0', 'summary.pageErrors.length === 0',
    'summary.passed = true', 'summary.json',
  ]) assert.ok(browser.includes(needle), 'Chromium contract missing: ' + needle)
  assert.match(browser, /for \(const width of \[320, 390, 899, 900, 1280, 1740\]\)/)
  assert.match(browser, /async function auditAllDependencyWidths\(page, width\)/)
  assert.match(browser, /data-xdrive-core-dependency-flat/)
  assert.match(browser, /data-xdrive-baidu-jsapi4-admin/)
  assert.match(browser, /Math\.abs\(upperGap - lowerGap\) <= 2/)
  assert.match(browser, /1740: real shared MUI uses screenshot dark-mode theme/)
  assert.match(fixture, /data-xdrive-fixture-theme=\{fixtureTheme\}/)
  assert.match(browser, /new URL\(route\.request\(\)\.url\(\)\)\.origin !== origin/)
  assert.doesNotMatch(browser, /github\.com\/releases|new WebSocket|authorization.*Bearer/i)
})

test('isolated Actions job executes accurate SHA, native Chrome and retains sanitized evidence', () => {
  assert.match(workflow, /pull_request:/)
  assert.match(workflow, /branches: \[master\]/)
  assert.match(workflow, /ui\/shared\/src\/mui\/ServiceDependenciesPage\.tsx/)
  assert.match(workflow, /system-dependencies-real-chromium\.cjs/)
  assert.match(workflow, /git rev-parse HEAD/)
  assert.match(workflow, /playwright-core@1\.56\.1/)
  assert.match(workflow, /fonts-noto-cjk/)
  assert.match(workflow, /fc-match -f/)
  assert.match(workflow, /desktop\/scripts\/system-dependencies-real-chromium\.cjs/)
  assert.match(workflow, /!p\.passed/)
  assert.match(workflow, /upload-artifact@v4/)
  assert.match(browser, /getByLabel\('自动安排照片智能分析'\)/)
  assert.match(browser, /getByRole\('dialog'\)\.filter\(/)
  assert.match(browser, /policySave\.isEnabled\(\)/)
  assert.match(browser, /unsaved-leave-attempt-390/)
})

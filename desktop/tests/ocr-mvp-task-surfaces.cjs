const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('OCR dependency shows Smart Info, fixed OCR canary and shared automatic policy', () => {
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const host = read('ui/shared/src/mui/PhotoHostDesiredPanel.tsx')
  const server = read('internal/api/admin_service_dependencies.go')
  assert.match(page, /data-xdrive-ocr-dependency-status/)
  assert.match(page, /selectedItem\.status === 'ready'/)
  assert.match(page, /tab: 'verify'/)
  assert.match(page, /photo\.smart_search/)
  assert.match(page, /photoAutoKindChoices/)
  assert.match(host, /data-xdrive-photo-smart-model-task-state/)
  assert.match(host, /data-xdrive-photo-smart-ocr-fixture-state/)
  assert.match(server, /PhotoSmartAnalyzer\.Info\(ctx\)/)
  assert.doesNotMatch(page, /case 'photo-ocr':/)
})

test('my tasks expose OCR visual batch with existing controls, not a duplicate job', () => {
  const page = read('ui/shared/src/mui/TaskCenterPage.tsx')
  const model = read('ui/shared/src/background-tasks.ts')
  const scheduler = read('internal/api/photo_intelligence_scheduler.go')
  assert.match(page, /title="照片文字识别（OCR）与视觉分类"/)
  assert.match(page, /tasks=\{ocrTasks\}/)
  assert.match(page, /!xDriveBackgroundTaskIsOCR\(task.kind\)/)
  assert.match(model, /case 'photo\.smart_search': return .*OCR/)
  assert.match(model, /case 'photo_ocr_visual':/)
  assert.match(scheduler, /GroupKey:\s+kindName/)
  assert.match(scheduler, /photoIntelligenceProgressPhase\(key.Kind\)/)
})

test('global filter preserves existing Owner authorization, cards/table and pagination', () => {
  const page = read('ui/shared/src/mui/TaskCenterPage.tsx')
  const cards = read('ui/shared/src/mui/BackgroundTaskCenter.tsx')
  const controller = read('ui/shared/src/mui/TaskCenterController.ts')
  const auth = read('internal/api/background_task_controls.go')
  assert.match(page, /aria-label="全局 OCR 任务筛选"/)
  assert.match(page, /displayedGlobalTasks/)
  assert.match(page, /当前已加载/)
  assert.match(page, /tasks=\{displayedGlobalTasks\}/)
  assert.match(cards, /data-xdrive-ocr-shared-task/)
  assert.match(cards, /data-xdrive-ocr-global-task/)
  assert.match(cards, /<BackgroundTaskControls/)
  assert.match(controller, /scope === 'global'/)
  assert.match(auth, /case "photo\.face", "photo\.smart_search"/)
  assert.match(auth, /backgroundTaskActionReanalyze/)
})

test('OCR activation must distinguish model health, automatic pause and Host observation', () => {
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const types = read('ui/shared/src/service-dependencies.ts')
  const api = read('internal/api/admin_service_dependencies.go')
  const client = read('internal/client/client.go')
  const diagnosis = read('internal/api/admin_photo_ocr_status.go')
  const testCases = read('internal/api/admin_photo_ocr_status_test.go')
  for (const marker of [
    'data-xdrive-ocr-auto-state', 'data-xdrive-ocr-diagnostic-reason',
    'data-xdrive-ocr-overview-activation', 'ocrAutoStateLabel(selectedItem)',
    'ocrAutoReasonLabel(selectedItem)', 'probe_auth_rejected', 'auto_paused',
    'host_unverified', 'probe_invalid_response', 'legacy_unverified',
  ]) {
    assert.ok(page.includes(marker), 'shared OCR readiness UI missing: ' + marker)
  }
  assert.match(types, /ocr_auto_state\?:/)
  assert.match(types, /ocr_reason\?:/)
  assert.match(api, /photoOCRAutoDiagnosis\(/)
  assert.ok(api.includes('runnerInitialized && s.BackgroundScheduler != nil'))
  assert.match(api, /ValidateSmartAnalyzerInfo\(info\)/)
  assert.match(client, /OCRAutoState/)
  assert.match(client, /OCRReason/)
  assert.match(diagnosis, /case "ready":/)
  assert.match(testCases, /TestPhotoOCRAutoDiagnosisReproducesFalseEnablement/)
  assert.match(testCases, /TestAdminServiceDependenciesOCRFailureReasonsAndMalformedInfo/)
  // No new admin writes or independent OCR workers are allowed.
  assert.doesNotMatch(api, /func \(s \*Server\) adminSetOCR/)
})

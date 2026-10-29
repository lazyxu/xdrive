'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.resolve(__dirname, '../..')
const filename = 'ui/shared/src/mui/CloudFilesFirstPageAdmission.ts'
const source = fs.readFileSync(path.join(repo, filename), 'utf8')
const js = ts.transpileModule(source, {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const moduleRef = { exports: {} }
new Function('exports', 'module', js)(moduleRef.exports, moduleRef)
const admit = moduleRef.exports.xDriveAdmitCloudFilesCountedFirstPage
const valid = {
  items: [{ id: 1 }, { id: 2 }],
  total_count: 100001,
  total_count_included: true,
  offset: 0, limit: 200, sort: 'name', order: 'asc',
}

test('valid 100k first Range is admitted unchanged without copying Owner data', () => {
  assert.strictEqual(admit(valid), valid)
  assert.strictEqual(admit({ ...valid, total_count_included: undefined }), undefined)
})

test('unverified count, mismatched first ordinal or impossible totals fail closed', () => {
  for (const malformed of [
    { total_count_included: false },
    { total_count: 0 },
    { total_count: 1 },
    { total_count: -1 },
    { total_count: NaN },
    { total_count: Number.MAX_SAFE_INTEGER + 1 },
    { offset: 1 },
    { offset: -1 },
    { offset: Number.MAX_SAFE_INTEGER + 1 },
    { limit: 0 },
    { limit: 1 },
    { items: [] },
    { items: null },
  ]) {
    assert.throws(() => admit({ ...valid, ...malformed }),
      /Unverified Files first counted Range/, JSON.stringify(malformed))
  }
})

test('verified empty folder is supported; reported positive count cannot mask zero rows', () => {
  const empty = {
    ...valid, items: [], total_count: 0, total_count_included: true,
  }
  assert.strictEqual(admit(empty), empty)
  assert.strictEqual(admit({ ...empty, total_count_included: undefined }), undefined)
})

test('read-only first page validation runs before sparse activation or new rows', () => {
  const controller = fs.readFileSync(
    path.join(repo, 'ui/shared/src/mui/CloudFilesController.ts'), 'utf8')
  const first = controller.slice(controller.indexOf('  const loadDirectory = useCallback('),
    controller.indexOf('  const refreshChangedDirectory'))
  const cold = controller.slice(controller.indexOf('  const loadInitial = useCallback('),
    controller.indexOf('  useEffect(() => () => {', controller.indexOf('  const loadInitial = useCallback(')))
  for (const block of [first, cold]) {
    const admission = block.indexOf('xDriveAdmitCloudFilesCountedFirstPage(read.page)')
    const virtual = block.indexOf('activateVirtualDirectory(')
    const files = block.indexOf('setItems([...range.items])')
    const crumbs = block.indexOf('setCrumbs(')
    assert.ok(admission >= 0 && virtual > admission && files > virtual && crumbs > virtual,
      'neither a cold root nor a folder switch can publish unverified counted rows')
  }
  assert.doesNotMatch(source, /window\.|fetch\s*\(|ipcRenderer|cloudUpload|cloudDelete|localStorage/)
})

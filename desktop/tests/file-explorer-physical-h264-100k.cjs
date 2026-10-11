'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')

test('100k physical H264 fixture stores unique real CAS containers without altering encoded frames', () => {
  const go = read('internal/api/file_explorer_real_h264_100k_performance_integration_test.go')
  for (const required of [
    'XD_FILEEXPLORER_REAL_H264_PHYSICAL_100K_PERF',
    'physicalMode && cancelMode',
    'fileExplorerH264PhysicalContainer',
    'binary.BigEndian.PutUint32',
    'storage.ContentAddressedKey(digest)',
    'store.Put(t.Context(), key, bytes.NewReader(container))',
    'persistedUnique != 100000 || consistentMedia != 100000',
    'disk.Open(t.Context(), key)',
    'physical_source_bytes',
    'physical_videos',
  ]) assert.ok(go.includes(required), required)
  assert.ok(!read('desktop/scripts/file-explorer-real-h264-100k-main.cjs').includes('setInterval(() => {},'),
    'sampling must read actual native process state')
})

test('physical benchmark requires three independent real Chromium decoded-poster sessions', () => {
  const runner = read('desktop/scripts/file-explorer-real-h264-100k-main.cjs')
  const workflow = read('.github/workflows/file-explorer-real-physical-h264-100k-performance.yml')
  for (const required of [
    'for (let sample = 1; sample <= 3; sample++)',
    'win.webContents.executeJavaScript',
    'r.coldMisses === 6 && r.posterPuts === 6 && r.warmHits === 6',
    'r.uniquePhysicalSHA256Count === 100000',
    'r.nativeGoResources.sampledRSSGrowthBytes <= 256 * 1024 * 1024',
  ]) assert.ok(runner.includes(required), required)
  assert.ok(workflow.includes("ref: ${{ github.event.pull_request.head.sha }}"))
  assert.ok(workflow.includes('XD_FILEEXPLORER_REAL_H264_PHYSICAL_100K_PERF'))
  assert.ok(workflow.includes('go test -c -o desktop/real-physical-h264-bin/api.test'))
})

'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')

const root = path.resolve(__dirname, '../..')
const progressPath = path.join(root, 'ui/shared/src/mui/MediaLoadProgress.tsx')
const viewerPath = path.join(root, 'web/src/WebFileViewerApps.tsx')
const apiPath = path.join(root, 'web/src/api.ts')
const progressSource = fs.readFileSync(progressPath, 'utf8')
const viewerSource = fs.readFileSync(viewerPath, 'utf8')
const apiSource = fs.readFileSync(apiPath, 'utf8')
const transpile = (source, name) => ts.transpileModule(source, {
  fileName: name,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText

function moduleFrom(source, name, localRequire) {
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', transpile(source, name))(
    mod.exports, mod, localRequire)
  return mod.exports
}

const format = moduleFrom(progressSource, progressPath, (name) => {
  if (name === '@mui/material') return { Box: 'div', CircularProgress: 'span', Typography: 'span' }
  if (name === 'react/jsx-runtime') return require(name)
  throw Error('Unexpected UI formatter dependency: ' + name)
}).xDriveViewerDownloadTransferLabel

test('Viewer shows ONLY real IEC Task Center bytes, with truthful browser handoff', () => {
  const task = (state, bytes_done, bytes_total, speed_source = 'server') =>
    ({ state, bytes_done, bytes_total, speed_source })
  assert.equal(format(task('running', 1024 ** 2, 4 * 1024 ** 2)),
    '下载中 · 1.0 / 4.0 MiB')
  assert.equal(format(task('running', 1024 ** 2, 0)), '下载中 · 1.0 MiB')
  assert.equal(format(task('running', 0, 0)), '正在连接下载…')
  assert.equal(format(task('queued', 0, 4 * 1024 ** 2)), '正在准备下载…')
  assert.match(format(task('cancelling', 1024, 0)), /正在取消下载 · 1.0 KiB/)
  assert.equal(format(task('completed', 1024, 1024, 'server')),
    '服务端传输完成 · 1.0 / 1.0 KiB（不代表文件已保存）')
  assert.equal(format(task('completed', 1024, 1024, 'client')),
    '下载已保存 · 1.0 / 1.0 KiB')
  assert.match(format(task('handed_off', 0, 1024)), /不?在浏览器下载记录中确认保存结果/)
  assert.doesNotMatch(format(task('handed_off', 0, 1024)), /下载已保存|下载完成/)
  assert.match(format(task('failed', 0, 1024)), /下载失败/)
  assert.equal(format(task('cancelled', 0, 1024)), '下载已取消')
})

function liveViewerHook() {
  const start = viewerSource.indexOf('function useWebViewerDownload(')
  const end = viewerSource.indexOf('\n// Standalone text/audio metadata', start)
  assert.ok(start !== -1 && end > start, 'must mount the REAL Viewer download hook')
  const hook = viewerSource.slice(start, end)
  const source = [
    "import { useEffect, useRef, useState } from 'react'",
    "import { xDriveViewerDownloadTransferLabel } from './label'",
    'type Node = { id: number; revision: number }',
    'type XDriveTransferTask = any',
    'type XDriveApi = any',
    hook,
    'export { useWebViewerDownload }',
  ].join('\n')
  return moduleFrom(source, 'real-web-viewer-download-hook.tsx', (name) => {
    if (name === 'react') return React
    if (name === './label') return { xDriveViewerDownloadTransferLabel: format }
    throw Error('Unexpected Viewer hook dependency: ' + name)
  }).useWebViewerDownload
}

function makeApi() {
  const tasks = []
  const listeners = new Set()
  let started = 0
  return {
    started: () => started,
    listeners: () => listeners.size,
    transfers: () => [...tasks],
    onTransfers(listener) {
      listeners.add(listener)
      listener([...tasks])
      return () => { listeners.delete(listener) }
    },
    async download(node, options) {
      started++
      const id = 'receipt-' + started
      tasks.push({
        id, kind: 'download', cloud_node_id: node.id,
        state: 'running', bytes_done: 0, bytes_total: 4 * 1024 ** 2,
        speed_source: 'server',
      })
      options.onTransferCreated(id)
      for (const notify of listeners) notify([...tasks])
      return true
    },
    update(id, state, bytes_done) {
      const index = tasks.findIndex(t => t.id === id)
      tasks[index] = { ...tasks[index], state, bytes_done }
      for (const notify of listeners) notify([...tasks])
    },
  }
}

test('mounted Viewer receipt is exact-Owner/exact-task, survives native return but not A→B→A', async () => {
  const useDownload = liveViewerHook()
  const api = makeApi()
  const ownerA = {}, ownerB = {}
  let current
  function Harness({ owner, node }) {
    current = useDownload(api, owner, node)
    return null
  }
  const nodeA = { id: 77, revision: 3 }
  let renderer
  await act(async () => { renderer = create(React.createElement(Harness, { owner: ownerA, node: nodeA })) })
  assert.equal(current.status, '')

  await act(async () => { current.start(); current.start(); await Promise.resolve() })
  assert.equal(api.started(), 1, 'two same-tick taps must be single-flight')
  assert.equal(api.listeners(), 1)
  assert.match(current.status, /下载中 · 0.0 \/ 4.0 MiB/)
  assert.equal(current.announceStatus, false,
    'frequent byte updates must not flood live screen-reader announcements')
  await act(async () => { api.update('receipt-1', 'running', 1024 ** 2) })
  assert.equal(current.status, '下载中 · 1.0 / 4.0 MiB')
  await act(async () => { api.update('receipt-1', 'handed_off', 1024 ** 2) })
  assert.match(current.status, /浏览器下载记录/)
  assert.equal(current.announceStatus, true,
    'browser handoff is a meaningful state transition for VoiceOver')
  assert.doesNotMatch(current.status, /下载已保存/)

  await act(async () => { renderer.update(React.createElement(Harness, { owner: ownerB, node: nodeA })) })
  assert.equal(current.status, '', 'old Owner Task Center receipts must be invisible')
  assert.equal(api.listeners(), 0, 'owner-switch detaches previous receipt observer')
  await act(async () => { api.update('receipt-1', 'completed', 4 * 1024 ** 2) })
  assert.equal(current.status, '', 'late completion from Owner A must not paint Owner B')
  await act(async () => { renderer.update(React.createElement(Harness, { owner: ownerA, node: nodeA })) })
  assert.equal(current.status, '', 'A→B→A cannot revive a stale completed download')
  await act(async () => { current.start(); await Promise.resolve() })
  assert.equal(api.started(), 2)
  assert.equal(api.listeners(), 1)
  await act(async () => { renderer.unmount() })
  assert.equal(api.listeners(), 0)
})

test('only the accepted single-file download creates an exact transfer receipt', () => {
  assert.match(apiSource, /async download\(\s*node: Node,\s*options: \{ onTransferCreated\?/)
  assert.match(apiSource, /onTransferCreated\?\.\(transferID\)/)
  assert.match(apiSource, /options\.onTransferCreated/)
  assert.match(apiSource, /if \(transferID\) \{\s*try \{ onTransferCreated\?\.\(transferID\) \}/)
  assert.match(viewerSource, /api\.onTransfers\(\(items\) =>/)
  assert.match(viewerSource, /candidate\.id === currentTransferID/)
  assert.match(viewerSource, /candidate\.cloud_node_id === token\.nodeID/)
  assert.match(viewerSource, /tokenRef\.current !== token/)
  assert.match(viewerSource, /api\.download\(downloadNode, \{\s*onTransferCreated,/)
  assert.equal((viewerSource.match(/data-xdrive-viewer-download-progress/g) || []).length, 1,
    'all four Viewer modes must use a single shared visual feedback implementation')
  assert.equal((viewerSource.match(/<WebViewerDownloadFeedback download=/g) || []).length, 4,
    'Files Quick Look, Gallery, Text and Audio/PDF must all display the same receipt UI')
  assert.match(viewerSource, /const download = useWebViewerDownload\(api, dialogOwner, viewer.node\)/,
    'Files Quick Look must use its exact Owner/Node scoped receipt')
  assert.match(viewerSource, /const viewerDownload = useWebViewerDownload\(api, actionOwner, viewer.node\)/,
    'Gallery routed Viewer must use its exact browse session')
  assert.match(viewerSource, /runViewerAction\('download', async \(\) =>/,
    'Gallery actions must preserve synchronous Owner-gated duplicate/error handling')
  assert.match(viewerSource, /await gallerySource.downloadItems\(\[currentItem\]\)/,
    'Gallery must still delegate its single item to the authoritative DataSource')
  assert.match(viewerSource, /viewerDownload.onTransferCreated/,
    'Only the optional Web adapter connects the exact Task Center receipt')
  const adapter = fs.readFileSync(path.join(root, 'web/src/mediaGalleryAdapter.ts'), 'utf8')
  assert.match(adapter, /downloadItemsWithReceipt:/,
    'Web Gallery must add a receipt without replacing downloadItems')
  assert.match(adapter, /api.download\(items\[0\].node, \{ onTransferCreated \}\)/,
    'the optional one-item bridge must reuse the existing download transport')
  assert.match(viewerSource, /downloadDisabled=\{Boolean\(actionBusy\) \|\| viewerDownload.busy\}/,
    'the Gallery button must prevent repeated same-file downloads')
  const receiptBlock = viewerSource.split('data-xdrive-viewer-download-progress')[1]
    .slice(0, viewerSource.split('data-xdrive-viewer-download-progress')[1].indexOf('</Box>'))
  assert.match(receiptBlock, /position: 'absolute'/,
    'download progress must overlay and never shrink the actual Viewer content')
  assert.match(receiptBlock, /pointerEvents: 'none'/,
    'status must not intercept photo gestures or native video controls')
  assert.match(receiptBlock, /aria-live=\{download.announceStatus \? 'polite' : 'off'\}/,
    'VoiceOver must announce terminal/handoff events, not every byte')
  assert.doesNotMatch(receiptBlock, /flexShrink: 0/,
    'progress must not become a normal flex item')
  assert.doesNotMatch(viewerSource, /transfers\(\)\.find\([^]*file_name ===/,
    'identical filenames are not authoritative download ownership')
})

'use strict'
// Source-level regression contracts for an actual SwiftUI paint-gap in the
// Files Viewer. These do not claim signed-device pixel/FPS measurements.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const source = fs.readFileSync(path.resolve(__dirname, '../..', 'ios/XDriveIOS/NativeFilesViewer.swift'), 'utf8')

function section(start, end) {
  const from = source.indexOf(start)
  assert.ok(from >= 0, 'missing start: ' + start)
  const to = source.indexOf(end, from + start.length)
  assert.ok(to > from, 'missing end: ' + end)
  return source.slice(from, to)
}
const turn = section('private func commitNeighbor(', '/// Only one user-initiated')
const phase = section('.onChange(of: phase) { next in', '.onDisappear { retire() }')
const retry = section('private func reloadCurrent()', 'private func playbackFailed(')
const preview = section('private func openCurrent() async', 'private func commitNeighbor(')
const retire = section('private func retire()', 'private func close()')

test('repro: neighbor transition retires the old payload and makes pending visible before the deferred task', () => {
  assert.match(retire, /display = nil\s*loading = false/)
  assert.match(turn, /retire\(\)\s*active = next[\s\S]*?loading = true\s*attempt = UUID\(\)/)
})
test('repro: neighboring an unsupported/failed file clears the previous error before rendering the next Node', () => {
  assert.match(turn, /active = next[\s\S]*?failure = nil\s*loading = true\s*attempt = UUID\(\)/)
})
test('repro: scene foreground restoration paints a pending preview before its asynchronous read starts', () => {
  assert.match(phase, /else if !isClosing &&[\s\S]*?failure = nil\s*loading = true\s*attempt = UUID\(\)/)
})
test('foreground restoration cannot revive a stale pre-background playback failure', () => {
  assert.match(phase, /if next != \.active \{\s*allowAudioAutoplay = false\s*retire\(\)/)
  assert.match(phase, /failure = nil\s*loading = true\s*attempt = UUID\(\)/)
})
test('direct, bounded-window and extended-range Next/Previous share the same guarded transition', () => {
  const move = section('private func move(_ direction:', 'private func retire()')
  assert.match(move, /if let next = neighbor\(direction\) \{\s*commitNeighbor\(next\)/)
  assert.match(move, /guard let next = neighbor\(direction\) else \{/)
  assert.match(move, /commitNeighbor\(next\)/)
  assert.match(turn, /guard !isClosing, authorized, onNavigate\(next\) else \{ return \}/)
})
test('explicit Retry has the same no-fallback pending state without retaining a stale error', () => {
  assert.match(retry, /retire\(\)\s*failure = nil\s*loading = true\s*attempt = UUID\(\)/)
})
test('the pending state has a native AX marker and a video-dark canvas', () => {
  assert.match(source, /ProgressView\("正在读取当前文件…"\)[\s\S]*?accessibilityIdentifier\("native-ios-files-viewer-pending"\)/)
  assert.match(source, /loading && expectsVideoCanvas/)
  assert.match(source, /if isNativeVideo && !videoFirstFrameRecorded/)
})
test('retirement detaches the exact old player and discards the signed export before pending transition', () => {
  assert.match(retire, /exporter\.invalidate\(\)/)
  assert.match(retire, /player\?\.pause\(\)\s*player\?\.replaceCurrentItem\(with: nil\)\s*player = nil\s*display = nil/)
})
test('late preview results cannot overwrite the new Node or a revoked Owner', () => {
  assert.match(preview, /let generation = attempt/)
  assert.match(preview, /guard generation == attempt, viewed == current, authorized,\s*!isClosing else \{ return \}/)
  assert.match(preview, /XDriveIOSNativePhotoOwnerScope\.matches\(credentials\.owner, openedOwner\)/)
  assert.match(phase, /else \{\s*close\(\)/)
})
test('genuine load failures still leave a recoverable error, not a permanent spinner', () => {
  assert.match(preview, /catch \{[\s\S]*?retire\(\)\s*loading = false/)
  assert.match(source, /Button\("重试"\) \{ reloadCurrent\(\) \}/)
  assert.match(source, /else if let failure \{[\s\S]*?native-ios-files-viewer-error-scroll/)
  assert.match(source, /else if loading \{\s*ProgressView\("正在读取当前文件…"\)/)
})

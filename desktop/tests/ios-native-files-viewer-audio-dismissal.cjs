'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const src = fs.readFileSync(path.resolve(__dirname, '../..', 'ios/XDriveIOS/NativeFilesViewer.swift'), 'utf8')
function part(a, b) {
  const i=src.indexOf(a), j=src.indexOf(b,i+a.length)
  assert.ok(i>=0&&j>i,'missing viewer section '+a)
  return src.slice(i,j)
}
const audio = part('private struct XDriveIOSNativeFileAudioSurface: View', 'struct XDriveIOSNativeFilesViewer: View')
const viewer = part('struct XDriveIOSNativeFilesViewer: View','\n}')
test('audio surface receives caller autoplay intent and foreground scene',()=>{
  assert.match(audio,/let autoplay: Bool\s*@Environment\(\\\.scenePhase\) private var phase/)
})
test('audio does not start automatically while hidden or after suspension',()=>{
  assert.match(audio,/\.onAppear \{\s*guard phase == \.active, autoplay else \{ return \}\s*player\.play\(\)/)
})
test('audio button cannot cause hidden playback',()=>{
  assert.match(audio,/Button \{\s*guard phase == \.active else \{ return \}/)
  assert.match(audio,/\.buttonStyle\(\.borderedProminent\)\s*\.disabled\(phase != \.active\)/)
})
test('audio seeking is disabled while not foreground-active',()=>{
  assert.match(audio,/!editing && duration > 0 && phase == \.active/)
  assert.match(audio,/\.disabled\(duration <= 0 \|\| phase != \.active\)/)
})
test('audio playback is paused immediately on inactive phase',()=>{
  assert.match(audio,/\.onChange\(of: phase\) \{ state in\s*if state != \.active \{\s*player\.pause\(\)\s*playing = false\s*seeking = false/)
})
test('ticker cannot re-render hidden audio surface',()=>{
  assert.match(audio,/\.onReceive\(ticker\) \{ _ in\s*guard phase == \.active else \{ return \}/)
})
test('audio progress never exceeds the native slider bound',()=>{
  assert.match(audio,/value: \$position, in: 0\.\.\.max\(duration, 1\)/)
  assert.match(audio,/position = min\(seconds, max\(duration, 1\)\)/)
  assert.doesNotMatch(audio,/position = min\(seconds, max\(duration, seconds\)\)/)
})
test('backgrounded Viewer refuses audio autoplay on reactivation',()=>{
  assert.match(viewer,/@State private var allowAudioAutoplay = true/)
  assert.match(viewer,/if next != \.active \{\s*allowAudioAutoplay = false\s*retire\(\)/)
})
test('audio surface is bound to actual per-viewer autoplay intent',()=>{
  assert.match(viewer,/XDriveIOSNativeFileAudioSurface\(player: player, autoplay: allowAudioAutoplay\)/)
})
test('explicit close sets one-way dismissal fence before retiring content',()=>{
  assert.match(viewer,/private func close\(\) \{\s*isClosing = true\s*retire\(\)\s*dismiss\(\)/)
})
test('dismissal cannot dispatch another preview GET task',()=>{
  assert.match(viewer,/\.task\(id: attempt\) \{\s*guard !isClosing else \{ return \}\s*await openCurrent\(\)/)
  assert.match(viewer,/private func openCurrent\(\) async \{\s*guard !isClosing else \{ return \}/)
})
test('late successful payload from a dismissed viewer cannot be published',()=>{
  assert.match(viewer,/guard generation == attempt, viewed == current, authorized,\s*!isClosing else \{ return \}/)
  assert.match(viewer,/try Task\.checkCancellation\(\)/)
})
test('late failed preview from revoked Owner cannot re-render the error surface',()=>{
  assert.match(viewer,/catch \{\s*guard !Task\.isCancelled, generation == attempt,\s*viewed == current, authorized, !isClosing else \{ return \}/)
})
test('audio player failure notification is scoped to an open viewer and exact player',()=>{
  assert.match(viewer,/guard authorized, !isClosing,\s*let failed = notification\.object as\? AVPlayerItem/)
  assert.match(viewer,/failed === current/)
})
test('reload, playback failure and page swipe cannot restart a closed viewer',()=>{
  assert.match(viewer,/private func reloadCurrent\(\) \{\s*guard authorized, !isClosing else \{ return \}/)
  assert.match(viewer,/private func playbackFailed\(_ failed: AVPlayerItem\) \{\s*guard authorized, !isClosing, let current/)
  assert.match(viewer,/private func move\(_ direction: Int\) \{\s*guard !isClosing, authorized, !neighborBusy else \{ return \}/)
  assert.match(viewer,/private func commitNeighbor\(_ next: XDriveIOSNativeFilesNode\) \{\s*guard !isClosing, authorized, onNavigate\(next\) else \{ return \}/)
  assert.match(viewer,/neighborJob\?\.cancel\(\)/)
})
test('existing selected node/revision, Owner and signed preview verification remains enforced',()=>{
  assert.match(viewer,/let credentials = try await login\.verifiedAuthorization\(\)/)
  assert.match(viewer,/XDriveIOSNativePhotoOwnerScope\.matches\(credentials\.owner, openedOwner\)/)
  assert.match(viewer,/generation == attempt, viewed == current, authorized/)
})
test('retirement pauses and detaches actual AVPlayer before dropping old display',()=>{
  assert.match(viewer,/player\?\.pause\(\)\s*player\?\.replaceCurrentItem\(with: nil\)\s*player = nil\s*display = nil/)
  assert.match(viewer,/\.onDisappear \{ retire\(\) \}/)
})
test('Files preview remains read-only with no old WebView or upload path',()=>{
  assert.doesNotMatch(src,/WKWebView|import WebKit|UploadSession|document\.cookie/)
})

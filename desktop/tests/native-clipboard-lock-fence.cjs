'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

const swift = read('ios/XDriveIOS/NativeClipboardScreen.swift')
const android = read('android/app/src/main/java/com/tfluid/xdrive/NativeClipboardScreens.kt')
const androidFence = read('android/core/src/main/kotlin/com/tfluid/xdrive/core/XDriveClipboardSessionFence.kt')
const kotlinTests = read('android/core/src/test/kotlin/com/tfluid/xdrive/core/XDriveClipboardSessionFenceTest.kt')

const swiftFunction = name => {
  const marker = '    private func ' + name + '('
  const start = swift.indexOf(marker)
  assert.ok(start >= 0, 'missing native Clipboard ' + name)
  const next = swift.indexOf('    @MainActor', start + marker.length)
  return swift.slice(start, next < 0 ? undefined : next)
}

test('iOS Lock, Owner change and onDisappear invalidate current async session', () => {
  assert.match(swift, /@State private var sessionGeneration: UInt64 = 0/)
  assert.match(swift, /\.onChange\(of: login\.owner\) \{ _ in lock\(\) \}/)
  assert.match(swift, /\.onDisappear \{ lock\(\) \}/)
  const lock = swiftFunction('lock')
  assert.match(lock, /sessionGeneration &\+= 1/)
  assert.match(lock, /key = nil/)
  assert.match(lock, /busy = false/)
  assert.match(lock, /loading = false/)
})

test('iOS async unlock/read/create/delete/clear cannot apply results after Lock', () => {
  assert.match(swiftFunction('authorizedClient'), /sessionGeneration == generation, login\.owner == proof\.owner/)
  for (const name of ['unlock', 'refresh', 'send', 'delete', 'clear']) {
    const method = swiftFunction(name)
    assert.match(method, /let generation = sessionGeneration/, name)
    assert.match(method, /sessionGeneration == generation/, name)
    assert.match(method, /defer \{ if sessionGeneration == generation \{/, name)
  }
  assert.match(swiftFunction('unlock'), /guard sessionGeneration == generation, login\.owner == client\.owner/)
  assert.match(swiftFunction('refresh'), /key != nil else \{ return \}/)
  assert.match(swiftFunction('send'), /if draft == textAtStart \{ draft = "" \}/)
})

test('Android native page locks out delayed requests and preserves new drafts', () => {
  assert.match(android, /remember\(epoch\) \{ XDriveClipboardSessionFence\(\) \}/)
  assert.match(android, /fun stillSession\(snapshot: Long\) = stillOwner\(\) && actionFence\.accepts\(snapshot\)/)
  assert.match(android, /onDispose \{ lock\(\) \}/)
  assert.match(android, /fun lock\(\) \{\s*actionFence\.invalidate\(\)/)
  assert.match(android, /if \(stillSession\(snapshot\) && key === keyAtStart\)/)
  assert.match(android, /if \(draft == textAtStart\) draft = ""/)
  assert.doesNotMatch(android, /finally\s*\{\s*busy\s*=\s*false\s*\}/)
})

test('iOS native Clipboard stops polling while scene is backgrounded', () => {
  assert.match(swift, /@Environment\(\\\.scenePhase\) private var scenePhase/)
  assert.match(swift, /\.task\(id: unlocked && scenePhase == \.active\)/)
  assert.match(swift, /guard unlocked, scenePhase == \.active else \{ return \}/)
  assert.match(swift, /await refresh\(\)[\s\S]*?try await Task\.sleep\(nanoseconds: 15_000_000_000\)/)
  assert.match(swift, /guard !Task\.isCancelled, scenePhase == \.active else \{ break \}/)
  assert.doesNotMatch(swift, /try\? await Task\.sleep\(nanoseconds: 15_000_000_000\)/)
})

test('Android native Clipboard only polls while Lifecycle is STARTED', () => {
  assert.match(android, /val lifecycleOwner = LocalLifecycleOwner\.current/)
  assert.match(android, /lifecycleOwner\.lifecycle\.repeatOnLifecycle\(Lifecycle\.State\.STARTED\)/)
  assert.match(android, /if \(stillOwner\(\) && key != null\) refresh\(\)/)
  assert.match(android, /delay\(15_000\)/)
  assert.doesNotMatch(android, /LaunchedEffect\(epoch, key\) \{/)
})

test('Android session fence has executable JVM race cases, not just a source assertion', () => {
  assert.match(androidFence, /fun invalidate\(\) \{\s*generation \+= 1L/)
  assert.match(androidFence, /fun accepts\(snapshot: Long\): Boolean = generation == snapshot/)
  assert.match(kotlinTests, /lateUnlockCannotRestoreKeyAfterManualLock/)
  assert.match(kotlinTests, /lateMutationFromPreviousUnlockCannotModifySameOwner/)
  assert.match(kotlinTests, /pageDisposalOrOwnerSwitchRejectsLateReads/)
})

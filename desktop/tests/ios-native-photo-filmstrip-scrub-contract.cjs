'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const local = read('ios/XDriveIOS/NativeLocalPhotoViewerFilmstrip.swift')
const cloud = read('ios/XDriveIOS/NativeCloudPhotoAssetViewerFilmstrip.swift')
const policy = read('ios/XDriveIOS/NativePhotoFilmstripScrubPolicy.swift')
const swift = read('ios/tests/NativePhotoFilmstripScrubPolicyChecks.swift')

test('scrub remains in one bounded page and ignores vertical/invalid input', () => {
  assert.match(policy, /static let maximumPageCount = 64/)
  assert.match(policy, /dx.isFinite, dy.isFinite/)
  assert.match(policy, /abs\(dx\) > abs\(dy\) \* 1\.5/)
  assert.match(policy, /count <= maximumPageCount/)
  assert.match(policy, /let moves = min\(CGFloat\(count - 1\)/)
  assert.match(policy, /return max\(0, min\(count - 1, start \+ delta\)\)/)
  for (const phrase of ['vertical pan', 'diagonal pan', 'permission revoked',
    'first page boundary', 'last page boundary', 'cloud 48 slot boundary',
    'unbounded page', 'tap remains tap', 'NaN drag rejected',
    'huge finite drag safely clamped'
  ]) assert.ok(swift.includes(phrase), 'missing executable Swift check: ' + phrase)
})

test('both native filmstrips scrub with authorization, revision and throttled dispatch', () => {
  for (const source of [local, cloud]) {
    assert.match(source, /@State private var scrubStartIndex: Int\?/)
    assert.match(source, /private func scrubChanged\(_ translation: CGSize, force: Bool = false\)/)
    assert.match(source, /private func resetScrub\(\)/)
    assert.match(source, /XDriveIOSNativePhotoFilmstripScrubPolicy\.targetIndex\(/)
    assert.match(source, /horizontal: translation\.width, vertical: translation\.height/)
    assert.match(source, /now - lastScrubDispatch >= 0\.08/)
    assert.match(source, /\.highPriorityGesture\(\s*DragGesture\(minimumDistance: 18, coordinateSpace: \.local\)/)
    assert.match(source, /\.onChanged \{ scrubChanged\(\$0\.translation\) \}/)
    assert.match(source, /\.onEnded \{\s*scrubChanged\(\$0\.translation, force: true\)\s*resetScrub\(\)/)
    assert.match(source, /\.onChange\(of: keys\) \{ _ in resetScrub\(\) \}/)
    assert.match(source, /\.onChange\(of: phase\) \{ newPhase in/)
    assert.match(source, /onSelect\(candidate\)/)
    assert.doesNotMatch(source, /UploadSession|UserDefaults|WKWebView/)
  }
  assert.match(local, /guard admitted, !busy else \{ resetScrub\(\); return \}/)
  assert.match(local, /XDriveIOSNativeLocalFilmstripPolicy\.target\(/)
  assert.match(local, /options\.isNetworkAccessAllowed = false/)
  assert.match(cloud, /XDriveIOSNativeCloudFilmstripPolicy\.target\(/)
  assert.match(cloud, /sameVisibleRevision\(as: candidate\)/)
  assert.match(cloud, /\.onChange\(of: login\.owner\) \{ _ in resetScrub\(\) \}/)
  assert.match(cloud, /login\.verifiedAuthorization\(\)/)
})

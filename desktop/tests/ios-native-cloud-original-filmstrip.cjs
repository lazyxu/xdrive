'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const policy = read('ios/XDriveIOS/NativeCloudOriginalFilmstripPolicy.swift')
const filmstrip = read('ios/XDriveIOS/NativeCloudOriginalViewerFilmstrip.swift')
const gallery = read('ios/XDriveIOS/NativeCloudOriginalGallery.swift')
const checks = read('ios/tests/NativeCloudOriginalFilmstripPolicyChecks.swift')

test('cloud originals filmstrip stays in immutable, exact Owner 48-item selection', () => {
  assert.match(policy, /static let maximumLoaded = 48/)
  assert.match(policy, /Set\(loaded\.map\(\\\.nodeID\)\)\.count == loaded\.count/)
  assert.match(policy, /loaded\.firstIndex\(of: current\)/)
  assert.match(policy, /loaded\.contains\(requested\)/)
  assert.match(filmstrip, /phase == \.active && authorized/)
  assert.match(filmstrip, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, \$0\)/)
  assert.match(filmstrip, /XDriveIOSNativeCloudOriginalFilmstripPolicy\.target\(/)
  assert.match(filmstrip, /onSelect\(node\)/)
  for (const phrase of [
    'Owner revoked', 'outside current 48', 'changed Node revision',
    'reused Node with different name', 'changed original size',
    'changed media type', 'current Node revised', 'oversized window',
    'duplicate Node ID', 'negative original size', 'folder rejected',
    'Live ZIP placeholder admitted without thumbnail'
  ]) assert.ok(checks.includes(phrase), 'missing Swift executable test: ' + phrase)
})

test('lazy current-Owner thumbnail uses existing authenticated derivative, never Live ZIP original', () => {
  assert.match(filmstrip, /LazyHStack/)
  assert.match(filmstrip, /\.task\(id: identity\)/)
  assert.match(filmstrip, /guard authorized, !node\.isLiveArchive,/)
  assert.match(filmstrip, /login\.verifiedAuthorization\(\)/)
  assert.match(filmstrip, /XDriveIOSNativeCloudOriginalReader\(/)
  assert.match(filmstrip, /try await reader\.thumbnail\(node\)/)
  assert.match(filmstrip, /XDriveIOSNativePhotoOwnerScope\.matches\(auth\.owner, owner\)/)
  assert.match(filmstrip, /\.onChange\(of: login\.owner\) \{ _ in image = nil \}/)
  assert.match(filmstrip, /\.onDisappear \{ image = nil \}/)
  assert.match(filmstrip, /scroll\.scrollTo\(current\.id, anchor: \.center\)/)
  assert.doesNotMatch(filmstrip, /livePreview\(|downloadOriginal|URLSession|UploadSession|WKWebView|UserDefaults/)
})

test('original Viewer selects only same revision and retires old player, Live resources and export', () => {
  const v = gallery.slice(gallery.indexOf('struct XDriveIOSNativeCloudOriginalPreview: View'),
    gallery.indexOf('/// SwiftUI\'s ForEach identity'))
  assert.match(v, /private func selectFilmstrip\(_ next: XDriveIOSNativeCloudOriginal\)/)
  assert.match(v, /guard currentOwnerAuthorized, !exporter\.busy, !restoringToPhotos/)
  assert.match(v, /loadedNodes\.first\(where: \{/)
  assert.match(v, /XDriveIOSNativeCloudOriginalFilmstripPolicy\.target\(/)
  assert.match(v, /onViewed\?\(target\) == true/)
  assert.match(v, /cancelPhotoRestore\(\)[\s\S]*?exporter\.invalidate\(\)[\s\S]*?player\?\.pause\(\)[\s\S]*?liveResources\?\.discard\(\)[\s\S]*?activeNode = target/)
  assert.match(v, /XDriveIOSNativeCloudOriginalViewerFilmstrip\(/)
  assert.match(v, /loaded: loadedNodes/)
  assert.match(v, /onSelect: \{ next in selectFilmstrip\(next\) \}/)
  assert.match(v, /if showChrome && \(loadedNodes\.count > 1/)
  assert.match(v, /\.onChange\(of: login\.owner\) \{ _ in/)
})


test('backed-up Original filmstrip scrubs with existing bounded PhotoKit/Owner gesture policy', () => {
  const scrub = read('ios/XDriveIOS/NativePhotoFilmstripScrubPolicy.swift')
  const executable = read('ios/tests/NativePhotoFilmstripScrubPolicyChecks.swift')
  assert.match(scrub, /static let maximumPageCount = 64/)
  assert.match(scrub, /abs\(dx\) > abs\(dy\) \* 1\.5/)
  assert.match(scrub, /dx.isFinite, dy.isFinite/)
  assert.match(policy, /static let maximumLoaded = 48/)
  assert.match(filmstrip, /@State private var scrubStartIndex: Int\?/)
  assert.match(filmstrip, /private func scrubChanged\(_ translation: CGSize, force: Bool = false\)/)
  assert.match(filmstrip, /XDriveIOSNativePhotoFilmstripScrubPolicy\.targetIndex\(/)
  assert.match(filmstrip, /startingAt: origin, loadedCount: visible\.count/)
  assert.match(filmstrip, /horizontal: translation\.width, vertical: translation\.height/)
  assert.match(filmstrip, /visible\.indices\.contains\(target\)/)
  assert.match(filmstrip, /XDriveIOSNativeCloudOriginalFilmstripPolicy\.target\(/)
  assert.match(filmstrip, /candidateKey != key\(current\), candidateKey != lastScrubbedKey/)
  assert.match(filmstrip, /now - lastScrubDispatch >= 0\.08/)
  assert.match(filmstrip, /\.highPriorityGesture\(\s*DragGesture\(minimumDistance: 18, coordinateSpace: \.local\)/)
  assert.match(filmstrip, /\.onChanged \{ scrubChanged\(\$0\.translation\) \}/)
  assert.match(filmstrip, /\.onEnded \{\s*scrubChanged\(\$0\.translation, force: true\)\s*resetScrub\(\)/)
  assert.match(filmstrip, /\.onChange\(of: keys\) \{ _ in resetScrub\(\) \}/)
  assert.match(filmstrip, /\.onChange\(of: login\.owner\) \{ _ in resetScrub\(\) \}/)
  assert.match(filmstrip, /\.onChange\(of: phase\) \{ state in/)
  assert.match(filmstrip, /\.onDisappear \{ resetScrub\(\) \}/)
  assert.match(filmstrip, /onSelect\(candidate\)/)
  for (const label of [
    'vertical pan', 'diagonal pan', 'permission revoked',
    'first page boundary', 'last page boundary', 'cloud 48 slot boundary',
    'NaN drag rejected', 'huge finite drag safely clamped'
  ]) assert.ok(executable.includes(label), 'missing executable Swift policy regression: ' + label)
  assert.doesNotMatch(filmstrip, /UploadSession|downloadOriginal|livePreview\(|UserDefaults|WKWebView/)
})


test('selected cloud Live original uses its already verified still for filmstrip cover', () => {
  assert.match(filmstrip, /let selectedLiveStill: UIImage\?/)
  assert.match(filmstrip, /private var visibleStill: UIImage\?/)
  assert.match(filmstrip, /guard authorized else \{ return nil \}/)
  assert.match(filmstrip, /if selected && node\.isLiveArchive \{ return selectedLiveStill \}/)
  assert.match(filmstrip, /if let visibleStill \{\s*Image\(uiImage: visibleStill\)/)
  assert.match(filmstrip, /selected: key\(node\) == key\(current\),\s*selectedLiveStill: selectedLiveStill/)
  assert.match(gallery, /private var displayedLiveFilmstripStill: UIImage\?/)
  assert.match(gallery, /guard currentOwnerAuthorized, viewed\.isLiveArchive,\s*liveResources != nil, !stillIsThumbnailOnly else \{ return nil \}/)
  assert.match(gallery, /selectedLiveStill: displayedLiveFilmstripStill/)
  assert.match(filmstrip, /guard authorized, !node\.isLiveArchive,/)
  assert.match(gallery, /still = nil[\s\S]*?liveResources\?\.discard\(\)[\s\S]*?liveResources = nil[\s\S]*?activeNode = target/)
  assert.doesNotMatch(filmstrip, /livePreview\(|downloadOriginal|URLSession|UploadSession/)
})


test('cloud Originals Viewer crosses only adjacent preloaded 48-item windows without scanning', () => {
  const child = gallery.slice(gallery.indexOf('struct XDriveIOSNativeCloudOriginalPreview: View'),
    gallery.indexOf('/// SwiftUI\'s ForEach identity'))
  const parent = gallery.slice(gallery.indexOf('struct XDriveIOSNativeCloudOriginalGallery: View'))
  const helper = parent.slice(parent.indexOf('private func adjacentLoadedOriginal('),
    parent.indexOf('    var body: some View {', parent.indexOf('private func adjacentLoadedOriginal(')))
  assert.match(child, /let canCrossLoadedWindow: \(\(XDriveIOSNativeCloudOriginal, Int\) -> Bool\)\?/)
  assert.match(child, /let onCrossLoadedWindow: \(\(XDriveIOSNativeCloudOriginal, Int\) -> XDriveIOSNativeCloudOriginal\?\)\?/)
  assert.match(child, /private func canNavigate\(_ direction: Int\) -> Bool/)
  assert.match(child, /if neighbor\(direction\) == nil \{[\s\S]*?canCrossLoadedWindow\?\(viewed, direction\) == true,[\s\S]*?onCrossLoadedWindow\?\(viewed, direction\)/)
  assert.match(child, /onCrossLoadedWindow\?\(viewed, direction\)[\s\S]*?cancelPhotoRestore\(\)[\s\S]*?exporter\.invalidate\(\)[\s\S]*?player\?\.pause\(\)[\s\S]*?liveResources\?\.discard\(\)[\s\S]*?activeNode = next[\s\S]*?previewRequestID = UUID\(\)/)
  assert.match(child, /if loadedNodes\.count > 1 \|\| canNavigate\(-1\) \|\| canNavigate\(1\)/)
  assert.match(child, /\.disabled\(!canNavigate\(-1\)\)/)
  assert.match(child, /\.disabled\(!canNavigate\(1\)\)/)
  assert.match(helper, /phase == \.active, !refreshAfterViewer,[\s\S]*?!needsForegroundReload/)
  assert.match(helper, /direction == -1 \|\| direction == 1/)
  assert.match(helper, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, owner\)/)
  assert.match(helper, /returning\.revision == current\.revision/)
  assert.match(helper, /viewerLoadedNodes\.count == expected\.count/)
  assert.match(helper, /zip\(viewerLoadedNodes, expected\)\.allSatisfy/)
  assert.match(helper, /currentIndex == start/)
  assert.match(helper, /currentIndex == end - 1/)
  assert.match(helper, /model\.nodes\.indices\.contains\(nextIndex\)/)
  assert.match(helper, /let nextStart = \(nextIndex \/ 48\) \* 48/)
  assert.match(helper, /window\.count <= 48/)
  assert.match(parent, /canCrossLoadedWindow: \{ current, direction in[\s\S]*?adjacentLoadedOriginal\(from: current, direction: direction\) != nil/)
  assert.match(parent, /onCrossLoadedWindow: \{ current, direction in[\s\S]*?viewerLoadedNodes = next\.window[\s\S]*?viewerReturnNode = next\.node/)
  assert.doesNotMatch(helper, /URLSession|livePreview|downloadOriginal|loadNext\(|requestMoreOnScroll\(|UploadSession/)
})

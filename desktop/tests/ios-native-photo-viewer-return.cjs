'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const local = read('ios/XDriveIOS/NativeLocalPhotoGallery.swift')
const continuous = read('ios/XDriveIOS/NativeLocalContinuousGallery.swift')
const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift')
const albums = read('ios/XDriveIOS/NativePhotoAlbumBrowser.swift')
const cloud = read('ios/XDriveIOS/NativeCloudOriginalGallery.swift')


test('active continuous PhotoKit wall restores the exact PhotoKit ID and timestamps after Viewer crossing', () => {
  assert.match(dashboard, /XDriveIOSNativeLocalPhotoTimelineContainer\(/)
  assert.match(continuous, /XDriveIOSNativeLocalContinuousGalleryScreen: View/)
  assert.match(continuous, /\.fullScreenCover\(item: \$selected, onDismiss: restoreAfterViewer\)/)
  assert.match(continuous, /if let expected = returnID, returnPageOffset == page\.startOffset/)
  assert.match(continuous, /\$0\.id == expected && \$0\.capturedAt == returnDate/)
  assert.match(continuous, /\$0\.modifiedAt == returnModified/)
  assert.match(continuous, /scroll\.scrollTo\("photo:\\?\(candidate\.id\)", anchor: \.center\)/)
  assert.match(continuous, /onCrossPage: \{ page, anchor, direction in/)
  assert.match(continuous, /reader\.adjacentPage\(/)
  assert.match(continuous, /onCrossedPage: \{ next, page in\s*returnPageOffset = page\.startOffset/)
  assert.match(continuous, /asset\.creationDate == candidate\.capturedAt/)
  assert.match(continuous, /asset\.modificationDate == candidate\.modifiedAt/)
  assert.match(continuous, /if value != \.active \{[\s\S]*?invalidate\(with: nil\)/)
  assert.doesNotMatch(dashboard, /XDriveIOSNativeLocalGalleryScreen\(/)
})

test('PhotoKit viewer returns to same 64-item page after fresh permission check', () => {
  const wall = local.slice(local.indexOf('struct XDriveIOSNativeLocalGalleryScreen'))
  assert.match(wall, /@Binding var savedOffset: Int/)
  assert.doesNotMatch(wall, /@State private var savedOffset = 0/)
  // The enclosing Gallery owns only a bounded numeric cursor, not a PhotoKit ID.
  assert.match(dashboard, /@State private var localGalleryPageOffset = 0/)
  assert.match(dashboard, /XDriveIOSNativeLocalPhotoTimelineContainer\(\s*savedOffset: \$localGalleryPageOffset,\s*mediaFilter: \$localGalleryMediaFilter,\s*onMapDateScope: \{ galleryMapCaptureRange = \$0 \}\s*\)/)
  assert.doesNotMatch(dashboard, /XDriveIOSNativeLocalGalleryScreen\(/)
  assert.match(dashboard, /localGalleryPageOffset = 0\s*dynamicFeature = nil/)
  assert.match(wall, /\.fullScreenCover\(item: \$selected, onDismiss: \{ restoreAfterViewer\(\) \}\)/)
  assert.match(wall, /libraryChanges\.start\(\)/)
  assert.match(wall, /if grant != authorization \{\s*refresh\(at: savedOffset\)/)
  assert.match(wall, /else if selected == nil && !busy &&[\s\S]*?page == nil \|\| retainedLibraryRevision != libraryChanges\.revision[\s\S]*?refresh\(at: savedOffset\)/)
  assert.match(wall, /if isVisible && phase == \.active \{ refresh\(at: savedOffset\) \}/)
  assert.match(wall, /if phase == \.active \{ refresh\(at: savedOffset\) \}/)
  assert.match(wall, /load\(offset: max\(0, requestedOffset\)\)/)
  assert.match(wall, /savedOffset = next\.startOffset/)
  assert.match(wall, /if selected != nil \{\s*suspendForViewer\(\)/)
  assert.match(wall, /else if phase == \.active &&[\s\S]*?\[\.authorized, \.limited\]\.contains\([\s\S]*?suspendForViewer\(\)/)
  const phase = wall.slice(wall.indexOf('.onChange(of: phase)'),
    wall.indexOf('.onDisappear', wall.indexOf('.onChange(of: phase)')))
  assert.match(phase, /if new != \.active \{\s*if selected != nil \{[\s\S]*?accessibilityFocusedTileID = nil[\s\S]*?suspendForViewer\(\)\s*page = nil/)
  assert.match(phase, /else \{\s*clearViewerTileAnchor\(\)\s*invalidate\(\)\s*\}\s*\} else if selected != nil/)
  assert.match(phase, /if authorization != \.authorized && authorization != \.limited \{\s*clearViewerTileAnchor\(\)\s*invalidate\(\)/)
  assert.match(phase, /\} else if isVisible \{\s*refresh\(at: savedOffset\)\s*\}/)
  assert.doesNotMatch(phase.slice(phase.indexOf('if selected != nil {'),
    phase.indexOf('} else {', phase.indexOf('if selected != nil {'))),
    /selected = nil|viewerReturnID = nil|clearViewerTileAnchor\(\)|invalidate\(\)/)
})

test('album viewer return revalidates the same album and last confirmed offset', () => {
  const wall = albums.slice(albums.indexOf('struct XDriveIOSNativeAlbumContentsScreen'),
    albums.indexOf('struct XDriveIOSNativePhotoAlbumsScreen'))
  assert.match(wall, /@State private var savedOffset = 0/)
  assert.match(wall, /\.fullScreenCover\(item: \$selected, onDismiss: \{ restoreAfterViewer\(\) \}\)/)
  assert.match(wall, /let sameVerifiedPage = page != nil && total != nil && !loading &&/)
  assert.match(wall, /pageRevision == libraryMonitor\.revision &&[\s\S]*?freshGrant == permission/)
  assert.match(wall, /if selected == nil && !sameVerifiedPage && !loading \{ reload\(\) \}/)
  assert.match(wall, /\} else if isContentVisible \{\s*reload\(\)\s*\}/)
  assert.match(wall, /load\(offset: savedOffset\)/)
  assert.match(wall, /savedOffset = loadedPage\.startOffset/)
  assert.match(wall, /let anchor = XDriveIOSNativePhotoVirtualPagePolicy\.normalizedAnchor\(/)
  assert.match(wall, /returnScroll\.scrollTo\("album-page:/)
  assert.match(wall, /if selected != nil \|\| showingAlbumMap \|\|\s*\(phase == \.active && albumAuthorized\) \{\s*suspendForViewer\(\)/)
  assert.match(wall, /\.onChange\(of: libraryMonitor\.revision\)/)
  const phase = wall.slice(wall.indexOf('.onChange(of: phase)'),
    wall.indexOf('.onDisappear', wall.indexOf('.onChange(of: phase)')))
  assert.match(phase, /if state != \.active \{\s*if selected != nil \{[\s\S]*?accessibilityFocusedTileID = nil[\s\S]*?suspendForViewer\(\)\s*page = nil/)
  assert.match(phase, /else \{\s*clearViewerTileAnchor\(\)\s*invalidate\(\)\s*\}\s*\} else if selected != nil/)
  assert.match(phase, /if permission != \.authorized && permission != \.limited \{\s*clearViewerTileAnchor\(\)\s*invalidate\(\)/)
  assert.match(phase, /\} else if isContentVisible \{\s*reload\(\)\s*\}/)
  assert.doesNotMatch(phase.slice(phase.indexOf('if selected != nil {'),
    phase.indexOf('} else {', phase.indexOf('if selected != nil {'))),
    /selected = nil|viewerReturnID = nil|clearViewerTileAnchor\(\)|invalidate\(\)/)
  assert.match(albums, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
})

test('Owner-specific cloud Viewer retains modal state but clears stale previews', () => {
  assert.match(cloud, /\.fullScreenCover\(item: \$selected, onDismiss: \{/)
  assert.match(cloud, /if selected == nil \{\s*refreshAfterViewer = false\s*if phase == \.active, !isTabActive,\s*model\.matchesOwner\(login.owner\) \{\s*needsTabRevalidation = true\s*model\.cancel\(\)\s*\} else \{[\s\S]*?model\.invalidate\(\)/)
  assert.match(cloud, /if refreshAfterViewer \{\s*refreshAfterViewer = false\s*model\.reload\(login: login\)/)
  const ownerChangeStart = cloud.lastIndexOf('.onChange(of: login.owner) { _ in')
  assert.ok(ownerChangeStart >= 0)
  const ownerChanged = cloud.slice(ownerChangeStart)
  assert.match(ownerChanged, /refreshAfterViewer = false\s*selected = nil\s*viewerOwner = nil\s*viewerLoadedNodes = \[\]\s*viewerReturnNode = nil\s*accessibilityFocusedNodeID = nil\s*needsTabRevalidation = false\s*needsForegroundReload = false\s*hasActivated = false\s*model\.invalidate\(\)/)
  assert.match(cloud, /player\?\.pause\(\)[\s\S]*still = nil[\s\S]*dismiss\(\)/)
  assert.doesNotMatch(local + albums, /UserDefaults\.standard|URLSession\(|UploadSession|WKWebView/)
})

const unified = read('ios/XDriveIOS/NativeUnifiedPhotoGallery.swift')

test('Gallery child NavigationLinks keep verified unified page checkpoints on return', () => {
  const life = unified.slice(
    unified.indexOf('struct XDriveIOSNativeUnifiedPhotoGallery: View'),
    unified.indexOf('private var galleryContent:')
  )
  assert.match(unified, /NavigationLink\(isActive: \$showingThumbnailCache\) \{\s*XDriveIOSNativePhotoThumbnailCacheScreen\(login: login\)/)
  assert.match(unified, /NavigationLink\(isActive: \$showingPeople\) \{\s*XDriveIOSNativeGalleryPeople\(login: login\)/)
  const disappeared = life.slice(
    life.indexOf('.onDisappear {'), life.indexOf('.onChange(of: photoObserver.change)')
  )
  assert.match(disappeared, /photoObserver\.stop\(\)/)
  assert.match(disappeared, /explicitOriginalAudit = false/)
  assert.doesNotMatch(disappeared, /started = false|timeline\.reset\(\)|wall\.reset\(\)/)
  // Owner, PhotoKit epoch and scene invalidation must still run independently.
  assert.match(life, /validateForegroundWall\(\)/)
  assert.match(unified, /private func validateForegroundWall\(\) \{[\s\S]*XDriveIOSNativePhotoFingerprintIndex\.isCurrent\(\$0\)/)
  assert.match(unified, /if XDriveIOSUnifiedGalleryScenePolicy\.requiresResetOnReturn\([\s\S]*?\) \{\s*reset\(\)/)
  const phase = life.slice(life.indexOf('.onChange(of: phase)'), life.indexOf('.sheet(isPresented: $showFilters)'))
  assert.doesNotMatch(phase, /wall\.reset\(\)|timeline\.reset\(\)/)
  assert.match(life, /\.onChange\(of: login\.owner\) \{ _ in/)
  assert.match(life, /\.onChange\(of: phase\) \{ state in/)
})

test('native Gallery Map and album Map covers preserve their bounded verified page state', () => {
  const localWall = continuous.slice(continuous.indexOf(
    'struct XDriveIOSNativeLocalContinuousGalleryScreen: View'
  ))
  const localDisappearance = localWall.slice(
    localWall.indexOf('.onDisappear {', localWall.indexOf('.onChange(of: phase)')),
    localWall.indexOf('private func mediaFilterBinding')
  )
  assert.match(localDisappearance, /if selected != nil \|\| showingMap \|\|\s*\(phase == \.active && authorized\) \{/)
  assert.match(localDisappearance, /suspendForCoveredNavigation\(\)/)
  assert.match(localDisappearance, /\} else \{\s*invalidate\(with: nil\)\s*monitor\?\.stop\(\)/)
  const suspended = localWall.slice(
    localWall.indexOf('private func suspendForCoveredNavigation()'),
    localWall.indexOf('private func reload()')
  )
  assert.match(suspended, /scanTask\?\.cancel\(\)/)
  assert.doesNotMatch(suspended, /total = 0|generation = UUID\(\)|monitor\?\.stop\(\)/)
  assert.match(localWall, /if value != \.active \{[\s\S]*?invalidate\(with: nil\)/)
  const albumWall = albums.slice(
    albums.indexOf('struct XDriveIOSNativeAlbumContentsScreen: View'),
    albums.indexOf('struct XDriveIOSNativePhotoAlbumsScreen: View')
  )
  assert.match(albumWall, /if selected != nil \|\| showingAlbumMap \|\|\s*\(phase == \.active && albumAuthorized\) \{\s*suspendForViewer\(\)/)
  assert.match(albumWall, /else \{\s*libraryMonitor\.stop\(\)\s*invalidate\(\)\s*\}/)
  assert.match(albumWall, /\.onChange\(of: libraryMonitor\.revision\) \{ _ in[\s\S]*?invalidate\(\)/)
  assert.match(albumWall, /\.onChange\(of: phase\) \{ state in/)
})

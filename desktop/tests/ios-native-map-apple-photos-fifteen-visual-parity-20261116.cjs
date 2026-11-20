'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift')
const local = read('ios/XDriveIOS/NativeLocalPhotoMap.swift')
const owner = read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')
const unified = read('ios/XDriveIOS/NativeUnifiedSourcePhotoMap.swift')
const sourceSurface = read('ios/XDriveIOS/NativeUnifiedSourceMapSurface.swift')
const ownerPlace = read('ios/XDriveIOS/NativeOwnerMapClusterAlbum.swift')
const cloudWall = read('ios/XDriveIOS/NativeServerMediaGallery.swift')
const components = read('ios/XDriveIOS/NativePhotoWallComponents.swift')
const markerPolicy = read('ios/XDriveIOS/NativeMapMarkerVisualPolicy.swift')
const ui = read('ios/UITests/XDriveIOSMapNavigationRuntimeUITests.swift')
const movieAudit = read('ios/scripts/audit_native_map_journey.py')

const check = (name, assertions) => test(name, assertions)

check('P0-01 map takes available canvas rather than a multi-row count footer', () => {
  for (const file of [local, owner, unified]) {
    assert.match(file, /\.overlay\(alignment: \.bottomLeading\)/)
    assert.match(file, /XDriveIOSNativePhotoMapStatusPill\(/)
  }
  assert.doesNotMatch(owner, /Text\("当前视窗已有 /)
})
check('P0-02 floating map type and location are 44pt controls, dates remain in one overflow menu', () => {
  assert.match(components, /struct XDriveIOSNativePhotoMapFloatingTools: View/)
  assert.match(components, /frame\(width: 44, height: 44\)/)
  for (const file of [local, owner, unified]) {
    assert.match(file, /XDriveIOSNativePhotoMapFloatingTools\(/)
    assert.match(file, /XDriveIOSNativePhotoMapGridAction\(/)
    assert.match(file, /Label\("地图操作", systemImage: "ellipsis.circle"\)/)
    assert.match(file, /Label\("地图日期", systemImage: "calendar"\)/)
  }
  assert.match(ui, /let actions = element\("native-ios-local-map-actions", in: app\)/)
  assert.match(ui, /actions\.tap\(\)/)
  assert.match(ui, /let dateMenu = element\("native-ios-local-map-capture-menu", in: app\)/)
  assert.match(ui, /dateMenu\.waitForExistence\(timeout: 6\)/)
  assert.match(ui, /let chooseDate = byID\.exists \? byID : byLabel/)
  assert.match(ui, /chooseDate\.tap\(\)/)
})
check('P0-03 technical source/Owner prose is not a normal photo-map count', () => {
  assert.doesNotMatch(owner, /Text\("当前 Server Owner 已索引/)
  assert.doesNotMatch(owner, /Text\("当前视窗已有 /)
  assert.doesNotMatch(unified, /Text\("当前地图视窗或来源权限待核验/)
})
check('P0-04 place sheet uses a photo-first header from the same presentation component', () => {
  assert.match(local, /XDriveIOSNativePhotoMapPlaceHeader\(/)
  assert.match(ownerPlace, /XDriveIOSNativePhotoMapPlaceHeader\(/)
  assert.match(unified, /XDriveIOSNativePhotoMapPlaceHeader\(/)
  assert.match(components, /if let count \{[\s\S]*?Text\(/)
  // Location's prominent accessible header is the only visible Sheet title.
  // Keep a single title; avoid repeating it in a centered navigation bar.
  for (const file of [local, ownerPlace, unified]) {
    assert.match(file, /\.navigationTitle\(""\)/)
  }
})
check('P0-05 map stays beneath the bounded Sheet and H264 audit is navigation-scoped', () => {
  assert.match(local, /\.sheet\(item: \$globalSelection, onDismiss:/)
  assert.match(owner, /\.sheet\(item: \$selectedCluster, onDismiss:/)
  assert.match(unified, /\.sheet\(item: \$selected, onDismiss:/)
  assert.match(movieAudit, /def navigation_start_seconds\(/)
  assert.match(movieAudit, /real MapKit place\/Viewer\/Back events|real MapKit place\/Viewer|verified_route_taps/)
})
check('P0-06 local/Owner/source marker selected and shadow states share one policy', () => {
  for (const file of [local, owner, sourceSurface]) {
    assert.match(file, /XDriveIOSNativeMapMarkerVisualPolicy\.decorate\(self\)/)
    assert.match(file, /override func setSelected\(_ selected: Bool, animated: Bool\)/)
    assert.match(file, /XDriveIOSNativeMapMarkerVisualPolicy\.updateSelection\(/)
  }
  assert.match(markerPolicy, /UIAccessibility\.isReduceMotionEnabled/)
})
check('P1-07 place titles use locality/facet name and a safe fallback', () => {
  assert.match(unified, /placeName \?\? \(isNearbyExpansion/)
  assert.match(owner, /name: item\.name, owner: expected/)
  assert.match(cloudWall, /placeDisplayName \?\? "此地点的照片"/)
})
check('P1-08 the place wall is a compact shared date/grid layout', () => {
  for (const file of [local, ownerPlace, unified]) {
    assert.match(file, /XDriveIOSNativePhotoWallSectionList\(/)
    assert.match(file, /XDriveIOSNativePhotoWallTimeScaleControls\(/)
    assert.match(file, /\.controlSize\(\.small\)/)
  }
})
check('P1-09 nearby stays in the same verified navigation stack', () => {
  assert.match(unified, /\.navigationDestination\(isPresented: \$nearbyPresented\)/)
  assert.match(unified, /Label\("显示附近照片", systemImage:/)
  assert.doesNotMatch(unified, /\.sheet\(isPresented: \$nearbyPresented\)/)
  assert.match(unified, /isNearbyExpansion: true/)
})
check('P1-10 native media viewers keep current verification and one filmstrip', () => {
  assert.match(unified, /private var viewerNavigation: some View/)
  assert.match(unified, /admitViewerNeighbor\(row\)/)
  assert.match(unified, /onUnifiedNavigate: navigateViewer/)
  assert.match(unified, /viewing\?\.row\.id == row\.id/)
})
check('P1-11 verified Viewer focus and pixel-return anchor survive same-window return', () => {
  assert.match(unified, /viewerReturnViewport\?\.alignment\(/)
  assert.match(unified, /viewerOpeningWindow == windowIndex/)
  assert.match(unified, /focusedTileID = id/)
  assert.match(components, /struct XDriveIOSNativePhotoWallViewportAnchor: Equatable/)
  assert.match(local, /viewerOpeningID != checkedID/)
})
check('P1-12 map action targets remain at least 44 points where controls are visible', () => {
  for (const file of [local, owner, unified]) {
    assert.match(file, /\.frame\(minWidth: 44, minHeight: 44\)/)
  }
})
check('P1-13 loading/empty/error text stays brief without changing retry authorization', () => {
  assert.match(local, /地图暂时无法加载，请检查网络后重试/)
  assert.match(owner, /地图暂时无法加载，请检查网络后重试/)
  assert.match(unified, /地图暂时无法加载，请检查网络后重试/)
  assert.match(unified, /XDriveIOSNativePhotoWallRetryMessage\(/)
  assert.match(ownerPlace, /XDriveIOSNativePhotoWallFeedback\(/)
})
check('P1-14 three data sources retain readers but reuse photo-first presentation', () => {
  assert.match(local, /XDriveIOSNativePhotoMapStatusPill/)
  assert.match(owner, /XDriveIOSNativePhotoMapStatusPill/)
  assert.match(unified, /XDriveIOSNativePhotoMapStatusPill/)
  assert.match(local, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
  assert.match(owner, /XDriveIOSNativePhotoOwnerScope\.matches/)
  assert.match(unified, /XDriveIOSNativePhotoFingerprintIndex\.isCurrent/)
})
check('P1-15 large Dynamic Type, dark appearance and camera stability retain test contracts', () => {
  assert.match(components, /dynamicTypeSize\.isAccessibilitySize \? nil : 2/)
  assert.match(owner, /XDriveIOSNativePhotoMapPolicy\.compactViewport\(/)
  assert.match(local, /XDriveIOSNativePhotoMapPolicy\.compactViewport\(/)
  assert.match(ui, /testPhotoKitPlaceWallDarkAppearanceSnapshotEvidence/)
  assert.match(ui, /testMapCameraLayoutAndUnverifiedGestureNeverClosesTheApp/)
})

check('13-map P0 overlays never access credentials or broaden grid membership', () => {
  const pureControls = components.slice(
      components.indexOf('struct XDriveIOSNativePhotoMapFloatingTools: View'),
      components.indexOf('/// Photo-first, accessible location header'))
  assert.doesNotMatch(pureControls, /PHPhotoLibrary|OwnerScope|URLSession|PHAsset|upload/)
  assert.match(local, /private func openCurrentMapGrid\(\)[\s\S]*?acceptsCellSelection\(/)
  assert.match(owner, /private func openCurrentMapGrid\(\)[\s\S]*?acceptsSelectedCluster\(/)
  assert.match(unified, /enabled: currentProof && !pins\.isEmpty/)
  assert.match(unified, /pins\.allSatisfy\(\{ \$0\.count > 0 \}\)/)
  assert.match(unified, /viewportPins: pins/)
  assert.match(unified, /showingViewportGrid = false/)
  assert.match(local, /\.navigationTitle\("地图"\)/)
  assert.match(owner, /\.navigationTitle\("地图"\)/)
  assert.match(unified, /\.navigationTitle\("地图"\)/)
})

check('P0-07 closing MapKit must retain the same bounded Gallery wall, not remount a white PhotoKit spinner', () => {
  assert.match(dashboard, /@State private var keepUnifiedWallDuringMap = false/)
  assert.match(dashboard, /if gallerySource == \.unified \|\|[\s\S]*?\(gallerySource == \.map && keepUnifiedWallDuringMap\)/)
  assert.match(dashboard, /\.opacity\(gallerySource == \.map \? 0 : 1\)/)
  assert.match(dashboard, /\.allowsHitTesting\(gallerySource != \.map\)/)
  assert.match(dashboard, /\.accessibilityHidden\(gallerySource == \.map\)/)
  assert.match(dashboard, /keepUnifiedWallDuringMap = gallerySource == \.unified/)
  assert.match(dashboard, /keepUnifiedWallDuringMap = false/)
  assert.match(dashboard, /case \.map:[\s\S]*?XDriveIOSNativePhotoMapsScreen\(/)
  // Actual zero-white-frame acceptance remains the real H264 audit; this
  // source contract only prevents a reintroduction of the remount cause.
})

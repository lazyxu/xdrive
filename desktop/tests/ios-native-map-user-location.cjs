'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8')
const settings = read('ios/project.yml')
const controller = read('ios/XDriveIOS/NativeMapUserLocationController.swift')
const local = read('ios/XDriveIOS/NativeLocalPhotoMap.swift')
const owner = read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')

test('separate user-initiated When In Use permission; no location-on-map-entry or backup', () => {
  assert.match(settings, /NSLocationWhenInUseUsageDescription:/)
  assert.doesNotMatch(settings, /NSLocationAlways|UIBackgroundModes:[\s\S]*?location/)
  const beforeTap = controller.slice(0, controller.indexOf('private func requestLocationOnce('))
  assert.doesNotMatch(beforeTap, /CLLocationManager\(\)|\.delegate = self|requestWhenInUseAuthorization|requestLocation\(/)
  const locate = controller.slice(controller.indexOf('func locate()'),
    controller.indexOf('func locationManagerDidChangeAuthorization'))
  assert.match(locate, /let requestManager = CLLocationManager\(\)[\s\S]*?manager = requestManager\s*requestManager\.delegate = self/)
  assert.match(locate, /guard !pending else \{ return \}/)
  assert.match(locate, /CLLocationManager\.locationServicesEnabled\(\)/)
  assert.match(locate, /case \.notDetermined:[\s\S]*?requestManager\.requestWhenInUseAuthorization\(\)/)
  assert.match(locate, /case \.denied, \.restricted:/)
  assert.doesNotMatch(controller, /requestAlwaysAuthorization|startUpdatingLocation|UserDefaults|URLSession|UploadSession|print\(/)
})

test('one-shot foreground fix must be fresh and valid, and cancellation revokes late callbacks', () => {
  assert.match(controller, /source\.requestLocation\(\)/)
  assert.match(controller, /guard let self, self\.pending, self\.manager === manager else \{ return \}/)
  assert.match(controller, /\$0\.horizontalAccuracy\.isFinite && \$0\.horizontalAccuracy >= 0/)
  assert.match(controller, /abs\(\$0\.timestamp\.timeIntervalSinceNow\) <= 120/)
  assert.match(controller, /CLLocationCoordinate2DIsValid\(\$0\.coordinate\)/)
  assert.match(controller, /self\.camera = MKCoordinateRegion\([\s\S]*?self\.showsUserDot = true[\s\S]*?self\.requestID = UUID\(\)/)
  assert.match(controller, /func cancel\(\) \{[\s\S]*?pending = false[\s\S]*?manager\?\.stopUpdatingLocation\(\)[\s\S]*?manager\?\.delegate = nil[\s\S]*?manager = nil[\s\S]*?requestID = nil[\s\S]*?showsUserDot = false/)
})

test('local map locates only on explicit tap and preserves PhotoKit Cell authorization', () => {
  assert.match(local, /@StateObject private var currentLocation = XDriveIOSNativeMapUserLocationController\(\)/)
  assert.match(local, /Button \{\s*currentLocation\.locate\(\)\s*\} label: \{\s*Label\("我的位置", systemImage: "location"\)/)
  assert.match(local, /if mapScope == \.library && authorization == \.authorized \{/)
  assert.match(local, /native-ios-local-map-locate/)
  assert.match(local, /focusRequestID: currentLocation\.requestID,[\s\S]*?focusCamera: currentLocation\.camera,[\s\S]*?showsUserDot: currentLocation\.showsUserDot/)
  assert.match(local, /if let focusID = focusRequestID,[\s\S]*?context\.coordinator\.focusRequestID = focusID[\s\S]*?map\.setRegion\(focusCamera, animated: true\)/)
  assert.match(local, /\.onChange\(of: currentLocation\.requestID\)[\s\S]*?if globalViewport != nil \{ globalCameraMoving = true \}/)
  assert.match(local, /canSelectCells: refinedViewportIsCurrent/)
  assert.match(local, /\.onDisappear \{\s*currentLocation\.cancel\(\)/)
})

test('cloud Owner map locates and revokes prior verified camera before scoped reread', () => {
  assert.match(owner, /@StateObject private var currentLocation = XDriveIOSNativeMapUserLocationController\(\)/)
  assert.match(owner, /native-ios-owner-map-locate/)
  assert.match(owner, /focusRequestID: currentLocation\.requestID,[\s\S]*?focusCamera: currentLocation\.camera,[\s\S]*?showsUserDot: currentLocation\.showsUserDot/)
  assert.match(owner, /\.onChange\(of: currentLocation\.requestID\) \{ _ in[\s\S]*?guard phase == \.active, login\.owner != nil,[\s\S]*?revokeCameraAuthorization\(\)[\s\S]*?scheduleCameraRefresh\(\)/)
  assert.match(owner, /map\.setRegion\(focusCamera, animated: true\)/)
  assert.match(owner, /\.onChange\(of: login\.owner\) \{ _ in\s*currentLocation\.cancel\(\)/)
  assert.match(owner, /\.onDisappear \{\s*currentLocation\.cancel\(\)/)
  assert.doesNotMatch(owner, /CLLocationManager\(|requestWhenInUseAuthorization\(/)
})

test('user location dot is opt-in; a permission loss or scene exit clears it', () => {
  assert.match(local, /map\.showsUserLocation = false/)
  assert.match(owner, /map\.showsUserLocation = false/)
  assert.match(local, /if map\.showsUserLocation != showsUserDot \{\s*map\.showsUserLocation = showsUserDot\s*\}/)
  assert.match(owner, /if map\.showsUserLocation != showsUserDot \{\s*map\.showsUserLocation = showsUserDot\s*\}/)
  assert.match(controller, /if status == \.denied \|\| status == \.restricted \{\s*self\.showsUserDot = false/)
  assert.match(local, /onChange\(of: phase\)[\s\S]*?currentLocation\.cancel\(\)/)
  assert.match(owner, /onChange\(of: phase\)[\s\S]*?currentLocation\.cancel\(\)/)
})

test('cancelled requests cannot inject a late fix into another explicit tap', () => {
  const auth = controller.slice(controller.indexOf('func locationManagerDidChangeAuthorization'),
    controller.indexOf('func locationManager(_ manager: CLLocationManager,\n                         didUpdateLocations'))
  const updates = controller.slice(controller.indexOf('didUpdateLocations locations: [CLLocation]'),
    controller.indexOf('func locationManager(_ manager: CLLocationManager, didFailWithError'))
  const failure = controller.slice(controller.indexOf('func locationManager(_ manager: CLLocationManager, didFailWithError'),
    controller.indexOf('/// Prevent any outstanding one-shot callback'))
  assert.match(auth, /self\.manager === manager/)
  assert.match(updates, /guard let self, self\.pending, self\.manager === manager else \{ return \}/)
  assert.match(updates, /manager\.delegate = nil\s*self\.manager = nil/)
  assert.match(failure, /guard let self, self\.pending, self\.manager === manager else \{ return \}/)
  assert.match(controller, /private func fail\(_ message: String\) \{[\s\S]*?manager\?\.delegate = nil[\s\S]*?manager = nil[\s\S]*?camera = nil[\s\S]*?requestID = nil[\s\S]*?showsUserDot = false/)
})

test('Owner locate transparently discloses its existing signed viewport query', () => {
  assert.match(settings, /NSLocationWhenInUseUsageDescription:.*云端地图会向当前 xDrive 服务器查询该位置周围的地图视窗/)
  const reload = owner.slice(owner.indexOf('private func reload()'))
  assert.match(reload, /let bounds = XDriveIOSNativeOwnerMapSelectionPolicy\.viewportBounds\([\s\S]*?latitude: camera\.center\.latitude,[\s\S]*?longitude: camera\.center\.longitude/)
  assert.match(reload, /reader\.mapOverview\(bounds: bounds, detail: true\)/)
  // The client does not add a separate raw-location upload or durable store.
  assert.doesNotMatch(controller, /UserDefaults|URLSession|UploadSession|print\(|Keychain/)
})

test('an existing authorization callback cannot double-submit one location request', () => {
  assert.match(controller, /private var requestedFix = false/)
  assert.match(controller, /private func requestLocationOnce\(_ source: CLLocationManager\) \{\s*guard pending, manager === source, !requestedFix else \{ return \}\s*requestedFix = true\s*source\.requestLocation\(\)/)
  const locate = controller.slice(controller.indexOf('func locate()'),
    controller.indexOf('func locationManagerDidChangeAuthorization'))
  const auth = controller.slice(controller.indexOf('func locationManagerDidChangeAuthorization'),
    controller.indexOf('func locationManager(_ manager: CLLocationManager,\n                         didUpdateLocations'))
  assert.match(locate, /requestedFix = false[\s\S]*?case \.authorizedAlways, \.authorizedWhenInUse:\s*requestLocationOnce\(requestManager\)/)
  assert.match(auth, /status == \.authorizedAlways \|\| status == \.authorizedWhenInUse \{\s*self\.requestLocationOnce\(manager\)/)
  assert.match(controller, /func cancel\(\) \{\s*pending = false\s*isLocating = false\s*requestedFix = false/)
  assert.match(controller, /private func fail\(_ message: String\) \{\s*pending = false\s*isLocating = false\s*requestedFix = false/)
})

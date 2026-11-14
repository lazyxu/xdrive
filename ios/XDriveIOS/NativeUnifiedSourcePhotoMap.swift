import MapKit
import Photos
import SwiftUI
import UIKit

/// M07: an exact, Owner-bound projection of the EXISTING unified Gallery
/// reconciliation stream. Neither a map pin nor its count is authorization.
/// A scan retains at most 64 aggregate records and one bounded Gallery page;
/// it never persists PhotoKit identifiers, coordinates or cloud credentials.
private enum XDriveIOSUnifiedSourceMapPolicy {
    static let maximumPages = 10_000
    // A sparse 48-row Gallery window may have >256 nonmatching pages
    // between two GPS members. Do not stop before the proved map's bound.
    static let maximumWallSeekPages = maximumPages

    static func canonicalLongitude(_ longitude: Double) -> Double {
        // WGS84's +180 and -180 describe the SAME meridian. Unify before
        // bucketing AND computing MapKit representative coordinates.
        longitude == 180 ? -180 : longitude
    }

    // Exactly the same origin-aligned, power-of-two grid as the existing
    // PhotoKit MapKit scanner. The verified source is re-enumerated on zoom
    // rather than spreading an old global cell's count across smaller pins.
    static func cellKey(latitude: Double, longitude: Double, level: Int)
        -> XDriveIOSNativeLocalMapSpatialPolicy.Key? {
        XDriveIOSNativeLocalMapSpatialPolicy.key(
            latitude: latitude, longitude: longitude, level: level)
    }

    static func member(
        latitude: Double, longitude: Double,
        key: XDriveIOSNativeLocalMapSpatialPolicy.Key,
        viewport: XDriveIOSNativeLocalMapViewport?
    ) -> Bool {
        XDriveIOSNativeLocalMapSpatialPolicy.includes(
            viewport, latitude: latitude, longitude: longitude) &&
        cellKey(latitude: latitude, longitude: longitude,
                level: key.level) == key
    }

    static func coordinates(
        for row: XDriveIOSNativeUnifiedPhoto
    ) -> CLLocationCoordinate2D? {
        if let local = row.local {
            // Do not infer geography from the cloud's similarly named photo:
            // the Gallery primarily renders this currently authorized local.
            guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized,
                  let asset = PHAsset.fetchAssets(
                    withLocalIdentifiers: [local.id], options: nil
                  ).firstObject, let position = asset.location?.coordinate,
                  XDriveIOSNativePhotoMapPolicy.validCoordinate(
                      latitude: position.latitude, longitude: position.longitude)
            else { return nil }
            return CLLocationCoordinate2D(
                latitude: position.latitude,
                longitude: canonicalLongitude(position.longitude))
        }
        if let metadata = row.cloud?.metadata, let latitude = metadata.latitude,
           let longitude = metadata.longitude,
           XDriveIOSNativePhotoMapPolicy.validCoordinate(
                latitude: latitude, longitude: longitude) {
            return CLLocationCoordinate2D(
                latitude: latitude,
                longitude: canonicalLongitude(longitude))
        }
        return nil
    }
}

private struct XDriveIOSUnifiedSourceMapSeed {
    let row: XDriveIOSNativeUnifiedPhoto
    let cursor: XDriveIOSNativeGalleryCursor
}

/// Compact, ephemeral GPS + source cursor (never raw media IDs or pixels).
private struct XDriveIOSUnifiedSourceCachedCoordinate {
    let latitude: Double
    let longitude: Double
    let page: Int
    let ordinal: Int
}

struct XDriveIOSUnifiedSourceMapPin: Identifiable {
    let key: XDriveIOSNativeLocalMapSpatialPolicy.Key
    let latitude: Double
    let longitude: Double
    let count: Int
    // A display hint only; live membership and Owner admission are required
    // before presenting its original image or Cloud Node.
    let representative: XDriveIOSNativeUnifiedPhoto
    let viewport: XDriveIOSNativeLocalMapViewport?
    let firstCursor: XDriveIOSNativeGalleryCursor
    var id: String { key.id }
}

/// The map is published only after the COMPLETE verified source filter has
/// been traversed. Provisional source states and failed partial indexes do
/// not produce an authoritative count or a clickable marker.
struct XDriveIOSNativeUnifiedSourcePhotoMapScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let presence: XDriveIOSNativeGalleryPresence
    let query: XDriveIOSNativeUnifiedGalleryQuery
    let onClose: () -> Void
    var onSaveCamera: ((MKCoordinateRegion) -> Void)? = nil

    @Environment(\.scenePhase) private var phase
    // The Gallery underneath stops its PHChange observer while the modal
    // Map is open. Register one in this Map so stale GPS counts disappear
    // immediately after edits rather than only on the next user gesture.
    @StateObject private var photoChanges = XDriveIOSUnifiedPhotoObserver()
    @StateObject private var currentLocation = XDriveIOSNativeMapUserLocationController()
    @State private var mapType: MKMapType = .standard
    @State private var basemapUnavailable = false
    @State private var datePickerOpen = false
    @State private var requestedCaptureDay = Date()
    @State private var scopedQuery: XDriveIOSNativeUnifiedGalleryQuery
    @State private var mapRevision = UUID()
    @State private var cameraRequestID: UUID?
    @State private var remotePollTask: Task<Void, Never>?
    @State private var cachedCoordinates: [XDriveIOSUnifiedSourceCachedCoordinate] = []
    @State private var cachedCursors: [XDriveIOSNativeGalleryCursor] = []
    @State private var cachedOwner: XDriveNativeOwnerRoot?
    @State private var cachedLibrary: Data?
    @State private var cachedQuery: XDriveIOSNativeUnifiedGalleryQuery?
    @State private var cachedPresence: XDriveIOSNativeGalleryPresence?
    @State private var scanTask: Task<Void, Never>?
    @State private var cameraSettleTask: Task<Void, Never>?
    @State private var coverTask: Task<Void, Never>?
    @State private var localCoverRequests: [PHImageRequestID] = []
    @State private var generation = UUID()
    @State private var busy = false
    @State private var error: String?
    @State private var pins: [XDriveIOSUnifiedSourceMapPin] = []
    @State private var coverImages: [String: UIImage] = [:]
    @State private var coverUnavailable: Set<String> = []
    @State private var selected: XDriveIOSUnifiedSourceMapPin?
    @State private var provedOwner: XDriveNativeOwnerRoot?
    @State private var provedLibrary: Data?
    @State private var provedCamera: MKCoordinateRegion?
    @State private var didFitFirstVerifiedMap = false
    @State private var camera = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 0, longitude: 0),
        span: MKCoordinateSpan(latitudeDelta: 160, longitudeDelta: 360)
    )

    init(login: XDriveIOSNativeOwnerLoginModel,
         presence: XDriveIOSNativeGalleryPresence,
         query: XDriveIOSNativeUnifiedGalleryQuery,
         restoredCamera: MKCoordinateRegion? = nil,
         onSaveCamera: ((MKCoordinateRegion) -> Void)? = nil,
         onClose: @escaping () -> Void) {
        self.login = login
        self.presence = presence
        self.query = query
        self.onClose = onClose
        self.onSaveCamera = onSaveCamera
        _scopedQuery = State(initialValue: query)
        if let restoredCamera {
            _camera = State(initialValue: restoredCamera)
            _didFitFirstVerifiedMap = State(initialValue: true)
        }
    }

    private func setDateRange(_ value: XDriveIOSNativePhotoMapCaptureRange?) {
        guard !busy else { return }
        var updated = scopedQuery
        updated.from = value?.from
        updated.until = value?.to
        guard updated.isValid else { return }
        scopedQuery = updated
        didFitFirstVerifiedMap = false
        reload()
    }

    private func startRemotePoll() {
        remotePollTask?.cancel()
        remotePollTask = Task { @MainActor in
            while !Task.isCancelled {
                // Cloud additions, edits and removals invalidate negative
                // source claims too. Do not confuse a provisional page with
                // an authoritative empty location index.
                do { try await Task.sleep(nanoseconds: 30_000_000_000) }
                catch { break }
                guard !Task.isCancelled else { break }
                if phase == .active && selected == nil && !busy { reload() }
            }
        }
    }

    private var canReuseLocationIndex: Bool {
        guard let owner = cachedOwner, let library = cachedLibrary else { return false }
        return phase == .active && scopedQuery == cachedQuery &&
            cachedPresence == presence &&
            PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized &&
            XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) &&
            XDriveIOSNativePhotoFingerprintIndex.isCurrent(library)
    }

    private var currentViewport: XDriveIOSNativeLocalMapViewport? {
        if camera.span.longitudeDelta >= 359 && camera.span.latitudeDelta >= 159 {
            return nil // The first global survey also includes polar GPS.
        }
        return XDriveIOSNativeLocalMapSpatialPolicy.viewportBounds(
            latitude: camera.center.latitude, longitude: camera.center.longitude,
            latitudeSpan: camera.span.latitudeDelta,
            longitudeSpan: camera.span.longitudeDelta)
    }

    private var cameraProof: Bool {
        guard let scanned = provedCamera else { return false }
        func longitudeDistance(_ a: Double, _ b: Double) -> Double {
            let difference = abs(a - b).truncatingRemainder(dividingBy: 360)
            return min(difference, 360 - difference)
        }
        return abs(camera.center.latitude - scanned.center.latitude)
            <= max(0.00001, scanned.span.latitudeDelta * 0.015) &&
            longitudeDistance(camera.center.longitude, scanned.center.longitude)
            <= max(0.00001, scanned.span.longitudeDelta * 0.015) &&
            abs(camera.span.latitudeDelta - scanned.span.latitudeDelta)
            <= max(0.00001, scanned.span.latitudeDelta * 0.015) &&
            abs(camera.span.longitudeDelta - scanned.span.longitudeDelta)
            <= max(0.00001, scanned.span.longitudeDelta * 0.015)
    }

    private var currentProof: Bool {
        guard let provedOwner else { return false }
        return phase == .active && !busy && error == nil && cameraProof &&
            PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized &&
            XDriveIOSNativePhotoOwnerScope.matches(login.owner, provedOwner) &&
            provedLibrary.map(XDriveIOSNativePhotoFingerprintIndex.isCurrent) == true
    }

    var body: some View {
        VStack(spacing: 8) {
            XDriveIOSNativeUnifiedSourceMapSurface(
                pins: currentProof ? pins : [], images: coverImages,
                unavailable: coverUnavailable, revision: mapRevision,
                markersEnabled: currentProof, initialCamera: camera,
                mapType: mapType, cameraRequestID: cameraRequestID,
                requestedCamera: camera, showsUserDot: currentLocation.showsUserDot,
                onCameraWillChange: {},
                onCamera: { region in camera = region },
                onBasemapStatus: { basemapUnavailable = $0 },
                onOpen: { id in
                    guard currentProof, let pin = pins.first(where: { $0.id == id }),
                          pin.count > 0 else { return }
                    selected = pin
                }
            )
            .accessibilityIdentifier("native-ios-unified-source-map")
            if basemapUnavailable {
                Text("地图底图暂不可用。联网后可切换底图重试；照片位置仍受当前权限保护。")
                    .font(.footnote).foregroundStyle(.secondary)
                    .accessibilityIdentifier("native-ios-unified-source-map-basemap-error")
            }
            if busy {
                ProgressView("核对整个当前来源的照片位置…")
                    .accessibilityIdentifier("native-ios-unified-source-map-scanning")
            } else if let error {
                XDriveIOSNativePhotoWallRetryMessage(
                    message: error, buttonTitle: "重新核对照片地图",
                    canRetry: phase == .active,
                    accessibilityID: "native-ios-unified-source-map-retry"
                ) { reload() }
            } else if currentProof {
                let total = pins.reduce(0) { $0 + $1.count }
                Text("\(presence.title) · 当前视窗已核对 \(total) 张有定位的照片")
                    .font(.footnote).monospacedDigit()
                    .accessibilityIdentifier("native-ios-unified-source-map-total")
                if pins.isEmpty {
                    Text("当前已核验的筛选结果在这个地图视窗没有拍摄位置。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            } else {
                Text("当前地图视窗或来源权限待核验，旧地点不可打开。")
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle(presence.title + " · 地图")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button("完成") {
                        if currentProof { onSaveCamera?(camera) }
                        onClose()
                    }
                    .accessibilityIdentifier("native-ios-unified-source-map-close")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button("刷新照片位置") { reload() }
                        .disabled(busy || phase != .active)
                    Picker("底图样式", selection: $mapType) {
                        Text("标准地图").tag(MKMapType.standard)
                        Text("卫星地图").tag(MKMapType.satellite)
                    }
                } label: { Label("地图操作", systemImage: "ellipsis.circle") }
                .accessibilityIdentifier("native-ios-unified-source-map-actions")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button("恢复原始日期范围") { setDateRange(nil) }
                    Button("最近 7 天") {
                        setDateRange(XDriveIOSNativePhotoMapCaptureRange.recentDays(7))
                    }
                    Button("最近 30 天") {
                        setDateRange(XDriveIOSNativePhotoMapCaptureRange.recentDays(30))
                    }
                    Button("选择日期、月份或年份") { datePickerOpen = true }
                } label: { Label("地图日期", systemImage: "calendar") }
                .accessibilityIdentifier("native-ios-unified-source-map-dates")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { currentLocation.locate() } label: {
                    Label("我的位置", systemImage: "location")
                }
                .disabled(currentLocation.isLocating || phase != .active || !currentProof)
                .accessibilityIdentifier("native-ios-unified-source-map-locate")
            }
        }
        .sheet(isPresented: $datePickerOpen) {
            NavigationStack {
                Form {
                    DatePicker("拍摄日期", selection: $requestedCaptureDay,
                               displayedComponents: .date)
                        .datePickerStyle(.graphical)
                    Button("显示当天") {
                        setDateRange(XDriveIOSNativePhotoMapCaptureRange.day(requestedCaptureDay))
                        datePickerOpen = false
                    }
                    Button("显示所在月份") {
                        let calendar = Calendar.current
                        setDateRange(XDriveIOSNativePhotoMapCaptureRange.month(
                            calendar.component(.year, from: requestedCaptureDay),
                            calendar.component(.month, from: requestedCaptureDay)))
                        datePickerOpen = false
                    }
                    Button("显示所在年份") {
                        setDateRange(XDriveIOSNativePhotoMapCaptureRange.year(
                            Calendar.current.component(.year, from: requestedCaptureDay)))
                        datePickerOpen = false
                    }
                }
                .navigationTitle("选择来源地图日期")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("取消") { datePickerOpen = false }
                    }
                }
            }
        }
        .alert(item: $currentLocation.alert) { issue in
            Alert(title: Text("无法获取当前位置"), message: Text(issue.message),
                  dismissButton: .default(Text("完成")))
        }
        .sheet(item: $selected, onDismiss: {
            // A return is a new authority boundary, not permission to reuse
            // a vanished Owner or a different PhotoKit generation.
            if !currentProof { invalidate() }
        }) { pin in
            if let owner = provedOwner, let library = provedLibrary, currentProof,
               pins.contains(where: { $0.id == pin.id && $0.count == pin.count }) {
                NavigationStack {
                    XDriveIOSNativeUnifiedSourceMapCellWall(
                        login: login, owner: owner, library: library,
                        presence: presence, query: scopedQuery, pin: pin)
                }
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
            } else {
                Text("位置照片核验已失效。")
            }
        }
        .onAppear {
            photoChanges.start()
            if pins.isEmpty && !busy { reload() }
            startRemotePoll()
        }
        .onChange(of: photoChanges.change) { _ in
            invalidate()
            didFitFirstVerifiedMap = false
            if phase == .active { reload() }
        }
        .onChange(of: login.owner) { _ in
            invalidate()
            didFitFirstVerifiedMap = false
            if phase == .active && login.owner != nil { reload() }
        }
        .onChange(of: presence) { _ in
            didFitFirstVerifiedMap = false
            reload()
        }
        .onChange(of: query) { updated in
            scopedQuery = updated
            didFitFirstVerifiedMap = false
            reload()
        }
        .onChange(of: currentLocation.requestID) { _ in
            guard let target = currentLocation.camera, phase == .active else { return }
            camera = target
            cameraRequestID = UUID()
        }
        .onChange(of: camera.center.latitude) { _ in scheduleCameraRefinement() }
        .onChange(of: camera.center.longitude) { _ in scheduleCameraRefinement() }
        .onChange(of: camera.span.latitudeDelta) { _ in scheduleCameraRefinement() }
        .onChange(of: camera.span.longitudeDelta) { _ in scheduleCameraRefinement() }
        .onChange(of: phase) { state in
            if state == .active {
                startRemotePoll()
                reload()
            } else {
                remotePollTask?.cancel(); remotePollTask = nil
                currentLocation.cancel()
                invalidate()
            }
        }
        .onDisappear {
            // Keep observing while a place sheet covers the map. Retire the
            // observation only on actual route departure.
            if selected == nil {
                remotePollTask?.cancel(); remotePollTask = nil
                currentLocation.cancel()
                if currentProof { onSaveCamera?(camera) }
                photoChanges.stop()
                invalidate()
            }
        }
    }

    private func invalidate(keepCoordinates: Bool = false) {
        generation = UUID()
        scanTask?.cancel(); scanTask = nil
        cameraSettleTask?.cancel(); cameraSettleTask = nil
        coverTask?.cancel(); coverTask = nil
        for request in localCoverRequests {
            PHImageManager.default().cancelImageRequest(request)
        }
        localCoverRequests = []
        coverImages = [:]
        coverUnavailable = []
        pins = []
        mapRevision = UUID()
        selected = nil
        provedOwner = nil
        provedLibrary = nil
        provedCamera = nil
        busy = false
        error = nil
        if !keepCoordinates {
            cachedCoordinates = []
            cachedCursors = []
            cachedOwner = nil
            cachedLibrary = nil
            cachedQuery = nil
            cachedPresence = nil
        }
    }

    private func scheduleCameraRefinement() {
        guard phase == .active, selected == nil else { return }
        // Revoke old markers immediately, not after 900ms quiet, so an old
        // regional count cannot be opened during a pinch/rapid pan.
        let reuseIndex = canReuseLocationIndex
        invalidate(keepCoordinates: reuseIndex)
        let ticket = generation
        busy = true
        cameraSettleTask = Task { @MainActor in
            do {
                try await Task.sleep(
                    nanoseconds: XDriveIOSNativeLocalMapAutoRefinePolicy.settleNanoseconds)
            } catch { return }
            guard !Task.isCancelled, generation == ticket,
                  phase == .active, selected == nil else { return }
            cameraSettleTask = nil
            if reuseIndex && canReuseLocationIndex {
                regroupCachedCoordinates()
            } else {
                reload()
            }
        }
    }

    /// M03: viewport repartition is local O(N) arithmetic after the first
    /// verified source scan. Reopen only representative source pages (<=64)
    /// to recheck current Owner/PhotoKit authority and photo identity.
    private func regroupCachedCoordinates() {
        guard canReuseLocationIndex, let owner = cachedOwner,
              let library = cachedLibrary else { reload(); return }
        let ticket = generation
        let scopedCamera = camera
        let viewport = currentViewport
        let cursors = cachedCursors
        let coordinates = cachedCoordinates
        busy = true
        scanTask = Task { @MainActor in
            defer { if generation == ticket { busy = false; scanTask = nil } }
            do {
                var index =
                    XDriveIOSNativeLocalMapSpatialIndex<XDriveIOSUnifiedSourceCachedCoordinate>()
                for point in coordinates {
                    try Task.checkCancellation()
                    if XDriveIOSNativeLocalMapSpatialPolicy.includes(
                        viewport, latitude: point.latitude,
                        longitude: point.longitude) {
                        index.add(latitude: point.latitude,
                                  longitude: point.longitude, representative: point)
                    }
                }
                var validatedPages: [Int: [XDriveIOSNativeUnifiedPhoto]] = [:]
                var result: [XDriveIOSUnifiedSourceMapPin] = []
                for cell in index.cells {
                    try Task.checkCancellation()
                    let sample = cell.representative
                    guard generation == ticket, canReuseLocationIndex,
                          cursors.indices.contains(sample.page)
                    else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
                    let rows: [XDriveIOSNativeUnifiedPhoto]
                    if let cached = validatedPages[sample.page] {
                        rows = cached
                    } else {
                        let page = XDriveIOSNativeUnifiedPhotoTimeline()
                        await page.load(from: cursors[sample.page], filter: presence,
                                        login: login, query: scopedQuery, library: library)
                        try Task.checkCancellation()
                        guard generation == ticket, canReuseLocationIndex,
                              page.completed, page.notice == nil
                        else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
                        rows = page.rows
                        validatedPages[sample.page] = rows
                    }
                    guard rows.indices.contains(sample.ordinal),
                          rows[sample.ordinal].presence == presence,
                          let live = XDriveIOSUnifiedSourceMapPolicy.coordinates(
                            for: rows[sample.ordinal]),
                          live.latitude == sample.latitude,
                          live.longitude == sample.longitude,
                          XDriveIOSUnifiedSourceMapPolicy.member(
                            latitude: live.latitude, longitude: live.longitude,
                            key: cell.key, viewport: viewport)
                    else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
                    result.append(XDriveIOSUnifiedSourceMapPin(
                        key: cell.key, latitude: cell.latitude,
                        longitude: cell.longitude, count: cell.count,
                        representative: rows[sample.ordinal],
                        viewport: viewport, firstCursor: cursors[sample.page]))
                }
                guard generation == ticket, canReuseLocationIndex else { return }
                pins = result
                mapRevision = UUID()
                provedOwner = owner
                provedLibrary = library
                provedCamera = scopedCamera
                loadCovers(result, owner: owner, ticket: ticket)
            } catch is CancellationError {
            } catch {
                guard generation == ticket else { return }
                pins = []
                cachedOwner = nil; cachedLibrary = nil
                cachedCoordinates = []; cachedCursors = []
                provedOwner = nil; provedLibrary = nil; provedCamera = nil
                self.error = "来源位置索引已变化，需重新核验地图。"
            }
        }
    }

    private func loadCovers(
        _ verifiedPins: [XDriveIOSUnifiedSourceMapPin],
        owner: XDriveNativeOwnerRoot, ticket: UUID
    ) {
        coverTask?.cancel()
        coverTask = Task { @MainActor in
            guard let auth = try? await login.verifiedAuthorization(),
                  XDriveIOSNativePhotoOwnerScope.matches(auth.owner, owner),
                  generation == ticket, currentProof else { return }
            let reader = XDriveIOSNativeMediaGalleryReader(
                owner: owner, accessToken: auth.accessToken)
            // One trusted 64-cell window. Only bounded 128px PhotoKit posters
            // may use iCloud networking; never fetch full-size media or originals.
            for pin in verifiedPins {
                guard !Task.isCancelled, generation == ticket, currentProof else { return }
                if let local = pin.representative.local,
                   let asset = PHAsset.fetchAssets(
                    withLocalIdentifiers: [local.id], options: nil).firstObject,
                   let coordinate = asset.location?.coordinate,
                   XDriveIOSUnifiedSourceMapPolicy.member(
                    latitude: coordinate.latitude, longitude: coordinate.longitude,
                    key: pin.key, viewport: pin.viewport) {
                    let options = PHImageRequestOptions()
                    // Same bounded opportunistic iCloud poster policy as
                    // the native PhotoKit map: retain a degraded preview until
                    // its final image arrives, even if the final request fails.
                    options.isNetworkAccessAllowed = true
                    options.deliveryMode = .opportunistic
                    options.resizeMode = .fast
                    let request = PHImageManager.default().requestImage(
                        for: asset, targetSize: CGSize(width: 128, height: 128),
                        contentMode: .aspectFill, options: options
                    ) { image, info in
                        let degraded = info?[PHImageResultIsDegradedKey] as? Bool == true
                        let cancelled = info?[PHImageCancelledKey] as? Bool == true
                        let failed = info?[PHImageErrorKey] != nil
                        Task { @MainActor in
                            guard !cancelled, generation == ticket, currentProof,
                                  pins.contains(where: { $0.id == pin.id })
                            else { return }
                            if let image {
                                coverUnavailable.remove(pin.id)
                                coverImages[pin.id] = image
                            } else if !degraded && failed && coverImages[pin.id] == nil {
                                // Never clear an already presented degraded poster.
                                coverUnavailable.insert(pin.id)
                            }
                        }
                    }
                    localCoverRequests.append(request)
                } else if let cloud = pin.representative.cloud,
                          let image = try? await reader.thumbnail(cloud) {
                    guard !Task.isCancelled, generation == ticket, currentProof,
                          pins.contains(where: { $0.id == pin.id }) else { return }
                    coverImages[pin.id] = image
                }
            }
        }
    }

    private func reload() {
        invalidate()
        guard phase == .active, scopedQuery.isValid,
              let owner = login.owner,
              PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized,
              let stamp = try? XDriveIOSPhotoKitLibraryEpoch.capture()
        else {
            error = "精确来源地图需要完整照片权限及当前 Owner。未登录时请使用本机照片地图。"
            return
        }
        let library = stamp.serialized
        let ticket = generation
        let scannedCamera = camera
        let scannedViewport = currentViewport
        busy = true
        scanTask = Task { @MainActor in
            defer {
                if generation == ticket {
                    busy = false
                    scanTask = nil
                }
            }
            var index = XDriveIOSNativeLocalMapSpatialIndex<XDriveIOSUnifiedSourceMapSeed>()
            var coordinates: [XDriveIOSUnifiedSourceCachedCoordinate] = []
            var pageCursors: [XDriveIOSNativeGalleryCursor] = []
            var cursor: XDriveIOSNativeGalleryCursor? = .init()
            do {
                for _ in 0..<XDriveIOSUnifiedSourceMapPolicy.maximumPages {
                    try Task.checkCancellation()
                    guard generation == ticket, phase == .active,
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                          PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized,
                          XDriveIOSNativePhotoFingerprintIndex.isCurrent(library),
                          let start = cursor else { return }
                    let page = XDriveIOSNativeUnifiedPhotoTimeline()
                    await page.load(from: start, filter: presence, login: login,
                                    query: scopedQuery, library: library)
                    try Task.checkCancellation()
                    guard generation == ticket, page.completed,
                          page.notice == nil,
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                          XDriveIOSNativePhotoFingerprintIndex.isCurrent(library)
                    else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
                    var indexedPage: Int?
                    for (ordinal, row) in page.rows.enumerated() where row.presence == presence {
                        guard let coordinate =
                            XDriveIOSUnifiedSourceMapPolicy.coordinates(for: row)
                        else { continue }
                        if indexedPage == nil {
                            indexedPage = pageCursors.count
                            pageCursors.append(start)
                        }
                        coordinates.append(XDriveIOSUnifiedSourceCachedCoordinate(
                            latitude: coordinate.latitude, longitude: coordinate.longitude,
                            page: indexedPage!, ordinal: ordinal))
                        guard XDriveIOSNativeLocalMapSpatialPolicy.includes(
                            scannedViewport, latitude: coordinate.latitude,
                            longitude: coordinate.longitude) else { continue }
                        index.add(
                            latitude: coordinate.latitude,
                            longitude: coordinate.longitude,
                            representative: XDriveIOSUnifiedSourceMapSeed(
                                row: row, cursor: start))
                    }
                    if let next = page.next {
                        guard next != start else {
                            throw XDriveIOSNativeMediaReadFailure.invalidPage
                        }
                        cursor = next
                    } else {
                        guard generation == ticket, phase == .active,
                              XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                              XDriveIOSNativePhotoFingerprintIndex.isCurrent(library),
                              PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized
                        else { return }
                        let verifiedPins = index.cells.map { cell in
                            XDriveIOSUnifiedSourceMapPin(
                                key: cell.key, latitude: cell.latitude,
                                longitude: cell.longitude, count: cell.count,
                                representative: cell.representative.row,
                                viewport: scannedViewport,
                                firstCursor: cell.representative.cursor)
                        }
                        cachedCoordinates = coordinates
                        cachedCursors = pageCursors
                        cachedOwner = owner
                        cachedLibrary = library
                        cachedQuery = scopedQuery
                        cachedPresence = presence
                        pins = verifiedPins
                        mapRevision = UUID()
                        provedOwner = owner
                        provedLibrary = library
                        provedCamera = scannedCamera
                        if !didFitFirstVerifiedMap {
                            didFitFirstVerifiedMap = true
                            if let fit = XDriveIOSNativeUnifiedMapCameraPolicy.fit(
                                coordinates.map {
                                    .init(latitude: $0.latitude, longitude: $0.longitude)
                                }),
                               scannedCamera.span.longitudeDelta >= 359 {
                                // One-time initial framing; a later pan/zoom
                                // always belongs to the user and is not reset.
                                camera = MKCoordinateRegion(
                                    center: CLLocationCoordinate2D(
                                        latitude: fit.latitude, longitude: fit.longitude),
                                    span: MKCoordinateSpan(
                                        latitudeDelta: fit.latitudeDelta,
                                        longitudeDelta: fit.longitudeDelta))
                                cameraRequestID = UUID()
                            }
                        }
                        loadCovers(verifiedPins, owner: owner, ticket: ticket)
                        return
                    }
                }
                throw XDriveIOSNativeMediaReadFailure.invalidPage
            } catch is CancellationError {
            } catch {
                guard generation == ticket else { return }
                pins = []
                provedOwner = nil
                provedLibrary = nil
                provedCamera = nil
                self.error = "当前来源或分页核验未完成，不显示可能错误的地图，请重试。"
            }
        }
    }
}

private struct XDriveIOSUnifiedMapViewerChoice: Identifiable {
    let row: XDriveIOSNativeUnifiedPhoto
    var id: String { row.id }
}

/// One exact visual cell, revisiting the original Gallery cursor. Only two
/// windows of at most 48 rows stay mounted; a cell ID is never a request
/// parameter or source proof, and each Viewer retains its normal authority.
private struct XDriveIOSNativeUnifiedSourceMapCellWall: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let owner: XDriveNativeOwnerRoot
    let library: Data
    let presence: XDriveIOSNativeGalleryPresence
    let query: XDriveIOSNativeUnifiedGalleryQuery
    let pin: XDriveIOSUnifiedSourceMapPin
    var isNearbyExpansion = false

    @Environment(\.scenePhase) private var phase
    @StateObject private var photoChanges = XDriveIOSUnifiedPhotoObserver()
    @State private var generation = UUID()
    @State private var request: Task<Void, Never>?
    @State private var admissionTask: Task<Void, Never>?
    @State private var busy = false
    @State private var opening = false
    @State private var error: String?
    @State private var previous: [XDriveIOSNativeUnifiedPhoto] = []
    @State private var current: [XDriveIOSNativeUnifiedPhoto] = []
    @State private var next: XDriveIOSNativeGalleryCursor?
    // Display-only window checkpoints, never media IDs or admission tokens.
    @State private var windowStarts: [XDriveIOSNativeGalleryCursor] = []
    @State private var windowIndex = -1
    @State private var backfillAnchorID: String?
    @State private var ended = false
    @State private var viewing: XDriveIOSUnifiedMapViewerChoice?
    @State private var viewerReturnID: String?
    @State private var nearbyPresented = false
    @State private var density: XDriveIOSNativePhotoWallDensity = .standard
    @State private var framing: XDriveIOSNativePhotoWallFraming = .square
    @State private var timeScale: XDriveIOSNativePhotoWallTimeScale = .day

    private var active: Bool {
        phase == .active &&
        XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) &&
        PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized &&
        XDriveIOSNativePhotoFingerprintIndex.isCurrent(library)
    }

    private var nearbyViewport: XDriveIOSNativeLocalMapViewport? {
        guard isNearbyExpansion else { return nil }
        let step = XDriveIOSNativeLocalMapSpatialPolicy.initialCellDegrees *
            Double(1 << pin.key.level)
        return XDriveIOSNativeLocalMapSpatialPolicy.viewportBounds(
            latitude: pin.latitude, longitude: pin.longitude,
            latitudeSpan: min(90, max(0.35, step * 3)),
            longitudeSpan: min(180, max(0.35, step * 3)))
    }

    private func matchesPlace(latitude: Double, longitude: Double) -> Bool {
        if isNearbyExpansion {
            guard let nearbyViewport else { return false }
            return XDriveIOSNativeLocalMapSpatialPolicy.includes(
                nearbyViewport, latitude: latitude, longitude: longitude)
        }
        return XDriveIOSUnifiedSourceMapPolicy.member(
            latitude: latitude, longitude: longitude,
            key: pin.key, viewport: pin.viewport)
    }

    var body: some View {
        VStack(spacing: 8) {
            if active {
                XDriveIOSNativePhotoWallScopeSummary(
                    message: isNearbyExpansion
                        ? "附近照片 · 按当前来源和拍摄位置核验"
                        : "当前来源 · 此区域 \(pin.count) 张照片")
                if let error {
                    XDriveIOSNativePhotoWallRetryMessage(
                        message: error, buttonTitle: "重新核对当前区域",
                        canRetry: !busy && !opening
                    ) { load(from: next ?? (isNearbyExpansion ? .init() : pin.firstCursor)) }
                }
                if busy {
                    XDriveIOSNativePhotoWallLoadingMessage(
                        message: "核对当前区域的照片…")
                }
                photoWall
                if ended && previous.isEmpty && current.isEmpty && error == nil {
                    XDriveIOSNativePhotoWallStatusMessage(
                        message: "该位置的照片已发生变化，请重新打开地图。")
                }
            } else {
                XDriveIOSNativePhotoWallStatusMessage(
                    message: "Owner 或本机照片权限已变化，旧照片已隐藏。")
            }
        }
        .navigationTitle(isNearbyExpansion ? "附近照片" : "此地点的照片")
        .toolbar {
            if !isNearbyExpansion {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("附近照片") {
                        guard active, !busy, !opening else { return }
                        nearbyPresented = true
                    }
                    .disabled(!active || busy || opening)
                    .accessibilityIdentifier("native-ios-unified-source-map-nearby")
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                XDriveIOSNativePhotoWallDisplayMenu(
                    density: $density, framing: $framing,
                    accessibilityID: "native-ios-unified-source-map-display"
                ) {
                    Section("时间分组") {
                        ForEach(XDriveIOSNativePhotoWallTimeScale.allCases) { option in
                            Button {
                                timeScale = option
                            } label: {
                                Label(option.title,
                                    systemImage: option == timeScale
                                        ? "checkmark.circle.fill" : "calendar")
                            }
                        }
                    }
                }
            }
        }
        .sheet(isPresented: $nearbyPresented) {
            if active {
                AnyView(NavigationStack {
                    XDriveIOSNativeUnifiedSourceMapCellWall(
                        login: login, owner: owner, library: library,
                        presence: presence, query: query, pin: pin,
                        isNearbyExpansion: true)
                })
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
            } else {
                AnyView(Text("该地点来源核验已失效。"))
            }
        }
        .fullScreenCover(item: $viewing, onDismiss: {
            if !active { invalidate() }
        }) { choice in
            if active, let local = choice.row.local {
                XDriveIOSNativeLocalPhotoDetail(candidate: local)
            } else if active, let cloud = choice.row.cloud {
                XDriveIOSNativeServerMediaPreview(
                    item: cloud, login: login, loadedItems: [cloud],
                    openedOwner: owner)
            } else {
                Text("该照片已不可访问。")
            }
        }
        .onAppear {
            photoChanges.start()
            if current.isEmpty && !busy && error == nil {
                load(from: isNearbyExpansion ? .init() : pin.firstCursor)
            }
        }
        .onChange(of: photoChanges.change) { _ in invalidate() }
        .onChange(of: login.owner) { _ in invalidate() }
        .onChange(of: phase) { state in
            if state != .active { invalidate() }
        }
        .onDisappear {
            request?.cancel(); request = nil
            admissionTask?.cancel(); admissionTask = nil
            if viewing == nil && !nearbyPresented {
                photoChanges.stop()
                invalidate()
            }
        }
    }

    private var photoWall: some View {
        ScrollViewReader { scroll in
            ScrollView {
                if windowIndex > 1 && !busy && active &&
                   viewing == nil && !opening {
                    Color.clear.frame(height: 32)
                        .onAppear { retreat() }
                        .accessibilityHidden(true)
                }
                let sections = xdriveIOSNativePhotoWallVisibleSections(
                    previous + current, scale: timeScale
                ) { timeScale.key(for: $0.capturedAt) }
                XDriveIOSNativePhotoWallSectionList(
                    sections: sections, density: density,
                    title: { timeScale == .all ? nil : timeScale.label(for: $0.key) },
                    items: { $0.items }
                ) { row in
                    photoButton(for: row).id(row.id)
                }
                if next != nil && !busy && error == nil && active &&
                   viewing == nil && !opening {
                    Color.clear.frame(height: 32)
                        .onAppear { advance() }
                        .accessibilityHidden(true)
                }
            }
            .padding(4)
            .xdrivePhotoWallPinch(density: $density, enabled: viewing == nil)
            .onChange(of: backfillAnchorID) { anchor in
                guard active, let anchor,
                      (previous + current).contains(where: { $0.id == anchor })
                else { return }
                scroll.scrollTo(anchor, anchor: .top)
                backfillAnchorID = nil
            }
            .onChange(of: viewing?.id) { activeID in
                guard activeID == nil, active, let anchor = viewerReturnID,
                      XDriveIOSNativePhotoWallWindowPolicy.canRestore(
                        anchor, in: (previous + current).map(\.id),
                        scopeActive: active) else { return }
                scroll.scrollTo(anchor, anchor: .center)
                viewerReturnID = nil
            }
        }
    }

    private func photoButton(for row: XDriveIOSNativeUnifiedPhoto) -> some View {
        Button { openAfterLiveAdmission(row) } label: {
            XDriveIOSUnifiedPhotoTile(
                row: row, login: login, presentingOwner: owner,
                displayActive: active && viewing == nil,
                retainWhileCovered: viewing != nil, framing: framing)
        }
        .disabled(!active || busy || opening)
        .buttonStyle(.plain)
        .accessibilityIdentifier("native-ios-unified-source-map-photo")
    }

    private func openAfterLiveAdmission(_ row: XDriveIOSNativeUnifiedPhoto) {
        guard active, !busy, !opening, viewing == nil,
              row.presence == presence,
              (previous + current).filter({ $0.id == row.id }).count == 1 else { return }
        let ticket = generation
        opening = true
        admissionTask?.cancel()
        admissionTask = Task { @MainActor in
            defer {
                if generation == ticket {
                    admissionTask = nil
                    opening = false
                }
            }
            guard let currentRow = await revalidateCurrentMember(row),
                  !Task.isCancelled, generation == ticket, active,
                  (previous + current).filter({ $0.id == row.id }).count == 1
            else {
                if generation == ticket { error = "此照片的地点或权限已变化，请刷新后重试。" }
                return
            }
            viewerReturnID = row.id
            viewing = .init(row: currentRow)
        }
    }

    /// G02: a verified page is not a permanent permission to open a photo.
    /// PhotoKit GPS/filename/date/type and cloud Node revision/GPS are reread
    /// on each actual tap. An old count can never authorize a changed member.
    /// M05: all Viewer moves are from the SAME current GPS cell and source
    /// filter. Recheck the selected media before opening the next frame.
    private func admitViewerNeighbor(_ row: XDriveIOSNativeUnifiedPhoto) {
        guard active, !opening, row.presence == presence,
              (previous + current).filter({ $0.id == row.id }).count == 1
        else { return }
        let ticket = generation
        opening = true
        admissionTask?.cancel()
        admissionTask = Task { @MainActor in
            defer {
                if generation == ticket { opening = false; admissionTask = nil }
            }
            guard let fresh = await revalidateCurrentMember(row),
                  !Task.isCancelled, generation == ticket, active,
                  (previous + current).filter({ $0.id == row.id }).count == 1
            else {
                if generation == ticket { error = "相邻照片或来源状态已变化，请刷新。" }
                return
            }
            viewerReturnID = fresh.id
            viewing = XDriveIOSUnifiedMapViewerChoice(row: fresh)
        }
    }

    private func navigateViewer(_ direction: Int) {
        guard (direction == -1 || direction == 1),
              active, !opening, !busy, let opened = viewing else { return }
        let rows = previous + current
        guard let position = rows.firstIndex(where: { $0.id == opened.id }) else { return }
        let target = position + direction
        if rows.indices.contains(target) {
            admitViewerNeighbor(rows[target])
        } else if direction > 0, let next {
            load(from: next, forViewer: true)
        } else if direction < 0, windowIndex > 1 {
            retreat(forViewer: true)
        }
    }

    private var viewerNavigation: some View {
        VStack(spacing: 5) {
            if busy || opening { ProgressView("正在核对相邻照片…").font(.caption) }
            HStack {
                Button { navigateViewer(-1) } label: {
                    Image(systemName: "chevron.left").frame(width: 44, height: 44)
                }
                .accessibilityLabel("上一张")
                .disabled(!active || busy || opening || viewing == nil)
                Spacer()
                Text("此地点的照片").font(.caption)
                Spacer()
                Button { navigateViewer(1) } label: {
                    Image(systemName: "chevron.right").frame(width: 44, height: 44)
                }
                .accessibilityLabel("下一张")
                .disabled(!active || busy || opening || viewing == nil)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 4) {
                    ForEach(previous + current) { row in
                        Button { admitViewerNeighbor(row) } label: {
                            XDriveIOSUnifiedPhotoTile(
                                row: row, login: login, presentingOwner: owner,
                                displayActive: active, retainWhileCovered: true,
                                framing: framing
                            )
                            .frame(width: 48, height: 48)
                            .overlay(RoundedRectangle(cornerRadius: 4)
                                .stroke(viewing?.id == row.id
                                    ? Color.accentColor : Color.clear, lineWidth: 2))
                        }
                        .buttonStyle(.plain)
                        .disabled(!active || busy || opening)
                        .accessibilityLabel("选择此地点的照片")
                    }
                }
                .padding(4)
            }
        }
        .padding(.horizontal, 8)
        .background(.ultraThinMaterial)
        .accessibilityIdentifier("native-ios-unified-source-map-viewer-filmstrip")
    }

    private func revalidateCurrentMember(
        _ row: XDriveIOSNativeUnifiedPhoto
    ) async -> XDriveIOSNativeUnifiedPhoto? {
        guard active, row.presence == presence else { return nil }
        if let local = row.local {
            guard let asset = PHAsset.fetchAssets(
                withLocalIdentifiers: [local.id], options: nil).firstObject,
                let coordinate = asset.location?.coordinate,
                matchesPlace(latitude: coordinate.latitude,
                             longitude: coordinate.longitude)
            else { return nil }
            let video = asset.mediaType == .video
            let live = asset.mediaSubtypes.contains(.photoLive)
            guard asset.mediaType == .image || video,
                  (local.kind == "video") == video,
                  local.isLive == live,
                  local.capturedAt == asset.creationDate,
                  local.modifiedAt == asset.modificationDate else { return nil }
            // A source-filtered "both" row can outlive its cloud match even
            // while the local PhotoKit asset and GPS remain unchanged.
            // Admission requires the same current Owner Node, exact match,
            // revision and content identity, not just the local half.
            var currentCloud = row.cloud
            if row.presence == .both {
                guard let expectedCloud = row.cloud, let match = row.match,
                      match.matches(expectedCloud),
                      let auth = try? await login.verifiedAuthorization(),
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, owner)
                else { return nil }
                let reader = XDriveIOSNativeMediaGalleryReader(
                    owner: owner, accessToken: auth.accessToken)
                guard let liveCloud = try? await reader.currentMapItem(expectedCloud),
                      match.matches(liveCloud) else { return nil }
                currentCloud = liveCloud
            }
            let names = PHAssetResource.assetResources(for: asset)
                .map(\.originalFilename) +
                (currentCloud.map { [$0.node.name] + ($0.resources ?? []).map(\.name) } ?? [])
            guard query.matches(video: video, live: live,
                                capturedAt: asset.creationDate, names: names)
            else { return nil }
            if row.presence == .localOnly {
                // A prior unmatched result is not permanent. Re-hash this
                // CURRENT local original (network disabled) and query the
                // current Owner's exact-match index again before opening it.
                // Unavailable iCloud-only originals fail closed, not "absent".
                guard row.cloud == nil, row.match == nil,
                      let auth = try? await login.verifiedAuthorization(),
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, owner),
                      let probe = try? await XDriveIOSNativeExactPhotoProbe.read(local),
                      let replies = try? await XDriveIOSNativeMediaGalleryReader(
                        owner: owner, accessToken: auth.accessToken
                      ).exactMatches([probe]),
                      replies.count == 1,
                      replies[0].state == .unmatched,
                      XDriveIOSNativePhotoFingerprintIndex.isCurrent(library)
                else { return nil }
            }
            return XDriveIOSNativeUnifiedPhoto(
                local: local, cloud: currentCloud, match: row.match,
                presence: row.presence, capturedAt: asset.creationDate, reason: row.reason)
        }
        // A cloud-only negative match needs the original complete, still-
        // current local library proof. New PhotoKit assets invalidate it.
        guard row.presence == .cloudOnly, row.local == nil, row.match == nil,
              XDriveIOSNativePhotoFingerprintIndex.isCurrent(library),
              let cloud = row.cloud,
              let auth = try? await login.verifiedAuthorization(),
              XDriveIOSNativePhotoOwnerScope.matches(auth.owner, owner)
        else { return nil }
        let reader = XDriveIOSNativeMediaGalleryReader(
            owner: owner, accessToken: auth.accessToken)
        guard let updated = try? await reader.currentMapItem(cloud),
              let latitude = updated.metadata.latitude,
              let longitude = updated.metadata.longitude,
              matchesPlace(latitude: latitude, longitude: longitude)
        else { return nil }
        let capturedAt: Date?
        if let value = updated.metadata.captured_at {
            capturedAt = try? Date(value, strategy: .iso8601)
        } else {
            capturedAt = nil
        }
        let checked = XDriveIOSNativeUnifiedPhoto(
            local: nil, cloud: updated, match: row.match,
            presence: row.presence, capturedAt: capturedAt, reason: row.reason)
        guard checked.matches(query) else { return nil }
        return checked
    }

    private func invalidate() {
        generation = UUID()
        request?.cancel(); request = nil
        admissionTask?.cancel(); admissionTask = nil
        previous = []; current = []; next = nil
        windowStarts = []; windowIndex = -1; backfillAnchorID = nil
        ended = false
        viewing = nil
        viewerReturnID = nil
        nearbyPresented = false
        busy = false
        opening = false
        error = nil
    }

    private func advance() {
        guard !busy, active, !opening, let next else { return }
        load(from: next)
    }

    /// M04: one bounded backward virtual page, re-proved from its original
    /// cursor and exact location predicate. Preserve the visible first tile
    /// anchor while replacing the two 48-row windows.
    private func retreat(forViewer: Bool = false) {
        guard active, !busy, !opening, (viewing == nil || forViewer),
              windowIndex > 1, windowStarts.indices.contains(windowIndex - 2),
              let anchor = previous.first?.id else { return }
        let target = windowStarts[windowIndex - 2]
        let ticket = UUID()
        generation = ticket
        request?.cancel()
        busy = true
        request = Task { @MainActor in
            defer { if generation == ticket { busy = false; request = nil } }
            let model = XDriveIOSNativeUnifiedPhotoTimeline()
            await model.load(from: target, filter: presence, login: login,
                             query: query, library: library)
            guard generation == ticket, active, !Task.isCancelled else { return }
            let selected = model.rows.filter { row in
                guard row.presence == presence,
                      let coordinate = XDriveIOSUnifiedSourceMapPolicy.coordinates(for: row)
                else { return false }
                return matchesPlace(latitude: coordinate.latitude,
                                    longitude: coordinate.longitude)
            }
            guard model.completed, model.notice == nil, !selected.isEmpty,
                  selected.count <= 48 else {
                error = "此前照片窗口已变更，请重新打开地点。"
                previous = []; current = []; next = nil
                return
            }
            let retained = previous
            previous = selected
            current = retained
            windowIndex -= 1
            next = windowStarts[windowIndex + 1]
            ended = false
            if forViewer {
                if let row = previous.last { admitViewerNeighbor(row) }
            } else {
                backfillAnchorID = anchor
            }
        }
    }

    private func load(from start: XDriveIOSNativeGalleryCursor,
                      forViewer: Bool = false) {
        guard active, !busy, !opening, (viewing == nil || forViewer) else { return }
        let ticket = UUID()
        generation = ticket
        request?.cancel()
        busy = true
        error = nil
        request = Task { @MainActor in
            defer { if generation == ticket { busy = false; request = nil } }
            var cursor: XDriveIOSNativeGalleryCursor? = start
            do {
                for inspected in 0..<XDriveIOSUnifiedSourceMapPolicy.maximumWallSeekPages {
                    if inspected > 0 && inspected % 256 == 0 { await Task.yield() }
                    try Task.checkCancellation()
                    guard generation == ticket, active, let from = cursor else { return }
                    let model = XDriveIOSNativeUnifiedPhotoTimeline()
                    await model.load(from: from, filter: presence, login: login,
                                     query: query, library: library)
                    try Task.checkCancellation()
                    guard generation == ticket, active, model.completed,
                          model.notice == nil
                    else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
                    let selected = model.rows.filter { row in
                        guard row.presence == presence,
                              let coordinates = XDriveIOSUnifiedSourceMapPolicy.coordinates(for: row)
                        else { return false }
                        return matchesPlace(
                            latitude: coordinates.latitude,
                            longitude: coordinates.longitude)
                    }
                    if !selected.isEmpty {
                        // A revisited forward page must match the checkpoint
                        // already verified for this exact Owner and source.
                        if windowStarts.indices.contains(windowIndex + 1) {
                            guard windowStarts[windowIndex + 1] == from else {
                                throw XDriveIOSNativeMediaReadFailure.invalidPage
                            }
                            windowIndex += 1
                        } else {
                            windowStarts.append(from)
                            windowIndex = windowStarts.count - 1
                        }
                        previous = current
                        current = Array(selected.prefix(48))
                        next = model.next
                        ended = model.next == nil
                        if forViewer, let candidate = current.first {
                            admitViewerNeighbor(candidate)
                        }
                        return
                    }
                    guard let nextCursor = model.next else {
                        next = nil
                        ended = true
                        return
                    }
                    guard nextCursor != from else {
                        throw XDriveIOSNativeMediaReadFailure.invalidPage
                    }
                    cursor = nextCursor
                }
                throw XDriveIOSNativeMediaReadFailure.invalidPage
            } catch is CancellationError {
            } catch {
                if generation == ticket {
                    self.error = "当前位置已变化或来源重新核验失败，请刷新。"
                    previous = []
                    current = []
                    next = nil
                }
            }
        }
    }
}

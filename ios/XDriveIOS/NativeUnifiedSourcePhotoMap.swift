import CoreLocation
import MapKit
import Photos
import SwiftUI
import UIKit

/// M07: an exact, Owner-bound projection of the EXISTING unified Gallery
/// reconciliation stream. Neither a map pin nor its count is authorization.
/// A scan retains at most 64 aggregate records and one bounded Gallery page;
/// it never persists PhotoKit identifiers, coordinates or cloud credentials.
private enum XDriveIOSUnifiedSourceMapPolicy {
    static let maximumPages = XDriveIOSNativeUnifiedMapSeekPolicy.maximumPages
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
    // The current viewport wall is independent of a selected single Cell.
    // It uses the same proven Owner/PhotoKit/source page reader, no new API.
    @State private var showingViewportGrid = false
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
                if phase == .active && selected == nil &&
                    !showingViewportGrid && !busy { reload() }
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
            .overlay(alignment: .topTrailing) {
                XDriveIOSNativePhotoMapFloatingTools(
                    satellite: mapType == .satellite,
                    locateEnabled: !currentLocation.isLocating && phase == .active &&
                        currentProof,
                    locateID: "native-ios-unified-source-map-locate",
                    styleID: "native-ios-unified-source-map-basemap",
                    onLocate: { currentLocation.locate() },
                    onToggleStyle: {
                        mapType = mapType == .satellite ? .standard : .satellite
                    }
                )
                .padding(12)
            }
            .overlay(alignment: .bottomTrailing) {
                // The full current verified viewport is a union of the
                // existing exact GPS Cells, not the entire merged Gallery.
                XDriveIOSNativePhotoMapGridAction(
                    enabled: currentProof && !pins.isEmpty,
                    accessibilityID: "native-ios-unified-source-map-current-grid",
                    verifiedSummary: currentProof
                        ? "\(pins.reduce(0) { $0 + $1.count }) 张照片"
                        : nil
                ) {
                    guard currentProof, !pins.isEmpty,
                          pins.allSatisfy({ $0.count > 0 }) else { return }
                    showingViewportGrid = true
                }
                .padding(12)
            }
            .overlay(alignment: .topLeading) {
                VStack(alignment: .leading, spacing: 3) {
                    if basemapUnavailable {
                        XDriveIOSNativePhotoMapStatusPill(
                            message: "地图暂时无法加载，请检查网络后重试。",
                            accessibilityID: "native-ios-unified-source-map-basemap-error",
                            systemImage: "wifi.exclamationmark")
                    }
                    if let error {
                        XDriveIOSNativePhotoWallRetryMessage(
                            message: error, buttonTitle: "重试加载照片",
                            canRetry: phase == .active,
                            accessibilityID: "native-ios-unified-source-map-retry"
                        ) { reload() }
                        .padding(8)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                    }
                }
                .frame(maxWidth: 240, alignment: .leading)
            }
            .overlay(alignment: .bottomLeading) {
                // No permanent count capsule over MapKit; verified totals
                // stay available in the exact viewport grid and VoiceOver.
                if busy {
                    ProgressView("正在加载照片位置…")
                        .font(.caption).padding(10)
                        .background(.regularMaterial, in: Capsule()).padding(10)
                        .accessibilityIdentifier("native-ios-unified-source-map-scanning")
                }
            }
            // Progress, map errors and retries are presented above the map canvas.
        }
        .navigationTitle("地图")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    if currentProof { onSaveCamera?(camera) }
                    onClose()
                } label: {
                    Image(systemName: "xmark").frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("关闭地图")
                .accessibilityIdentifier("native-ios-unified-source-map-close")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Menu {
                        Button("恢复图库日期范围") {
                            scopedQuery = query
                            reload()
                        }
                        Button("全部日期") { setDateRange(nil) }
                        Button("最近 7 天") {
                            setDateRange(XDriveIOSNativePhotoMapCaptureRange.recentDays(7))
                        }
                        Button("最近 30 天") {
                            setDateRange(XDriveIOSNativePhotoMapCaptureRange.recentDays(30))
                        }
                        Button("选择日期、月份或年份") { datePickerOpen = true }
                    } label: {
                        Label("地图日期", systemImage: "calendar")
                    }
                    .accessibilityIdentifier("native-ios-unified-source-map-dates")
                    // Basemap is controlled only by the floating MapKit tool.
                    Button("刷新照片位置") { reload() }
                        .disabled(busy || phase != .active)
                } label: {
                    Label("地图操作", systemImage: "ellipsis.circle")
                        .frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityIdentifier("native-ios-unified-source-map-actions")
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
        .sheet(isPresented: $showingViewportGrid, onDismiss: {
            if phase == .active { reload() } else { invalidate() }
        }) {
            if let owner = provedOwner, let library = provedLibrary,
               currentProof, !pins.isEmpty,
               pins.allSatisfy({ $0.count > 0 }) {
                NavigationStack {
                    XDriveIOSNativeUnifiedSourceMapCellWall(
                        login: login, owner: owner, library: library,
                        presence: presence, query: scopedQuery, pin: pins[0],
                        sourceCoordinates: cachedCoordinates,
                        sourceCursors: cachedCursors, viewportPins: pins)
                }
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
            } else {
                Text("当前地图照片核验已失效，请重新进入。")
            }
        }
        .sheet(item: $selected, onDismiss: {
            // Cloud changes that happened while a place sheet covered the map
            // must be re-read even if local PhotoKit and Owner stayed valid.
            if phase == .active { reload() } else { invalidate() }
        }) { pin in
            if let owner = provedOwner, let library = provedLibrary, currentProof,
               pins.contains(where: { $0.id == pin.id && $0.count == pin.count }) {
                NavigationStack {
                    XDriveIOSNativeUnifiedSourceMapCellWall(
                        login: login, owner: owner, library: library,
                        presence: presence, query: scopedQuery, pin: pin,
                        sourceCoordinates: cachedCoordinates, sourceCursors: cachedCursors)
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
            // Date picker presentation must not destroy the current verified
            // source Camera/Owner/PhotoKit index or restart a full scan.
            guard !datePickerOpen else { return }
            // SwiftUI may call onDisappear while either a single-place Sheet
            // or the current-viewport grid is presented. Neither event is a
            // map-route exit: keep the PhotoKit observer, current GPS proof,
            // authenticated Owner and camera alive behind the Sheet.
            // A real route departure (no presented sheet) retires them.
            if selected == nil && !showingViewportGrid {
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
        // A revoked Owner, library or camera scope must also dismiss an
        // opened viewport union sheet before another frame can use old pins.
        showingViewportGrid = false
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
                for (position, point) in coordinates.enumerated() {
                    // Keep pinch/scroll, accessibility and cancel events
                    // responsive during 100k+ exact local repartitions.
                    if position > 0 && position % 1_024 == 0 { await Task.yield() }
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
                // The synchronous proof is now published. Covers check
                // currentProof, which must not still be masked by scan busy.
                busy = false
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
            var cloudPins: [XDriveIOSUnifiedSourceMapPin] = []
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
                } else if pin.representative.cloud != nil {
                    cloudPins.append(pin)
                }
            }
            // M12: fixed-width concurrent network thumbnail reads. No more
            // than three cloud requests are in flight; image publication is
            // always checked against the exact current Owner/camera lease.
            for offset in stride(from: 0, to: cloudPins.count, by: 3) {
                guard !Task.isCancelled, generation == ticket, currentProof else { return }
                let batch = Array(cloudPins[offset..<min(offset + 3, cloudPins.count)])
                await withTaskGroup(of: (String, UIImage?).self) { group in
                    for pin in batch {
                        guard let cloud = pin.representative.cloud else { continue }
                        group.addTask {
                            let image = try? await reader.thumbnail(cloud)
                            return (pin.id, image)
                        }
                    }
                    for await (id, image) in group {
                        guard !Task.isCancelled, generation == ticket,
                              currentProof else { continue }
                        if let image, pins.contains(where: { $0.id == id }) {
                            coverImages[id] = image
                        }
                    }
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
                        // Permit genuine verified cover publication after the
                        // complete scan; the first camera auto-fit may still
                        // invalidate this proof and reproject from the cache.
                        busy = false
                        if cameraProof {
                            loadCovers(verifiedPins, owner: owner, ticket: ticket)
                        }
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
    // A Viewer session survives adjacent-media switches without dismissing
    // and re-presenting the full-screen SwiftUI cover (visible flash).
    let session: UUID
    let row: XDriveIOSNativeUnifiedPhoto
    var id: UUID { session }

    init(row: XDriveIOSNativeUnifiedPhoto, session: UUID = UUID()) {
        self.session = session
        self.row = row
    }
}

/// One exact visual cell, revisiting the original Gallery cursor. Only two
/// windows of at most 48 rows stay mounted; a cell ID is never a request
/// parameter or source proof, and each Viewer retains its normal authority.
private struct XDriveIOSNativeUnifiedSourceMapCellWall: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @Environment(\.dismiss) private var dismiss
    let owner: XDriveNativeOwnerRoot
    let library: Data
    let presence: XDriveIOSNativeGalleryPresence
    let query: XDriveIOSNativeUnifiedGalleryQuery
    let pin: XDriveIOSUnifiedSourceMapPin
    let sourceCoordinates: [XDriveIOSUnifiedSourceCachedCoordinate]
    let sourceCursors: [XDriveIOSNativeGalleryCursor]
    var isNearbyExpansion = false
    // Scoped collection of already verified Cell keys for a viewport grid.
    // No PhotoKit asset identifiers, cloud Node IDs or new Owner capability.
    var viewportPins: [XDriveIOSUnifiedSourceMapPin]? = nil

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
    @State private var backfillViewportAnchor: XDriveIOSNativePhotoWallViewportAnchor?
    @State private var nearbyRanked: [XDriveIOSUnifiedSourceCachedCoordinate] = []
    @State private var nearbyNext: Int?
    @State private var nearbyStarts: [Int] = []
    @State private var nearbyWindowIndex = -1
    @State private var ended = false
    @State private var viewing: XDriveIOSUnifiedMapViewerChoice?
    @State private var viewerReturnID: String?
    @State private var viewerOpeningID: String?
    @State private var viewerOpeningWindow: Int = -1
    @State private var nearbyPresented = false
    @AppStorage("xdrive.ios.gallery.photo-wall-density.v1")
    private var density: XDriveIOSNativePhotoWallDensity = .standard
    @AppStorage("xdrive.ios.gallery.photo-wall-framing.v1")
    private var wallFraming: XDriveIOSNativePhotoWallFraming = .square
    @State private var timeScale: XDriveIOSNativePhotoWallTimeScale = .all
    @State private var shouldRestoreViewerTile = false
    // At most two verified 48-row windows; presentation-only measurements.
    @State private var visibleTileFrames: [String: CGRect] = [:]
    @State private var pinchReturnViewport: XDriveIOSNativePhotoWallViewportAnchor?
    @State private var photoWallViewportHeight: CGFloat = 0
    @State private var viewerReturnViewport: XDriveIOSNativePhotoWallViewportAnchor?
    @AccessibilityFocusState private var focusedTileID: String?
    @State private var placeName: String?
    @State private var placeGeocoder = CLGeocoder()
    @State private var placeNameTask: Task<Void, Never>?

    private var initialWallCursor: XDriveIOSNativeGalleryCursor {
        // A multi-cell viewport can include photos *before* the first
        // representative Cell cursor. Begin at the first verified source
        // page, then use existing <=48-item bounded page windows.
        viewportPins == nil ? pin.firstCursor : .init()
    }

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

    /// M13: the already selected, authorized representative is mapped to
    /// a human-readable locality by Apple's CoreLocation geocoder. No
    /// reverse-geocoded result is stored or used as a media membership proof.
    private func resolvePlaceName() {
        // Reverse geocoding one representative would mislabel a multi-place
        // viewport as a single town. The union sheet has its own title.
        guard viewportPins == nil, active, placeName == nil,
              placeNameTask == nil else { return }
        let ticket = generation
        let geocoder = placeGeocoder
        let target = CLLocation(latitude: pin.latitude, longitude: pin.longitude)
        placeNameTask = Task { @MainActor in
            defer { if generation == ticket { placeNameTask = nil } }
            do {
                let places = try await geocoder.reverseGeocodeLocation(target)
                guard generation == ticket, active, !Task.isCancelled,
                      let address = places.first else { return }
                let components = [address.locality, address.subLocality,
                                  address.administrativeArea]
                    .compactMap { $0 }.filter { !$0.isEmpty }
                if !components.isEmpty {
                    placeName = components.prefix(2).joined(separator: " · ")
                }
            } catch is CancellationError {
            } catch {
                // Map/PhotoKit membership works normally without a geocoder.
            }
        }
    }

    private func matchesPlace(latitude: Double, longitude: Double) -> Bool {
        if let viewportPins {
            return !viewportPins.isEmpty && viewportPins.contains { cell in
                XDriveIOSUnifiedSourceMapPolicy.member(
                    latitude: latitude, longitude: longitude,
                    key: cell.key, viewport: cell.viewport)
            }
        }
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
                XDriveIOSNativePhotoMapPlaceHeader(
                    title: viewportPins != nil ? "当前地图的照片" :
                        (placeName ?? (isNearbyExpansion
                            ? "附近照片" : "此地点的照片")),
                    count: isNearbyExpansion ? nil :
                        (viewportPins?.reduce(0) { $0 + $1.count } ?? pin.count),
                    detail: viewportPins != nil
                        ? "\(viewportPins?.count ?? 0) 个地点" :
                        (isNearbyExpansion ? "按距离浏览" : nil),
                    titleAccessibilityID: "native-ios-unified-map-place-name")
                if !isNearbyExpansion && viewportPins == nil {
                    Button {
                        guard active, !busy, !opening else { return }
                        nearbyPresented = true
                    } label: {
                        Label("显示附近照片", systemImage: "mappin.and.ellipse")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .padding(.horizontal, 14)
                    .disabled(busy || opening || viewing != nil)
                    .accessibilityIdentifier("native-ios-unified-source-map-nearby")
                }
                // Share presentation only; source-owned retry retains
                // Owner/PhotoKit authorization and cursor verification.
                XDriveIOSNativePhotoWallFeedback(
                    isLoading: busy, loadingMessage: "核对当前区域的照片…",
                    error: error, canRetry: !busy && !opening,
                    buttonTitle: "重新核对当前区域"
                ) { retryCurrentArea() }
                if !isNearbyExpansion {
                    XDriveIOSNativePhotoWallTimeScaleControls(scale: $timeScale)
                        .controlSize(.small)
                        .padding(.horizontal, 8)
                        .disabled(busy || opening || viewing != nil)
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
        // The geocoded place name is in the visible, accessible header.
        // A second centered navigation title duplicates the same information.
        .navigationTitle("")
        .toolbar {
            if !isNearbyExpansion {
                ToolbarItem(placement: .confirmationAction) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("关闭地点照片")
                    .accessibilityIdentifier("native-ios-unified-source-place-dismiss")
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                XDriveIOSNativePhotoWallDisplayMenu(
                    density: $density, framing: $wallFraming,
                    accessibilityID: "native-ios-unified-source-map-display"
                ) {
                    // Navigate within the existing place-sheet NavigationStack,
                    // not a second nested modal sheet hiding the map.
                    if !isNearbyExpansion {
                        // Nearby has a visible header action; time scale remains advanced.

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
        }
        .navigationDestination(isPresented: $nearbyPresented) {
            if active {
                // Type-erase the recursive, verified same-screen destination;
                // this is navigation-only and never caches any Owner/media ID.
                AnyView(XDriveIOSNativeUnifiedSourceMapCellWall(
                    login: login, owner: owner, library: library,
                    presence: presence, query: query, pin: pin,
                    sourceCoordinates: sourceCoordinates,
                    sourceCursors: sourceCursors, isNearbyExpansion: true))
            } else {
                AnyView(Text("该地点的照片已不可访问。"))
            }
        }
        .fullScreenCover(item: $viewing, onDismiss: {
            if !active { invalidate() }
            else { shouldRestoreViewerTile = true }
        }) { session in
            // The sheet's item identity stays stable across adjacent photos,
            // but the presented media must read the CURRENT selected row.
            // Capturing the opening item here would leave the first picture
            // mounted even after the filmstrip changes @State viewing.
            Group {
                if active, let choice = viewing, choice.session == session.session,
                   let local = choice.row.local {
                    XDriveIOSNativeLocalPhotoDetail(
                        candidate: local, onUnifiedNavigate: navigateViewer)
                        .id(choice.row.id)
                } else if active, let choice = viewing,
                          choice.session == session.session,
                          let cloud = choice.row.cloud {
                    XDriveIOSNativeServerMediaPreview(
                        item: cloud, login: login, loadedItems: [cloud],
                        openedOwner: owner, onUnifiedNavigate: navigateViewer)
                        .id(choice.row.id)
                } else {
                    Text("该照片已不可访问。")
                }
            }
            .safeAreaInset(edge: .bottom) {
                if active { viewerNavigation }
            }
        }
        .onAppear {
            photoChanges.start()
            resolvePlaceName()
            if current.isEmpty && !busy && error == nil {
                if isNearbyExpansion {
                    prepareNearbyRanking()
                } else {
                    load(from: initialWallCursor)
                }
            }
        }
        .onChange(of: photoChanges.change) { _ in invalidate() }
        .onChange(of: login.owner) { _ in invalidate() }
        .onChange(of: phase) { state in
            if state != .active { invalidate() }
        }
        .onDisappear {
            placeNameTask?.cancel(); placeNameTask = nil
            placeGeocoder.cancelGeocode()
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
            XDriveIOSNativePhotoWallScrollContainer {
                XDriveIOSNativePhotoWallCollectionStack {
                if active && busy && previous.isEmpty && current.isEmpty {
                    XDriveIOSNativePhotoWallSkeletonGrid(
                        density: density, count: min(48, max(0, pin.count))
                    )
                }
                if active && !busy && !opening && ended && error == nil &&
                   previous.isEmpty && current.isEmpty {
                    XDriveIOSNativePhotoWallEmptyState(
                        message: "此地点没有可访问的照片或视频")
                }
                if (isNearbyExpansion ? nearbyWindowIndex > 1 : windowIndex > 1)
                    && !busy && active && viewing == nil && !opening {
                    Color.clear.frame(height: 32)
                        .onAppear {
                            if isNearbyExpansion { retreatNearby() }
                            else { retreat() }
                        }
                        .accessibilityHidden(true)
                }
                // Do not date-reorder the globally distance-ranked Nearby
                // page; only an ordinary place album uses calendar groups.
                let displayTimeScale: XDriveIOSNativePhotoWallTimeScale =
                    isNearbyExpansion ? .all : timeScale
                let sections = xdriveIOSNativePhotoWallVisibleSections(
                    previous + current, scale: displayTimeScale
                ) { displayTimeScale.key(for: $0.capturedAt) }
                XDriveIOSNativePhotoWallSectionList(
                    sections: sections, density: density,
                    title: { section in
                        xdriveIOSNativePhotoWallHeading(
                            scale: displayTimeScale, key: section.key,
                            firstSection: section.id == 0)
                    },
                    items: { $0.items }
                ) { row in
                    photoButton(for: row).id(row.id)
                }
                if (isNearbyExpansion ? nearbyNext != nil : next != nil)
                    && !busy && error == nil && active &&
                    viewing == nil && !opening {
                    Color.clear.frame(height: 32)
                        .onAppear {
                            if isNearbyExpansion, let nearbyNext {
                                loadNearby(from: nearbyNext)
                            } else { advance() }
                        }
                        .accessibilityHidden(true)
                }
                }
            }
            .padding(.horizontal, XDriveIOSNativePhotoWallLayout.horizontalInset)
            .padding(.vertical, 4)
            .coordinateSpace(name: "xdrive-ios-source-place-wall")
            .background {
                GeometryReader { viewport in
                    Color.clear
                        .onAppear { photoWallViewportHeight = viewport.size.height }
                        .onChange(of: viewport.size.height) {
                            photoWallViewportHeight = $0
                        }
                }
            }
            .onPreferenceChange(XDriveIOSNativePhotoWallTileFramesKey.self) { frames in
                if visibleTileFrames != frames { visibleTileFrames = frames }
            }
            .xdrivePhotoWallPinch(
                density: $density, enabled: active && viewing == nil && !busy,
                onDensityChange: { _ in
                    // Keep the same fully visible tile at its measured pixel
                    // position, matching the main Gallery's pinch behavior.
                    // This only stores transient presentation geometry.
                    let verifiedWindow = isNearbyExpansion
                        ? nearbyWindowIndex : windowIndex
                    pinchReturnViewport = visibleTileFrames
                        .filter { $0.value.minY >= 0 &&
                                  $0.value.maxY <= photoWallViewportHeight }
                        .min(by: { $0.value.minY < $1.value.minY })
                        .map { entry in
                            XDriveIOSNativePhotoWallViewportAnchor(
                                itemID: entry.key,
                                windowIndex: verifiedWindow,
                                viewportOffset: entry.value.minY,
                                tileHeight: entry.value.height)
                        }
                }
            )
            .onChange(of: density) { _ in
                defer { pinchReturnViewport = nil }
                let verifiedWindow = isNearbyExpansion
                    ? nearbyWindowIndex : windowIndex
                guard active, viewing == nil,
                      let anchor = pinchReturnViewport,
                      (previous + current).filter({
                          $0.id == anchor.itemID
                      }).count == 1,
                      let alignment = anchor.alignment(
                          for: anchor.itemID, window: verifiedWindow,
                          viewportHeight: photoWallViewportHeight)
                else { return }
                xdrivePhotoWallScrollVerifiedTile(
                    anchor.itemID, scroll: scroll, anchor: alignment)
            }
            .onChange(of: backfillAnchorID) { anchor in
                defer {
                    backfillAnchorID = nil
                    backfillViewportAnchor = nil
                }
                guard active, let anchor,
                      (previous + current).filter({ $0.id == anchor }).count == 1
                else { return }
                let currentWindow = isNearbyExpansion
                    ? nearbyWindowIndex : windowIndex
                let alignment = backfillViewportAnchor?.alignment(
                    for: anchor, window: currentWindow,
                    viewportHeight: photoWallViewportHeight)
                scroll.scrollTo(anchor, anchor: alignment ?? .top)
            }
            .onChange(of: shouldRestoreViewerTile) { restore in
                guard restore else { return }
                shouldRestoreViewerTile = false
                defer {
                    viewerReturnID = nil
                    viewerOpeningID = nil
                    viewerOpeningWindow = -1
                }
                guard active, viewing == nil, let id = viewerReturnID,
                      (previous + current).filter({ $0.id == id }).count == 1,
                      XDriveIOSNativePhotoWallWindowPolicy.canRestore(
                        id, in: (previous + current).map(\.id),
                        scopeActive: active) else { return }
                // Do not jump/recenter on a same-photo return when the signed
                // Owner/PhotoKit window has not rotated under the Viewer.
                let sameWindow = isNearbyExpansion
                    ? viewerOpeningWindow == nearbyWindowIndex
                    : viewerOpeningWindow == windowIndex
                if viewerOpeningID == id && sameWindow {
                    // Unchanged tile and window: retain exact ScrollView pixels.
                    focusedTileID = id
                } else {
                    // A different tile may retain its measured pixel placement
                    // ONLY in the currently verified same virtual window.
                    let currentWindow = isNearbyExpansion
                        ? nearbyWindowIndex : windowIndex
                    let alignment = viewerReturnViewport?.alignment(
                        for: id, window: currentWindow,
                        viewportHeight: photoWallViewportHeight
                    )
                    xdrivePhotoWallFocusVerifiedTile(
                        id, scroll: scroll, focus: $focusedTileID,
                        anchor: alignment ?? .center
                    )
                }
            }
        }
    }

    private func photoButton(for row: XDriveIOSNativeUnifiedPhoto) -> some View {
        Button { openAfterLiveAdmission(row) } label: {
            XDriveIOSUnifiedPhotoTile(
                row: row, login: login, presentingOwner: owner,
                displayActive: active && viewing == nil,
                retainWhileCovered: viewing != nil, framing: wallFraming)
        }
        .disabled(!active || busy || opening)
        .buttonStyle(.plain)
        .accessibilityIdentifier("native-ios-unified-source-map-photo")
        .accessibilityFocused($focusedTileID, equals: row.id)
        .xdrivePhotoWallMeasureTile(row.id, in: "xdrive-ios-source-place-wall")
    }

    private func openAfterLiveAdmission(_ row: XDriveIOSNativeUnifiedPhoto) {
        guard active, !busy, !opening, viewing == nil,
              row.presence == presence,
              (previous + current).filter({ $0.id == row.id }).count == 1 else { return }
        let ticket = generation
        let openedWindow = isNearbyExpansion ? nearbyWindowIndex : windowIndex
        let openedFrame = visibleTileFrames[row.id]
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
            viewerOpeningID = row.id
            viewerOpeningWindow = openedWindow
            viewerReturnViewport = openedFrame.map {
                XDriveIOSNativePhotoWallViewportAnchor(
                    itemID: row.id, windowIndex: openedWindow,
                    viewportOffset: $0.minY, tileHeight: $0.height)
            }
            focusedTileID = nil
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
            let currentWindow = isNearbyExpansion ? nearbyWindowIndex : windowIndex
            viewerReturnViewport = visibleTileFrames[fresh.id].map {
                XDriveIOSNativePhotoWallViewportAnchor(
                    itemID: fresh.id, windowIndex: currentWindow,
                    viewportOffset: $0.minY, tileHeight: $0.height)
            }
            focusedTileID = nil
            viewing = XDriveIOSUnifiedMapViewerChoice(
                row: fresh, session: viewing?.session ?? UUID())
        }
    }

    private func navigateViewer(_ direction: Int) {
        guard (direction == -1 || direction == 1),
              active, !opening, !busy, let opened = viewing else { return }
        let rows = previous + current
        guard let position = rows.firstIndex(where: { $0.id == opened.row.id }) else { return }
        let target = position + direction
        if rows.indices.contains(target) {
            admitViewerNeighbor(rows[target])
        } else if direction > 0 {
            if isNearbyExpansion, let nearbyNext {
                loadNearby(from: nearbyNext, forViewer: true)
            } else if let next { load(from: next, forViewer: true) }
        } else if direction < 0 {
            if isNearbyExpansion && nearbyWindowIndex > 1 {
                retreatNearby(forViewer: true)
            } else if windowIndex > 1 {
                retreat(forViewer: true)
            }
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
                Text(placeName ?? (isNearbyExpansion
                    ? "附近照片" : "此地点的照片"))
                    .font(.caption).lineLimit(1)
                Spacer()
                Button { navigateViewer(1) } label: {
                    Image(systemName: "chevron.right").frame(width: 44, height: 44)
                }
                .accessibilityLabel("下一张")
                .disabled(!active || busy || opening || viewing == nil)
            }
            XDriveIOSNativePhotoWallViewerFilmstripScroll(height: 68) {
                    ForEach(previous + current) { row in
                        Button { admitViewerNeighbor(row) } label: {
                            XDriveIOSUnifiedPhotoTile(
                                row: row, login: login, presentingOwner: owner,
                                displayActive: active, retainWhileCovered: true,
                                framing: wallFraming
                            )
                            .frame(width: 48, height: 48)
                            .overlay(RoundedRectangle(cornerRadius: 4)
                                .stroke(viewing?.row.id == row.id
                                    ? Color.accentColor : Color.clear, lineWidth: 2))
                        }
                        .buttonStyle(.plain)
                        .disabled(!active || busy || opening)
                        .accessibilityLabel("选择此地点的照片")
                    }
            }
        }
        .padding(.horizontal, 8)
        .background(.ultraThinMaterial)
        .accessibilityIdentifier("native-ios-unified-source-map-viewer-filmstrip")
    }

    /// Current visible rows are display windows, not permanent source-state
    /// evidence. On EVERY Viewer move, recalculate this exact 48-item Owner
    /// and PhotoKit source page, including fresh negative matching for
    /// cloudOnly/localOnly, instead of trusting an old "absent" label.
    private func sourceCursor(for row: XDriveIOSNativeUnifiedPhoto)
        -> XDriveIOSNativeGalleryCursor? {
        let inCurrent = current.firstIndex(where: { $0.id == row.id })
        let inPrevious = previous.firstIndex(where: { $0.id == row.id })
        guard (inCurrent == nil) != (inPrevious == nil) else { return nil }
        if isNearbyExpansion {
            let page = inCurrent == nil ? nearbyWindowIndex - 1 : nearbyWindowIndex
            guard nearbyStarts.indices.contains(page) else { return nil }
            let position = nearbyStarts[page] + (inCurrent ?? inPrevious!)
            guard nearbyRanked.indices.contains(position) else { return nil }
            let sample = nearbyRanked[position]
            return sourceCursors.indices.contains(sample.page)
                ? sourceCursors[sample.page] : nil
        }
        let page = inCurrent == nil ? windowIndex - 1 : windowIndex
        return windowStarts.indices.contains(page) ? windowStarts[page] : nil
    }

    private func reproveCurrentSourcePresence(
        _ row: XDriveIOSNativeUnifiedPhoto
    ) async -> Bool {
        guard active, let cursor = sourceCursor(for: row) else { return false }
        let model = XDriveIOSNativeUnifiedPhotoTimeline()
        await model.load(from: cursor, filter: presence, login: login,
                         query: query, library: library)
        guard !Task.isCancelled, active, model.completed, model.notice == nil else {
            return false
        }
        let matches = model.rows.filter { $0.id == row.id && $0.presence == presence }
        guard matches.count == 1 else { return false }
        let refreshed = matches[0]
        guard refreshed.local?.id == row.local?.id,
              refreshed.match == row.match else { return false }
        if let earlier = row.cloud, let latest = refreshed.cloud {
            return earlier.id == latest.id &&
                earlier.node.revision == latest.node.revision &&
                earlier.contentIdentity == latest.contentIdentity
        }
        if row.presence == .cloudOnly {
            // Every cloud-only item must retain an actual present cloud Node.
            return row.cloud != nil && refreshed.cloud != nil
        }
        // A "both" Gallery row legitimately contains only the PhotoKit half
        // when its matching cloud Node is outside the current 48-item window.
        // The matched Media Reader below fetches and verifies it by exact
        // Owner, asset ID and revision instead of treating nil as "missing".
        if let newer = refreshed.cloud { return row.match?.matches(newer) == true }
        return row.cloud == nil || row.presence == .both
    }

    private func revalidateCurrentMember(
        _ row: XDriveIOSNativeUnifiedPhoto
    ) async -> XDriveIOSNativeUnifiedPhoto? {
        guard active, row.presence == presence,
              await reproveCurrentSourcePresence(row) else { return nil }
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
                guard let match = row.match, match.isValid,
                      let auth = try? await login.verifiedAuthorization(),
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, owner)
                else { return nil }
                let reader = XDriveIOSNativeMediaGalleryReader(
                    owner: owner, accessToken: auth.accessToken)
                let liveCloud: XDriveIOSNativeMediaItem
                if let expectedCloud = row.cloud {
                    guard match.matches(expectedCloud),
                          let current = try? await reader.currentMapItem(expectedCloud)
                    else { return nil }
                    liveCloud = current
                } else {
                    // Exact matching may refer to an authorized Node outside
                    // this Gallery page; do not block a valid "both" photo.
                    guard let current = try? await reader.matchedMedia(match)
                    else { return nil }
                    liveCloud = current
                }
                guard match.matches(liveCloud) else { return nil }
                currentCloud = liveCloud
            }
            let names = PHAssetResource.assetResources(for: asset)
                .map(\.originalFilename) +
                (currentCloud.map { [$0.node.name] + ($0.resources ?? []).map(\.name) } ?? [])
            guard query.matches(video: video, live: live,
                                capturedAt: asset.creationDate, names: names)
            else { return nil }
            if row.presence == .localOnly {
                // reproveCurrentSourcePresence() already reloaded the exact
                // current Owner+PhotoKit page. Its timeline recomputed the
                // server's unmatched decision using the current bounded,
                // already-proven original fingerprint index. Do not trigger
                // a second full-asset SHA read on a Viewer tap (4GiB video).
                guard row.cloud == nil, row.match == nil,
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
        windowStarts = []; windowIndex = -1; backfillAnchorID = nil; backfillViewportAnchor = nil
        nearbyRanked = []; nearbyNext = nil
        nearbyStarts = []; nearbyWindowIndex = -1
        ended = false
        viewing = nil
        viewerReturnID = nil
        viewerOpeningID = nil
        viewerOpeningWindow = -1
        shouldRestoreViewerTile = false
        viewerReturnViewport = nil
        pinchReturnID = nil
        visibleTileFrames = [:]
        photoWallViewportHeight = 0
        focusedTileID = nil
        placeNameTask?.cancel(); placeNameTask = nil
        placeGeocoder.cancelGeocode()
        placeName = nil
        nearbyPresented = false
        busy = false
        opening = false
        error = nil
    }

    /// Nearby pages are ordered by GPS distance, never by the Gallery's
    /// chronological cursor. A retry must rebuild the same ranked window,
    /// not silently switch to ordinary place timeline navigation.
    private func retryCurrentArea() {
        guard active, !busy, !opening, viewing == nil else { return }
        if isNearbyExpansion {
            previous = []; current = []
            nearbyNext = nil; nearbyStarts = []; nearbyWindowIndex = -1
            backfillAnchorID = nil; backfillViewportAnchor = nil
            ended = false
            error = nil
            if nearbyRanked.isEmpty { prepareNearbyRanking() }
            else { loadNearby(from: 0) }
        } else {
            // A failed later page may leave historical windowStarts while
            // clearing its visible rows. Restart the entire proof-bound
            // place pagination; never append page zero to an old history.
            previous = []; current = []; next = nil
            windowStarts = []; windowIndex = -1
            backfillAnchorID = nil; backfillViewportAnchor = nil
            viewerReturnID = nil
            ended = false
            error = nil
            load(from: initialWallCursor)
        }
    }

    private func advance() {
        guard !busy, active, !opening, let next else { return }
        load(from: next)
    }

    /// M14: sort ALL verified nearby GPS samples by geodesic distance
    /// (not by the temporal order of whichever 48 rows happened to load).
    /// Source offsets are display hints and are re-admitted for every page.
    private static func proximity(
        latitude: Double, longitude: Double,
        toLatitude: Double, toLongitude: Double
    ) -> Double {
        let radians = Double.pi / 180
        let dLat = (latitude - toLatitude) * radians
        let dLon = (longitude - toLongitude) * radians
        let a = pow(sin(dLat / 2), 2) +
            cos(toLatitude * radians) * cos(latitude * radians) *
            pow(sin(dLon / 2), 2)
        let bounded = min(1.0, max(0.0, a))
        return 2 * atan2(sqrt(bounded), sqrt(1 - bounded))
    }

    private func prepareNearbyRanking() {
        guard active, isNearbyExpansion, !busy, nearbyRanked.isEmpty else { return }
        // Evaluate the spherical distance exactly ONCE per matching GPS
        // sample, not O(N log N) repeated trig inside the sort comparator.
        let scored = sourceCoordinates.filter {
            matchesPlace(latitude: $0.latitude, longitude: $0.longitude)
        }.map { sample in
            (point: sample, distance: Self.proximity(
                latitude: sample.latitude, longitude: sample.longitude,
                toLatitude: pin.latitude, toLongitude: pin.longitude))
        }.sorted { left, right in
            if left.distance != right.distance { return left.distance < right.distance }
            if left.point.page != right.point.page {
                return left.point.page < right.point.page
            }
            return left.point.ordinal < right.point.ordinal
        }
        nearbyRanked = scored.map(\.point)
        if nearbyRanked.isEmpty {
            ended = true
        } else {
            loadNearby(from: 0)
        }
    }

    private func retreatNearby(forViewer: Bool = false) {
        guard nearbyWindowIndex > 1,
              nearbyStarts.indices.contains(nearbyWindowIndex - 2)
        else { return }
        loadNearby(from: nearbyStarts[nearbyWindowIndex - 2],
                   forViewer: forViewer, backwards: true)
    }

    private func loadNearby(from start: Int, forViewer: Bool = false,
                            backwards: Bool = false) {
        guard isNearbyExpansion, active, !busy, !opening,
              viewing == nil || forViewer,
              start >= 0, start < nearbyRanked.count else { return }
        let ticket = UUID()
        generation = ticket
        request?.cancel()
        busy = true
        error = nil
        let sampleRows = Array(nearbyRanked[start..<min(start + 48, nearbyRanked.count)])
        let oldAnchor = previous.first?.id
        request = Task { @MainActor in
            defer { if generation == ticket { busy = false; request = nil } }
            do {
                var verifiedPages: [Int: [XDriveIOSNativeUnifiedPhoto]] = [:]
                var items: [XDriveIOSNativeUnifiedPhoto] = []
                for sample in sampleRows {
                    try Task.checkCancellation()
                    guard generation == ticket, active,
                          sourceCursors.indices.contains(sample.page)
                    else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
                    let rows: [XDriveIOSNativeUnifiedPhoto]
                    if let hit = verifiedPages[sample.page] {
                        rows = hit
                    } else {
                        let model = XDriveIOSNativeUnifiedPhotoTimeline()
                        await model.load(from: sourceCursors[sample.page],
                                         filter: presence, login: login,
                                         query: query, library: library)
                        try Task.checkCancellation()
                        guard generation == ticket, active,
                              model.completed, model.notice == nil
                        else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
                        rows = model.rows
                        verifiedPages[sample.page] = rows
                    }
                    guard rows.indices.contains(sample.ordinal),
                          rows[sample.ordinal].presence == presence,
                          let coord = XDriveIOSUnifiedSourceMapPolicy.coordinates(
                            for: rows[sample.ordinal]),
                          coord.latitude == sample.latitude,
                          coord.longitude == sample.longitude,
                          matchesPlace(latitude: coord.latitude,
                                       longitude: coord.longitude)
                    else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
                    items.append(rows[sample.ordinal])
                }
                guard generation == ticket, active, !Task.isCancelled else { return }
                if backwards {
                    guard nearbyWindowIndex > 1, let oldAnchor else {
                        throw XDriveIOSNativeMediaReadFailure.invalidPage
                    }
                    current = previous
                    previous = items
                    nearbyWindowIndex -= 1
                    nearbyNext = nearbyStarts[nearbyWindowIndex + 1]
                    if forViewer {
                        if let row = previous.last { admitViewerNeighbor(row) }
                    } else {
                        backfillViewportAnchor = visibleTileFrames[oldAnchor].map {
                            XDriveIOSNativePhotoWallViewportAnchor(
                                itemID: oldAnchor, windowIndex: nearbyWindowIndex,
                                viewportOffset: $0.minY, tileHeight: $0.height)
                        }
                        backfillAnchorID = oldAnchor
                    }
                } else {
                    if nearbyStarts.indices.contains(nearbyWindowIndex + 1) {
                        guard nearbyStarts[nearbyWindowIndex + 1] == start else {
                            throw XDriveIOSNativeMediaReadFailure.invalidPage
                        }
                        nearbyWindowIndex += 1
                    } else {
                        nearbyStarts.append(start)
                        nearbyWindowIndex = nearbyStarts.count - 1
                    }
                    previous = current
                    current = items
                    let nextOffset = start + sampleRows.count
                    nearbyNext = nextOffset < nearbyRanked.count ? nextOffset : nil
                    if forViewer, let row = current.first { admitViewerNeighbor(row) }
                }
                next = nil
                ended = nearbyNext == nil
            } catch is CancellationError {
            } catch {
                guard generation == ticket else { return }
                previous = []; current = []; nearbyNext = nil
                self.error = "附近位置或来源索引已变化，请关闭后重新核验。"
            }
        }
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
                backfillViewportAnchor = visibleTileFrames[anchor].map {
                    XDriveIOSNativePhotoWallViewportAnchor(
                        itemID: anchor, windowIndex: windowIndex,
                        viewportOffset: $0.minY, tileHeight: $0.height)
                }
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
                    if XDriveIOSNativeUnifiedMapSeekPolicy.shouldYield(beforePage: inspected) {
                        await Task.yield()
                    }
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

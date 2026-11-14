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

private struct XDriveIOSUnifiedSourceMapPin: Identifiable {
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

    @Environment(\.scenePhase) private var phase
    // The Gallery underneath stops its PHChange observer while the modal
    // Map is open. Register one in this Map so stale GPS counts disappear
    // immediately after edits rather than only on the next user gesture.
    @StateObject private var photoChanges = XDriveIOSUnifiedPhotoObserver()
    @State private var scanTask: Task<Void, Never>?
    @State private var cameraSettleTask: Task<Void, Never>?
    @State private var coverTask: Task<Void, Never>?
    @State private var localCoverRequests: [PHImageRequestID] = []
    @State private var generation = UUID()
    @State private var busy = false
    @State private var error: String?
    @State private var pins: [XDriveIOSUnifiedSourceMapPin] = []
    @State private var coverImages: [String: UIImage] = [:]
    @State private var selected: XDriveIOSUnifiedSourceMapPin?
    @State private var provedOwner: XDriveNativeOwnerRoot?
    @State private var provedLibrary: Data?
    @State private var provedCamera: MKCoordinateRegion?
    @State private var didFitFirstVerifiedMap = false
    @State private var camera = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 0, longitude: 0),
        span: MKCoordinateSpan(latitudeDelta: 160, longitudeDelta: 360)
    )

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
            Map(coordinateRegion: $camera, annotationItems: currentProof ? pins : []) { pin in
                MapAnnotation(coordinate: CLLocationCoordinate2D(
                    latitude: pin.latitude, longitude: pin.longitude
                )) {
                    verifiedMarker(for: pin)
                }
            }
            .accessibilityIdentifier("native-ios-unified-source-map")
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
                Button("完成", action: onClose)
                    .accessibilityIdentifier("native-ios-unified-source-map-close")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("刷新") { reload() }.disabled(busy || phase != .active)
            }
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
                        presence: presence, query: query, pin: pin)
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
        .onChange(of: query) { _ in
            didFitFirstVerifiedMap = false
            reload()
        }
        .onChange(of: camera.center.latitude) { _ in scheduleCameraRefinement() }
        .onChange(of: camera.center.longitude) { _ in scheduleCameraRefinement() }
        .onChange(of: camera.span.latitudeDelta) { _ in scheduleCameraRefinement() }
        .onChange(of: camera.span.longitudeDelta) { _ in scheduleCameraRefinement() }
        .onChange(of: phase) { state in
            if state == .active { reload() } else { invalidate() }
        }
        .onDisappear {
            // Keep observing while a place sheet covers the map. Retire the
            // observation only on actual route departure.
            if selected == nil {
                photoChanges.stop()
                invalidate()
            }
        }
    }

    private func verifiedMarker(for pin: XDriveIOSUnifiedSourceMapPin) -> some View {
        Button {
            // Old MapKit hit testing cannot be treated as a source grant.
            guard currentProof, pins.contains(where: {
                $0.id == pin.id && $0.count == pin.count &&
                $0.firstCursor == pin.firstCursor
            }) else { return }
            selected = pin
        } label: {
            ZStack(alignment: .topTrailing) {
                Group {
                    if let cover = coverImages[pin.id] {
                        Image(uiImage: cover).resizable().scaledToFill()
                    } else {
                        Image(systemName: "photo.on.rectangle")
                            .resizable().scaledToFit().padding(16)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(
                    width: XDriveIOSNativeMapMarkerVisualPolicy.imageFrame.width,
                    height: XDriveIOSNativeMapMarkerVisualPolicy.imageFrame.height)
                .background(Color(uiColor: .secondarySystemGroupedBackground))
                .clipShape(RoundedRectangle(
                    cornerRadius: XDriveIOSNativeMapMarkerVisualPolicy.coverCornerRadius))
                .overlay(RoundedRectangle(
                    cornerRadius: XDriveIOSNativeMapMarkerVisualPolicy.coverCornerRadius)
                    .stroke(.white, lineWidth:
                        XDriveIOSNativeMapMarkerVisualPolicy.photoBorderWidth))
                if pin.count > 1 {
                    Text(XDriveIOSNativeMapMarkerVisualPolicy.badgeText(count: pin.count))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 5)
                        .frame(minWidth: 24, minHeight: 24)
                        .background(Color.blue, in: Capsule())
                        .overlay(Capsule().stroke(.white, lineWidth: 1.5))
                }
            }
            .frame(
                width: XDriveIOSNativeMapMarkerVisualPolicy.frame.width,
                height: XDriveIOSNativeMapMarkerVisualPolicy.frame.height)
            .overlay(RoundedRectangle(cornerRadius: 10)
                .stroke(selected?.id == pin.id ? Color.accentColor : .clear,
                        lineWidth: 3))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("native-ios-unified-source-map-cell-\(pin.id)")
        .accessibilityLabel("当前筛选的此区域 \(pin.count) 张照片")
    }

    private func invalidate() {
        generation = UUID()
        scanTask?.cancel(); scanTask = nil
        cameraSettleTask?.cancel(); cameraSettleTask = nil
        coverTask?.cancel(); coverTask = nil
        for request in localCoverRequests {
            PHImageManager.default().cancelImageRequest(request)
        }
        localCoverRequests = []
        coverImages = [:]
        pins = []
        selected = nil
        provedOwner = nil
        provedLibrary = nil
        provedCamera = nil
        busy = false
        error = nil
    }

    private func scheduleCameraRefinement() {
        guard phase == .active, selected == nil else { return }
        // Revoke old markers immediately, not after 900ms quiet, so an old
        // regional count cannot be opened during a pinch/rapid pan.
        invalidate()
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
            reload()
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
            // One trusted 64-cell window, progressive thumbnails, no original
            // image buffer and no remote download for iCloud-only local assets.
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
                    options.isNetworkAccessAllowed = false
                    options.deliveryMode = .fastFormat
                    let request = PHImageManager.default().requestImage(
                        for: asset, targetSize: CGSize(width: 128, height: 128),
                        contentMode: .aspectFill, options: options
                    ) { image, _ in
                        Task { @MainActor in
                            guard generation == ticket, currentProof,
                                  pins.contains(where: { $0.id == pin.id }),
                                  let image else { return }
                            coverImages[pin.id] = image
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
        guard phase == .active, query.isValid,
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
                                    query: query, library: library)
                    try Task.checkCancellation()
                    guard generation == ticket, page.completed,
                          page.notice == nil,
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                          XDriveIOSNativePhotoFingerprintIndex.isCurrent(library)
                    else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
                    for row in page.rows where row.presence == presence {
                        guard let coordinate = XDriveIOSUnifiedSourceMapPolicy.coordinates(for: row),
                              XDriveIOSNativeLocalMapSpatialPolicy.includes(
                                scannedViewport,
                                latitude: coordinate.latitude,
                                longitude: coordinate.longitude)
                        else { continue }
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
                        pins = verifiedPins
                        provedOwner = owner
                        provedLibrary = library
                        provedCamera = scannedCamera
                        if !didFitFirstVerifiedMap {
                            didFitFirstVerifiedMap = true
                            if let fit = XDriveIOSNativeUnifiedMapCameraPolicy.fit(
                                verifiedPins.map {
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

    @Environment(\.scenePhase) private var phase
    @StateObject private var photoChanges = XDriveIOSUnifiedPhotoObserver()
    @State private var generation = UUID()
    @State private var request: Task<Void, Never>?
    @State private var busy = false
    @State private var error: String?
    @State private var previous: [XDriveIOSNativeUnifiedPhoto] = []
    @State private var current: [XDriveIOSNativeUnifiedPhoto] = []
    @State private var next: XDriveIOSNativeGalleryCursor?
    @State private var ended = false
    @State private var viewing: XDriveIOSUnifiedMapViewerChoice?
    @State private var density: XDriveIOSNativePhotoWallDensity = .standard

    private var active: Bool {
        phase == .active &&
        XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) &&
        PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized &&
        XDriveIOSNativePhotoFingerprintIndex.isCurrent(library)
    }

    var body: some View {
        VStack(spacing: 8) {
            Text("当前来源 · 此区域 \(pin.count) 张照片")
                .font(.footnote).foregroundStyle(.secondary)
            if let error {
                XDriveIOSNativePhotoWallRetryMessage(
                    message: error, buttonTitle: "重试核对当前区域",
                    canRetry: active && !busy
                ) { load(from: next ?? pin.firstCursor) }
            }
            if busy {
                ProgressView("核对当前区域的照片…")
            }
            photoWall
            if ended && previous.isEmpty && current.isEmpty && error == nil {
                Text("该位置的照片已发生变化，请重新打开地图。")
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("此地点的照片")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu { xdrivePhotoWallDensityButtons($density) } label: {
                    Image(systemName: "square.grid.3x3")
                }
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
                load(from: pin.firstCursor)
            }
        }
        .onChange(of: photoChanges.change) { _ in invalidate() }
        .onChange(of: login.owner) { _ in invalidate() }
        .onChange(of: phase) { state in
            if state != .active { invalidate() }
        }
        .onDisappear {
            request?.cancel()
            request = nil
            if viewing == nil {
                photoChanges.stop()
                invalidate()
            }
        }
    }

    // Split the real PhotoKit wall from the sheet/Viewer modifier chain.
    // Keeping the nested ForEach/Button/Grid expression in one SwiftUI body
    // exceeded Xcode 16.4's type-check budget; there is no shortcut in tests.
    private var photoWall: some View {
        ScrollView {
            XDriveIOSNativePhotoWallGrid(density: density) {
                ForEach(previous + current) { row in
                    photoButton(for: row)
                }
                if next != nil, !busy, error == nil {
                    Color.clear.frame(height: 32)
                        .onAppear { advance() }
                        .accessibilityHidden(true)
                }
            }
            .padding(4)
        }
    }

    private func photoButton(for row: XDriveIOSNativeUnifiedPhoto) -> some View {
        Button {
            guard active, !busy,
                  (previous + current).contains(where: { $0.id == row.id })
            else { return }
            viewing = .init(row: row)
        } label: {
            XDriveIOSUnifiedPhotoTile(
                row: row, login: login, presentingOwner: owner,
                displayActive: active && viewing == nil,
                retainWhileCovered: viewing != nil, framing: .square)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("native-ios-unified-source-map-photo")
    }

    private func invalidate() {
        generation = UUID()
        request?.cancel()
        request = nil
        previous = []
        current = []
        next = nil
        ended = false
        viewing = nil
        busy = false
        error = nil
    }

    private func advance() {
        guard !busy, active, let next else { return }
        load(from: next)
    }

    private func load(from start: XDriveIOSNativeGalleryCursor) {
        guard active, !busy, viewing == nil else { return }
        let ticket = UUID()
        generation = ticket
        request?.cancel()
        busy = true
        error = nil
        request = Task { @MainActor in
            defer { if generation == ticket { busy = false; request = nil } }
            var cursor: XDriveIOSNativeGalleryCursor? = start
            do {
                for _ in 0..<XDriveIOSUnifiedSourceMapPolicy.maximumWallSeekPages {
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
                        return XDriveIOSUnifiedSourceMapPolicy.bucket(
                            latitude: coordinates.latitude,
                            longitude: coordinates.longitude) == pin.id
                    }
                    if !selected.isEmpty {
                        previous = current
                        current = Array(selected.prefix(48))
                        next = model.next
                        ended = model.next == nil
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

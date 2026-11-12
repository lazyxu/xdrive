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
    static let maximumWallSeekPages = 256

    static func canonicalLongitude(_ longitude: Double) -> Double {
        // WGS84's +180 and -180 describe the SAME meridian. Unify before
        // bucketing AND computing MapKit representative coordinates.
        longitude == 180 ? -180 : longitude
    }

    static func bucket(latitude: Double, longitude: Double) -> Int? {
        guard XDriveIOSNativePhotoMapPolicy.validCoordinate(
            latitude: latitude, longitude: longitude
        ) else { return nil }
        let lat = min(7, max(0, Int(floor((latitude + 90) / 180 * 8))))
        let canonical = canonicalLongitude(longitude)
        let lon = min(7, max(0, Int(floor((canonical + 180) / 360 * 8))))
        return lat * 8 + lon
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
                  bucket(latitude: position.latitude, longitude: position.longitude) != nil
            else { return nil }
            return CLLocationCoordinate2D(
                latitude: position.latitude,
                longitude: canonicalLongitude(position.longitude))
        }
        if let metadata = row.cloud?.metadata, let latitude = metadata.latitude,
           let longitude = metadata.longitude,
           bucket(latitude: latitude, longitude: longitude) != nil {
            return CLLocationCoordinate2D(
                latitude: latitude,
                longitude: canonicalLongitude(longitude))
        }
        return nil
    }
}

private struct XDriveIOSUnifiedSourceMapPin: Identifiable {
    let id: Int
    var latitude: Double
    var longitude: Double
    var count: Int
    // Offset/cursor only, never saved or trusted as a media access token.
    let firstCursor: XDriveIOSNativeGalleryCursor
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
    @State private var generation = UUID()
    @State private var busy = false
    @State private var error: String?
    @State private var pins: [XDriveIOSUnifiedSourceMapPin] = []
    @State private var selected: XDriveIOSUnifiedSourceMapPin?
    @State private var provedOwner: XDriveNativeOwnerRoot?
    @State private var provedLibrary: Data?
    @State private var camera = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 0, longitude: 0),
        span: MKCoordinateSpan(latitudeDelta: 160, longitudeDelta: 360)
    )

    private var currentProof: Bool {
        phase == .active && !busy && error == nil &&
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
                    Button {
                        guard currentProof else { return }
                        selected = pin
                    } label: {
                        Label("\(pin.count)", systemImage: "photo.on.rectangle")
                            .font(.caption.weight(.semibold))
                            .padding(7)
                            .background(.regularMaterial, in: Capsule())
                    }
                    .accessibilityIdentifier("native-ios-unified-source-map-cell-\(pin.id)")
                    .accessibilityLabel("当前筛选的此区域 \(pin.count) 张照片")
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
                Text("\(presence.title) · 已核对 \(total) 张有定位的照片")
                    .font(.footnote).monospacedDigit()
                    .accessibilityIdentifier("native-ios-unified-source-map-total")
                if pins.isEmpty {
                    Text("当前经过核对的筛选结果没有拍摄位置。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            } else {
                Text("照片访问或来源核验已失效，请重新核对。")
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
            if let owner = provedOwner, let library = provedLibrary, currentProof {
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
            // A PhotoKit edit invalidates both published map counts and the
            // selected sheet. No old coordinate becomes a new membership.
            invalidate()
            if phase == .active { reload() }
        }
        .onChange(of: login.owner) { _ in invalidate() }
        .onChange(of: presence) { _ in reload() }
        .onChange(of: query) { _ in reload() }
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

    private func invalidate() {
        generation = UUID()
        scanTask?.cancel()
        scanTask = nil
        pins = []
        selected = nil
        provedOwner = nil
        provedLibrary = nil
        busy = false
        error = nil
    }

    private func reload() {
        invalidate()
        guard phase == .active, query.isValid,
              let owner = login.owner,
              PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized,
              let stamp = try? XDriveIOSPhotoKitLibraryEpoch.capture()
        else {
            error = "来源地图需要完整照片权限、当前 Owner 及有效筛选。"
            return
        }
        let library = stamp.serialized
        let ticket = generation
        busy = true
        scanTask = Task { @MainActor in
            defer {
                if generation == ticket {
                    busy = false
                    scanTask = nil
                }
            }
            var counted: [Int: XDriveIOSUnifiedSourceMapPin] = [:]
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
                              let id = XDriveIOSUnifiedSourceMapPolicy.bucket(
                                latitude: coordinate.latitude, longitude: coordinate.longitude
                              ) else { continue }
                        if var known = counted[id] {
                            let n = Double(known.count)
                            known.latitude = (known.latitude * n + coordinate.latitude) / (n + 1)
                            known.longitude = (known.longitude * n + coordinate.longitude) / (n + 1)
                            known.count += 1
                            counted[id] = known
                        } else {
                            counted[id] = .init(
                                id: id, latitude: coordinate.latitude,
                                longitude: coordinate.longitude, count: 1,
                                firstCursor: start)
                        }
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
                        pins = counted.values.sorted { $0.id < $1.id }
                        provedOwner = owner
                        provedLibrary = library
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
            ScrollView {
                XDriveIOSNativePhotoWallGrid(density: density) {
                    ForEach(previous + current) { row in
                        Button {
                            guard active, !busy,
                                  (previous + current).contains(where: { $0.id == row.id })
                            else { return }
                            viewing = .init(row: row)
                        } label: {
                            XDriveIOSUnifiedPhotoTile(
                                row: row, login: login, presentingOwner: owner,
                                displayActive: active && viewing == nil,
                                retainWhileCovered: viewing != nil)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("native-ios-unified-source-map-photo")
                    }
                    if next != nil, !busy, error == nil {
                        Color.clear.frame(height: 32)
                            .onAppear { advance() }
                            .accessibilityHidden(true)
                    }
                }
                .padding(4)
            }
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

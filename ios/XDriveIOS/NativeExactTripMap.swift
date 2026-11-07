import MapKit
import SwiftUI
import UIKit

/// Bounded independent cover reader. Map pins are NOT authority: a thumbnail
/// is eligible only after a fresh trip AND place filtered 48-item Range proves
/// the same signed Owner trip-map count. It has no SwiftUI state access.
private enum XDriveIOSExactTripCoverResult: @unchecked Sendable {
    case ready(String, UIImage)
    case revoked
    case unavailable
}

private struct XDriveIOSExactTripCoverRequest: @unchecked Sendable {
    let reader: XDriveIOSNativeMediaGalleryReader
    let trip: XDriveIOSNativeExactTrip
    let facet: XDriveIOSNativeOwnerMapFacet
    let timeZone: String

    func perform() async -> XDriveIOSExactTripCoverResult {
        do {
            try Task.checkCancellation()
            let page = try await reader.exactTripPage(
                trip, offset: 0, timeZone: timeZone, place: facet)
            try Task.checkCancellation()
            guard XDriveIOSNativeOwnerMapSelectionPolicy.acceptsCoverPage(
                facet, rangeTotal: page.total_count, offset: page.offset
            ), let first = page.items.first(where: { $0.supportsPreview })
            else { return .unavailable }
            let image = try await reader.thumbnail(first)
            try Task.checkCancellation()
            return .ready(facet.id, image)
        } catch is CancellationError {
            return .unavailable
        } catch let failure as XDriveIOSNativeMediaReadFailure {
            if case .response(let code) = failure, code == 401 || code == 403 {
                return .revoked
            }
            return .unavailable
        } catch {
            return .unavailable
        }
    }
}

private struct XDriveIOSExactTripMapCluster: Identifiable {
    let id = UUID()
    let facets: [XDriveIOSNativeOwnerMapFacet]
}

/// A MapKit page INSIDE one trip. It never calls /media/places/overview,
/// reader.page(placeID:) or a client-side all-photo GPS enumerator.
struct XDriveIOSNativeExactTripMapScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let expectedOwner: XDriveNativeOwnerRoot
    let trip: XDriveIOSNativeExactTrip
    let timeZone: String

    @Environment(\.scenePhase) private var phase
    @State private var epoch = UUID()
    @State private var task: Task<Void, Never>?
    @State private var coverTask: Task<Void, Never>?
    @State private var overview: XDriveIOSNativeOwnerMapOverview?
    @State private var coverImages: [String: UIImage] = [:]
    @State private var busy = false
    @State private var error: String?
    @State private var moving = false
    @State private var revision = UUID()
    @State private var mapType: MKMapType = .standard
    @State private var selectedPlace: XDriveIOSNativeOwnerMapFacet?
    @State private var selectedCluster: XDriveIOSExactTripMapCluster?
    @State private var fitRequestID: UUID?
    @State private var fittedCamera: MKCoordinateRegion?
    @State private var camera = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 0, longitude: 0),
        span: MKCoordinateSpan(latitudeDelta: 160, longitudeDelta: 360))

    private var activeOwner: Bool {
        phase == .active &&
        XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner)
    }

    private var markersEnabled: Bool {
        activeOwner && !busy && !moving &&
        selectedPlace == nil && selectedCluster == nil &&
        overview != nil
    }

    var body: some View {
        VStack(spacing: 8) {
            XDriveIOSOwnerMapSurface(
                overview: overview,
                coverImages: coverImages,
                markersEnabled: markersEnabled,
                revision: revision,
                mapType: mapType,
                initialCamera: camera,
                focusRequestID: fitRequestID,
                focusCamera: fittedCamera,
                onCameraWillChange: {
                    // Disable all hit-testing at gesture START. The same
                    // trip-only selection covers every camera viewport.
                    moving = true
                },
                onCamera: { next in
                    camera = next
                    moving = false
                },
                onPlace: { facet in
                    guard activeOwner, !busy, !moving,
                          selectedPlace == nil, selectedCluster == nil,
                          let overview,
                          overview.total_photo_count == trip.item_count,
                          XDriveIOSNativeOwnerMapSelectionPolicy.acceptsSelectedFacet(
                              facet, currentlyVisible: overview.items)
                    else { return }
                    selectedPlace = facet
                },
                onPlaces: { facets in
                    guard activeOwner, !busy, !moving,
                          selectedPlace == nil, selectedCluster == nil,
                          let overview,
                          overview.total_photo_count == trip.item_count,
                          XDriveIOSNativeOwnerMapSelectionPolicy.acceptsSelectedCluster(
                              facets, currentlyVisible: overview.items)
                    else { return }
                    selectedCluster = XDriveIOSExactTripMapCluster(facets: facets)
                },
                onAggregate: {
                    self.error = "当前位置不是可直接打开的旅行地点，请调整地图。"
                }
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityIdentifier("native-ios-exact-trip-map")
            if let overview {
                Text("仅此旅行已核对 GPS 照片：\(overview.total_photo_count) 张 · \(overview.items.count) 个真实地点")
                    .font(.caption).monospacedDigit()
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("native-ios-exact-trip-map-count")
            }
            if busy { ProgressView("核对本次旅行的地点…") }
            if let error {
                Text(error).font(.footnote).foregroundStyle(.secondary)
                Button("重试旅行地图") { reload() }
                    .disabled(busy || !activeOwner)
            }
        }
        .padding(.horizontal, 8)
        .navigationTitle(trip.title + " · 地图")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Picker("底图样式", selection: $mapType) {
                        Text("标准地图").tag(MKMapType.standard)
                        Text("卫星地图").tag(MKMapType.satellite)
                    }
                } label: {
                    Label("底图样式", systemImage: "square.3.layers.3d")
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("刷新") { reload() }.disabled(busy || !activeOwner)
            }
        }
        .sheet(item: $selectedPlace, onDismiss: {
            if activeOwner { reload() } else { invalidate() }
        }) { facet in
            NavigationStack {
                XDriveIOSNativeExactTripWall(
                    login: login, expectedOwner: expectedOwner,
                    trip: trip, timeZone: timeZone, place: facet)
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .sheet(item: $selectedCluster, onDismiss: {
            if activeOwner { reload() } else { invalidate() }
        }) { cluster in
            NavigationStack {
                List(cluster.facets) { facet in
                    NavigationLink {
                        XDriveIOSNativeExactTripWall(
                            login: login, expectedOwner: expectedOwner,
                            trip: trip, timeZone: timeZone, place: facet)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(facet.name)
                            Text("\(facet.item_count) 张此旅行照片")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .navigationTitle("旅行中的地点")
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .onAppear {
            if overview == nil && !busy { reload() }
        }
        .onChange(of: login.owner) { _ in
            invalidate()
            if activeOwner { reload() }
        }
        .onChange(of: phase) { state in
            if state == .active {
                if overview == nil { reload() }
            } else {
                invalidate()
            }
        }
        .onDisappear {
            // Navigation/sheet dismissal does not grant any new GPS access.
            // The next presentation will reverify its v2 scope if needed.
            task?.cancel()
            coverTask?.cancel()
            if selectedPlace == nil && selectedCluster == nil {
                invalidate()
            }
        }
    }

    private func invalidate() {
        epoch = UUID()
        task?.cancel()
        coverTask?.cancel()
        task = nil
        coverTask = nil
        overview = nil
        coverImages = [:]
        selectedPlace = nil
        selectedCluster = nil
        fittedCamera = nil
        fitRequestID = nil
        busy = false
        moving = false
        revision = UUID()
        error = nil
    }

    private func reload() {
        invalidate()
        guard activeOwner, XDriveIOSNativeExactTripPolicy.validTrip(trip),
              XDriveIOSNativeExactTripPolicy.validTimeZone(timeZone)
        else { return }
        let ticket = epoch
        busy = true
        task = Task { @MainActor in
            defer {
                if epoch == ticket { busy = false; task = nil }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard epoch == ticket, activeOwner,
                      XDriveIOSNativePhotoOwnerScope.matches(
                          auth.owner, expectedOwner)
                else { return }
                let reader = XDriveIOSNativeMediaGalleryReader(
                    owner: auth.owner, accessToken: auth.accessToken)
                let result = try await reader.exactTripMap(
                    trip, timeZone: timeZone)
                try Task.checkCancellation()
                guard epoch == ticket, activeOwner,
                      XDriveIOSNativePhotoOwnerScope.matches(
                          login.owner, expectedOwner),
                      result.total_photo_count == trip.item_count
                else { return }
                overview = result
                revision = UUID()
                let positions = result.items.map {
                    XDriveIOSNativeExactTripMapPoint(
                        latitude: $0.latitude, longitude: $0.longitude)
                }
                guard let frame = XDriveIOSNativeExactTripMapCameraPolicy.fit(positions)
                else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
                fittedCamera = MKCoordinateRegion(
                    center: CLLocationCoordinate2D(
                        latitude: frame.latitude, longitude: frame.longitude),
                    span: MKCoordinateSpan(
                        latitudeDelta: frame.latitudeSpan,
                        longitudeDelta: frame.longitudeSpan))
                fitRequestID = UUID()
                busy = false
                loadCovers(result, reader: reader, ticket: ticket)
            } catch is CancellationError {
            } catch let failure as XDriveIOSNativeMediaReadFailure {
                guard epoch == ticket else { return }
                if case .response(let code) = failure {
                    switch code {
                    case 401, 403:
                        invalidate()
                        self.error = "当前 Owner 已撤权，旅行地图不可访问。"
                    case 404:
                        self.error = "此旅行已变化，请返回旅行列表刷新。"
                    case 409:
                        // Never masquerade a truncated 65+ place overview
                        // as a complete map. Keep the trip photo wall usable.
                        self.error = "当前旅行地点过多或成员正在变化，暂无法完整显示地图（最多 64 个地点）。"
                    default:
                        self.error = "无法核对旅行地图，请重试。"
                    }
                } else {
                    self.error = "旅行地点或成员已变化，请返回旅行列表刷新。"
                }
            } catch {
                if epoch == ticket {
                    self.error = "无法读取当前旅行地图，请稍后重试。"
                }
            }
        }
    }

    private func loadCovers(
        _ result: XDriveIOSNativeOwnerMapOverview,
        reader: XDriveIOSNativeMediaGalleryReader,
        ticket: UUID
    ) {
        coverTask?.cancel()
        coverTask = Task { @MainActor in
            defer { if epoch == ticket { coverTask = nil } }
            let maximumConcurrentCovers = 3
            let facets = XDriveIOSNativeOwnerMapSelectionPolicy
                .prioritizedPhotoCovers(result.items)
            for start in stride(from: 0, to: facets.count, by: maximumConcurrentCovers) {
                guard !Task.isCancelled, epoch == ticket,
                      activeOwner, selectedPlace == nil, selectedCluster == nil
                else { return }
                let end = min(facets.count, start + maximumConcurrentCovers)
                await withTaskGroup(of: XDriveIOSExactTripCoverResult.self) { group in
                    for facet in facets[start..<end] {
                        let request = XDriveIOSExactTripCoverRequest(
                            reader: reader, trip: trip, facet: facet,
                            timeZone: timeZone)
                        group.addTask { await request.perform() }
                    }
                    for await completed in group {
                        guard !Task.isCancelled, epoch == ticket, activeOwner,
                              selectedPlace == nil, selectedCluster == nil,
                              overview?.total_photo_count == trip.item_count
                        else { group.cancelAll(); return }
                        switch completed {
                        case .ready(let placeID, let image):
                            coverImages[placeID] = image
                        case .revoked:
                            group.cancelAll()
                            invalidate()
                            error = "当前 Owner 身份或旅行地图权限已失效。"
                            return
                        case .unavailable:
                            break
                        }
                    }
                }
            }
        }
    }
}


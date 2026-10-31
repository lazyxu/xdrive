import Combine
import MapKit
import SwiftUI
import UIKit

private enum XDriveIOSNativePhotoMapSource: String, CaseIterable {
    case local, cloud
    var label: String { self == .local ? "本机位置" : "云端 Owner" }
}

/// Keep one Gallery map route; source selection does not create an independent
/// native tab or a second Owner authentication/backup writer.
struct XDriveIOSNativePhotoMapsScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    var onFocusChange: ((Bool) -> Void)?
    @State private var source: XDriveIOSNativePhotoMapSource = .local

    var body: some View {
        VStack(spacing: 4) {
            Picker("地图照片来源", selection: $source) {
                ForEach(XDriveIOSNativePhotoMapSource.allCases, id: \.self) { item in
                    Text(item.label).tag(item)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 12)
            .accessibilityIdentifier("native-ios-map-source-selector")
            Group {
                switch source {
                case .local:
                    XDriveIOSNativeLocalPhotoMapScreen(onFocusChange: onFocusChange)
                case .cloud:
                    XDriveIOSNativeOwnerPhotoMapScreen(
                        login: login, onFocusChange: onFocusChange)
                }
            }
        }
        .onChange(of: source) { _ in onFocusChange?(false) }
    }
}

private final class XDriveIOSOwnerPlaceAnnotation: NSObject, MKAnnotation {
    let facet: XDriveIOSNativeOwnerMapFacet
    let coordinate: CLLocationCoordinate2D
    var title: String? { facet.name }
    init(_ facet: XDriveIOSNativeOwnerMapFacet) {
        self.facet = facet
        coordinate = CLLocationCoordinate2D(
            latitude: facet.latitude, longitude: facet.longitude)
    }
}

/// Presentation-only, reusable 64px native cloud cover. No network or
/// PhotoKit work happens inside an MKAnnotationView/SDK callback.
private final class XDriveIOSOwnerMapPhotoCover: MKAnnotationView {
    private let imageView = UIImageView()
    private let placeholder = UIImageView(image: UIImage(systemName: "photo"))
    private let badge = UILabel()

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        setup()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setup()
    }

    private func setup() {
        frame = CGRect(x: 0, y: 0, width: 68, height: 68)
        centerOffset = CGPoint(x: 0, y: -16)
        collisionMode = .circle
        displayPriority = .defaultHigh
        imageView.frame = CGRect(x: 2, y: 2, width: 64, height: 64)
        imageView.contentMode = .scaleAspectFill
        imageView.clipsToBounds = true
        imageView.layer.cornerRadius = 9
        imageView.layer.borderColor = UIColor.white.cgColor
        imageView.layer.borderWidth = 2
        imageView.backgroundColor = .secondarySystemGroupedBackground
        addSubview(imageView)
        placeholder.frame = CGRect(x: 20, y: 20, width: 28, height: 28)
        placeholder.tintColor = .secondaryLabel
        addSubview(placeholder)
        badge.frame = CGRect(x: 41, y: -7, width: 33, height: 28)
        badge.font = .boldSystemFont(ofSize: 11)
        badge.textAlignment = .center
        badge.textColor = .white
        badge.backgroundColor = .systemBlue
        badge.layer.cornerRadius = 14
        badge.layer.borderWidth = 2
        badge.layer.borderColor = UIColor.white.cgColor
        badge.clipsToBounds = true
        addSubview(badge)
    }

    func configure(_ image: UIImage?, count: Int, enabled: Bool) {
        imageView.image = image
        placeholder.isHidden = image != nil
        badge.isHidden = count <= 1
        badge.text = count >= 1000 ? "999+" : String(count)
        // Old pins may remain visually during a gesture, but must not
        // become actionable VoiceOver targets or stale SDK selections.
        isEnabled = enabled
        isAccessibilityElement = enabled
        accessibilityTraits = enabled ? .button : []
        accessibilityLabel = enabled ? "\(count) 张已索引照片的云端位置" : nil
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        imageView.image = nil
        placeholder.isHidden = false
        badge.text = nil
        accessibilityLabel = nil
    }
}

private struct XDriveIOSOwnerMapSurface: UIViewRepresentable {
    let overview: XDriveIOSNativeOwnerMapOverview?
    let coverImages: [String: UIImage]
    let markersEnabled: Bool
    let revision: UUID
    let onCameraWillChange: () -> Void
    let onCamera: (MKCoordinateRegion) -> Void
    let onPlace: (XDriveIOSNativeOwnerMapFacet) -> Void
    let onAggregate: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onCameraWillChange: onCameraWillChange,
                    onCamera: onCamera, onPlace: onPlace, onAggregate: onAggregate)
    }

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        // Do not treat the initial, programmatic world-region setup as a
        // user pan. Install the delegate only after setRegion completes.
        map.showsUserLocation = false
        map.register(XDriveIOSOwnerMapPhotoCover.self,
                     forAnnotationViewWithReuseIdentifier: "xdrive-owner-pin")
        map.register(XDriveIOSOwnerMapPhotoCover.self,
                     forAnnotationViewWithReuseIdentifier: "xdrive-owner-cluster")
        map.setRegion(MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 0, longitude: 0),
            span: MKCoordinateSpan(latitudeDelta: 160, longitudeDelta: 360)),
            animated: false)
        map.delegate = context.coordinator
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.onCameraWillChange = onCameraWillChange
        context.coordinator.onCamera = onCamera
        context.coordinator.onPlace = onPlace
        context.coordinator.onAggregate = onAggregate
        context.coordinator.coverImages = coverImages
        context.coordinator.markersEnabled = markersEnabled
        context.coordinator.refreshVisibleCovers(map)
        guard context.coordinator.revision != revision else { return }
        context.coordinator.revision = revision
        map.removeAnnotations(map.annotations.filter {
            $0 is XDriveIOSOwnerPlaceAnnotation
        })
        if let overview {
            map.addAnnotations(overview.items.prefix(64).map(XDriveIOSOwnerPlaceAnnotation.init))
            context.coordinator.refreshVisibleCovers(map)
        }
        // Never auto-fit a new response: the user-owned camera stays intact
        // until an explicit pan, pinch, zoom or selected cluster.
    }

    static func dismantleUIView(_ map: MKMapView, coordinator: Coordinator) {
        map.delegate = nil
        map.removeAnnotations(map.annotations.filter {
            $0 is XDriveIOSOwnerPlaceAnnotation
        })
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var revision: UUID?
        var coverImages: [String: UIImage] = [:]
        var markersEnabled = false
        var onCameraWillChange: () -> Void
        var onCamera: (MKCoordinateRegion) -> Void
        var onPlace: (XDriveIOSNativeOwnerMapFacet) -> Void
        var onAggregate: () -> Void

        init(onCameraWillChange: @escaping () -> Void,
             onCamera: @escaping (MKCoordinateRegion) -> Void,
             onPlace: @escaping (XDriveIOSNativeOwnerMapFacet) -> Void,
             onAggregate: @escaping () -> Void) {
            self.onCameraWillChange = onCameraWillChange
            self.onCamera = onCamera
            self.onPlace = onPlace
            self.onAggregate = onAggregate
        }

        func mapView(_ mapView: MKMapView, regionWillChangeAnimated animated: Bool) {
            // Revoke hit-testing and accessibility on UIKit's coordinator
            // synchronously, before SwiftUI can schedule another state render.
            markersEnabled = false
            refreshVisibleCovers(mapView)
            // Like both Baidu SDK Hosts, revoke earlier Cell/Camera authority
            // at gesture START, not when a later network response arrives.
            onCameraWillChange()
        }

        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
            onCamera(mapView.region)
        }

        func refreshVisibleCovers(_ map: MKMapView) {
            for annotation in map.annotations {
                guard let cover = map.view(for: annotation) as? XDriveIOSOwnerMapPhotoCover
                else { continue }
                let members: [XDriveIOSOwnerPlaceAnnotation]
                if let cluster = annotation as? MKClusterAnnotation {
                    members = cluster.memberAnnotations.compactMap {
                        $0 as? XDriveIOSOwnerPlaceAnnotation
                    }
                } else if let point = annotation as? XDriveIOSOwnerPlaceAnnotation {
                    members = [point]
                } else { continue }
                cover.configure(members.compactMap { coverImages[$0.facet.id] }.first,
                                count: members.reduce(0) { $0 + $1.facet.item_count },
                                enabled: markersEnabled)
            }
        }

        func mapView(_ mapView: MKMapView,
                     viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            if annotation is MKUserLocation { return nil }
            let members: [XDriveIOSOwnerPlaceAnnotation]
            let reuse: String
            if let cluster = annotation as? MKClusterAnnotation {
                members = cluster.memberAnnotations.compactMap {
                    $0 as? XDriveIOSOwnerPlaceAnnotation
                }
                reuse = "xdrive-owner-cluster"
            } else if let pin = annotation as? XDriveIOSOwnerPlaceAnnotation {
                members = [pin]
                reuse = "xdrive-owner-pin"
            } else { return nil }
            guard !members.isEmpty else { return nil }
            let marker = mapView.dequeueReusableAnnotationView(
                withIdentifier: reuse, for: annotation) as? XDriveIOSOwnerMapPhotoCover
            marker?.annotation = annotation
            marker?.clusteringIdentifier =
                reuse == "xdrive-owner-pin" ? "xdrive-owner-cluster-id" : nil
            let counted = members.reduce(0) { $0 + $1.facet.item_count }
            marker?.configure(members.compactMap { coverImages[$0.facet.id] }.first,
                              count: counted, enabled: markersEnabled)
            marker?.canShowCallout = false
            return marker
        }

        func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
            mapView.deselectAnnotation(view.annotation, animated: false)
            guard markersEnabled else { return }
            if let cluster = view.annotation as? MKClusterAnnotation {
                mapView.showAnnotations(cluster.memberAnnotations, animated: true)
                onAggregate()
            } else if let point = view.annotation as? XDriveIOSOwnerPlaceAnnotation {
                if XDriveIOSNativeOwnerMapSelectionPolicy.canOpenPhotoRange(point.facet) {
                    onPlace(point.facet)
                } else {
                    let current = mapView.region.span
                    let smaller = MKCoordinateSpan(
                        latitudeDelta: max(0.01, current.latitudeDelta * 0.35),
                        longitudeDelta: max(0.01, current.longitudeDelta * 0.35))
                    mapView.setRegion(MKCoordinateRegion(
                        center: point.coordinate, span: smaller), animated: true)
                    onAggregate()
                }
            }
        }
    }
}

private struct XDriveIOSOwnerMapChosenPlace: Identifiable {
    let id: String
}

struct XDriveIOSNativeOwnerPhotoMapScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    var onFocusChange: ((Bool) -> Void)?
    @Environment(\.scenePhase) private var phase
    @State private var overview: XDriveIOSNativeOwnerMapOverview?
    @State private var coverImages: [String: UIImage] = [:]
    @State private var coverTask: Task<Void, Never>?
    @State private var verifiedBounds: XDriveIOSNativeOwnerMapBounds?
    @State private var requestedBounds: XDriveIOSNativeOwnerMapBounds?
    @State private var cameraGesturePending = false
    @State private var cameraSettleTask: Task<Void, Never>?
    @State private var busy = false
    @State private var error: String?
    @State private var revision = UUID()
    @State private var epoch = UUID()
    @State private var task: Task<Void, Never>?
    @State private var selected: XDriveIOSOwnerMapChosenPlace?
    @State private var focused = false
    @State private var camera = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 0, longitude: 0),
        span: MKCoordinateSpan(latitudeDelta: 160, longitudeDelta: 360))

    private var mapMarkersEnabled: Bool {
        guard phase == .active, !busy, login.owner != nil,
              selected == nil, let verifiedBounds else { return false }
        return XDriveIOSNativeOwnerMapSelectionPolicy.isSameViewport(
            verifiedBounds, current: currentBounds())
    }

    var body: some View {
        VStack(spacing: 8) {
            Text("当前 Server Owner 已索引的 WGS84 云端位置，不是本机 PhotoKit 相册。")
                .font(.footnote).foregroundStyle(.secondary)
            XDriveIOSOwnerMapSurface(
                overview: overview, coverImages: coverImages,
                markersEnabled: mapMarkersEnabled,
                revision: revision,
                onCameraWillChange: { revokeCameraAuthorization() },
                onCamera: { next in
                    camera = next
                    // Programmatic camera correction may occur during Owner
                    // HTTPS; compare pending as well as already-verified bounds.
                    if let authorized = verifiedBounds ?? requestedBounds,
                       !XDriveIOSNativeOwnerMapSelectionPolicy.isSameViewport(
                         authorized, current: currentBounds()) {
                        revokeCameraAuthorization()
                    }
                    if cameraGesturePending {
                        cameraGesturePending = false
                        scheduleCameraRefresh()
                    }
                },
                onPlace: { item in
                    guard phase == .active, !busy, login.owner != nil,
                          let overview, let verifiedBounds,
                          XDriveIOSNativeOwnerMapSelectionPolicy.isSameViewport(
                            verifiedBounds, current: currentBounds()),
                          XDriveIOSNativeOwnerMapSelectionPolicy.acceptsSelectedPlace(
                            item.id, currentlyVisibleIDs: overview.items.map(\.id)),
                          overview.items.contains(where: {
                            $0.id == item.id && $0.item_count == item.item_count
                          }) else { return }
                    cameraSettleTask?.cancel()
                    cameraSettleTask = nil
                    coverTask?.cancel()
                    coverTask = nil
                    selected = XDriveIOSOwnerMapChosenPlace(id: item.id)
                },
                onAggregate: {
                    error = "聚合区域已放大；相机稳定后自动刷新，必要时可手动刷新。"
                }
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityIdentifier("native-ios-owner-cloud-photo-map")
            if let overview {
                if verifiedBounds != nil {
                    Text("当前视窗已有 \(overview.total_photo_count) 张已索引照片；地图显示 \(overview.items.count) 个位置代表项。")
                        .font(.footnote).monospacedDigit()
                } else {
                    // Retain old annotations VISUALLY during pan/zoom but do
                    // not mislabel them as the newly authorized camera count.
                    Text("上次验证视窗有 \(overview.total_photo_count) 张已索引照片；地图移动后旧标记暂不可打开。")
                        .font(.footnote).monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                if overview.aggregated {
                    Text("区域仍为聚合结果；放大后刷新才能进入精确地点照片。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            if busy { ProgressView("核对当前 Owner 地图位置…") }
            if let error { Text(error).font(.footnote).foregroundStyle(.secondary) }
            Button("刷新当前视窗") { reload() }
                .disabled(busy || login.owner == nil || phase != .active)
                .frame(minHeight: 44)
                .buttonStyle(.bordered)
                .accessibilityIdentifier("native-ios-owner-map-refresh")
            Text("选择真实地点后仅打开当前 Owner 重新验证的 48 项 PhotoAsset 分页与原生 Viewer；聚合区域不能当成照片访问凭证。")
                .font(.footnote).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 8)
        .navigationTitle("云端照片地图")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(focused ? "显示底部导航" : "专注地图") {
                    focused.toggle()
                    onFocusChange?(focused)
                }
            }
        }
        .sheet(item: $selected, onDismiss: {
            if phase == .active { reload() } else { invalidate() }
        }) { place in
            NavigationStack {
                XDriveIOSNativeServerMediaWall(
                    login: login, album: nil, placeID: place.id)
            }
            // One native map album sheet: medium preview grows into the same
            // verified 48-item PhotoAsset wall, without a fixed photo strip.
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .onAppear { if overview == nil && !busy && phase == .active { reload() } }
        .onChange(of: login.owner) { _ in
            selected = nil
            invalidate()
            if phase == .active && login.owner != nil { reload() }
        }
        .onChange(of: phase) { new in
            if new == .active { reload() }
            else { selected = nil; invalidate() }
        }
        .onDisappear {
            if selected == nil {
                focused = false
                onFocusChange?(false)
                invalidate()
            } else {
                cameraSettleTask?.cancel()
                cameraSettleTask = nil
                coverTask?.cancel()
                coverTask = nil
                task?.cancel()
                task = nil
            }
        }
    }

    private func currentBounds() -> XDriveIOSNativeOwnerMapBounds? {
        XDriveIOSNativeOwnerMapSelectionPolicy.viewportBounds(
            latitude: camera.center.latitude,
            longitude: camera.center.longitude,
            latitudeSpan: camera.span.latitudeDelta,
            longitudeSpan: camera.span.longitudeDelta
        )
    }

    private func scheduleCameraRefresh() {
        cameraSettleTask?.cancel()
        cameraSettleTask = nil
        guard phase == .active, selected == nil,
              login.owner != nil, currentBounds() != nil else { return }
        let ticket = epoch
        // One camera read after 500ms quiet, matching the two Baidu Hosts.
        // Another gesture/Owner change cancels this task before dispatch.
        cameraSettleTask = Task { @MainActor in
            do { try await Task.sleep(nanoseconds: 500_000_000) }
            catch { return }
            guard !Task.isCancelled, epoch == ticket,
                  phase == .active, selected == nil,
                  login.owner != nil else { return }
            cameraSettleTask = nil
            reload()
        }
    }

    private func loadCurrentOwnerCovers(
        _ result: XDriveIOSNativeOwnerMapOverview,
        reader: XDriveIOSNativeMediaGalleryReader,
        expected: XDriveNativeOwnerRoot, bounds: XDriveIOSNativeOwnerMapBounds,
        ticket: UUID
    ) {
        coverTask?.cancel()
        coverTask = Task { @MainActor in
            // At most 12 covers per viewport, sourced from fresh exact-place
            // Owner Range pages. Never trust bare cover_node_id as an image
            // credential. Sequential requests bound foreground memory/traffic.
            for facet in XDriveIOSNativeOwnerMapSelectionPolicy
                .prioritizedPhotoCovers(result.items) {
                guard !Task.isCancelled, epoch == ticket, selected == nil,
                      phase == .active,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected),
                      XDriveIOSNativeOwnerMapSelectionPolicy.isSameViewport(
                        bounds, current: currentBounds())
                else { return }
                do {
                    let page = try await reader.page(offset: 0, placeID: facet.id)
                    try Task.checkCancellation()
                    // An Owner or camera switch during the first await must
                    // not dispatch another thumbnail request for the old scope.
                    guard epoch == ticket, selected == nil, phase == .active,
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected),
                          XDriveIOSNativeOwnerMapSelectionPolicy.isSameViewport(
                            bounds, current: currentBounds())
                    else { return }
                    guard page.total_count > 0, let first = page.items.first
                    else { continue }
                    let cover = try await reader.thumbnail(first)
                    try Task.checkCancellation()
                    guard epoch == ticket, selected == nil, phase == .active,
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected),
                          XDriveIOSNativeOwnerMapSelectionPolicy.isSameViewport(
                            bounds, current: currentBounds())
                    else { return }
                    coverImages[facet.id] = cover
                } catch is CancellationError {
                    return
                } catch let failure as XDriveIOSNativeMediaReadFailure {
                    // A revoked Owner may return an auth failure without a
                    // local login notification. Stop the whole cover sequence
                    // immediately; never issue eleven more old-Owner reads.
                    if case .response(let status) = failure,
                       status == 401 || status == 403 {
                        if epoch == ticket {
                            // The signed Owner session is no longer an
                            // authority for either images or location pins.
                            invalidate()
                            error = "当前 Owner 身份或地图权限已失效，请重新验证。"
                        }
                        return
                    }
                } catch {
                    // No derivative is not a missing original or an excuse
                    // to fetch a broad all-Owner photo range.
                }
            }
        }
    }

    private func revokeCameraAuthorization() {
        // A MapKit gesture may occur during the awaited HTTPS Owner read.
        // Advance the generation *immediately*, before the next paint, while
        // preserving old annotations as NONINTERACTIVE visual references.
        epoch = UUID()
        cameraGesturePending = true
        cameraSettleTask?.cancel()
        cameraSettleTask = nil
        coverTask?.cancel()
        coverTask = nil
        task?.cancel()
        task = nil
        verifiedBounds = nil
        requestedBounds = nil
        if overview != nil || busy {
            error = "地图视窗已变化，请刷新当前视窗。"
        }
        busy = false
    }

    private func invalidate() {
        epoch = UUID()
        cameraSettleTask?.cancel()
        cameraSettleTask = nil
        cameraGesturePending = false
        coverTask?.cancel()
        coverTask = nil
        coverImages = [:]
        task?.cancel()
        task = nil
        overview = nil
        verifiedBounds = nil
        requestedBounds = nil
        error = nil
        busy = false
        revision = UUID()
    }

    private func reload() {
        guard phase == .active, let expected = login.owner else {
            invalidate()
            return
        }
        guard let bounds = XDriveIOSNativeOwnerMapSelectionPolicy.viewportBounds(
            latitude: camera.center.latitude,
            longitude: camera.center.longitude,
            latitudeSpan: camera.span.latitudeDelta,
            longitudeSpan: camera.span.longitudeDelta
        ) else {
            invalidate()
            error = "地图位置无效，请缩放后重试。"
            return
        }
        epoch = UUID()
        let ticket = epoch
        cameraSettleTask?.cancel()
        cameraSettleTask = nil
        coverTask?.cancel()
        coverTask = nil
        coverImages = [:]
        task?.cancel()
        task = nil
        overview = nil
        verifiedBounds = nil
        requestedBounds = bounds
        error = nil
        busy = true
        revision = UUID()
        task = Task { @MainActor in
            defer {
                if epoch == ticket {
                    busy = false
                    task = nil
                    requestedBounds = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                guard epoch == ticket, phase == .active,
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected)
                else { return }
                let reader = XDriveIOSNativeMediaGalleryReader(
                    owner: auth.owner, accessToken: auth.accessToken)
                let result = try await reader.mapOverview(bounds: bounds, detail: true)
                try Task.checkCancellation()
                guard epoch == ticket, phase == .active,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected),
                      XDriveIOSNativeOwnerMapSelectionPolicy.isSameViewport(
                        bounds, current: currentBounds())
                else { return }
                verifiedBounds = bounds
                overview = result
                revision = UUID()
                loadCurrentOwnerCovers(result, reader: reader,
                                       expected: expected, bounds: bounds,
                                       ticket: ticket)
            } catch is CancellationError {
            } catch {
                guard epoch == ticket else { return }
                overview = nil
                self.error = "当前 Owner 地图范围或权限已失效，请核对账户并重试。"
            }
        }
    }
}

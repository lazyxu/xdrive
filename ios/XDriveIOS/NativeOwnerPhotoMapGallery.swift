import Combine
import MapKit
import SwiftUI
import UIKit

/// A cover read never has access to SwiftUI map state. Its result crosses
/// back to the MainActor before any image is published or authorization revoked.
/// UIImage is immutable here; the sole UI mutation remains MainActor-bound.
private enum XDriveIOSOwnerMapCoverOutcome: @unchecked Sendable {
    case ready(String, UIImage)
    case revoked
    case unavailable
}

/// Immutable snapshot only. The Reader creates one ephemeral HTTPS session per
/// request; no UIKit view, Owner authorization state or map camera is captured
/// by an independently executing child task.
private struct XDriveIOSOwnerMapCoverRead: @unchecked Sendable {
    let facet: XDriveIOSNativeOwnerMapFacet
    let reader: XDriveIOSNativeMediaGalleryReader
    let captureRange: XDriveIOSNativePhotoMapCaptureRange?

    func perform() async -> XDriveIOSOwnerMapCoverOutcome {
        do {
            try Task.checkCancellation()
            let page = try await reader.page(
                offset: 0, placeID: facet.id, captureRange: captureRange)
            try Task.checkCancellation()
            // A verified page total is mandatory; a MapKit cover Node ID
            // is never a credential for a thumbnail or an Owner PhotoAsset.
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
            if case .response(let status) = failure, status == 401 || status == 403 {
                return .revoked
            }
            return .unavailable
        } catch {
            return .unavailable
        }
    }
}

enum XDriveIOSNativePhotoMapSource: String, CaseIterable {
    case local, cloud
    var label: String { self == .local ? "本机位置" : "云端 Owner" }
}

/// Keep one Gallery map route; source selection does not create an independent
/// native tab or a second Owner authentication/backup writer.
struct XDriveIOSNativePhotoMapsScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    // The Gallery parent retains only bounded local PhotoKit navigation hints.
    // Source switches never reset the parent's map scope or page cursor.
    @Binding var localMapScope: XDriveIOSNativeLocalMapScope
    @Binding var localMapPageOffset: Int
    @Binding var source: XDriveIOSNativePhotoMapSource
    @Binding var cloudMapCamera: MKCoordinateRegion?
    @Binding var localMapCamera: MKCoordinateRegion?
    var onFocusChange: ((Bool) -> Void)?
    var onClose: (() -> Void)? = nil
    // Shared Gallery media selection applies only to the local PhotoKit map.
    // Cloud Owner Map remains governed by its signed Server PhotoScope.
    var mediaFilter: XDriveIOSNativePhotoMediaFilter = .all
    var filenameTerm: String = ""
    var cloudSourceAllowed = true
    var inheritedCaptureRange: XDriveIOSNativePhotoMapCaptureRange? = nil

    var body: some View {
        let expectedOwner = login.owner
        return Group {
            switch source {
            case .local:
                XDriveIOSNativeLocalPhotoMapScreen(
                    mapScope: $localMapScope,
                    offset: $localMapPageOffset,
                    onClose: onClose,
                    cameraOnEntry: localMapCamera,
                    onLibraryCameraChange: { next in
                        // Local PhotoKit maps work without a Server Owner.
                        // Preserve their camera in a signed-out session, but
                        // never accept an old callback across login/logout or
                        // an Owner switch. Cloud camera remains Owner-bound.
                        guard source == .local else { return }
                        if let expectedOwner {
                            guard XDriveIOSNativePhotoOwnerScope.matches(
                                login.owner, expectedOwner
                            ) else { return }
                        } else {
                            guard login.owner == nil else { return }
                        }
                        localMapCamera = next
                    },
                    onFocusChange: onFocusChange,
                    mediaFilter: mediaFilter,
                    filenameTerm: filenameTerm,
                    inheritedCaptureRange: inheritedCaptureRange
                )
            case .cloud:
                if cloudSourceAllowed {
                    XDriveIOSNativeOwnerPhotoMapScreen(
                    login: login, onFocusChange: onFocusChange,
                    cameraReturn: cloudMapCamera,
                    onCameraChange: { next in
                        guard source == .cloud, let expectedOwner,
                              XDriveIOSNativePhotoOwnerScope.matches(
                                login.owner, expectedOwner
                              ) else { return }
                        cloudMapCamera = next
                    },
                    inheritedCaptureRange: inheritedCaptureRange)
                } else {
                    Text("当前文件名或媒体筛选仅允许查看本机位置地图。")
                        .accessibilityIdentifier("native-ios-map-cloud-filter-unavailable")
                }
            }
        }
        .toolbar {
            // Local MapKit supplies its own Done item. The cloud Owner map
            // shares this route and receives the same native dismissal action.
            if source == .cloud {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("完成") { onClose?() }
                        .accessibilityIdentifier("native-ios-map-close")
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Picker("地图照片来源", selection: $source) {
                        ForEach(XDriveIOSNativePhotoMapSource.allCases.filter {
                            cloudSourceAllowed || $0 == .local
                        }, id: \.self) { item in
                            Text(item.label).tag(item)
                        }
                    }
                } label: {
                    Label(source.label, systemImage: "square.stack.3d.up")
                }
                .accessibilityLabel("地图照片来源：\(source.label)")
                .accessibilityIdentifier("native-ios-map-source-selector")
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
        badge.isHidden = !enabled || count <= 1
        badge.text = count >= 1000 ? "999+" : String(count)
        // Old pins may remain visually during a gesture, but must not
        // become actionable VoiceOver targets or stale SDK selections.
        isEnabled = enabled
        isAccessibilityElement = enabled
        accessibilityTraits = enabled ? .button : []
        accessibilityLabel = enabled ? "\(count) 张已索引照片的云端位置" : nil
        accessibilityHint = enabled ? "双击打开已核对的地点照片" : nil
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        imageView.image = nil
        placeholder.isHidden = false
        badge.text = nil
        accessibilityLabel = nil
    }
}

// Presentation-only MapKit surface shared by ordinary Owner maps and exact
// trip-only maps. Data selection and authentication stay in their callers.
struct XDriveIOSOwnerMapSurface: UIViewRepresentable {
    let overview: XDriveIOSNativeOwnerMapOverview?
    let coverImages: [String: UIImage]
    let markersEnabled: Bool
    let revision: UUID
    let mapType: MKMapType
    let initialCamera: MKCoordinateRegion
    var focusRequestID: UUID? = nil
    var focusCamera: MKCoordinateRegion? = nil
    var showsUserDot = false
    let onCameraWillChange: () -> Void
    let onCamera: (MKCoordinateRegion) -> Void
    let onPlace: (XDriveIOSNativeOwnerMapFacet) -> Void
    let onPlaces: ([XDriveIOSNativeOwnerMapFacet]) -> Void
    let onAggregate: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onCameraWillChange: onCameraWillChange,
                    onCamera: onCamera, onPlace: onPlace,
                    onPlaces: onPlaces, onAggregate: onAggregate)
    }

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        // Do not treat the initial, programmatic world-region setup as a
        // user pan. Install the delegate only after setRegion completes.
        map.showsUserLocation = false
        map.mapType = mapType
        map.register(XDriveIOSOwnerMapPhotoCover.self,
                     forAnnotationViewWithReuseIdentifier: "xdrive-owner-pin")
        map.register(XDriveIOSOwnerMapPhotoCover.self,
                     forAnnotationViewWithReuseIdentifier: "xdrive-owner-cluster")
        map.setRegion(initialCamera, animated: false)
        map.delegate = context.coordinator
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        // Base-layer changes keep the verified Owner bounds and current camera.
        if map.mapType != mapType {
            // MapKit may emit camera callbacks while replacing its base layer.
            // This is not a user pan: preserve the existing verified GPS cells.
            map.delegate = nil
            map.mapType = mapType
            map.delegate = context.coordinator
        }
        context.coordinator.onCameraWillChange = onCameraWillChange
        context.coordinator.onCamera = onCamera
        context.coordinator.onPlace = onPlace
        context.coordinator.onPlaces = onPlaces
        context.coordinator.onAggregate = onAggregate
        context.coordinator.coverImages = coverImages
        context.coordinator.markersEnabled = markersEnabled
        context.coordinator.refreshVisibleCovers(map)
        if map.showsUserLocation != showsUserDot {
            map.showsUserLocation = showsUserDot
        }
        if let focusID = focusRequestID,
           context.coordinator.focusRequestID != focusID,
           let focusCamera {
            // This is a real camera change. MapKit's native delegate revokes
            // the previous Owner/Cell lease and requests a fresh scoped scan.
            context.coordinator.focusRequestID = focusID
            map.setRegion(focusCamera, animated: true)
        }
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
        var focusRequestID: UUID?
        var coverImages: [String: UIImage] = [:]
        var markersEnabled = false
        var onCameraWillChange: () -> Void
        var onCamera: (MKCoordinateRegion) -> Void
        var onPlace: (XDriveIOSNativeOwnerMapFacet) -> Void
        var onPlaces: ([XDriveIOSNativeOwnerMapFacet]) -> Void
        var onAggregate: () -> Void

        init(onCameraWillChange: @escaping () -> Void,
             onCamera: @escaping (MKCoordinateRegion) -> Void,
             onPlace: @escaping (XDriveIOSNativeOwnerMapFacet) -> Void,
             onPlaces: @escaping ([XDriveIOSNativeOwnerMapFacet]) -> Void,
             onAggregate: @escaping () -> Void) {
            self.onCameraWillChange = onCameraWillChange
            self.onCamera = onCamera
            self.onPlace = onPlace
            self.onPlaces = onPlaces
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
                let members = cluster.memberAnnotations
                let facets = members.compactMap {
                    ($0 as? XDriveIOSOwnerPlaceAnnotation)?.facet
                }
                // Only complete, exact place-ID clusters may open photos.
                // Virtual map-region samples are zoom targets, not credentials.
                if members.count == facets.count, facets.count >= 2,
                   facets.allSatisfy({
                       XDriveIOSNativeOwnerMapSelectionPolicy.canOpenPhotoRange($0)
                   }) {
                    onPlaces(facets.sorted { $0.id < $1.id })
                } else {
                    mapView.showAnnotations(cluster.memberAnnotations, animated: true)
                    onAggregate()
                }
            } else if let point = view.annotation as? XDriveIOSOwnerPlaceAnnotation {
                if XDriveIOSNativeOwnerMapSelectionPolicy.canOpenPhotoRange(point.facet) {
                    onPlace(point.facet)
                } else {
                    let region: MKCoordinateRegion
                    if let rectangle = point.facet.display_bounds,
                       XDriveIOSNativeOwnerMapOverviewPolicy.validBounds(rectangle) {
                        // The entire display bucket, not only its representative
                        // photo, must survive a drilldown. This rectangle is
                        // never a PhotoAsset credential or Range selector.
                        let lonSpan = rectangle.west < rectangle.east
                            ? rectangle.east - rectangle.west
                            : rectangle.east + 360 - rectangle.west
                        let longitude = rectangle.west + lonSpan / 2
                        region = MKCoordinateRegion(
                            center: CLLocationCoordinate2D(
                                latitude: (rectangle.south + rectangle.north) / 2,
                                longitude: longitude > 180 ? longitude - 360 : longitude),
                            span: MKCoordinateSpan(
                                latitudeDelta: max(0.002, (rectangle.north - rectangle.south) * 1.10),
                                longitudeDelta: max(0.002, lonSpan * 1.10)))
                    } else {
                        let current = mapView.region.span
                        region = MKCoordinateRegion(
                            center: point.coordinate,
                            span: MKCoordinateSpan(
                                latitudeDelta: max(0.002, current.latitudeDelta * 0.35),
                                longitudeDelta: max(0.002, current.longitudeDelta * 0.35)))
                    }
                    mapView.setRegion(region, animated: true)
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
    // Transient same-Owner camera only, never serialized as GPS history.
    var cameraReturn: MKCoordinateRegion? = nil
    var onCameraChange: ((MKCoordinateRegion) -> Void)? = nil
    var inheritedCaptureRange: XDriveIOSNativePhotoMapCaptureRange? = nil
    @Environment(\.scenePhase) private var phase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
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
    @State private var selectedCluster: XDriveIOSOwnerMapChosenCluster?
    // A reverified one-photo exact Owner place opens native L3 directly.
    @State private var singleViewer: XDriveIOSNativeMediaItem?
    @State private var singlePage: XDriveIOSNativeMediaRange?
    @State private var singleOwner: XDriveNativeOwnerRoot?
    @State private var singleTask: Task<Void, Never>?
    @State private var focused = false
    @State private var mapType: MKMapType = .standard
    @State private var captureOverride: XDriveIOSNativePhotoMapCaptureRange?
    @State private var usingCaptureOverride = false
    @State private var datePickerOpen = false
    @State private var requestedCaptureDay = Date()
    @StateObject private var currentLocation = XDriveIOSNativeMapUserLocationController()
    @State private var showingMapHelp = false
    @State private var camera = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 0, longitude: 0),
        span: MKCoordinateSpan(latitudeDelta: 160, longitudeDelta: 360))

    private var recentMapYears: [Int] {
        let current = Calendar.current.component(.year, from: Date())
        return Array((max(1, current - 20)...current).reversed())
    }

    private var activeCaptureRange: XDriveIOSNativePhotoMapCaptureRange? {
        usingCaptureOverride ? captureOverride : inheritedCaptureRange
    }

    private func setCaptureRange(_ range: XDriveIOSNativePhotoMapCaptureRange?) {
        usingCaptureOverride = true
        captureOverride = range
        // onChange below cancels all previously authorized Owner map requests.
    }

    private var mapMarkersEnabled: Bool {
        guard phase == .active, !busy, login.owner != nil,
              selected == nil, selectedCluster == nil,
              singleViewer == nil, singleTask == nil,
              let verifiedBounds else { return false }
        return XDriveIOSNativeOwnerMapSelectionPolicy.isSameViewport(
            verifiedBounds, current: currentBounds())
    }

    var body: some View {
        GeometryReader { viewport in
        let compactMap = XDriveIOSNativePhotoMapPolicy.compactViewport(
            width: Double(viewport.size.width),
            height: Double(viewport.size.height),
            accessibilityText: dynamicTypeSize.isAccessibilitySize
        )
        VStack(spacing: compactMap ? 4 : 8) {
            // Source details live in map help during ordinary photo browsing.
            // Large accessibility text retains the full inline explanation.
            if !compactMap && dynamicTypeSize.isAccessibilitySize {
                Text("当前 Server Owner 已索引的 WGS84 云端位置，不是本机 PhotoKit 相册。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            XDriveIOSOwnerMapSurface(
                overview: overview, coverImages: coverImages,
                markersEnabled: mapMarkersEnabled,
                revision: revision, mapType: mapType,
                initialCamera: cameraReturn ?? camera,
                focusRequestID: currentLocation.requestID,
                focusCamera: currentLocation.camera,
                showsUserDot: currentLocation.showsUserDot,
                onCameraWillChange: { revokeCameraAuthorization() },
                onCamera: { next in
                    camera = next
                    onCameraChange?(next)
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
                    guard phase == .active, !busy,
                          selected == nil, selectedCluster == nil,
                          singleViewer == nil, singleTask == nil,
                          let expected = login.owner,
                          let overview, let verifiedBounds,
                          XDriveIOSNativeOwnerMapSelectionPolicy.isSameViewport(
                            verifiedBounds, current: currentBounds()),
                          XDriveIOSNativeOwnerMapSelectionPolicy.acceptsSelectedPlace(
                            item.id, currentlyVisibleIDs: overview.items.map(\.id)),
                          overview.items.contains(where: {
                            $0.id == item.id && $0.item_count == item.item_count
                          }),
                          // Retained MapKit pins must match the freshly signed
                          // facet, not just a reused ID and count.
                          XDriveIOSNativeOwnerMapSelectionPolicy.acceptsSelectedFacet(
                            item, currentlyVisible: overview.items
                          ) else { return }
                    cameraSettleTask?.cancel()
                    cameraSettleTask = nil
                    coverTask?.cancel()
                    coverTask = nil
                    if item.item_count == 1,
                       XDriveIOSNativeOwnerMapSelectionPolicy.canOpenPhotoRange(item) {
                        openSinglePhoto(item, expected: expected, bounds: verifiedBounds)
                    } else {
                        selected = XDriveIOSOwnerMapChosenPlace(id: item.id)
                    }
                },
                onPlaces: { facets in
                    guard phase == .active, !busy,
                          selected == nil, selectedCluster == nil,
                          singleViewer == nil, singleTask == nil,
                          let expected = login.owner,
                          let overview, let verifiedBounds,
                          XDriveIOSNativeOwnerMapSelectionPolicy.isSameViewport(
                            verifiedBounds, current: currentBounds()
                          ),
                          XDriveIOSNativeOwnerMapSelectionPolicy.acceptsSelectedCluster(
                            facets, currentlyVisible: overview.items
                          ) else { return }
                    cameraSettleTask?.cancel()
                    cameraSettleTask = nil
                    coverTask?.cancel()
                    coverTask = nil
                    selectedCluster = XDriveIOSOwnerMapChosenCluster(
                        places: facets, owner: expected,
                        captureRange: activeCaptureRange)
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
                        .font(.caption).monospacedDigit()
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("native-ios-owner-map-verified-count")
                } else {
                    // Retain old annotations VISUALLY during pan/zoom but do
                    // not mislabel them as the newly authorized camera count.
                    Text("上次验证视窗有 \(overview.total_photo_count) 张已索引照片；地图移动后旧标记暂不可打开。")
                        .font(.caption).monospacedDigit()
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("native-ios-owner-map-stale-count")
                }
                if overview.aggregated {
                    Text("区域仍为聚合结果；放大后刷新才能进入精确地点照片。")
                        .font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if let activeCaptureRange {
                Text("当前照片日期：\(activeCaptureRange.label)")
                    .font(.footnote).foregroundStyle(.secondary)
                    .accessibilityIdentifier("native-ios-owner-map-capture-range")
            }
            if busy { ProgressView("核对当前 Owner 地图位置…") }
            if let error { Text(error).font(.footnote).foregroundStyle(.secondary) }
            if !compactMap && dynamicTypeSize.isAccessibilitySize {
                Text("选择真实地点后仅打开当前 Owner 重新验证的 48 项 PhotoAsset 分页与原生 Viewer；聚合区域不能当成照片访问凭证。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        }
        .padding(.horizontal, 8)
        .navigationTitle("云端照片地图")
        .navigationBarTitleDisplayMode(.inline)
        .alert("云端照片地图说明", isPresented: $showingMapHelp) {
            Button("完成", role: .cancel) {}
        } message: {
            Text("当前地图仅展示已经验证的 Server Owner 位置代表项。地图移动后旧封面暂不可操作；相机稳定后重新核对。只有实际授权地点才可打开当前 Owner 的 48 项 PhotoAsset 分页与 Viewer；聚合区域不是照片访问凭证。")
        }
        .sheet(isPresented: $datePickerOpen) {
            NavigationStack {
                Form {
                    DatePicker("拍摄日期", selection: $requestedCaptureDay,
                               displayedComponents: .date)
                        .datePickerStyle(.graphical)
                    Button("显示选择日期所在月份") {
                        let calendar = Calendar.current
                        setCaptureRange(XDriveIOSNativePhotoMapCaptureRange.month(
                            calendar.component(.year, from: requestedCaptureDay),
                            calendar.component(.month, from: requestedCaptureDay)))
                        datePickerOpen = false
                    }
                    .accessibilityIdentifier("native-ios-owner-map-selected-month")
                    Button("显示选择日期所在年份") {
                        setCaptureRange(XDriveIOSNativePhotoMapCaptureRange.year(
                            Calendar.current.component(.year, from: requestedCaptureDay)))
                        datePickerOpen = false
                    }
                    .accessibilityIdentifier("native-ios-map-selected-year")
                }
                .navigationTitle("选择云端地图日期")
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("显示当天") {
                            setCaptureRange(XDriveIOSNativePhotoMapCaptureRange.day(
                                requestedCaptureDay))
                            datePickerOpen = false
                        }
                    }
                    ToolbarItem(placement: .cancellationAction) {
                        Button("取消") { datePickerOpen = false }
                    }
                }
            }
        }
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button("全部日期") { setCaptureRange(nil) }
                    Button("最近 7 天") {
                        setCaptureRange(XDriveIOSNativePhotoMapCaptureRange.recentDays(7))
                    }
                    Button("最近 30 天") {
                        setCaptureRange(XDriveIOSNativePhotoMapCaptureRange.recentDays(30))
                    }
                    Section("按年份") {
                        ForEach(recentMapYears, id: \.self) { year in
                            Button("\(year) 年") {
                                setCaptureRange(XDriveIOSNativePhotoMapCaptureRange.year(year))
                            }
                        }
                    }
                    Button("按指定日期") { datePickerOpen = true }
                } label: {
                    Label("地图日期", systemImage: "calendar")
                }
                .accessibilityIdentifier("native-ios-owner-map-capture-menu")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    // Keep explicit retry/refresh accessible without occupying
                    // another fixed-height row under the photo map.
                    Button("刷新当前视窗") { reload() }
                        .disabled(busy || login.owner == nil || phase != .active)
                        .accessibilityIdentifier("native-ios-owner-map-refresh")
                } label: {
                    Label("地图操作", systemImage: "ellipsis.circle")
                }
                .accessibilityIdentifier("native-ios-owner-map-actions")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Picker("底图样式", selection: $mapType) {
                        Text("标准地图").tag(MKMapType.standard)
                        Text("卫星地图").tag(MKMapType.satellite)
                    }
                } label: {
                    Label("底图样式", systemImage: "square.3.layers.3d")
                }
                .accessibilityIdentifier("native-ios-owner-map-basemap")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    currentLocation.locate()
                } label: {
                    Label("我的位置", systemImage: "location")
                }
                .disabled(currentLocation.isLocating ||
                          login.owner == nil || phase != .active)
                .accessibilityIdentifier("native-ios-owner-map-locate")
                .alert(item: $currentLocation.alert) { issue in
                    Alert(title: Text("无法获取当前位置"),
                          message: Text(issue.message),
                          dismissButton: .default(Text("完成")))
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(focused ? "显示底部导航" : "专注地图") {
                    focused.toggle()
                    onFocusChange?(focused)
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                // Same verified Owner: these are Server GPS members, not
                // PhotoKit assets or heuristic date-only Memories.
                NavigationLink {
                    XDriveIOSNativeExactTripsScreen(login: login)
                } label: {
                    Label("旅行地点", systemImage: "map")
                }
                .disabled(login.owner == nil || phase != .active)
                .accessibilityIdentifier("native-ios-owner-map-exact-trips")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    showingMapHelp = true
                } label: {
                    Label("地图说明", systemImage: "info.circle")
                }
                .accessibilityIdentifier("native-ios-owner-map-layout-help")
            }
        }
        .sheet(item: $selected, onDismiss: {
            if phase == .active { reload() } else { invalidate() }
        }) { place in
            NavigationStack {
                XDriveIOSNativeServerMediaWall(
                    login: login, album: nil, placeID: place.id,
                    captureRange: activeCaptureRange)
            }
            // One native map album sheet: medium preview grows into the same
            // verified 48-item PhotoAsset wall, without a fixed photo strip.
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .sheet(item: $selectedCluster, onDismiss: {
            if phase == .active { reload() } else { invalidate() }
        }) { chosen in
            NavigationStack {
                XDriveIOSNativeOwnerMapClusterAlbum(
                    login: login, selection: chosen)
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .fullScreenCover(item: $singleViewer, onDismiss: {
            singlePage = nil
            singleOwner = nil
            if phase == .active { reload() } else { invalidate() }
        }) { initial in
            XDriveIOSNativeServerMediaPreview(
                item: initial, login: login,
                loadedItems: singlePage?.items ?? [],
                loadedRange: singlePage,
                openedOwner: singleOwner
            )
        }
        .onAppear {
            if let cameraReturn { camera = cameraReturn }
            if overview == nil && !busy && phase == .active { reload() }
        }
        .onChange(of: currentLocation.requestID) { _ in
            guard phase == .active, login.owner != nil,
                  let target = currentLocation.camera else { return }
            // Immediately revoke old Owner camera rights before moving to
            // the user's position; no PhotoAsset can use stale ACLs.
            revokeCameraAuthorization()
            camera = target
            onCameraChange?(target)
            scheduleCameraRefresh()
        }
        .onChange(of: activeCaptureRange) { _ in
            if phase == .active { invalidate(); reload() }
            else { invalidate() }
        }
        .onChange(of: login.owner) { _ in
            currentLocation.cancel()
            selected = nil
            selectedCluster = nil
            singleViewer = nil
            invalidate()
            if phase == .active && login.owner != nil { reload() }
        }
        .onChange(of: phase) { new in
            if new == .active {
                if singleViewer == nil { reload() }
            } else {
                currentLocation.cancel()
                selected = nil
                selectedCluster = nil
                singleViewer = nil
                invalidate()
            }
        }
        .onDisappear {
            currentLocation.cancel()
            if selected == nil && selectedCluster == nil && singleViewer == nil {
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

    private func openSinglePhoto(
        _ facet: XDriveIOSNativeOwnerMapFacet,
        expected: XDriveNativeOwnerRoot,
        bounds: XDriveIOSNativeOwnerMapBounds
    ) {
        guard phase == .active, !busy, singleTask == nil,
              singleViewer == nil, facet.item_count == 1,
              XDriveIOSNativeOwnerMapSelectionPolicy.canOpenPhotoRange(facet)
        else { return }
        let ticket = epoch
        busy = true
        error = nil
        singleTask = Task { @MainActor in
            defer {
                if epoch == ticket {
                    singleTask = nil
                    busy = false
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard epoch == ticket, phase == .active,
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected),
                      XDriveIOSNativeOwnerMapSelectionPolicy.isSameViewport(
                          bounds, current: currentBounds()
                      ) else { return }
                let reader = XDriveIOSNativeMediaGalleryReader(
                    owner: auth.owner, accessToken: auth.accessToken)
                // MapKit annotations are not access credentials. A fresh
                // Owner-scoped single-place Range must prove the L3 item.
                let result = try await reader.page(
                    offset: 0, placeID: facet.id, captureRange: activeCaptureRange)
                try Task.checkCancellation()
                guard epoch == ticket, phase == .active,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected),
                      XDriveIOSNativeOwnerMapSelectionPolicy.isSameViewport(
                          bounds, current: currentBounds()
                      ),
                      overview?.items.contains(where: {
                          $0.id == facet.id && $0.item_count == 1
                      }) == true,
                      result.total_count == 1, result.items.count == 1,
                      result.offset == 0, let item = result.items.first
                else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
                if item.supportsPreview {
                    singlePage = result
                    singleOwner = expected
                    singleViewer = item
                } else {
                    selected = XDriveIOSOwnerMapChosenPlace(id: facet.id)
                }
            } catch is CancellationError {
            } catch let failure as XDriveIOSNativeMediaReadFailure {
                guard epoch == ticket else { return }
                if case .response(let status) = failure,
                   status == 401 || status == 403 {
                    invalidate()
                    error = "当前 Owner 权限已失效，请重新验证。"
                    return
                }
                error = "该地点照片已变化或暂不可读取，请重试。"
            } catch {
                if epoch == ticket { self.error = "地点照片读取失败，请重试。" }
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
        guard phase == .active, selected == nil, selectedCluster == nil,
              singleViewer == nil, singleTask == nil,
              login.owner != nil, currentBounds() != nil else { return }
        let ticket = epoch
        // One camera read after 500ms quiet, matching the two Baidu Hosts.
        // Another gesture/Owner change cancels this task before dispatch.
        cameraSettleTask = Task { @MainActor in
            do { try await Task.sleep(nanoseconds: 500_000_000) }
            catch { return }
            guard !Task.isCancelled, epoch == ticket,
                  phase == .active, selected == nil, selectedCluster == nil,
                   singleViewer == nil, singleTask == nil,
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
            defer { if epoch == ticket { coverTask = nil } }
            // Do not serialize up to 64 independent Range + thumbnail pairs:
            // a single slow derivative must not starve all remaining places.
            // Three concurrent reads is a hard ceiling, not 64 fan-out.
            // Every group is structured under coverTask so gesture, Owner,
            // Viewer or scene cancellation terminates in-flight URL requests.
            let maximumConcurrentCovers = 3
            let captureRange = activeCaptureRange
            let facets = XDriveIOSNativeOwnerMapSelectionPolicy
                .prioritizedPhotoCovers(result.items)
            for start in stride(from: 0, to: facets.count, by: maximumConcurrentCovers) {
                guard !Task.isCancelled, epoch == ticket,
                      selected == nil, selectedCluster == nil,
                      singleViewer == nil, singleTask == nil, phase == .active,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected),
                      XDriveIOSNativeOwnerMapSelectionPolicy.isSameViewport(
                        bounds, current: currentBounds())
                else { return }

                let end = min(facets.count, start + maximumConcurrentCovers)
                await withTaskGroup(of: XDriveIOSOwnerMapCoverOutcome.self) { group in
                    for facet in facets[start..<end] {
                        let request = XDriveIOSOwnerMapCoverRead(
                            facet: facet, reader: reader, captureRange: captureRange)
                        group.addTask { await request.perform() }
                    }
                    for await completed in group {
                        // Only this actor may commit decoded images to the map.
                        // A late old-Owner/old-camera result cannot reappear
                        // after revocation, cancellation or Viewer navigation.
                        guard !Task.isCancelled, epoch == ticket,
                              selected == nil, selectedCluster == nil,
                              singleViewer == nil, singleTask == nil, phase == .active,
                              XDriveIOSNativePhotoOwnerScope.matches(
                                login.owner, expected),
                              XDriveIOSNativeOwnerMapSelectionPolicy.isSameViewport(
                                bounds, current: currentBounds())
                        else { group.cancelAll(); return }
                        switch completed {
                        case .ready(let placeID, let image):
                            coverImages[placeID] = image
                        case .revoked:
                            // Even one 401/403 invalidates this entire signed
                            // Owner snapshot. Cancel siblings and clear every
                            // previously displayed cover and interactive pin.
                            group.cancelAll()
                            invalidate()
                            error = "当前 Owner 身份或地图权限已失效，请重新验证。"
                            return
                        case .unavailable:
                            // A missing derivative is NOT a missing original.
                            break
                        }
                    }
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
        singleTask?.cancel()
        singleTask = nil
        singleViewer = nil
        singlePage = nil
        singleOwner = nil
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
        singleTask?.cancel()
        singleTask = nil
        singleViewer = nil
        singlePage = nil
        singleOwner = nil
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
        task?.cancel()
        task = nil
        // Preserve the last rendered covers during the settled-camera HTTPS
        // refresh. They are visual-only: busy and the revoked viewport fence
        // disable both touch and VoiceOver activation until a fresh response.
        verifiedBounds = nil
        requestedBounds = bounds
        error = nil
        busy = true
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
                let result = try await reader.mapOverview(
                    bounds: bounds, detail: true, captureRange: activeCaptureRange)
                try Task.checkCancellation()
                guard epoch == ticket, phase == .active,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected),
                      XDriveIOSNativeOwnerMapSelectionPolicy.isSameViewport(
                        bounds, current: currentBounds())
                else { return }
                // Publish the verified new place snapshot together with a
                // clean cover cache. No previous-viewport thumbnail can be
                // reused as the current place's photo.
                coverImages = [:]
                overview = result
                verifiedBounds = bounds
                revision = UUID()
                loadCurrentOwnerCovers(result, reader: reader,
                                       expected: expected, bounds: bounds,
                                       ticket: ticket)
            } catch is CancellationError {
            } catch {
                guard epoch == ticket else { return }
                // A failed authorization or failed map response cannot keep
                // old Owner GPS covers displayed indefinitely.
                overview = nil
                coverImages = [:]
                revision = UUID()
                self.error = "当前 Owner 地图范围或权限已失效，请核对账户并重试。"
            }
        }
    }
}

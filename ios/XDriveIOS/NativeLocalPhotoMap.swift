import Combine
import MapKit
import Photos
import SwiftUI
import UIKit

/// A stale PhotoKit edit can precede the PHChange callback. Re-admit a
/// just-tapped Viewer item against the live Full Access library and the exact
/// Gallery filter, without reading originals or retaining private identities.
private enum XDriveIOSMapCurrentPhotoKitAdmission {
    static func allows(
        _ candidate: XDrivePhotoKitScanCandidate,
        filter: XDriveIOSNativePhotoMediaFilter
    ) -> Bool {
        guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized,
              let asset = PHAsset.fetchAssets(
                withLocalIdentifiers: [candidate.id], options: nil
              ).firstObject else { return false }
        let kind: String
        switch asset.mediaType {
        case .image: kind = "image"
        case .video: kind = "video"
        default: return false
        }
        return candidate.kind == kind && filter.includes(asset: asset)
    }
}

/// Transient, one-shot location handoff into the existing Gallery map.
/// No local photo ID or GPS position is persisted or sent to a server.
struct XDriveIOSNativeLocalMapJump: Equatable {
    let id = UUID()
    let latitude: Double
    let longitude: Double

    init?(latitude: Double, longitude: Double) {
        guard XDriveIOSNativePhotoMapPolicy.validCoordinate(
            latitude: latitude, longitude: longitude
        ) else { return nil }
        self.latitude = latitude
        self.longitude = longitude
    }

    var camera: MKCoordinateRegion {
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
            span: MKCoordinateSpan(latitudeDelta: 0.12, longitudeDelta: 0.12)
        )
    }

    var nearbyViewport: XDriveIOSNativeLocalMapViewport? {
        XDriveIOSNativeLocalMapAutoRefinePolicy.expandedViewport(
            latitude: latitude, longitude: longitude,
            latitudeSpan: camera.span.latitudeDelta,
            longitudeSpan: camera.span.longitudeDelta
        )
    }
}

private struct XDriveIOSNativeLocalMapJumpKey: EnvironmentKey {
    static let defaultValue: XDriveIOSNativeLocalMapJump? = nil
}

private struct XDriveIOSNativeLocalMapOpenKey: EnvironmentKey {
    static let defaultValue: ((XDriveIOSNativeLocalMapJump) -> Void)? = nil
}

extension EnvironmentValues {
    var xdriveNativeLocalMapJump: XDriveIOSNativeLocalMapJump? {
        get { self[XDriveIOSNativeLocalMapJumpKey.self] }
        set { self[XDriveIOSNativeLocalMapJumpKey.self] = newValue }
    }

    var xdriveOpenNativeLocalMap: ((XDriveIOSNativeLocalMapJump) -> Void)? {
        get { self[XDriveIOSNativeLocalMapOpenKey.self] }
        set { self[XDriveIOSNativeLocalMapOpenKey.self] = newValue }
    }
}

private final class XDriveIOSMapPhotoPin: NSObject, MKAnnotation {
    typealias Cell = XDriveIOSNativeLocalMapSpatialCell<XDrivePhotoKitLocatedCandidate>
    let candidate: XDrivePhotoKitScanCandidate
    let coordinate: CLLocationCoordinate2D
    let cell: Cell?
    let displayCount: Int

    init(_ item: XDrivePhotoKitLocatedCandidate) {
        candidate = item.candidate
        coordinate = CLLocationCoordinate2D(latitude: item.latitude, longitude: item.longitude)
        cell = nil
        displayCount = 1
    }

    init(_ representative: Cell) {
        candidate = representative.representative.candidate
        coordinate = CLLocationCoordinate2D(
            latitude: representative.latitude, longitude: representative.longitude)
        cell = representative
        displayCount = representative.count
    }
}

/// All image requests belong to a reused visible MapKit view, never a 100k cache.
private final class XDriveIOSMapPhotoCover: MKAnnotationView {
    private let photo = UIImageView()
    private let placeholder = UIImageView(image: UIImage(systemName: "photo"))
    private let loading = UIActivityIndicatorView(style: .medium)
    private let badge = UILabel()
    private var request = PHInvalidImageRequestID
    private var epoch = UUID()

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
        clipsToBounds = false
        collisionMode = .circle
        displayPriority = .defaultHigh
        photo.frame = CGRect(x: 2, y: 2, width: 64, height: 64)
        photo.contentMode = .scaleAspectFill
        photo.clipsToBounds = true
        photo.layer.cornerRadius = 9
        photo.layer.borderWidth = 2
        photo.layer.borderColor = UIColor.white.cgColor
        photo.backgroundColor = .secondarySystemGroupedBackground
        addSubview(photo)
        placeholder.frame = CGRect(x: 20, y: 20, width: 28, height: 28)
        placeholder.contentMode = .scaleAspectFit
        placeholder.tintColor = .secondaryLabel
        addSubview(placeholder)
        loading.frame = CGRect(x: 20, y: 20, width: 28, height: 28)
        loading.hidesWhenStopped = true
        addSubview(loading)
        badge.frame = CGRect(x: 43, y: -7, width: 28, height: 28)
        badge.textAlignment = .center
        badge.font = .boldSystemFont(ofSize: 12)
        badge.textColor = .white
        badge.backgroundColor = .systemBlue
        badge.layer.cornerRadius = 14
        badge.layer.borderColor = UIColor.white.cgColor
        badge.layer.borderWidth = 2
        badge.clipsToBounds = true
        addSubview(badge)
    }

    func configure(_ representative: XDrivePhotoKitScanCandidate, count: Int,
                   wholeLibrary: Bool = false, provisional: Bool = false) {
        cancel()
        // An incomplete 64-cell preview has neither a final member count
        // nor permission to open a PhotoKit location album.
        badge.isHidden = provisional || count <= 1
        badge.text = provisional ? nil : (count > 999 ? "999+" : String(count))
        isAccessibilityElement = !provisional
        accessibilityTraits = provisional ? [] : .button
        accessibilityLabel = provisional ?
            "正在核对位置照片，封面暂不可打开" :
            wholeLibrary ? "已扫描图库区域有\(count)张带定位照片" :
            XDriveIOSNativePhotoMapPolicy.markerLabel(count)
        guard [.authorized].contains(
            PHPhotoLibrary.authorizationStatus(for: .readWrite)
        ), let asset = PHAsset.fetchAssets(
            withLocalIdentifiers: [representative.id], options: nil
        ).firstObject else { return }
        let snapshot = epoch
        let options = PHImageRequestOptions()
        // Map covers are visible, bounded 128px renditions. Allow PhotoKit to
        // fetch an iCloud-only thumbnail; this is not an original export/read.
        options.isNetworkAccessAllowed = true
        options.deliveryMode = .fastFormat
        options.resizeMode = .fast
        placeholder.isHidden = true
        loading.startAnimating()
        request = PHImageManager.default().requestImage(
            for: asset, targetSize: CGSize(width: 128, height: 128),
            contentMode: .aspectFill, options: options
        ) { [weak self] value, _ in
            DispatchQueue.main.async { [weak self] in
                guard let self, self.epoch == snapshot,
                      [.authorized].contains(
                        PHPhotoLibrary.authorizationStatus(for: .readWrite)
                      ) else { return }
                self.loading.stopAnimating()
                self.photo.image = value
                self.placeholder.isHidden = value != nil
            }
        }
    }

    private func cancel() {
        epoch = UUID()
        if request != PHInvalidImageRequestID {
            PHImageManager.default().cancelImageRequest(request)
            request = PHInvalidImageRequestID
        }
        photo.image = nil
        loading.stopAnimating()
        placeholder.isHidden = false
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        cancel()
        badge.text = nil
        accessibilityLabel = nil
    }

    override func didMoveToSuperview() {
        super.didMoveToSuperview()
        if superview == nil { cancel() }
    }
}
private struct XDriveIOSMapKitPhotoPage: UIViewRepresentable {
    typealias Cell = XDriveIOSNativeLocalMapSpatialCell<XDrivePhotoKitLocatedCandidate>
    let items: [XDrivePhotoKitLocatedCandidate]
    var globalCells: [Cell]? = nil
    let revision: UUID
    let mapType: MKMapType
    // Only a short-lived camera snapshot from the currently selected pin;
    // no GPS or PhotoKit identity is persisted between views or Owners.
    let cameraReturn: MKCoordinateRegion?
    // Explicit foreground CoreLocation tap, separate from PhotoKit authority.
    var focusRequestID: UUID? = nil
    var focusCamera: MKCoordinateRegion? = nil
    var showsUserDot = false
    var provisional = false
    var canSelectCells = true
    // Only previously viewport-filtered cells need instant gesture revocation.
    // All-library overview and normal photo page remain directly selectable.
    var cameraBoundCells = false
    var onCells: (([Cell], MKCoordinateRegion) -> Void)? = nil
    var onCamera: ((MKCoordinateRegion) -> Void)? = nil
    var onCameraWillChange: (() -> Void)? = nil
    let onOpen: ([XDrivePhotoKitScanCandidate], MKCoordinateRegion) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onOpen: onOpen, onCells: onCells, onCamera: onCamera,
                    onCameraWillChange: onCameraWillChange)
    }

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.showsUserLocation = false
        map.mapType = mapType
        map.register(XDriveIOSMapPhotoCover.self, forAnnotationViewWithReuseIdentifier: "photo")
        map.register(XDriveIOSMapPhotoCover.self, forAnnotationViewWithReuseIdentifier: "cluster")
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        // Change the base layer on the same MKMapView; never invalidate PhotoKit cells.
        if map.mapType != mapType {
            // MapKit may emit camera callbacks while replacing its base layer.
            // This is not a user pan: preserve the existing verified GPS cells.
            map.delegate = nil
            map.mapType = mapType
            map.delegate = context.coordinator
        }
        context.coordinator.onOpen = onOpen
        context.coordinator.onCells = onCells
        context.coordinator.onCamera = onCamera
        context.coordinator.onCameraWillChange = onCameraWillChange
        context.coordinator.canSelectCells = canSelectCells
        context.coordinator.cameraBoundCells = cameraBoundCells
        context.coordinator.showingProvisional = provisional
        // A location request is a real camera move: reuse the same native
        // gesture/auth-revocation path, but only once per explicit tap.
        if map.showsUserLocation != showsUserDot {
            map.showsUserLocation = showsUserDot
        }
        if let focusID = focusRequestID,
           context.coordinator.focusRequestID != focusID,
           let focusCamera {
            context.coordinator.focusRequestID = focusID
            map.setRegion(focusCamera, animated: true)
        }
        // Camera movement does not change the photo grid revision. Revoke
        // old MapKit marker taps and accessibility activation immediately.
        for annotation in map.annotations {
            if let cover = map.view(for: annotation) as? XDriveIOSMapPhotoCover {
                cover.isEnabled = canSelectCells
                cover.isAccessibilityElement = canSelectCells
                cover.accessibilityElementsHidden = !canSelectCells
                cover.accessibilityTraits = canSelectCells ? .button : []
            }
        }
        guard context.coordinator.revision != revision else { return }
        context.coordinator.revision = revision
        map.removeAnnotations(map.annotations.filter { $0 is XDriveIOSMapPhotoPin })
        let pins: [XDriveIOSMapPhotoPin]
        if let globalCells {
            // Max 64 representatives. Full-library coordinates/IDs never
            // enter MKMapView as a 100k-object annotation collection.
            pins = globalCells.prefix(XDriveIOSNativeLocalMapSpatialPolicy.maximumCells)
                .map(XDriveIOSMapPhotoPin.init)
        } else {
            pins = items.prefix(XDriveIOSNativePhotoMapPolicy.pageSize)
                .map(XDriveIOSMapPhotoPin.init)
        }
        map.addAnnotations(pins)
        // A filtered viewport may legitimately have ZERO GPS members.
        // Keep that same camera, rather than unexpectedly jumping to world.
        // The original page Viewer-return path also retains its own camera.
        if let cameraReturn {
            // A refreshed grid must not generate a fake gesture when MapKit
            // already displays the same camera; preserve active map touches.
            let target = XDriveIOSNativeLocalMapSpatialPolicy.viewportBounds(
                latitude: cameraReturn.center.latitude,
                longitude: cameraReturn.center.longitude,
                latitudeSpan: cameraReturn.span.latitudeDelta,
                longitudeSpan: cameraReturn.span.longitudeDelta
            )
            let displayed = XDriveIOSNativeLocalMapSpatialPolicy.viewportBounds(
                latitude: map.region.center.latitude,
                longitude: map.region.center.longitude,
                latitudeSpan: map.region.span.latitudeDelta,
                longitudeSpan: map.region.span.longitudeDelta
            )
            if target == nil ||
               !XDriveIOSNativeLocalMapSpatialPolicy.matchesViewport(
                   target!, current: displayed
               ) {
                map.setRegion(cameraReturn, animated: false)
            }
        } else if !pins.isEmpty {
            if provisional {
                // Fit the first useful GPS representative without treating
                // this programmatic move as a user gesture. Subsequent scan
                // updates never repeatedly recenter the native map.
                if !context.coordinator.provisionalPresented {
                    map.delegate = nil
                    map.showAnnotations(pins, animated: false)
                    map.delegate = context.coordinator
                }
            } else if !context.coordinator.provisionalCameraMoved {
                // Final verified counts may auto-fit only if the user did not
                // move the camera while the partial preview was visible.
                map.showAnnotations(pins, animated: false)
            }
        }
        context.coordinator.provisionalPresented = provisional && !pins.isEmpty
        if !provisional { context.coordinator.provisionalCameraMoved = false }
    }

    static func dismantleUIView(_ map: MKMapView, coordinator: Coordinator) {
        map.delegate = nil
        map.removeAnnotations(map.annotations.filter { $0 is XDriveIOSMapPhotoPin })
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var revision: UUID?
        var onOpen: ([XDrivePhotoKitScanCandidate], MKCoordinateRegion) -> Void
        var onCells: (([Cell], MKCoordinateRegion) -> Void)?
        var onCamera: ((MKCoordinateRegion) -> Void)?
        var onCameraWillChange: (() -> Void)?
        var canSelectCells = true
        var cameraBoundCells = false
        var showingProvisional = false
        var focusRequestID: UUID?
        var provisionalPresented = false
        var provisionalCameraMoved = false

        init(onOpen: @escaping ([XDrivePhotoKitScanCandidate], MKCoordinateRegion) -> Void,
             onCells: (([Cell], MKCoordinateRegion) -> Void)?,
             onCamera: ((MKCoordinateRegion) -> Void)?,
             onCameraWillChange: (() -> Void)?) {
            self.onOpen = onOpen
            self.onCells = onCells
            self.onCamera = onCamera
            self.onCameraWillChange = onCameraWillChange
        }

        func mapView(_ mapView: MKMapView, regionWillChangeAnimated animated: Bool) {
            // Preview auto-fit runs without a delegate; only subsequent
            // native camera changes preserve the user's chosen viewport.
            if showingProvisional && provisionalPresented {
                provisionalCameraMoved = true
            }
            if cameraBoundCells {
                // UIKit's delegate fires before SwiftUI re-renders. Make
                // every stale GPS cell cover unclickable and unreachable by
                // VoiceOver synchronously at the first camera gesture.
                canSelectCells = false
                for annotation in mapView.annotations {
                    guard let cover = mapView.view(for: annotation) as? XDriveIOSMapPhotoCover
                    else { continue }
                    cover.isEnabled = false
                    cover.isAccessibilityElement = false
                    cover.accessibilityElementsHidden = true
                    cover.accessibilityTraits = []
                }
            }
            onCameraWillChange?()
        }

        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
            onCamera?(mapView.region)
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            if annotation is MKUserLocation { return nil }
            let items: [XDriveIOSMapPhotoPin]
            let identifier: String
            if let cluster = annotation as? MKClusterAnnotation {
                items = cluster.memberAnnotations.compactMap { $0 as? XDriveIOSMapPhotoPin }
                identifier = "cluster"
            } else if let pin = annotation as? XDriveIOSMapPhotoPin {
                items = [pin]
                identifier = "photo"
            } else { return nil }
            guard let first = items.first else { return nil }
            let view = mapView.dequeueReusableAnnotationView(
                withIdentifier: identifier, for: annotation
            ) as? XDriveIOSMapPhotoCover
            view?.clusteringIdentifier = identifier == "photo" ? "xdrive-photo-page" : nil
            view?.configure(
                first.candidate,
                count: items.reduce(0) { $0 + $1.displayCount },
                wholeLibrary: first.cell != nil,
                provisional: showingProvisional
            )
            view?.isEnabled = canSelectCells
            view?.isAccessibilityElement = canSelectCells
            view?.accessibilityElementsHidden = !canSelectCells
            view?.accessibilityTraits = canSelectCells ? .button : []
            return view
        }

        func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
            let items: [XDriveIOSMapPhotoPin]
            if let cluster = view.annotation as? MKClusterAnnotation {
                items = cluster.memberAnnotations.compactMap { $0 as? XDriveIOSMapPhotoPin }
            } else if let pin = view.annotation as? XDriveIOSMapPhotoPin {
                items = [pin]
            } else { return }
            mapView.deselectAnnotation(view.annotation, animated: false)
            guard canSelectCells else { return }
            if items.contains(where: { $0.cell != nil }) {
                // A MapKit cluster represents multiple *already scanned* GPS
                // cells. Open their complete bounded identity set, not just
                // the first representative and not an extra zoom step.
                // The parent revalidates every ID/count before any PhotoKit read.
                let cells = items.compactMap(\.cell)
                guard cells.count == items.count, !cells.isEmpty,
                      Set(cells.map(\.id)).count == cells.count else { return }
                onCells?(cells.sorted { $0.id < $1.id }, mapView.region)
                return
            }
            let members = items.map(\.candidate).sorted {
                ($0.capturedAt ?? .distantPast) > ($1.capturedAt ?? .distantPast)
            }
            if !members.isEmpty { onOpen(members, mapView.region) }
        }
    }
}

private final class XDriveIOSMapPhotoChanges: NSObject, ObservableObject,
    PHPhotoLibraryChangeObserver {
    @Published private(set) var revision = 0
    private var observing = false

    func start() {
        guard !observing else { return }
        PHPhotoLibrary.shared().register(self)
        observing = true
    }

    func stop() {
        guard observing else { return }
        PHPhotoLibrary.shared().unregisterChangeObserver(self)
        observing = false
    }

    func photoLibraryDidChange(_ changeInstance: PHChange) {
        DispatchQueue.main.async { [weak self] in self?.revision &+= 1 }
    }

    deinit { stop() }
}

private struct XDriveIOSMapPhotoSelection: Identifiable {
    let id = UUID()
    let items: [XDrivePhotoKitScanCandidate]
}

/// Keep the map sheet's Viewer inside its already-loaded, currently authorized
/// PhotoKit slice. This revalidates the exact member on tap/return; the map
/// never fetches out-of-page neighbors or stores an identifier in navigation.
private enum XDriveIOSNativeMapViewerAdmission {
    static func supported(_ item: XDrivePhotoKitScanCandidate) -> Bool {
        item.kind == "image" || item.kind == "video"
    }

    static func allows(
        _ item: XDrivePhotoKitScanCandidate,
        in loaded: [XDrivePhotoKitScanCandidate],
        sceneActive: Bool
    ) -> Bool {
        let permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard sceneActive, permission == .authorized,
              supported(item),
              XDriveIOSNativePhotoViewerReturnAnchorPolicy.localLoadedIndex(
                  currentID: item.id, in: loaded.map(\.id), authorized: true
              ) != nil,
              loaded.contains(where: {
                  $0.id == item.id && $0.kind == item.kind &&
                  $0.isLive == item.isLive &&
                  $0.capturedAt == item.capturedAt &&
                  $0.modifiedAt == item.modifiedAt
              }),
              let asset = PHAsset.fetchAssets(
                  withLocalIdentifiers: [item.id], options: nil
              ).firstObject
        else { return false }
        let matchingMedia = (item.kind == "image" &&
            asset.mediaType == .image &&
            item.isLive == asset.mediaSubtypes.contains(.photoLive)) ||
            (item.kind == "video" && asset.mediaType == .video)
        return matchingMedia && asset.creationDate == item.capturedAt &&
            asset.modificationDate == item.modifiedAt &&
            PHPhotoLibrary.authorizationStatus(for: .readWrite) == permission
    }
}

private struct XDriveIOSMapPhotoAlbum: View {
    let items: [XDrivePhotoKitScanCandidate]
    var mediaFilter: XDriveIOSNativePhotoMediaFilter = .all
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @State private var selected: XDrivePhotoKitScanCandidate?
    @State private var viewerReturnID: String?
    @State private var wallDensity: XDriveIOSNativePhotoWallDensity = .standard
    @AccessibilityFocusState private var focusedTileID: String?

    private var previewItems: [XDrivePhotoKitScanCandidate] {
        items.prefix(XDriveIOSNativePhotoMapPolicy.pageSize).filter {
            XDriveIOSNativeMapViewerAdmission.supported($0)
        }
    }

    var body: some View {
        ScrollViewReader { returnScroll in
        NavigationStack {
            ScrollView {
                XDriveIOSNativePhotoWallGrid(density: wallDensity) {
                    ForEach(items.prefix(XDriveIOSNativePhotoMapPolicy.pageSize)) { item in
                        Button {
                            guard XDriveIOSNativeMapViewerAdmission.allows(
                                item, in: previewItems, sceneActive: phase == .active
                            ), XDriveIOSMapCurrentPhotoKitAdmission.allows(
                                item, filter: mediaFilter
                            ) else { return }
                            viewerReturnID = item.id
                            focusedTileID = nil
                            selected = item
                        } label: {
                            XDriveIOSNativeSquarePhotoTile(candidate: item)
                        }
                        .buttonStyle(.plain)
                        .disabled(!XDriveIOSNativeMapViewerAdmission.supported(item) ||
                                  phase != .active)
                        .id(item.id)
                        .accessibilityFocused($focusedTileID, equals: item.id)
                    }
                }.padding(8)
            }
            .navigationTitle("此处照片 · 当前页")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        xdrivePhotoWallDensityButtons($wallDensity)
                    } label: {
                        Label("缩略图大小", systemImage: "square.grid.3x3")
                    }
                    .accessibilityIdentifier("native-ios-map-page-wall-density")
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
            .simultaneousGesture(
                MagnificationGesture(minimumScaleDelta: 0.14).onEnded { scale in
                    guard selected == nil, phase == .active else { return }
                    wallDensity = wallDensity.applyingPinch(scale)
                }
            )
            .fullScreenCover(item: $selected, onDismiss: {
                restoreViewerTile(using: returnScroll)
            }) { initial in
                XDriveIOSNativeLocalPhotoDetail(
                    candidate: initial, loadedItems: previewItems,
                    onViewed: { next in
                        guard selected?.id == initial.id,
                              XDriveIOSNativeMapViewerAdmission.allows(
                                  next, in: previewItems, sceneActive: phase == .active
                              ) else { return }
                        viewerReturnID = next.id
                        focusedTileID = nil
                    }
                )
            }
        }
        }
    }

    private func restoreViewerTile(using scroll: ScrollViewProxy) {
        defer { viewerReturnID = nil }
        guard let id = viewerReturnID,
              let target = previewItems.first(where: { $0.id == id }),
              XDriveIOSNativeMapViewerAdmission.allows(
                  target, in: previewItems, sceneActive: phase == .active
              ) else { return }
        scroll.scrollTo(id, anchor: .center)
        focusedTileID = id
    }
}

/// The legacy `.page` value remains decodable for older navigation snapshots.
/// Gallery map entry migrates it to `.library`; no page-only mode is presented.
enum XDriveIOSNativeLocalMapScope: String, CaseIterable {
    case page, library
    var label: String {
        self == .page ? "当前页" : "已授权全库"
    }
}

private struct XDriveIOSMapSpatialSelection: Identifiable {
    let id = UUID()
    let cells: [XDriveIOSNativeLocalMapSpatialCell<XDrivePhotoKitLocatedCandidate>]
    // Frozen scope of the completed viewport scan. Changing the camera does
    // not widen the transient 48-item cell wall to all-library coordinates.
    let viewport: XDriveIOSNativeLocalMapViewport?
    // Freeze the same Gallery filter as the verified map Cell count.
    let mediaFilter: XDriveIOSNativePhotoMediaFilter
    let captureRange: XDriveIOSNativePhotoMapCaptureRange?
}

/// On-demand bounded local-only cell paging. Re-scan the lazy PhotoKit
/// snapshot for 48 authorized matching assets rather than caching all
/// 100k member IDs or shipping private GPS to Server/SDK hosts.
private struct XDriveIOSMapSpatialAlbum: View {
    typealias Policy = XDriveIOSNativeLocalMapSpatialPolicy
    let selection: XDriveIOSMapSpatialSelection
    var album: XDriveLocalPhotoAlbumSummary? = nil
    var onShowNearby: (() -> Void)? = nil
    var isNearbyExpansion = false
    @Environment(\.scenePhase) private var phase
    @Environment(\.dismiss) private var dismiss
    @StateObject private var changes = XDriveIOSMapPhotoChanges()
    // Keep at most the previous and current 48-photo windows in the wall.
    // Viewer admission receives only the one exact 48-item window containing
    // the selected tile, preserving the existing bounded filmstrip contract.
    @State private var priorWindow: [XDrivePhotoKitScanCandidate] = []
    @State private var items: [XDrivePhotoKitScanCandidate] = []
    @State private var viewer: XDrivePhotoKitScanCandidate?
    @State private var viewerItems: [XDrivePhotoKitScanCandidate] = []
    @State private var viewerReturnID: String?
    @State private var wallDensity: XDriveIOSNativePhotoWallDensity = .standard
    @AccessibilityFocusState private var focusedTileID: String?
    @State private var worker: XDrivePhotoKitBoundedSnapshotScanner?
    @State private var readTask: Task<Void, Never>?
    @State private var generation = UUID()
    @State private var busy = false
    @State private var started = false
    // A 64-slot PhotoKit page may contain more than 48 matching GPS assets.
    // Keep its unused matches transiently rather than skipping those slots.
    @State private var pendingLocated: [XDrivePhotoKitLocatedCandidate] = []
    @State private var pendingIndex = 0
    @State private var nextOffset = 0
    @State private var scannerFinished = false
    @State private var scrollFootVisible = false
    @State private var autoScrollReturnID: String?
    @State private var visibleWindowRevision = UUID()
    @State private var windowNumber = 0
    @State private var error: String?

    private struct WindowRead {
        let items: [XDrivePhotoKitScanCandidate]
        let pending: [XDrivePhotoKitLocatedCandidate]
        let pendingIndex: Int
        let nextOffset: Int
        let scannerFinished: Bool
    }

    private var visibleItems: [XDrivePhotoKitScanCandidate] {
        priorWindow + items
    }

    private var hasNext: Bool {
        pendingIndex < pendingLocated.count || !scannerFinished
    }

    private var selectedPhotoCount: Int {
        selection.cells.reduce(0) { $0 + $1.count }
    }

    private func loadedWindow(containing id: String) -> [XDrivePhotoKitScanCandidate] {
        let source = priorWindow.contains(where: { $0.id == id }) ? priorWindow : items
        return source.filter { XDriveIOSNativeMapViewerAdmission.supported($0) }
    }

    private func restoreViewerTile(using scroll: ScrollViewProxy) {
        defer { viewerReturnID = nil }
        guard let id = viewerReturnID,
              let target = visibleItems.first(where: { $0.id == id }) else { return }
        let loaded = loadedWindow(containing: id)
        guard XDriveIOSNativeMapViewerAdmission.allows(
            target, in: loaded, sceneActive: phase == .active
        ) else { return }
        scroll.scrollTo(id, anchor: .center)
        focusedTileID = id
        viewerItems = []
    }

    private func photoTile(_ item: XDrivePhotoKitScanCandidate) -> some View {
        let loaded = loadedWindow(containing: item.id)
        return Button {
            guard !busy,
                  XDriveIOSNativeMapViewerAdmission.allows(
                    item, in: loaded, sceneActive: phase == .active
                  ), XDriveIOSMapCurrentPhotoKitAdmission.allows(
                    item, filter: selection.mediaFilter
                  ) else { return }
            viewerReturnID = item.id
            viewerItems = loaded
            focusedTileID = nil
            viewer = item
        } label: {
            XDriveIOSNativeSquarePhotoTile(candidate: item)
        }
        .buttonStyle(.plain)
        .disabled(busy || !XDriveIOSNativeMapViewerAdmission.supported(item))
        .id(item.id)
        .accessibilityFocused($focusedTileID, equals: item.id)
    }

    var body: some View {
        ScrollViewReader { returnScroll in
        NavigationStack {
            VStack(spacing: 8) {
                Text(isNearbyExpansion ?
                     "附近照片 · 已加载 \(visibleItems.count) 张" :
                     "此处照片 · \(selectedPhotoCount) 张")
                    .font(.footnote).foregroundStyle(.secondary)
                    .accessibilityValue(
                        busy ? "正在读取位置照片" :
                        (hasNext ? "可继续向下滚动浏览" : "已显示全部可访问照片")
                    )
                if busy { XDriveIOSNativePhotoWallLoadingMessage(message: "正在读取位置照片…") }
                if let error {
                    XDriveIOSNativePhotoWallRetryMessage(
                        message: error, buttonTitle: "重试读取照片",
                        canRetry: !busy && phase == .active,
                        accessibilityID: "native-ios-map-cluster-inline-retry"
                    ) {
                        if worker != nil { loadNext() } else { loadInitial() }
                    }
                }
                if !busy && items.isEmpty && priorWindow.isEmpty && error == nil {
                    XDriveIOSNativePhotoWallStatusMessage(message: "此位置没有可访问的照片或视频。")
                }
                ScrollView {
                    XDriveIOSNativePhotoWallGrid(density: wallDensity) {
                        ForEach(priorWindow) { item in photoTile(item) }
                        ForEach(items) { item in photoTile(item) }
                        // The lazy-grid sentinel is the native infinite-scroll
                        // trigger. It advances only as the last visible window
                        // approaches the viewport; busy/error guards prevent repeats.
                        if hasNext {
                            Color.clear
                                .frame(height: 24)
                                .id("map:\(windowNumber):\(nextOffset)")
                                .onAppear {
                                    scrollFootVisible = true
                                    advanceIfVisible()
                                }
                                .onDisappear { scrollFootVisible = false }
                                .accessibilityHidden(true)
                        }
                    }
                    .padding(8)
                }
                .onChange(of: visibleWindowRevision) { _ in
                    if let anchor = autoScrollReturnID,
                       visibleItems.contains(where: { $0.id == anchor }) {
                        returnScroll.scrollTo(anchor, anchor: .bottom)
                    }
                    autoScrollReturnID = nil
                }
                .onChange(of: busy) { isBusy in
                    if !isBusy { advanceIfVisible() }
                }
            }
            .navigationTitle(isNearbyExpansion ? "附近照片" :
                (album.map { "\($0.name) · 此处照片" } ?? "此处照片"))
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        if album != nil, onShowNearby != nil {
                            Button("显示附近照片") {
                                onShowNearby?()
                                dismiss()
                            }
                            .disabled(busy || viewer != nil || phase != .active)
                        }
                        Button("重新核对当前位置照片") { loadInitial() }
                            .disabled(busy || viewer != nil || phase != .active)
                        Section("照片网格") {
                            xdrivePhotoWallDensityButtons($wallDensity)
                        }
                    } label: {
                        Label("位置照片操作", systemImage: "ellipsis.circle")
                    }
                    .accessibilityIdentifier("native-ios-map-cluster-more")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
            .simultaneousGesture(
                MagnificationGesture(minimumScaleDelta: 0.14).onEnded { scale in
                    guard viewer == nil, !busy, phase == .active else { return }
                    wallDensity = wallDensity.applyingPinch(scale)
                }
            )
            .fullScreenCover(item: $viewer, onDismiss: {
                restoreViewerTile(using: returnScroll)
            }) { initial in
                XDriveIOSNativeLocalPhotoDetail(
                    candidate: initial, loadedItems: viewerItems,
                    onViewed: { next in
                        guard viewer?.id == initial.id,
                              XDriveIOSNativeMapViewerAdmission.allows(
                                  next, in: viewerItems, sceneActive: phase == .active
                              ) else { return }
                        viewerReturnID = next.id
                        focusedTileID = nil
                    }
                )
            }
            .onAppear {
                changes.start()
                if !started {
                    started = true
                    loadInitial()
                }
            }
            .onChange(of: changes.revision) { _ in
                retire()
                viewerReturnID = nil
                viewerItems = []
                focusedTileID = nil
                viewer = nil
                priorWindow = []
                items = []
                dismiss()
            }
            .onChange(of: phase) { state in
                if state != .active {
                    retire()
                    viewerReturnID = nil
                    viewerItems = []
                    focusedTileID = nil
                    viewer = nil
                    priorWindow = []
                    items = []
                    dismiss()
                }
            }
            .onDisappear {
                if viewer == nil {
                    retire()
                    viewerReturnID = nil
                    viewerItems = []
                    focusedTileID = nil
                    changes.stop()
                }
                // A full-screen Viewer covers, but does not end, this place
                // wall. Keep its PhotoKit cursor and change observer alive so
                // continuous scrolling can resume from the same snapshot.
            }
        }
        }
    }

    /// Read the next 48 matching photos from one unchanged PhotoKit snapshot.
    /// Any unused GPS hits from the last 64-slot page stay in a bounded queue.
    private func readWindow(
        scanner: XDrivePhotoKitBoundedSnapshotScanner,
        pending initialPending: [XDrivePhotoKitLocatedCandidate],
        pendingIndex initialPendingIndex: Int,
        nextOffset initialNextOffset: Int,
        scannerFinished initialScannerFinished: Bool
    ) async throws -> WindowRead {
        guard let level = selection.cells.first?.key.level else {
            throw XDrivePhotoKitScanFailure.snapshotChanged
        }
        let selectedKeys = Set(selection.cells.map(\.key))
        var pending = initialPending
        var cursor = initialPendingIndex
        var offset = initialNextOffset
        var finished = initialScannerFinished
        var rows: [XDrivePhotoKitScanCandidate] = []
        rows.reserveCapacity(48)

        while rows.count < 48 {
            try Task.checkCancellation()
            if cursor < pending.count {
                rows.append(pending[cursor].candidate)
                cursor += 1
                continue
            }
            guard !finished else { break }
            let next = try await scanner.nextLocatedPage()
            guard XDriveIOSNativePhotoMapPolicy.validPage(
                total: next.page.totalAccessibleAssets,
                start: next.page.startOffset,
                next: next.page.nextOffset,
                rows: next.page.items.count,
                pins: next.items.count
            ), next.page.startOffset == offset else {
                throw XDrivePhotoKitScanFailure.snapshotChanged
            }
            pending = next.items.filter { asset in
                guard Policy.includes(
                    selection.viewport,
                    latitude: asset.latitude, longitude: asset.longitude
                ), let key = Policy.key(
                    latitude: asset.latitude, longitude: asset.longitude,
                    level: level
                ), selectedKeys.contains(key) else { return false }
                return true
            }
            cursor = 0
            offset = next.page.nextOffset
            finished = next.page.finished
            await Task.yield()
        }
        return WindowRead(
            items: rows, pending: pending, pendingIndex: cursor,
            nextOffset: offset, scannerFinished: finished
        )
    }

    private func loadInitial() {
        retire()
        guard phase == .active,
              [.authorized].contains(
                PHPhotoLibrary.authorizationStatus(for: .readWrite)
              ) else {
            error = "照片库权限已变化，请返回地图重新扫描。"
            return
        }
        guard let level = selection.cells.first?.key.level,
              Policy.acceptsCellSelection(
                selectedIDs: selection.cells.map(\.id),
                currentCellIDs: selection.cells.map(\.id)
              ),
              selection.cells.allSatisfy({ $0.key.level == level }) else {
            error = "位置聚合已失效，请返回地图重新扫描。"
            return
        }
        let scanner = XDrivePhotoKitBoundedSnapshotScanner()
        worker = scanner
        let ticket = generation
        busy = true
        error = nil
        started = true
        priorWindow = []
        items = []
        viewerItems = []
        pendingLocated = []
        pendingIndex = 0
        nextOffset = 0
        scannerFinished = false
        scrollFootVisible = false
        autoScrollReturnID = nil
        windowNumber = 0
        readTask = Task { @MainActor in
            do {
                let total = try await scanner.startMap(
                    atOffset: 0, album: album, mediaFilter: selection.mediaFilter,
                    captureRange: selection.captureRange
                )
                let result = try await readWindow(
                    scanner: scanner, pending: [], pendingIndex: 0,
                    nextOffset: 0, scannerFinished: total == 0
                )
                try Task.checkCancellation()
                guard generation == ticket, phase == .active,
                      [.authorized].contains(
                        PHPhotoLibrary.authorizationStatus(for: .readWrite)
                      ) else { return }
                pendingLocated = result.pending
                pendingIndex = result.pendingIndex
                nextOffset = result.nextOffset
                scannerFinished = result.scannerFinished
                items = result.items
                visibleWindowRevision = UUID()
                if result.items.isEmpty && result.scannerFinished &&
                    result.pendingIndex >= result.pending.count {
                    error = "此位置没有可访问的照片或视频。"
                }
                if result.scannerFinished &&
                    result.pendingIndex >= result.pending.count {
                    await scanner.reset()
                    if generation == ticket { worker = nil }
                }
            } catch is CancellationError {
            } catch {
                if generation == ticket {
                    self.error = "照片权限、位置或图库版本已变化，请返回地图重新扫描。"
                    items = []
                    pendingLocated = []
                    pendingIndex = 0
                    scannerFinished = true
                    await scanner.reset()
                    worker = nil
                }
            }
            if generation == ticket {
                busy = false
                readTask = nil
            }
        }
    }

    private func advanceIfVisible() {
        guard scrollFootVisible, !busy, viewer == nil, hasNext, error == nil else {
            return
        }
        loadNext()
    }

    private func loadNext() {
        guard phase == .active, !busy, viewer == nil, hasNext,
              let scanner = worker, !items.isEmpty else { return }
        let ticket = generation
        let departingItems = items
        busy = true
        scrollFootVisible = false
        error = nil
        readTask = Task { @MainActor in
            do {
                let result = try await readWindow(
                    scanner: scanner, pending: pendingLocated,
                    pendingIndex: pendingIndex, nextOffset: nextOffset,
                    scannerFinished: scannerFinished
                )
                try Task.checkCancellation()
                guard generation == ticket, phase == .active,
                      [.authorized].contains(
                        PHPhotoLibrary.authorizationStatus(for: .readWrite)
                      ) else { return }
                pendingLocated = result.pending
                pendingIndex = result.pendingIndex
                nextOffset = result.nextOffset
                scannerFinished = result.scannerFinished
                if !result.items.isEmpty {
                    priorWindow = departingItems
                    autoScrollReturnID = departingItems.last?.id
                    items = result.items
                    windowNumber += 1
                    visibleWindowRevision = UUID()
                }
                if result.scannerFinished &&
                    result.pendingIndex >= result.pending.count {
                    await scanner.reset()
                    if generation == ticket { worker = nil }
                }
            } catch is CancellationError {
            } catch {
                if generation == ticket {
                    self.error = "照片权限、位置或图库版本已变化，请重新核对当前位置。"
                    priorWindow = []
                    items = []
                    viewerItems = []
                    viewerReturnID = nil
                    pendingLocated = []
                    pendingIndex = 0
                    scannerFinished = true
                    await scanner.reset()
                    worker = nil
                }
            }
            if generation == ticket {
                busy = false
                readTask = nil
            }
        }
    }

    private func retire() {
        generation = UUID()
        readTask?.cancel()
        readTask = nil
        if let worker { Task { await worker.reset() } }
        worker = nil
        priorWindow = []
        items = []
        viewerItems = []
        viewerReturnID = nil
        focusedTileID = nil
        pendingLocated = []
        pendingIndex = 0
        nextOffset = 0
        scannerFinished = true
        scrollFootVisible = false
        autoScrollReturnID = nil
        error = nil
        busy = false
    }
}

/// One native map route for both the original bounded 64-slot page and an
/// explicit, transient full-authorized-library GPS overview. No WebView or
/// second backup/upload worker; never persists or sends GPS/local IDs.
struct XDriveIOSNativeLocalPhotoMapScreen: View {
    // Parent-owned route hints; all PhotoKit GPS/thumbnail data stays transient.
    // When present, the same map surface is scoped to this verified PhotoKit album.
    var album: XDriveLocalPhotoAlbumSummary? = nil
    @Binding var mapScope: XDriveIOSNativeLocalMapScope
    @Binding var offset: Int
    /// Optional dismissal action for a full-screen map opened from the Gallery.
    /// The presenting Gallery remains mounted underneath and keeps its scroll/filter state.
    var onClose: (() -> Void)? = nil
    var cameraOnEntry: MKCoordinateRegion? = nil
    var onLibraryCameraChange: ((MKCoordinateRegion?) -> Void)? = nil
    var onFocusChange: ((Bool) -> Void)?
    // The local map is a projection of the calling Gallery's exact media scope.
    var mediaFilter: XDriveIOSNativePhotoMediaFilter = .all
    var inheritedCaptureRange: XDriveIOSNativePhotoMapCaptureRange? = nil
    @Environment(\.scenePhase) private var phase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.dismiss) private var dismiss
    @Environment(\.xdriveNativeLocalMapJump) private var incomingMapJump
    @StateObject private var changes = XDriveIOSMapPhotoChanges()
    @StateObject private var currentLocation = XDriveIOSNativeMapUserLocationController()
    @State private var scanner: XDrivePhotoKitBoundedSnapshotScanner?
    @State private var page: XDrivePhotoKitLocatedPage?
    @State private var task: Task<Void, Never>?
    @State private var generation = UUID()
    @State private var mapRevision = UUID()
    @State private var cameraReturn: MKCoordinateRegion?
    @State private var cameraReturnOffset: Int?
    @State private var busy = false
    @State private var gpsFindPagesScanned = 0
    @State private var focused = false
    @State private var mapType: MKMapType = .standard
    @State private var captureOverride: XDriveIOSNativePhotoMapCaptureRange?
    @State private var usingCaptureOverride = false
    @State private var datePickerOpen = false
    @State private var requestedCaptureDay = Date()
    @State private var error: String?
    @State private var selection: XDriveIOSMapPhotoSelection?
    @State private var singleViewer: XDrivePhotoKitScanCandidate?
    @State private var authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    @State private var globalCells: [
        XDriveIOSNativeLocalMapSpatialCell<XDrivePhotoKitLocatedCandidate>
    ] = []
    // Earliest bounded GPS representatives are DISPLAY-ONLY until the full
    // PhotoKit snapshot and exact counts have been verified.
    @State private var provisionalCells: [
        XDriveIOSNativeLocalMapSpatialCell<XDrivePhotoKitLocatedCandidate>
    ] = []
    @State private var globalComplete = false
    @State private var globalScanned = 0
    @State private var globalTotal = 0
    @State private var globalLocated = 0
    @State private var globalSelection: XDriveIOSMapSpatialSelection?
    // Queue the nearby expansion until the album-scoped full-screen cover has
    // fully dismissed; two fullScreenCover modifiers must never race to present.
    @State private var pendingNearbySelection: XDriveIOSMapSpatialSelection?
    @State private var nearbySelection: XDriveIOSMapSpatialSelection?
    @State private var globalCamera: MKCoordinateRegion?
    @State private var globalViewport: XDriveIOSNativeLocalMapViewport?
    @State private var globalCameraMoving = false
    @State private var autoRefineTask: Task<Void, Never>?
    @State private var handledMapJumpID: UUID?

    private var activeCaptureRange: XDriveIOSNativePhotoMapCaptureRange? {
        usingCaptureOverride ? captureOverride : inheritedCaptureRange
    }

    private func setCaptureRange(_ range: XDriveIOSNativePhotoMapCaptureRange?) {
        usingCaptureOverride = true
        captureOverride = range
    }

    private var refinedViewportIsCurrent: Bool {
        // Scanned-incomplete cells must never become tappable, even before
        // MapKit receives its first fully verified PhotoKit snapshot.
        guard globalComplete, !busy else { return false }
        guard let scanned = globalViewport else { return true }
        guard !globalCameraMoving, let current = globalCamera else { return false }
        return XDriveIOSNativeLocalMapSpatialPolicy.containsViewport(
            scanned,
            current: XDriveIOSNativeLocalMapSpatialPolicy.viewportBounds(
                latitude: current.center.latitude,
                longitude: current.center.longitude,
                latitudeSpan: current.span.latitudeDelta,
                longitudeSpan: current.span.longitudeDelta
            )
        )
    }

    var body: some View {
        GeometryReader { viewport in
        let compactMap = XDriveIOSNativePhotoMapPolicy.compactViewport(
            width: Double(viewport.size.width),
            height: Double(viewport.size.height),
            accessibilityText: dynamicTypeSize.isAccessibilitySize
        )
        VStack(spacing: compactMap ? 4 : 8) {
            if !compactMap && dynamicTypeSize.isAccessibilitySize {
                Text(album == nil ?
                    "显示已授权图库中具有位置数据的照片和视频。" :
                    "仅显示此相册中带有拍摄位置的照片和视频。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if authorization == .notDetermined {
                Button("允许查看本机照片") {
                    Task {
                        _ = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
                        // The local map deliberately requires Full Access.
                        // A Limited grant must never start a partial GPS scan.
                        authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                        if authorization == .authorized {
                            if mapScope == .page { refresh(at: 0) }
                            else { scanFullLibrary() }
                        } else {
                            onLibraryCameraChange?(nil)
                            clearReturnCamera()
                            invalidate()
                        }
                    }
                }.buttonStyle(.borderedProminent)
            } else if authorization == .limited {
                VStack(spacing: 10) {
                    Text("本机照片地图需要完整照片访问权限。当前为“有限访问”，不会扫描或显示部分图库。")
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                    Button("打开 iOS 设置") { openPhotoSettings() }
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("native-ios-map-open-photo-settings")
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if authorization == .denied || authorization == .restricted {
                VStack(spacing: 10) {
                    Text("本机照片地图需要完整照片访问权限。请在 iOS 设置中允许访问所有照片。")
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                    Button("打开 iOS 设置") { openPhotoSettings() }
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("native-ios-map-open-photo-settings")
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if mapScope == .library {
                if globalComplete && globalCells.isEmpty {
                    Text(album == nil ?
                        "此授权图库没有可显示位置的照片或视频。" :
                        "此相册没有可显示位置的照片或视频。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                // Keep MapKit mounted through the full 64-cell bounded scan.
                // Early representative covers are inert and hide partial counts
                // until the PhotoKit snapshot is fully verified.
                XDriveIOSMapKitPhotoPage(
                        items: [], globalCells: globalComplete ? globalCells : provisionalCells,
                        revision: mapRevision, mapType: mapType, cameraReturn: globalCamera,
                        focusRequestID: currentLocation.requestID,
                        focusCamera: currentLocation.camera,
                        showsUserDot: currentLocation.showsUserDot,
                        provisional: !globalComplete && !provisionalCells.isEmpty,
                        canSelectCells: refinedViewportIsCurrent,
                        cameraBoundCells: globalViewport != nil,
                        onCells: { cells, _ in
                            // A MapKit cluster may contain several spatial cells.
                            // Admit only the exact complete set still held by
                            // this PhotoKit scan; never trust stale SDK markers.
                            guard phase == .active, !busy, globalComplete,
                                  refinedViewportIsCurrent,
                                  [.authorized].contains(
                                    PHPhotoLibrary.authorizationStatus(for: .readWrite)
                                  ),
                                  XDriveIOSNativeLocalMapSpatialPolicy.acceptsCellSelection(
                                    selectedIDs: cells.map(\.id),
                                    currentCellIDs: globalCells.map(\.id)
                                  ),
                                  cells.allSatisfy({ cell in
                                    guard let trusted = globalCells.first(where: {
                                        $0.id == cell.id
                                    }) else { return false }
                                    return trusted.count == cell.count &&
                                        trusted.representative.id == cell.representative.id &&
                                        trusted.key == cell.key &&
                                        // ID/count alone cannot reauthorize an
                                        // old MapKit pin after a new GPS scan.
                                        XDriveIOSNativeLocalMapSpatialPolicy.matchesCurrentCell(
                                            cell, current: trusted,
                                            representativeID: { $0.id }
                                        )
                                  })
                            else { return }
                            if cells.count == 1, let only = cells.first,
                               only.count == 1 {
                                let candidate = only.representative.candidate
                                guard XDriveIOSNativeMapViewerAdmission.allows(
                                    candidate, in: [candidate],
                                    sceneActive: phase == .active
                                ), XDriveIOSMapCurrentPhotoKitAdmission.allows(
                                    candidate, filter: mediaFilter
                                ) else { return }
                                singleViewer = candidate
                            } else {
                                globalSelection = XDriveIOSMapSpatialSelection(
                                    cells: cells, viewport: globalViewport,
                                    mediaFilter: mediaFilter,
                                    captureRange: activeCaptureRange)
                            }
                        },
                        onCamera: { current in
                            guard mapScope == .library, phase == .active else { return }
                            if !globalComplete {
                                // Preview auto-fit has no MapKit delegate.
                                // A real pan while scanning must survive the
                                // later final-cell promotion and avoid a snap.
                                guard !provisionalCells.isEmpty,
                                      PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized
                                else { return }
                                globalCamera = current
                                onLibraryCameraChange?(current)
                                return
                            }
                            globalCamera = current
                            onLibraryCameraChange?(current)
                            globalCameraMoving = false
                            scheduleAutomaticRefinement(current)
                        },
                        onCameraWillChange: {
                            guard mapScope == .library, globalComplete else { return }
                            autoRefineTask?.cancel()
                            autoRefineTask = nil
                            if busy {
                                // A new gesture revokes the pending PhotoKit
                                // scan before the next settled viewport wins.
                                suspendForSheet()
                            }
                            if globalViewport != nil { globalCameraMoving = true }
                        },
                        onOpen: { _, _ in }
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityIdentifier(album == nil ? "native-ios-full-library-gps-map" : "native-ios-album-gps-map")
                if busy {
                    ProgressView(album == nil ? "正在读取照片位置…" : "正在读取相册位置…")
                        .accessibilityIdentifier(album == nil ? "native-ios-map-full-library-scan-progress" : "native-ios-map-album-scan-progress")
                }
                if !globalComplete && !provisionalCells.isEmpty && !compactMap {
                    Text("位置封面正在核对，完整数量确认前暂不可打开。")
                        .font(.caption).foregroundStyle(.secondary)
                        .accessibilityIdentifier("native-ios-map-provisional-covers")
                }
                // The authorized full-library scan starts on entry. Retain
                // an explicit retry before any map exists, then give its
                // verified photo covers the space occupied by these controls.
                if !globalComplete && !busy {
                    Button(album == nil ? "扫描已授权图库位置" : "扫描此相册位置") {
                        scanFullLibrary()
                    }
                        .frame(minHeight: 44)
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier(album == nil ? "native-ios-map-scan-full-library" : "native-ios-map-scan-album")
                }
            } else if let page {
                Text("已检查 \(page.page.startOffset)–\(page.page.nextOffset) / \(page.page.totalAccessibleAssets)，当前页有 \(page.items.count) 张带位置照片")
                    .font(.footnote).monospacedDigit()
                XDriveIOSMapKitPhotoPage(
                    items: page.items, revision: mapRevision, mapType: mapType, cameraReturn: cameraReturn
                ) { selected, region in
                    // UIKit can dispatch an old annotation selection after a
                    // new PhotoKit page has replaced the displayed markers.
                    // The current State page, not the captured SwiftUI
                    // branch or the annotation, is the membership authority.
                    guard phase == .active, !busy,
                          [.authorized].contains(
                            PHPhotoLibrary.authorizationStatus(for: .readWrite)
                          ),
                          let currentPage = self.page,
                          XDriveIOSNativePhotoMapPolicy.acceptsSelection(
                            selectedIDs: selected.map(\.id),
                            currentPageIDs: currentPage.items.map(\.id)
                          ),
                          selected.allSatisfy({
                            XDriveIOSMapCurrentPhotoKitAdmission.allows(
                                $0, filter: mediaFilter
                            )
                          }) else { return }
                    cameraReturn = region
                    cameraReturnOffset = currentPage.page.startOffset
                    if selected.count == 1, let only = selected.first,
                       XDriveIOSNativeMapViewerAdmission.allows(
                           only, in: currentPage.items.map(\.candidate),
                           sceneActive: phase == .active
                       ) {
                        singleViewer = only
                    } else {
                        selection = XDriveIOSMapPhotoSelection(items: selected)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("native-ios-local-photo-map")
                if page.items.isEmpty {
                    Text("当前页暂无有效 GPS 照片，可以切换下一页。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if gpsFindPagesScanned > 0 {
                    Text("本次连续检查了 \(gpsFindPagesScanned) 个分页（每页最多 64 张），仅显示最后一页的定位照片；不代表全库已完成扫描。")
                        .font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("native-ios-map-gps-find-progress")
                }
                HStack {
                    Button("上一页") { refresh(at: max(0, page.page.startOffset - 64)) }
                        .disabled(busy || page.page.startOffset == 0)
                    Spacer()
                    Button("下一页") { refresh(at: page.page.nextOffset) }
                        .disabled(busy || page.page.finished)
                }.buttonStyle(.bordered)
                Button("查找下一批有定位照片") {
                    refresh(at: page.page.nextOffset, findNextGPS: true)
                }
                .disabled(busy || page.page.finished)
                .frame(minHeight: 44)
                .buttonStyle(.bordered)
                .accessibilityIdentifier("native-ios-map-find-next-gps-page")
                if !compactMap {
                    Text("每次最多连续检查 16 页（1,024 张照片元数据），可重复查找；不自动读取 iCloud 原件。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            } else if busy {
                ProgressView("读取授权照片位置…")
            }
            if let activeCaptureRange {
                Text("位置时间范围：\(activeCaptureRange.label)")
                    .font(.footnote).foregroundStyle(.secondary)
                    .accessibilityIdentifier("native-ios-local-map-capture-range")
            }
            if let error { Text(error).foregroundStyle(.secondary).font(.footnote) }
            if mapScope == .page {
                Button("刷新当前页") { refresh(at: offset) }
                    .disabled(busy || authorization == .denied || authorization == .restricted)
            }
            if !compactMap && dynamicTypeSize.isAccessibilitySize {
                Text("地图只使用本机授权照片，缩略图不下载 iCloud 原件，照片 ID 和位置不会上传。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        }
        .padding(.horizontal, 8)
        .navigationTitle(album.map { "\($0.name) · 地图" } ??
            (mediaFilter.isAll ? "地图" : "地图 · \(mediaFilter.title)"))
        .toolbar {
            if album != nil || onClose != nil {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("完成") {
                        if onClose != nil { onClose?() }
                        else { dismiss() }
                    }
                    .accessibilityIdentifier(
                        album != nil ? "native-ios-album-map-dismiss" : "native-ios-map-dismiss"
                    )
                }
            }
            if mapScope == .library && globalComplete {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button(album == nil ? "重新扫描已授权图库位置" : "重新扫描此相册位置") {
                            scanFullLibrary()
                        }
                            .disabled(busy)
                            .accessibilityIdentifier(album == nil ? "native-ios-map-scan-full-library" : "native-ios-map-scan-album")
                    } label: {
                        Label("地图操作", systemImage: "ellipsis.circle")
                    }
                    .accessibilityIdentifier("native-ios-local-map-actions")
                }
            }
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
                        ForEach((max(1, Calendar.current.component(.year, from: Date()) - 20)...
                            Calendar.current.component(.year, from: Date())).reversed(),
                            id: \.self) { year in
                            Button("\(year) 年") {
                                setCaptureRange(XDriveIOSNativePhotoMapCaptureRange.year(year))
                            }
                        }
                    }
                    Button("按指定日期") { datePickerOpen = true }
                } label: {
                    Label("地图日期", systemImage: "calendar")
                }
                .accessibilityIdentifier("native-ios-local-map-capture-menu")
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
                .accessibilityIdentifier("native-ios-local-map-basemap")
            }
            if mapScope == .library && authorization == .authorized {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        currentLocation.locate()
                    } label: {
                        Label("我的位置", systemImage: "location")
                    }
                    .disabled(currentLocation.isLocating || phase != .active)
                    .accessibilityIdentifier("native-ios-local-map-locate")
                }
            }
            if album == nil && onFocusChange != nil {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(focused ? "显示底部导航" : "专注地图") {
                        focused.toggle()
                        onFocusChange?(focused)
                    }
                    .accessibilityIdentifier("native-ios-map-focus-toggle")
                }
            }
        }
        .sheet(isPresented: $datePickerOpen) {
            NavigationStack {
                Form {
                    DatePicker("拍摄日期", selection: $requestedCaptureDay,
                               displayedComponents: .date)
                        .datePickerStyle(.graphical)
                    Button("显示选择日期所在年份") {
                        setCaptureRange(XDriveIOSNativePhotoMapCaptureRange.year(
                            Calendar.current.component(.year, from: requestedCaptureDay)))
                        datePickerOpen = false
                    }
                    .accessibilityIdentifier("native-ios-map-selected-year")
                }
                .navigationTitle("选择地图日期")
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
        .alert(item: $currentLocation.alert) { issue in
            Alert(title: Text("无法获取当前位置"),
                  message: Text(issue.message),
                  dismissButton: .default(Text("完成")))
        }
        .sheet(item: $selection, onDismiss: {
            if phase == .active { refresh(at: offset) }
            else { invalidate() }
        }) { chosen in
            XDriveIOSMapPhotoAlbum(items: chosen.items, mediaFilter: mediaFilter)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(item: $globalSelection, onDismiss: {
            // The map is now visible behind a native sheet. Even an ordinary
            // swipe-to-dismiss (without Nearby) must recheck Full Access before
            // the previous PhotoKit covers can remain on screen.
            guard phase == .active,
                  PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized
            else {
                pendingNearbySelection = nil
                onLibraryCameraChange?(nil)
                clearReturnCamera()
                invalidate()
                return
            }
            // The optional nearby-library expansion starts only after this
            // place sheet has actually completed dismissal.
            guard let pending = pendingNearbySelection else { return }
            pendingNearbySelection = nil
            nearbySelection = pending
        }) { chosen in
            XDriveIOSMapSpatialAlbum(
                selection: chosen, album: album,
                onShowNearby: album == nil ? nil : {
                    guard phase == .active,
                          PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized
                    else {
                        onLibraryCameraChange?(nil)
                        clearReturnCamera()
                        invalidate()
                        return
                    }
                    pendingNearbySelection = chosen
                }
            )
            // Match the Owner map's native medium-to-large place photo wall.
            // Keep the MapKit canvas visible underneath; never promote an
            // unverified provisional cell into Viewer or Gallery authority.
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .sheet(item: $nearbySelection, onDismiss: {
            // The map is still visible behind the Nearby sheet. A revoked
            // Full Photo Library grant must not reveal earlier GPS covers
            // after a drag-to-dismiss, even without another PhotoKit callback.
            guard phase == .active,
                  PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized
            else {
                onLibraryCameraChange?(nil)
                clearReturnCamera()
                invalidate()
                return
            }
        }) { chosen in
            XDriveIOSMapSpatialAlbum(
                selection: chosen, album: nil, isNearbyExpansion: true
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .fullScreenCover(item: $singleViewer, onDismiss: {
            guard phase == .active else { invalidate(); return }
            if mapScope == .page {
                // Recheck the PhotoKit page while restoring the same camera.
                refresh(at: offset)
            } else if ![.authorized].contains(
                PHPhotoLibrary.authorizationStatus(for: .readWrite)
            ) {
                invalidate()
            }
        }) { initial in
            XDriveIOSNativeLocalPhotoDetail(
                candidate: initial, loadedItems: [initial]
            )
        }
        .onAppear {
            authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
            changes.start()
            guard authorization == .authorized else {
                onLibraryCameraChange?(nil)
                clearReturnCamera()
                invalidate()
                return
            }
            if focusOnRequestedPhotoLocation() { return }
            if mapScope == .page, page == nil, !busy, phase == .active {
                refresh(at: offset)
            } else if mapScope == .library && !globalComplete && !busy &&
                phase == .active {
                // First re-entry rescans current full PhotoKit authority;
                // reuse only the parent's transient camera, never old IDs.
                if let cameraOnEntry {
                    scanFullLibrary(returningCamera: cameraOnEntry)
                } else {
                    scanFullLibrary()
                }
            }
        }
        .onChange(of: incomingMapJump?.id) { _ in
            _ = focusOnRequestedPhotoLocation()
        }
        .onChange(of: currentLocation.requestID) { _ in
            guard phase == .active, mapScope == .library,
                  PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized,
                  let target = currentLocation.camera else { return }
            // Before MapKit's animated camera callback, disable any prior
            // viewport-bound Cell lease; the normal settled scan revalidates.
            if globalViewport != nil { globalCameraMoving = true }
            globalCamera = target
            onLibraryCameraChange?(target)
        }
        .onChange(of: activeCaptureRange) { _ in
            onLibraryCameraChange?(nil)
            clearReturnCamera()
            if phase == .active && mapScope == .library { scanFullLibrary() }
            else if phase == .active { refresh(at: 0) }
            else { invalidate() }
        }
        .onChange(of: mediaFilter) { _ in
            // A changed Gallery filter invalidates all previous Cell members
            // and the transient camera. Neither MapKit covers nor a place
            // wall may retain the earlier filtered PhotoKit lease.
            onLibraryCameraChange?(nil)
            if phase == .active && mapScope == .library {
                scanFullLibrary()
            } else if phase == .active {
                refresh(at: 0)
            } else {
                invalidate()
            }
        }
        .onChange(of: mapScope) { next in
            if next == .page { onLibraryCameraChange?(nil) }
            clearReturnCamera()
            invalidate()
            if next == .page && phase == .active { refresh(at: offset) }
            if next == .library && phase == .active { scanFullLibrary() }
        }
        .onChange(of: changes.revision) { _ in
            currentLocation.cancel()
            // Revoke all old PhotoKit IDs first, then rebuild only if Full
            // Access is still present. A Limited/revoked library stays empty.
            let returningCamera = globalCamera
            onLibraryCameraChange?(nil)
            clearReturnCamera()
            invalidate()
            authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
            guard phase == .active, authorization == .authorized else { return }
            if mapScope == .library {
                scanFullLibrary(returningCamera: returningCamera)
                onLibraryCameraChange?(returningCamera)
            } else {
                refresh(at: offset)
            }
        }
        .onChange(of: phase) { state in
            if state == .active {
                authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                changes.start()
                guard authorization == .authorized else {
                    onLibraryCameraChange?(nil)
                    clearReturnCamera()
                    invalidate()
                    return
                }
                if mapScope == .page { refresh(at: offset) }
                else { scanFullLibrary() } // A new PhotoKit generation must re-scan.
            } else {
                currentLocation.cancel()
                changes.stop()
                onLibraryCameraChange?(nil)
                clearReturnCamera()
                invalidate()
            }
        }
        .onDisappear {
            currentLocation.cancel()
            // A presented cluster sheet may hide its map presenter. Keep
            // PhotoKit change observation active until the sheet is dismissed,
            // so permission/library changes revoke its transient member IDs.
            if selection == nil && globalSelection == nil &&
                pendingNearbySelection == nil && nearbySelection == nil && singleViewer == nil {
                changes.stop()
                clearReturnCamera()
                focused = false
                onFocusChange?(false)
                invalidate()
            } else { suspendForSheet() }
        }
    }

    /// Reuse the SAME PhotoKit/MapKit route for nearby media rather than
    /// constructing an unrelated map screen in each Viewer.
    private func focusOnRequestedPhotoLocation() -> Bool {
        guard album == nil, mapScope == .library, phase == .active,
              [.authorized].contains(
                PHPhotoLibrary.authorizationStatus(for: .readWrite)
              ), let jump = incomingMapJump, handledMapJumpID != jump.id,
              let viewport = jump.nearbyViewport else { return false }
        handledMapJumpID = jump.id
        globalCamera = jump.camera
        scanFullLibrary(viewport: viewport)
        return true
    }

    /// A bounded PhotoKit metadata read is scheduled only after 900ms of
    /// camera quiet and a significant zoom / exit from the last overscan.
    /// Each subsequent gesture cancels the timer; no persistent GPS index.
    private func scheduleAutomaticRefinement(_ current: MKCoordinateRegion) {
        autoRefineTask?.cancel()
        autoRefineTask = nil
        guard mapScope == .library, globalComplete, !busy,
              globalSelection == nil, selection == nil,
              singleViewer == nil, phase == .active,
              [.authorized].contains(
                PHPhotoLibrary.authorizationStatus(for: .readWrite)
              ),
              let cameraViewport = XDriveIOSNativeLocalMapSpatialPolicy.viewportBounds(
                latitude: current.center.latitude,
                longitude: current.center.longitude,
                latitudeSpan: current.span.latitudeDelta,
                longitudeSpan: current.span.longitudeDelta
              ),
              XDriveIOSNativeLocalMapAutoRefinePolicy.shouldRefine(
                  cameraViewport, scanned: globalViewport
              )
        else { return }
        let ticket = generation
        autoRefineTask = Task { @MainActor in
            do {
                try await Task.sleep(
                    nanoseconds: XDriveIOSNativeLocalMapAutoRefinePolicy.settleNanoseconds)
            } catch { return }
            guard !Task.isCancelled, generation == ticket,
                  mapScope == .library, globalComplete, !busy,
                  globalSelection == nil, selection == nil,
                  singleViewer == nil, phase == .active,
                  let finalCamera = globalCamera,
                  [.authorized].contains(
                    PHPhotoLibrary.authorizationStatus(for: .readWrite)
                  ),
                  let finalViewport = XDriveIOSNativeLocalMapSpatialPolicy.viewportBounds(
                    latitude: finalCamera.center.latitude,
                    longitude: finalCamera.center.longitude,
                    latitudeSpan: finalCamera.span.latitudeDelta,
                    longitudeSpan: finalCamera.span.longitudeDelta
                  ),
                  XDriveIOSNativeLocalMapSpatialPolicy.matchesViewport(
                    cameraViewport, current: finalViewport
                  ),
                  XDriveIOSNativeLocalMapAutoRefinePolicy.shouldRefine(
                    finalViewport, scanned: globalViewport
                  ),
                  let padded = XDriveIOSNativeLocalMapAutoRefinePolicy.expandedViewport(
                    latitude: finalCamera.center.latitude,
                    longitude: finalCamera.center.longitude,
                    latitudeSpan: finalCamera.span.latitudeDelta,
                    longitudeSpan: finalCamera.span.longitudeDelta
                  )
            else { return }
            autoRefineTask = nil
            scanFullLibrary(viewport: padded, preserveCurrentMap: true)
        }
    }

    private func openPhotoSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    private func scanFullLibrary(
        viewport: XDriveIOSNativeLocalMapViewport? = nil,
        preserveCurrentMap: Bool = false,
        returningCamera: MKCoordinateRegion? = nil
    ) {
        // Manual overview/re-scan discards the remembered camera; only
        // a new, authorized source entry may supply its prior region.
        if viewport == nil && returningCamera == nil {
            onLibraryCameraChange?(nil)
        }
        authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        clearReturnCamera()
        // A new region scan must preserve its native camera on repaint, but
        // the original world overview intentionally refits its own markers.
        let restoreCamera = viewport == nil ? nil : globalCamera
        let keepOldMap = preserveCurrentMap && viewport != nil && globalComplete
        if keepOldMap {
            // Keep existing MapKit alive while scanning; old pins are inert.
            // Scanner progress remains cancelable and identity-fenced.
            suspendForSheet()
            globalCameraMoving = true
        } else {
            invalidate()
            globalCamera = restoreCamera
            if viewport == nil, let returningCamera {
                globalCamera = returningCamera
            }
        }
        guard mapScope == .library, phase == .active,
              authorization == .authorized else {
            onLibraryCameraChange?(nil)
            clearReturnCamera()
            invalidate()
            return
        }
        let worker = XDrivePhotoKitBoundedSnapshotScanner()
        scanner = worker
        let ticket = generation
        busy = true
        task = Task { @MainActor in
            do {
                let total = try await worker.startMap(
                    atOffset: 0, album: album, mediaFilter: mediaFilter,
                    captureRange: activeCaptureRange
                )
                var index = XDriveIOSNativeLocalMapSpatialIndex<XDrivePhotoKitLocatedCandidate>()
                var scanned = 0
                var pages = 0
                globalTotal = total
                while scanned < total {
                    try Task.checkCancellation()
                    let next = try await worker.nextLocatedPage()
                    guard XDriveIOSNativePhotoMapPolicy.validPage(
                        total: next.page.totalAccessibleAssets,
                        start: next.page.startOffset, next: next.page.nextOffset,
                        rows: next.page.items.count, pins: next.items.count
                    ), next.page.startOffset == scanned else {
                        throw XDrivePhotoKitScanFailure.snapshotChanged
                    }
                    for located in next.items {
                        guard XDriveIOSNativeLocalMapSpatialPolicy.includes(
                            viewport, latitude: located.latitude,
                            longitude: located.longitude
                        ) else { continue }
                        index.add(latitude: located.latitude,
                                  longitude: located.longitude,
                                  representative: located)
                    }
                    scanned = next.page.nextOffset
                    pages += 1
                    if !keepOldMap && provisionalCells.isEmpty && !index.cells.isEmpty {
                        // Publish ONLY the first <=64 transient representatives.
                        // Do not report incomplete counts or grant photo access.
                        // The scanner has checked its PhotoKit snapshot lease
                        // for this page; check runtime permission again here.
                        guard generation == ticket, mapScope == .library,
                              phase == .active else { return }
                        guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized
                        else { throw XDrivePhotoKitScanFailure.snapshotChanged }
                        provisionalCells = index.cells
                        mapRevision = UUID()
                    }
                    if pages % 16 == 0 || next.page.finished {
                        guard generation == ticket, phase == .active else { return }
                        globalScanned = scanned
                        globalLocated = index.locatedCount
                        await Task.yield()
                    }
                    if next.page.finished { break }
                }
                try Task.checkCancellation()
                guard generation == ticket, mapScope == .library, phase == .active
                else { return }
                // Revoke the preview through the common error cleanup if
                // Full Access disappears before the final trusted promotion.
                guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized,
                      scanned == total
                else { throw XDrivePhotoKitScanFailure.snapshotChanged }
                await worker.reset()
                scanner = nil
                globalCells = index.cells
                provisionalCells = []
                globalScanned = scanned
                globalLocated = index.locatedCount
                globalViewport = viewport
                globalComplete = true
                globalCameraMoving = false
                mapRevision = UUID()
            } catch is CancellationError {
            } catch {
                if generation == ticket {
                    if keepOldMap {
                        // Preserve only inert older pins until another settled
                        // viewport or explicit retry; do not claim fresh data.
                        globalCameraMoving = false
                    } else {
                        globalCells = []
                        provisionalCells = []
                        globalComplete = false
                        mapRevision = UUID()
                    }
                    self.error = album == nil ?
                        "授权图库在扫描过程中发生变化，请重新扫描。" :
                        "相册在扫描过程中发生变化，请重新打开地图。"
                }
            }
            if generation == ticket { busy = false }
        }
    }

    private func refresh(at requested: Int, findNextGPS: Bool = false) {
        authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if !XDriveIOSNativePhotoMapPolicy.shouldRestoreCamera(
            savedPageOffset: cameraReturnOffset,
            requestedPageOffset: max(0, requested),
            permissionGranted: authorization == .authorized,
            sceneActive: phase == .active
        ) {
            clearReturnCamera()
        }
        invalidate()
        guard phase == .active,
              authorization == .authorized else {
            onLibraryCameraChange?(nil)
            clearReturnCamera()
            invalidate()
            return
        }
        let worker = XDrivePhotoKitBoundedSnapshotScanner()
        scanner = worker
        let ticket = generation
        busy = true
        task = Task { @MainActor in
            do {
                _ = try await worker.startMap(
                    atOffset: max(0, requested), mediaFilter: mediaFilter,
                    captureRange: activeCaptureRange
                )
                var next = try await worker.nextLocatedPage()
                var pagesRead = 1
                // Reuse one lazy, permission-generation-fenced PhotoKit
                // snapshot. Each explicit seek reads <=16 * 64 slots, never
                // materializes the full 100k IDs or original media bytes.
                while findNextGPS && XDriveIOSNativePhotoMapPolicy.shouldSeekNextGPSPage(
                    foundPins: next.items.count,
                    finished: next.page.finished,
                    pagesRead: pagesRead
                ) {
                    try Task.checkCancellation()
                    next = try await worker.nextLocatedPage()
                    pagesRead += 1
                }
                try Task.checkCancellation()
                guard generation == ticket, phase == .active,
                      XDriveIOSNativePhotoMapPolicy.validPage(
                        total: next.page.totalAccessibleAssets,
                        start: next.page.startOffset, next: next.page.nextOffset,
                        rows: next.page.items.count, pins: next.items.count
                      ) else { return }
                page = next
                offset = next.page.startOffset
                gpsFindPagesScanned = findNextGPS ? pagesRead : 0
                mapRevision = UUID()
            } catch is CancellationError {
            } catch {
                if generation == ticket {
                    clearReturnCamera()
                    self.error = "照片权限或位置已变化，请刷新重试。"
                }
            }
            if generation == ticket { busy = false }
        }
    }

    private func suspendForSheet() {
        autoRefineTask?.cancel()
        autoRefineTask = nil
        generation = UUID()
        task?.cancel()
        task = nil
        if let scanner { Task { await scanner.reset() } }
        scanner = nil
        busy = false
    }

    private func clearReturnCamera() {
        cameraReturn = nil
        cameraReturnOffset = nil
    }

    private func invalidate() {
        suspendForSheet()
        gpsFindPagesScanned = 0
        page = nil
        selection = nil
        globalSelection = nil
        pendingNearbySelection = nil
        nearbySelection = nil
        singleViewer = nil
        globalCells = []
        provisionalCells = []
        globalComplete = false
        globalScanned = 0
        globalTotal = 0
        globalLocated = 0
        globalCamera = nil
        globalViewport = nil
        globalCameraMoving = false
        error = nil
        mapRevision = UUID()
    }
}

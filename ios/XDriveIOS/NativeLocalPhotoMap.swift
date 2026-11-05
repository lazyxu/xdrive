import Combine
import MapKit
import Photos
import SwiftUI
import UIKit

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
                   wholeLibrary: Bool = false) {
        cancel()
        badge.isHidden = count <= 1
        badge.text = count > 999 ? "999+" : String(count)
        isAccessibilityElement = true
        accessibilityTraits = .button
        accessibilityLabel = wholeLibrary ?
            "已扫描图库区域有\(count)张带定位照片" :
            XDriveIOSNativePhotoMapPolicy.markerLabel(count)
        guard [.authorized, .limited].contains(
            PHPhotoLibrary.authorizationStatus(for: .readWrite)
        ), let asset = PHAsset.fetchAssets(
            withLocalIdentifiers: [representative.id], options: nil
        ).firstObject else { return }
        let snapshot = epoch
        let options = PHImageRequestOptions()
        options.isNetworkAccessAllowed = false
        options.deliveryMode = .fastFormat
        options.resizeMode = .fast
        request = PHImageManager.default().requestImage(
            for: asset, targetSize: CGSize(width: 128, height: 128),
            contentMode: .aspectFill, options: options
        ) { [weak self] value, _ in
            DispatchQueue.main.async { [weak self] in
                guard let self, self.epoch == snapshot,
                      [.authorized, .limited].contains(
                        PHPhotoLibrary.authorizationStatus(for: .readWrite)
                      ) else { return }
                self.photo.image = value
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
    // Only a short-lived camera snapshot from the currently selected pin;
    // no GPS or PhotoKit identity is persisted between views or Owners.
    let cameraReturn: MKCoordinateRegion?
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
        map.register(XDriveIOSMapPhotoCover.self, forAnnotationViewWithReuseIdentifier: "photo")
        map.register(XDriveIOSMapPhotoCover.self, forAnnotationViewWithReuseIdentifier: "cluster")
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.onOpen = onOpen
        context.coordinator.onCells = onCells
        context.coordinator.onCamera = onCamera
        context.coordinator.onCameraWillChange = onCameraWillChange
        context.coordinator.canSelectCells = canSelectCells
        context.coordinator.cameraBoundCells = cameraBoundCells
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
            map.showAnnotations(pins, animated: false)
        }
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
                wholeLibrary: first.cell != nil
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
        guard sceneActive, permission == .authorized || permission == .limited,
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
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @State private var selected: XDrivePhotoKitScanCandidate?
    @State private var viewerReturnID: String?
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
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 4)], spacing: 4) {
                    ForEach(items.prefix(XDriveIOSNativePhotoMapPolicy.pageSize)) { item in
                        Button {
                            guard XDriveIOSNativeMapViewerAdmission.allows(
                                item, in: previewItems, sceneActive: phase == .active
                            ) else { return }
                            viewerReturnID = item.id
                            focusedTileID = nil
                            selected = item
                        } label: {
                            XDriveIOSLocalPhotoTile(candidate: item)
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
                    Button("完成") { dismiss() }
                }
            }
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
}

/// On-demand bounded local-only cell paging. Re-scan the lazy PhotoKit
/// snapshot for 48 authorized matching assets rather than caching all
/// 100k member IDs or shipping private GPS to Server/SDK hosts.
private struct XDriveIOSMapSpatialAlbum: View {
    typealias Policy = XDriveIOSNativeLocalMapSpatialPolicy
    let selection: XDriveIOSMapSpatialSelection
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
                  ) else { return }
            viewerReturnID = item.id
            viewerItems = loaded
            focusedTileID = nil
            viewer = item
        } label: {
            XDriveIOSLocalPhotoTile(candidate: item)
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
                Text("此处照片 · \(selectedPhotoCount) 张")
                    .font(.footnote).foregroundStyle(.secondary)
                    .accessibilityValue(
                        busy ? "正在读取位置照片" :
                        (hasNext ? "可继续向下滚动浏览" : "已显示全部可访问照片")
                    )
                if busy { ProgressView("正在读取位置照片…") }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.secondary)
                    Button("重试读取照片") {
                        if worker != nil { loadNext() } else { loadInitial() }
                    }
                    .disabled(busy || phase != .active)
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("native-ios-map-cluster-inline-retry")
                }
                if !busy && items.isEmpty && priorWindow.isEmpty && error == nil {
                    Text("此位置没有可访问的照片或视频。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 4)],
                              spacing: 4) {
                        ForEach(priorWindow) { item in photoTile(item) }
                        ForEach(items) { item in photoTile(item) }
                        // The sentinel lives inside LazyVGrid. Its appearance
                        // only arms the next read; a deliberate upward user
                        // drag at the bottom performs the actual advancement.
                        if hasNext {
                            Color.clear
                                .frame(height: 24)
                                .id("map:\(windowNumber):\(nextOffset)")
                                .onAppear { scrollFootVisible = true }
                                .onDisappear { scrollFootVisible = false }
                                .accessibilityHidden(true)
                        }
                    }
                    .padding(8)
                }
                .simultaneousGesture(
                    DragGesture(minimumDistance: 12).onEnded { gesture in
                        guard gesture.translation.height <= -12,
                              abs(gesture.translation.height) >
                                abs(gesture.translation.width),
                              scrollFootVisible, !busy, viewer == nil, hasNext
                        else { return }
                        loadNext()
                    }
                )
                .onChange(of: visibleWindowRevision) { _ in
                    if let anchor = autoScrollReturnID,
                       visibleItems.contains(where: { $0.id == anchor }) {
                        returnScroll.scrollTo(anchor, anchor: .bottom)
                    }
                    autoScrollReturnID = nil
                }
            }
            .navigationTitle("此处照片")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button("重新核对当前位置照片") { loadInitial() }
                            .disabled(busy || viewer != nil || phase != .active)
                        Button("继续浏览下一批照片") { loadNext() }
                            .disabled(busy || !hasNext || viewer != nil || phase != .active)
                    } label: {
                        Label("位置照片操作", systemImage: "ellipsis.circle")
                    }
                    .accessibilityIdentifier("native-ios-map-cluster-more")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
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
              [.authorized, .limited].contains(
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
                let total = try await scanner.start(atOffset: 0)
                let result = try await readWindow(
                    scanner: scanner, pending: [], pendingIndex: 0,
                    nextOffset: 0, scannerFinished: total == 0
                )
                try Task.checkCancellation()
                guard generation == ticket, phase == .active,
                      [.authorized, .limited].contains(
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
                      [.authorized, .limited].contains(
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
    @Binding var mapScope: XDriveIOSNativeLocalMapScope
    @Binding var offset: Int
    var cameraOnEntry: MKCoordinateRegion? = nil
    var onLibraryCameraChange: ((MKCoordinateRegion?) -> Void)? = nil
    var onFocusChange: ((Bool) -> Void)?
    @Environment(\.scenePhase) private var phase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.xdriveNativeLocalMapJump) private var incomingMapJump
    @StateObject private var changes = XDriveIOSMapPhotoChanges()
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
    @State private var error: String?
    @State private var selection: XDriveIOSMapPhotoSelection?
    @State private var singleViewer: XDrivePhotoKitScanCandidate?
    @State private var authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    @State private var globalCells: [
        XDriveIOSNativeLocalMapSpatialCell<XDrivePhotoKitLocatedCandidate>
    ] = []
    @State private var globalComplete = false
    @State private var globalScanned = 0
    @State private var globalTotal = 0
    @State private var globalLocated = 0
    @State private var globalSelection: XDriveIOSMapSpatialSelection?
    @State private var globalCamera: MKCoordinateRegion?
    @State private var globalViewport: XDriveIOSNativeLocalMapViewport?
    @State private var globalCameraMoving = false
    @State private var autoRefineTask: Task<Void, Never>?
    @State private var handledMapJumpID: UUID?

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
                Text("显示已授权图库中具有位置数据的照片和视频。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if authorization == .notDetermined {
                Button("允许查看本机照片") {
                    Task {
                        _ = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
                        // The user explicitly opened Places. When PhotoKit
                        // grants access, start the existing bounded local-only
                        // full-library GPS scan without another Scan tap.
                        authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                        if mapScope == .page { refresh(at: 0) }
                        else if authorization == .authorized || authorization == .limited {
                            scanFullLibrary()
                        } else { invalidate() }
                    }
                }.buttonStyle(.borderedProminent)
            } else if authorization == .denied || authorization == .restricted {
                Text("相册权限不可用；请到 iOS 设置中授权。")
                    .foregroundStyle(.secondary)
            } else if mapScope == .library {
                if globalComplete && globalCells.isEmpty {
                    Text("此授权图库没有可显示位置的照片或视频。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                // Keep MapKit mounted from first authorized entry through the
                // complete 64-cell bounded GPS scan. No provisional photo
                // covers are published or selectable during the scan.
                XDriveIOSMapKitPhotoPage(
                        items: [], globalCells: globalCells,
                        revision: mapRevision, cameraReturn: globalCamera,
                        canSelectCells: refinedViewportIsCurrent,
                        cameraBoundCells: globalViewport != nil,
                        onCells: { cells, _ in
                            // A MapKit cluster may contain several spatial cells.
                            // Admit only the exact complete set still held by
                            // this PhotoKit scan; never trust stale SDK markers.
                            guard phase == .active, !busy, globalComplete,
                                  refinedViewportIsCurrent,
                                  [.authorized, .limited].contains(
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
                                        trusted.key == cell.key
                                  })
                            else { return }
                            if cells.count == 1, let only = cells.first,
                               only.count == 1 {
                                let candidate = only.representative.candidate
                                guard XDriveIOSNativeMapViewerAdmission.allows(
                                    candidate, in: [candidate],
                                    sceneActive: phase == .active
                                ) else { return }
                                singleViewer = candidate
                            } else {
                                globalSelection = XDriveIOSMapSpatialSelection(
                                    cells: cells, viewport: globalViewport)
                            }
                        },
                        onCamera: { current in
                            guard mapScope == .library, globalComplete else { return }
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
                    .accessibilityIdentifier("native-ios-full-library-gps-map")
                if busy {
                    ProgressView("正在读取照片位置…")
                        .accessibilityIdentifier("native-ios-map-full-library-scan-progress")
                }
                // The authorized full-library scan starts on entry. Retain
                // an explicit retry before any map exists, then give its
                // verified photo covers the space occupied by these controls.
                if !globalComplete && !busy {
                    Button("扫描已授权图库位置") { scanFullLibrary() }
                        .frame(minHeight: 44)
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("native-ios-map-scan-full-library")
                }
            } else if let page {
                Text("已检查 \(page.page.startOffset)–\(page.page.nextOffset) / \(page.page.totalAccessibleAssets)，当前页有 \(page.items.count) 张带位置照片")
                    .font(.footnote).monospacedDigit()
                XDriveIOSMapKitPhotoPage(
                    items: page.items, revision: mapRevision, cameraReturn: cameraReturn
                ) { selected, region in
                    // UIKit can dispatch an old annotation selection after a
                    // new PhotoKit page has replaced the displayed markers.
                    // The current State page, not the captured SwiftUI
                    // branch or the annotation, is the membership authority.
                    guard phase == .active, !busy,
                          [.authorized, .limited].contains(
                            PHPhotoLibrary.authorizationStatus(for: .readWrite)
                          ),
                          let currentPage = self.page,
                          XDriveIOSNativePhotoMapPolicy.acceptsSelection(
                            selectedIDs: selected.map(\.id),
                            currentPageIDs: currentPage.items.map(\.id)
                          ) else { return }
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
        .navigationTitle("地图")
        .toolbar {
            if mapScope == .library && globalComplete {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button("重新扫描已授权图库位置") { scanFullLibrary() }
                            .disabled(busy)
                            .accessibilityIdentifier("native-ios-map-scan-full-library")
                        Button("细化当前视窗的定位照片") {
                            guard let region = globalCamera,
                                  let view = XDriveIOSNativeLocalMapSpatialPolicy.viewportBounds(
                                    latitude: region.center.latitude,
                                    longitude: region.center.longitude,
                                    latitudeSpan: region.span.latitudeDelta,
                                    longitudeSpan: region.span.longitudeDelta
                                  ) else {
                                error = "当前地图视窗无效，请移动或缩放地图后重试。"
                                return
                            }
                            scanFullLibrary(viewport: view)
                        }
                        .disabled(busy || globalCamera == nil)
                        .accessibilityIdentifier("native-ios-map-refine-viewport")
                        if globalViewport != nil {
                            Button("还原已授权全库概览") { scanFullLibrary() }
                                .disabled(busy)
                                .accessibilityIdentifier("native-ios-map-restore-global-overview")
                        }
                    } label: {
                        Label("地图操作", systemImage: "ellipsis.circle")
                    }
                    .accessibilityIdentifier("native-ios-local-map-actions")
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(focused ? "显示底部导航" : "专注地图") {
                    focused.toggle()
                    onFocusChange?(focused)
                }
                .accessibilityIdentifier("native-ios-map-focus-toggle")
            }
        }
        .sheet(item: $selection, onDismiss: {
            if phase == .active { refresh(at: offset) }
            else { invalidate() }
        }) { chosen in XDriveIOSMapPhotoAlbum(items: chosen.items) }
        .sheet(item: $globalSelection) { chosen in
            XDriveIOSMapSpatialAlbum(selection: chosen)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .fullScreenCover(item: $singleViewer, onDismiss: {
            guard phase == .active else { invalidate(); return }
            if mapScope == .page {
                // Recheck the PhotoKit page while restoring the same camera.
                refresh(at: offset)
            } else if ![.authorized, .limited].contains(
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
            if authorization != .authorized && authorization != .limited {
                onLibraryCameraChange?(nil)
            }
            changes.start()
            if focusOnRequestedPhotoLocation() { return }
            if mapScope == .page, page == nil, !busy, phase == .active {
                refresh(at: offset)
            } else if mapScope == .library && !globalComplete && !busy &&
                phase == .active && (authorization == .authorized || authorization == .limited) {
                // First re-entry rescans current PhotoKit authority; reuse
                // only the parent's transient camera, never old cell IDs.
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
        .onChange(of: mapScope) { next in
            if next == .page { onLibraryCameraChange?(nil) }
            clearReturnCamera()
            invalidate()
            if next == .page && phase == .active { refresh(at: offset) }
            if next == .library && phase == .active { scanFullLibrary() }
        }
        .onChange(of: changes.revision) { _ in
            onLibraryCameraChange?(nil)
            clearReturnCamera()
            invalidate()
            error = "照片库已改变，旧地图已经清除；请刷新。"
        }
        .onChange(of: phase) { state in
            if state == .active {
                authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                changes.start()
                if mapScope == .page { refresh(at: offset) }
                else { scanFullLibrary() } // A new PhotoKit generation must re-scan.
            } else {
                changes.stop()
                onLibraryCameraChange?(nil)
                clearReturnCamera()
                invalidate()
            }
        }
        .onDisappear {
            // A presented cluster sheet may hide its map presenter. Keep
            // PhotoKit change observation active until the sheet is dismissed,
            // so permission/library changes revoke its transient member IDs.
            if selection == nil && globalSelection == nil && singleViewer == nil {
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
        guard mapScope == .library, phase == .active,
              [.authorized, .limited].contains(
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
              [.authorized, .limited].contains(
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
                  [.authorized, .limited].contains(
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
              authorization == .authorized || authorization == .limited else { return }
        let worker = XDrivePhotoKitBoundedSnapshotScanner()
        scanner = worker
        let ticket = generation
        busy = true
        task = Task { @MainActor in
            do {
                let total = try await worker.start(atOffset: 0)
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
                    if pages % 16 == 0 || next.page.finished {
                        guard generation == ticket, phase == .active else { return }
                        globalScanned = scanned
                        globalLocated = index.locatedCount
                        await Task.yield()
                    }
                    if next.page.finished { break }
                }
                try Task.checkCancellation()
                guard generation == ticket, mapScope == .library, phase == .active,
                      [.authorized, .limited].contains(
                        PHPhotoLibrary.authorizationStatus(for: .readWrite)
                      ), scanned == total else { return }
                await worker.reset()
                scanner = nil
                globalCells = index.cells
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
                        globalComplete = false
                    }
                    self.error = "授权图库在扫描过程中发生变化，请重新扫描。"
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
            permissionGranted: authorization == .authorized || authorization == .limited,
            sceneActive: phase == .active
        ) {
            clearReturnCamera()
        }
        invalidate()
        guard phase == .active,
              authorization == .authorized || authorization == .limited else { return }
        let worker = XDrivePhotoKitBoundedSnapshotScanner()
        scanner = worker
        let ticket = generation
        busy = true
        task = Task { @MainActor in
            do {
                _ = try await worker.start(atOffset: max(0, requested))
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
        singleViewer = nil
        globalCells = []
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

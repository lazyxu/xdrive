import Combine
import MapKit
import Photos
import SwiftUI
import UIKit

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
    var onCell: ((Cell, MKCoordinateRegion) -> Void)? = nil
    var onCamera: ((MKCoordinateRegion) -> Void)? = nil
    var onCameraWillChange: (() -> Void)? = nil
    let onOpen: ([XDrivePhotoKitScanCandidate], MKCoordinateRegion) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onOpen: onOpen, onCell: onCell, onCamera: onCamera,
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
        context.coordinator.onCell = onCell
        context.coordinator.onCamera = onCamera
        context.coordinator.onCameraWillChange = onCameraWillChange
        context.coordinator.canSelectCells = canSelectCells
        // Camera movement does not change the photo grid revision. Revoke
        // old MapKit marker taps and accessibility activation immediately.
        for annotation in map.annotations {
            if let cover = map.view(for: annotation) as? XDriveIOSMapPhotoCover {
                cover.isEnabled = canSelectCells
                cover.accessibilityElementsHidden = !canSelectCells
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
            map.setRegion(cameraReturn, animated: false)
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
        var onCell: ((Cell, MKCoordinateRegion) -> Void)?
        var onCamera: ((MKCoordinateRegion) -> Void)?
        var onCameraWillChange: (() -> Void)?
        var canSelectCells = true

        init(onOpen: @escaping ([XDrivePhotoKitScanCandidate], MKCoordinateRegion) -> Void,
             onCell: ((Cell, MKCoordinateRegion) -> Void)?,
             onCamera: ((MKCoordinateRegion) -> Void)?,
             onCameraWillChange: (() -> Void)?) {
            self.onOpen = onOpen
            self.onCell = onCell
            self.onCamera = onCamera
            self.onCameraWillChange = onCameraWillChange
        }

        func mapView(_ mapView: MKMapView, regionWillChangeAnimated animated: Bool) {
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
            view?.accessibilityElementsHidden = !canSelectCells
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
                // Native MapKit clusters zoom first; never open a partly
                // verified union of unrelated spatial GPS cells.
                if let cluster = view.annotation as? MKClusterAnnotation {
                    mapView.showAnnotations(cluster.memberAnnotations, animated: true)
                } else if let cell = items.first?.cell {
                    onCell?(cell, mapView.region)
                }
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

private struct XDriveIOSMapPhotoAlbum: View {
    let items: [XDrivePhotoKitScanCandidate]
    @Environment(\.dismiss) private var dismiss
    @State private var selected: XDrivePhotoKitScanCandidate?

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 4)], spacing: 4) {
                    ForEach(items.prefix(XDriveIOSNativePhotoMapPolicy.pageSize)) { item in
                        Button { selected = item } label: {
                            XDriveIOSLocalPhotoTile(candidate: item)
                        }.buttonStyle(.plain)
                    }
                }.padding(8)
            }
            .navigationTitle("此处照片 · 当前页")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
            .fullScreenCover(item: $selected) {
                XDriveIOSNativeLocalPhotoDetail(candidate: $0)
            }
        }
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
    let cell: XDriveIOSNativeLocalMapSpatialCell<XDrivePhotoKitLocatedCandidate>
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
    @State private var items: [XDrivePhotoKitScanCandidate] = []
    @State private var viewer: XDrivePhotoKitScanCandidate?
    @State private var worker: XDrivePhotoKitBoundedSnapshotScanner?
    @State private var readTask: Task<Void, Never>?
    @State private var generation = UUID()
    @State private var busy = false
    @State private var started = false
    @State private var pageNumber = 0
    @State private var starts = [0]
    @State private var nextOffset = 0
    @State private var hasNext = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 8) {
                Text("本机已授权图库中的同一 GPS 聚合区域；全库扫描统计有 \(selection.cell.count) 张。")
                    .font(.footnote).foregroundStyle(.secondary)
                if busy { ProgressView("按区域筛选已授权照片…") }
                if let error { Text(error).font(.footnote).foregroundStyle(.secondary) }
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 4)],
                              spacing: 4) {
                        ForEach(items) { item in
                            Button { viewer = item } label: {
                                XDriveIOSLocalPhotoTile(candidate: item)
                            }.buttonStyle(.plain)
                        }
                    }.padding(8)
                }
                HStack {
                    Button("上一批") {
                        guard pageNumber > 0 else { return }
                        pageNumber -= 1
                        load(at: starts[pageNumber])
                    }.disabled(busy || pageNumber == 0)
                    Spacer()
                    Text("第 \(pageNumber + 1) 批 · \(items.count) 张")
                        .font(.caption).monospacedDigit()
                    Spacer()
                    Button("继续查找下一批") {
                        guard hasNext else { return }
                        pageNumber += 1
                        if pageNumber == starts.count { starts.append(nextOffset) }
                        load(at: starts[pageNumber])
                    }.disabled(busy || !hasNext)
                }
                .buttonStyle(.bordered)
                Text("每批最多 48 张；按同一 GPS 网格重新读取 PhotoKit，不留存全部照片 ID。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .navigationTitle("此处照片")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
            .fullScreenCover(item: $viewer) {
                XDriveIOSNativeLocalPhotoDetail(candidate: $0)
            }
            .onAppear {
                changes.start()
                if !started { started = true; load(at: 0) }
            }
            .onChange(of: changes.revision) { _ in
                retire()
                items = []
                dismiss()
            }
            .onChange(of: phase) { state in
                if state != .active {
                    retire()
                    items = []
                    dismiss()
                }
            }
            .onDisappear {
                retire()
                // The L3 original Viewer may cover this sheet; keep its
                // PHChange observer live until the viewer is dismissed.
                if viewer == nil { changes.stop() }
            }
        }
    }

    private func retire() {
        generation = UUID()
        readTask?.cancel()
        readTask = nil
        if let worker { Task { await worker.reset() } }
        worker = nil
        busy = false
    }

    private func load(at requested: Int) {
        retire()
        guard phase == .active,
              [.authorized, .limited].contains(
                PHPhotoLibrary.authorizationStatus(for: .readWrite)
              ), requested >= 0 else {
            error = "照片库权限已变化，请返回地图重新扫描。"
            return
        }
        let scanner = XDrivePhotoKitBoundedSnapshotScanner()
        worker = scanner
        let ticket = generation
        busy = true
        error = nil
        readTask = Task { @MainActor in
            do {
                let total = try await scanner.start(atOffset: requested)
                var rows: [XDrivePhotoKitScanCandidate] = []
                var cursor = min(requested, total)
                while cursor < total && rows.count < 48 {
                    try Task.checkCancellation()
                    let next = try await scanner.nextLocatedPage()
                    for asset in next.items {
                        guard Policy.includes(
                            selection.viewport,
                            latitude: asset.latitude, longitude: asset.longitude
                        ), Policy.key(
                            latitude: asset.latitude, longitude: asset.longitude,
                            level: selection.cell.key.level
                        ) == selection.cell.key else { continue }
                        rows.append(asset.candidate)
                        if rows.count == 48 {
                            // The last member may be in the middle of a
                            // 64-slot page: start next time at the NEXT slot.
                            cursor = asset.slotOffset + 1
                            break
                        }
                    }
                    if rows.count < 48 { cursor = next.page.nextOffset }
                    if rows.count < 48 && next.page.finished { break }
                    await Task.yield()
                }
                try Task.checkCancellation()
                guard generation == ticket, phase == .active,
                      [.authorized, .limited].contains(
                        PHPhotoLibrary.authorizationStatus(for: .readWrite)
                      ) else { return }
                items = rows
                nextOffset = cursor
                hasNext = cursor < total
                if rows.isEmpty && requested > 0 {
                    error = "此范围已没有后续照片；可以返回上一批。"
                }
            } catch is CancellationError {
            } catch {
                if generation == ticket {
                    self.error = "照片权限、位置或图库版本已变化，请返回地图重新扫描。"
                    items = []
                    hasNext = false
                }
            }
            if generation == ticket {
                busy = false
                await scanner.reset()
                worker = nil
            }
        }
    }
}

/// One native map route for both the original bounded 64-slot page and an
/// explicit, transient full-authorized-library GPS overview. No WebView or
/// second backup/upload worker; never persists or sends GPS/local IDs.
struct XDriveIOSNativeLocalPhotoMapScreen: View {
    // Parent-owned route hints; all PhotoKit GPS/thumbnail data stays transient.
    @Binding var mapScope: XDriveIOSNativeLocalMapScope
    @Binding var offset: Int
    var onFocusChange: ((Bool) -> Void)?
    @Environment(\.scenePhase) private var phase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
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
    @State private var showingMapHelp = false

    private var refinedViewportIsCurrent: Bool {
        guard let scanned = globalViewport else { return true }
        guard !globalCameraMoving, let current = globalCamera else { return false }
        return XDriveIOSNativeLocalMapSpatialPolicy.matchesViewport(
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
            Picker("本机地图扫描范围", selection: $mapScope) {
                ForEach(XDriveIOSNativeLocalMapScope.allCases, id: \.self) { item in
                    Text(item.label).tag(item)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("native-ios-map-library-scope")
            if !compactMap {
                Text(mapScope == .page ?
                     "本机照片地图：仅当前64条范围，不是完整云端地图" :
                     "本机完整已授权图库的只读 GPS 聚合；位置和照片 ID 不上传、不持久化。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if authorization == .notDetermined {
                Button("允许查看本机照片") {
                    Task {
                        _ = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
                        // Full-library mode is explicit opt-in. Reflect the
                        // newly granted access before showing its Scan button.
                        authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                        if mapScope == .page { refresh(at: 0) }
                        else { invalidate() }
                    }
                }.buttonStyle(.borderedProminent)
            } else if authorization == .denied || authorization == .restricted {
                Text("相册权限不可用；请到 iOS 设置中授权。")
                    .foregroundStyle(.secondary)
            } else if mapScope == .library {
                if globalComplete {
                    Text(globalViewport == nil ?
                         "已扫描 \(globalScanned) / \(globalTotal) 个授权照片槽位，找到 \(globalLocated) 张有效 GPS，合并为 \(globalCells.count) 个位置区域。" :
                         (refinedViewportIsCurrent ?
                          "已扫描 \(globalScanned) / \(globalTotal) 个授权照片槽位，当前视窗有 \(globalLocated) 张有效 GPS，合并为 \(globalCells.count) 个位置区域。" :
                          "上次扫描视窗有 \(globalLocated) 张有效 GPS；地图已移动，请重新细化当前视窗。"))
                        .font(.footnote).monospacedDigit()
                        .accessibilityIdentifier("native-ios-map-full-library-summary")
                    if globalCells.isEmpty {
                        Text(globalViewport == nil ?
                             "此授权图库没有可显示的 GPS 照片。" :
                             "上次细化的视窗没有可显示的 GPS 照片。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    XDriveIOSMapKitPhotoPage(
                        items: [], globalCells: globalCells,
                        revision: mapRevision, cameraReturn: globalCamera,
                        canSelectCells: refinedViewportIsCurrent,
                        onCell: { cell, _ in
                            // The current fully verified PhotoKit generation,
                            // never an old MapKit annotation, owns the cell.
                            guard phase == .active, !busy, globalComplete,
                                  refinedViewportIsCurrent,
                                  [.authorized, .limited].contains(
                                    PHPhotoLibrary.authorizationStatus(for: .readWrite)
                                  ),
                                  let trusted = globalCells.first(where: { $0.id == cell.id }),
                                  trusted.count == cell.count,
                                  trusted.representative.id == cell.representative.id
                            else { return }
                            globalSelection = XDriveIOSMapSpatialSelection(
                                cell: trusted, viewport: globalViewport)
                        },
                        onCamera: { current in
                            guard mapScope == .library, globalComplete else { return }
                            globalCamera = current
                            globalCameraMoving = false
                        },
                        onCameraWillChange: {
                            guard mapScope == .library, globalComplete,
                                  globalViewport != nil else { return }
                            globalCameraMoving = true
                        },
                        onOpen: { _, _ in }
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityIdentifier("native-ios-full-library-gps-map")
                    if globalViewport != nil && !refinedViewportIsCurrent {
                        Text("地图已移动：旧聚合仅作视觉参照，重新细化当前视窗后才能打开照片。")
                            .font(.footnote).foregroundStyle(.secondary)
                            .accessibilityIdentifier("native-ios-map-stale-viewport")
                    }
                } else if busy {
                    ProgressView("逐页扫描已授权图库的 GPS 元数据…")
                    Text("已检查 \(globalScanned) / \(globalTotal) 个槽位；当前找到 \(globalLocated) 张带定位照片。")
                        .font(.footnote).monospacedDigit()
                } else {
                    Text("扫描完整授权范围中的位置元数据，每次最多保留 64 个地图区域和代表封面。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Button(globalComplete ? "重新扫描已授权图库位置" : "扫描已授权图库位置") {
                    scanFullLibrary()
                }
                .disabled(busy)
                .frame(minHeight: 44)
                .buttonStyle(.bordered)
                .accessibilityIdentifier("native-ios-map-scan-full-library")
                if globalComplete {
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
                    .frame(minHeight: 44)
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("native-ios-map-refine-viewport")
                    if globalViewport != nil {
                        Button("还原已授权全库概览") { scanFullLibrary() }
                            .disabled(busy)
                            .frame(minHeight: 44)
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("native-ios-map-restore-global-overview")
                    }
                }
                if !compactMap {
                    Text("细化视窗是明确的重新扫描，不在每次拖动时自动扫描10万条；最多保留64个区域。")
                        .font(.footnote).foregroundStyle(.secondary)
                    Text("扫描过程中可离开页面取消；100k 张照片只生成有界聚合，不缓存全部照片 ID。点击位置后按 48 张逐批查找。")
                        .font(.footnote).foregroundStyle(.secondary)
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
                    selection = XDriveIOSMapPhotoSelection(items: selected)
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
            if !compactMap {
                Text("地图只使用本机授权照片，缩略图不下载 iCloud 原件，照片 ID 和位置不会上传。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        }
        .padding(.horizontal, 8)
        .navigationTitle("地图")
        .alert("本机照片地图说明", isPresented: $showingMapHelp) {
            Button("完成", role: .cancel) {}
        } message: {
            Text("当前页最多展示 64 条授权照片。全库地图需主动扫描，只保留最多 64 个位置区域；移动或放大后可显式细化当前视窗，不会在每次拖动时自动扫描。区域照片按 48 张分页重新验证。查找下一批 GPS 最多 16 页。照片 ID 与位置不上传服务器，缩略图不下载 iCloud 原件。")
        }
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(focused ? "显示底部导航" : "专注地图") {
                    focused.toggle()
                    onFocusChange?(focused)
                }
                .accessibilityIdentifier("native-ios-map-focus-toggle")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    showingMapHelp = true
                } label: {
                    Label("地图说明", systemImage: "info.circle")
                }
                .accessibilityIdentifier("native-ios-map-layout-help")
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
        .onAppear {
            changes.start()
            if mapScope == .page, page == nil, !busy, phase == .active {
                refresh(at: offset)
            }
        }
        .onChange(of: mapScope) { next in
            clearReturnCamera()
            invalidate()
            if next == .page && phase == .active { refresh(at: offset) }
        }
        .onChange(of: changes.revision) { _ in
            clearReturnCamera()
            invalidate()
            error = "照片库已改变，旧地图已经清除；请刷新。"
        }
        .onChange(of: phase) { state in
            if state == .active {
                changes.start()
                if mapScope == .page { refresh(at: offset) }
                else { invalidate() } // A new PhotoKit generation must re-scan.
            } else {
                changes.stop()
                clearReturnCamera()
                invalidate()
            }
        }
        .onDisappear {
            // A presented cluster sheet may hide its map presenter. Keep
            // PhotoKit change observation active until the sheet is dismissed,
            // so permission/library changes revoke its transient member IDs.
            if selection == nil && globalSelection == nil {
                changes.stop()
                clearReturnCamera()
                focused = false
                onFocusChange?(false)
                invalidate()
            } else { suspendForSheet() }
        }
    }

    private func scanFullLibrary(
        viewport: XDriveIOSNativeLocalMapViewport? = nil
    ) {
        authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        clearReturnCamera()
        // A new region scan must preserve its native camera on repaint, but
        // the original world overview intentionally refits its own markers.
        let restoreCamera = viewport == nil ? nil : globalCamera
        invalidate()
        globalCamera = restoreCamera
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
                mapRevision = UUID()
            } catch is CancellationError {
            } catch {
                if generation == ticket {
                    globalCells = []
                    globalComplete = false
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

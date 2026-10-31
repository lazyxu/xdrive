import Combine
import MapKit
import Photos
import SwiftUI
import UIKit

private final class XDriveIOSMapPhotoPin: NSObject, MKAnnotation {
    let candidate: XDrivePhotoKitScanCandidate
    let coordinate: CLLocationCoordinate2D

    init(_ item: XDrivePhotoKitLocatedCandidate) {
        candidate = item.candidate
        coordinate = CLLocationCoordinate2D(latitude: item.latitude, longitude: item.longitude)
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

    func configure(_ representative: XDrivePhotoKitScanCandidate, count: Int) {
        cancel()
        badge.isHidden = count <= 1
        badge.text = String(count)
        isAccessibilityElement = true
        accessibilityTraits = .button
        accessibilityLabel = XDriveIOSNativePhotoMapPolicy.markerLabel(count)
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
    let items: [XDrivePhotoKitLocatedCandidate]
    let revision: UUID
    // Only a short-lived camera snapshot from the currently selected pin;
    // no GPS or PhotoKit identity is persisted between views or Owners.
    let cameraReturn: MKCoordinateRegion?
    let onOpen: ([XDrivePhotoKitScanCandidate], MKCoordinateRegion) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onOpen: onOpen) }

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
        guard context.coordinator.revision != revision else { return }
        context.coordinator.revision = revision
        map.removeAnnotations(map.annotations.filter { $0 is XDriveIOSMapPhotoPin })
        let pins = items.prefix(XDriveIOSNativePhotoMapPolicy.pageSize)
            .map(XDriveIOSMapPhotoPin.init)
        map.addAnnotations(pins)
        if !pins.isEmpty {
            // Refreshing the SAME authorized PhotoKit page after a Viewer
            // return must not zoom out to fit all annotations again.
            if let cameraReturn {
                map.setRegion(cameraReturn, animated: false)
            } else {
                map.showAnnotations(pins, animated: false)
            }
        }
    }

    static func dismantleUIView(_ map: MKMapView, coordinator: Coordinator) {
        map.delegate = nil
        map.removeAnnotations(map.annotations.filter { $0 is XDriveIOSMapPhotoPin })
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var revision: UUID?
        var onOpen: ([XDrivePhotoKitScanCandidate], MKCoordinateRegion) -> Void

        init(onOpen: @escaping ([XDrivePhotoKitScanCandidate], MKCoordinateRegion) -> Void) {
            self.onOpen = onOpen
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
            view?.configure(first.candidate, count: items.count)
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

/// Honest MVP: only the current 64-asset local PhotoKit page. Not a cloud
/// PhotoAsset or full-library GPS map; no separate uploader, login or WebView.
struct XDriveIOSNativeLocalPhotoMapScreen: View {
    var onFocusChange: ((Bool) -> Void)?
    @Environment(\.scenePhase) private var phase
    @StateObject private var changes = XDriveIOSMapPhotoChanges()
    @State private var scanner: XDrivePhotoKitBoundedSnapshotScanner?
    @State private var page: XDrivePhotoKitLocatedPage?
    @State private var task: Task<Void, Never>?
    @State private var generation = UUID()
    @State private var mapRevision = UUID()
    @State private var cameraReturn: MKCoordinateRegion?
    @State private var cameraReturnOffset: Int?
    @State private var busy = false
    @State private var focused = false
    @State private var offset = 0
    @State private var error: String?
    @State private var selection: XDriveIOSMapPhotoSelection?
    @State private var authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)

    var body: some View {
        VStack(spacing: 8) {
            Text("本机照片地图：仅当前64条范围，不是完整云端地图")
                .font(.caption).foregroundStyle(.secondary)
            if authorization == .notDetermined {
                Button("允许查看本机照片") {
                    Task {
                        _ = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
                        refresh(at: 0)
                    }
                }.buttonStyle(.borderedProminent)
            } else if authorization == .denied || authorization == .restricted {
                Text("相册权限不可用；请到 iOS 设置中授权。")
                    .foregroundStyle(.secondary)
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
                HStack {
                    Button("上一页") { refresh(at: max(0, page.page.startOffset - 64)) }
                        .disabled(busy || page.page.startOffset == 0)
                    Spacer()
                    Button("下一页") { refresh(at: page.page.nextOffset) }
                        .disabled(busy || page.page.finished)
                }.buttonStyle(.bordered)
            } else if busy {
                ProgressView("读取授权照片位置…")
            }
            if let error { Text(error).foregroundStyle(.secondary).font(.footnote) }
            Button("刷新当前页") { refresh(at: offset) }
                .disabled(busy || authorization == .denied || authorization == .restricted)
            Text("地图只使用本机授权照片，缩略图不下载 iCloud 原件，照片 ID 和位置不会上传。")
                .font(.footnote).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 8)
        .navigationTitle("地图")
        .toolbar {
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
        .onAppear {
            changes.start()
            if page == nil && !busy && phase == .active { refresh(at: offset) }
        }
        .onChange(of: changes.revision) { _ in
            clearReturnCamera()
            invalidate()
            error = "照片库已改变，旧地图已经清除；请刷新。"
        }
        .onChange(of: phase) { state in
            if state == .active { changes.start(); refresh(at: offset) }
            else { changes.stop(); clearReturnCamera(); invalidate() }
        }
        .onDisappear {
            // A presented cluster sheet may hide its map presenter. Keep
            // PhotoKit change observation active until the sheet is dismissed,
            // so permission/library changes revoke its transient member IDs.
            if selection == nil {
                changes.stop()
                clearReturnCamera()
                focused = false
                onFocusChange?(false)
                invalidate()
            } else { suspendForSheet() }
        }
    }

    private func refresh(at requested: Int) {
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
                let next = try await worker.nextLocatedPage()
                try Task.checkCancellation()
                guard generation == ticket, phase == .active,
                      XDriveIOSNativePhotoMapPolicy.validPage(
                        total: next.page.totalAccessibleAssets,
                        start: next.page.startOffset, next: next.page.nextOffset,
                        rows: next.page.items.count, pins: next.items.count
                      ) else { return }
                page = next
                offset = next.page.startOffset
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
        page = nil
        selection = nil
        error = nil
        mapRevision = UUID()
    }
}

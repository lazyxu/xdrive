import Combine
import MapKit
import SwiftUI

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

private struct XDriveIOSOwnerMapSurface: UIViewRepresentable {
    let overview: XDriveIOSNativeOwnerMapOverview?
    let revision: UUID
    let onCamera: (MKCoordinateRegion) -> Void
    let onPlace: (XDriveIOSNativeOwnerMapFacet) -> Void
    let onAggregate: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onCamera: onCamera, onPlace: onPlace, onAggregate: onAggregate)
    }

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.showsUserLocation = false
        map.register(MKMarkerAnnotationView.self,
                     forAnnotationViewWithReuseIdentifier: "xdrive-owner-pin")
        map.register(MKMarkerAnnotationView.self,
                     forAnnotationViewWithReuseIdentifier: "xdrive-owner-cluster")
        map.setRegion(MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 0, longitude: 0),
            span: MKCoordinateSpan(latitudeDelta: 160, longitudeDelta: 360)),
            animated: false)
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.onCamera = onCamera
        context.coordinator.onPlace = onPlace
        context.coordinator.onAggregate = onAggregate
        guard context.coordinator.revision != revision else { return }
        context.coordinator.revision = revision
        map.removeAnnotations(map.annotations.filter {
            $0 is XDriveIOSOwnerPlaceAnnotation
        })
        if let overview {
            map.addAnnotations(overview.items.prefix(64).map(XDriveIOSOwnerPlaceAnnotation.init))
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
        var onCamera: (MKCoordinateRegion) -> Void
        var onPlace: (XDriveIOSNativeOwnerMapFacet) -> Void
        var onAggregate: () -> Void

        init(onCamera: @escaping (MKCoordinateRegion) -> Void,
             onPlace: @escaping (XDriveIOSNativeOwnerMapFacet) -> Void,
             onAggregate: @escaping () -> Void) {
            self.onCamera = onCamera
            self.onPlace = onPlace
            self.onAggregate = onAggregate
        }

        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
            onCamera(mapView.region)
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
                withIdentifier: reuse, for: annotation) as? MKMarkerAnnotationView
            marker?.annotation = annotation
            marker?.clusteringIdentifier =
                reuse == "xdrive-owner-pin" ? "xdrive-owner-cluster-id" : nil
            let counted = members.reduce(0) { $0 + $1.facet.item_count }
            marker?.glyphText = counted >= 1000 ? "999+" : String(counted)
            marker?.canShowCallout = false
            marker?.isAccessibilityElement = true
            marker?.accessibilityLabel =
                "\(counted) 张已索引照片的云端位置聚合"
            return marker
        }

        func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
            mapView.deselectAnnotation(view.annotation, animated: false)
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

    var body: some View {
        VStack(spacing: 8) {
            Text("当前 Server Owner 已索引的 WGS84 云端位置，不是本机 PhotoKit 相册。")
                .font(.footnote).foregroundStyle(.secondary)
            XDriveIOSOwnerMapSurface(
                overview: overview, revision: revision,
                onCamera: { camera = $0 },
                onPlace: { item in
                    guard phase == .active, !busy, login.owner != nil,
                          let overview,
                          XDriveIOSNativeOwnerMapSelectionPolicy.acceptsSelectedPlace(
                            item.id, currentlyVisibleIDs: overview.items.map(\.id)),
                          overview.items.contains(where: {
                            $0.id == item.id && $0.item_count == item.item_count
                          }) else { return }
                    selected = XDriveIOSOwnerMapChosenPlace(id: item.id)
                },
                onAggregate: {
                    error = "这是聚合区域；请放大后点击「刷新当前视窗」，再选择精确照片地点。"
                }
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityIdentifier("native-ios-owner-cloud-photo-map")
            if let overview {
                Text("当前视窗已有 \(overview.total_photo_count) 张已索引照片；地图显示 \(overview.items.count) 个位置代表项。")
                    .font(.footnote).monospacedDigit()
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
                task?.cancel()
                task = nil
            }
        }
    }

    private func invalidate() {
        epoch = UUID()
        task?.cancel()
        task = nil
        overview = nil
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
        task?.cancel()
        task = nil
        overview = nil
        error = nil
        busy = true
        revision = UUID()
        task = Task { @MainActor in
            defer { if epoch == ticket { busy = false; task = nil } }
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
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                overview = result
                revision = UUID()
            } catch is CancellationError {
            } catch {
                guard epoch == ticket else { return }
                overview = nil
                self.error = "当前 Owner 地图范围或权限已失效，请核对账户并重试。"
            }
        }
    }
}

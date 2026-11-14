import MapKit
import SwiftUI
import UIKit

/// One native MapKit presentation surface for the already Owner/PhotoKit-
/// verified 64-cell source map. It has no network, media or permission reader.
/// The SwiftUI parent remains the only source of authorized pin membership.
private final class XDriveIOSUnifiedSourceAnnotation: NSObject, MKAnnotation {
    let cell: XDriveIOSUnifiedSourceMapPin
    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: cell.latitude, longitude: cell.longitude)
    }
    init(_ cell: XDriveIOSUnifiedSourceMapPin) { self.cell = cell }
}

private final class XDriveIOSUnifiedSourceCover: MKAnnotationView {
    private let imageView = UIImageView()
    private let placeholder = UIImageView()
    private let badge = UILabel()

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        frame = XDriveIOSNativeMapMarkerVisualPolicy.frame
        centerOffset = XDriveIOSNativeMapMarkerVisualPolicy.centerOffset
        collisionMode = .circle
        displayPriority = .defaultHigh
        imageView.frame = XDriveIOSNativeMapMarkerVisualPolicy.imageFrame
        imageView.contentMode = .scaleAspectFill
        imageView.clipsToBounds = true
        imageView.layer.cornerRadius = XDriveIOSNativeMapMarkerVisualPolicy.coverCornerRadius
        imageView.layer.borderColor = UIColor.white.cgColor
        imageView.layer.borderWidth = XDriveIOSNativeMapMarkerVisualPolicy.photoBorderWidth
        imageView.backgroundColor = .secondarySystemGroupedBackground
        addSubview(imageView)
        placeholder.frame = XDriveIOSNativeMapMarkerVisualPolicy.placeholderFrame
        placeholder.contentMode = .scaleAspectFit
        placeholder.tintColor = .secondaryLabel
        addSubview(placeholder)
        badge.frame = XDriveIOSNativeMapMarkerVisualPolicy.badgeFrame
        badge.font = XDriveIOSNativeMapMarkerVisualPolicy.badgeFont
        badge.textAlignment = .center
        badge.textColor = .white
        badge.backgroundColor = .systemBlue
        badge.layer.cornerRadius = XDriveIOSNativeMapMarkerVisualPolicy.badgeCornerRadius
        badge.layer.borderColor = UIColor.white.cgColor
        badge.layer.borderWidth = XDriveIOSNativeMapMarkerVisualPolicy.badgeBorderWidth
        badge.clipsToBounds = true
        addSubview(badge)
    }

    required init?(coder: NSCoder) { fatalError("Map marker is created in code") }

    func configure(image: UIImage?, unavailable: Bool, count: Int, enabled: Bool) {
        imageView.image = image
        placeholder.image = UIImage(systemName: unavailable ? "icloud.slash" : "photo")
        placeholder.isHidden = image != nil
        badge.isHidden = count <= 1
        badge.text = XDriveIOSNativeMapMarkerVisualPolicy.badgeText(count: count)
        isEnabled = enabled
        isAccessibilityElement = enabled
        accessibilityElementsHidden = !enabled
        accessibilityTraits = enabled ? .button : []
        accessibilityLabel = enabled ? "此区域 \(count) 张已核验照片" : nil
        accessibilityHint = enabled ? (unavailable
            ? "照片封面暂不可用。双击打开当前区域。" : "双击打开当前区域照片") : nil
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        imageView.image = nil
        badge.text = nil
        placeholder.isHidden = false
        isAccessibilityElement = false
        accessibilityLabel = nil
    }
}

/// M07/M08/M10/M16: reuse native MKMapView gestures, basemap, location dot,
/// tile error delegate and UIKit accessibility; do not build a Web/Baidu map.
struct XDriveIOSNativeUnifiedSourceMapSurface: UIViewRepresentable {
    let pins: [XDriveIOSUnifiedSourceMapPin]
    let images: [String: UIImage]
    let unavailable: Set<String>
    let revision: UUID
    let markersEnabled: Bool
    let initialCamera: MKCoordinateRegion
    let mapType: MKMapType
    let cameraRequestID: UUID?
    let requestedCamera: MKCoordinateRegion?
    let showsUserDot: Bool
    let onCameraWillChange: () -> Void
    let onCamera: (MKCoordinateRegion) -> Void
    let onBasemapStatus: (Bool) -> Void
    let onOpen: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onCameraWillChange: onCameraWillChange, onCamera: onCamera,
                    onBasemapStatus: onBasemapStatus, onOpen: onOpen)
    }

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.mapType = mapType
        map.showsUserLocation = false
        map.register(XDriveIOSUnifiedSourceCover.self,
                     forAnnotationViewWithReuseIdentifier: "unified-source-photo")
        // No user gesture or stale pin is emitted by the first world camera.
        map.setRegion(initialCamera, animated: false)
        map.delegate = context.coordinator
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        let coordinator = context.coordinator
        coordinator.onCameraWillChange = onCameraWillChange
        coordinator.onCamera = onCamera
        coordinator.onBasemapStatus = onBasemapStatus
        coordinator.onOpen = onOpen
        coordinator.images = markersEnabled ? images : [:]
        coordinator.unavailable = markersEnabled ? unavailable : []
        coordinator.markersEnabled = markersEnabled
        if map.mapType != mapType {
            // A base-layer switch is not a map gesture or an Owner lease.
            map.delegate = nil
            map.mapType = mapType
            map.delegate = coordinator
        }
        if map.showsUserLocation != showsUserDot {
            map.showsUserLocation = showsUserDot
        }
        if coordinator.revision != revision {
            coordinator.revision = revision
            map.removeAnnotations(map.annotations.filter {
                $0 is XDriveIOSUnifiedSourceAnnotation
            })
            if markersEnabled {
                map.addAnnotations(pins.prefix(64).map(XDriveIOSUnifiedSourceAnnotation.init))
            }
        }
        coordinator.updateCovers(map)
        if let id = cameraRequestID, coordinator.cameraRequestID != id,
           let requestedCamera {
            coordinator.cameraRequestID = id
            // A deliberate fit/locate change is followed by the same exact
            // viewport revalidation as a gesture, but never a spurious
            // recursive delegate callback while setting the region.
            map.delegate = nil
            map.setRegion(requestedCamera, animated: true)
            map.delegate = coordinator
            DispatchQueue.main.async {
                coordinator.onCamera(map.region)
            }
        }
    }

    static func dismantleUIView(_ map: MKMapView, coordinator: Coordinator) {
        map.delegate = nil
        map.removeAnnotations(map.annotations.filter {
            $0 is XDriveIOSUnifiedSourceAnnotation
        })
        coordinator.markersEnabled = false
        coordinator.images = [:]
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var revision: UUID?
        var cameraRequestID: UUID?
        var markersEnabled = false
        var images: [String: UIImage] = [:]
        var unavailable: Set<String> = []
        var onCameraWillChange: () -> Void
        var onCamera: (MKCoordinateRegion) -> Void
        var onBasemapStatus: (Bool) -> Void
        var onOpen: (String) -> Void

        init(onCameraWillChange: @escaping () -> Void,
             onCamera: @escaping (MKCoordinateRegion) -> Void,
             onBasemapStatus: @escaping (Bool) -> Void,
             onOpen: @escaping (String) -> Void) {
            self.onCameraWillChange = onCameraWillChange
            self.onCamera = onCamera
            self.onBasemapStatus = onBasemapStatus
            self.onOpen = onOpen
        }

        func updateCovers(_ map: MKMapView) {
            for annotation in map.annotations {
                guard let pin = annotation as? XDriveIOSUnifiedSourceAnnotation,
                      let cover = map.view(for: pin) as? XDriveIOSUnifiedSourceCover
                else { continue }
                cover.configure(image: images[pin.cell.id],
                                unavailable: unavailable.contains(pin.cell.id),
                                count: pin.cell.count, enabled: markersEnabled)
            }
        }

        func mapView(_ map: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            guard let pin = annotation as? XDriveIOSUnifiedSourceAnnotation else { return nil }
            let cover = map.dequeueReusableAnnotationView(
                withIdentifier: "unified-source-photo", for: pin
            ) as? XDriveIOSUnifiedSourceCover
            cover?.annotation = pin
            cover?.canShowCallout = false
            cover?.configure(image: images[pin.cell.id],
                             unavailable: unavailable.contains(pin.cell.id),
                             count: pin.cell.count, enabled: markersEnabled)
            return cover
        }

        func mapView(_ map: MKMapView, regionWillChangeAnimated animated: Bool) {
            // Revoke old hit targets before SwiftUI can render the next frame.
            markersEnabled = false
            updateCovers(map)
            onCameraWillChange()
        }

        func mapView(_ map: MKMapView, regionDidChangeAnimated animated: Bool) {
            onCamera(map.region)
        }

        func mapView(_ map: MKMapView, didSelect view: MKAnnotationView) {
            map.deselectAnnotation(view.annotation, animated: false)
            guard markersEnabled,
                  let point = view.annotation as? XDriveIOSUnifiedSourceAnnotation
            else { return }
            onOpen(point.cell.id)
        }

        func mapViewDidFailLoadingMap(_ map: MKMapView, withError error: Error) {
            DispatchQueue.main.async { [weak self] in self?.onBasemapStatus(true) }
        }

        func mapViewDidFinishLoadingMap(_ map: MKMapView) {
            DispatchQueue.main.async { [weak self] in self?.onBasemapStatus(false) }
        }
    }
}

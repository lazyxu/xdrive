import SwiftUI
import UIKit

/// Read-only UIKit zoom surface shared by local and authenticated cloud
/// still-image previews. Owns no media loader, credential or image cache.
struct XDriveIOSNativeZoomablePhotoView: UIViewRepresentable {
    let image: UIImage
    var onSwipe: ((Int) -> Void)? = nil

    /// Keep the same still-view initializer for Files, local Photos and cloud.
    /// Only the owning Viewer can accept/reject a bounded neighbor.
    func onNavigateSwipe(_ handler: @escaping (Int) -> Void) -> Self {
        var copy = self
        copy.onSwipe = handler
        return copy
    }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        weak var photo: UIImageView?
        weak var scroll: UIScrollView?
        var onSwipe: ((Int) -> Void)?

        @objc func panEnded(_ recognizer: UIPanGestureRecognizer) {
            guard recognizer.state == .ended, let scroll else { return }
            let displacement = recognizer.translation(in: scroll)
            guard let direction = XDriveIOSNativeViewerSwipePolicy.direction(
                horizontal: displacement.x, vertical: displacement.y,
                zoom: scroll.zoomScale, minimum: scroll.minimumZoomScale
            ) else { return }
            onSwipe?(direction)
        }

        func viewForZooming(in scrollView: UIScrollView) -> UIView? {
            photo
        }

        @objc func doubleTap(_ gesture: UITapGestureRecognizer) {
            guard let scroll, let photo else { return }
            if scroll.zoomScale > scroll.minimumZoomScale + 0.01 {
                scroll.setZoomScale(scroll.minimumZoomScale, animated: true)
                return
            }
            let target = min(3, scroll.maximumZoomScale)
            let point = gesture.location(in: photo)
            let visible = CGSize(width: scroll.bounds.width / target,
                                 height: scroll.bounds.height / target)
            guard visible.width > 0, visible.height > 0 else { return }
            scroll.zoom(to: CGRect(x: point.x - visible.width / 2,
                                   y: point.y - visible.height / 2,
                                   width: visible.width, height: visible.height),
                        animated: true)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UIScrollView {
        let scroll = UIScrollView()
        scroll.delegate = context.coordinator
        scroll.minimumZoomScale = 1
        scroll.maximumZoomScale = 5
        scroll.bouncesZoom = true
        // The content normally fits the viewport. Keep the system pan
        // recognizer active for paging without stealing pinch-to-zoom.
        scroll.alwaysBounceHorizontal = true
        scroll.contentInsetAdjustmentBehavior = .never
        scroll.showsHorizontalScrollIndicator = false
        scroll.showsVerticalScrollIndicator = false
        scroll.backgroundColor = .clear

        let photo = UIImageView(image: image)
        photo.contentMode = .scaleAspectFit
        photo.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(photo)
        NSLayoutConstraint.activate([
            photo.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            photo.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            photo.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            photo.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            photo.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
            photo.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor)
        ])

        context.coordinator.photo = photo
        context.coordinator.scroll = scroll
        context.coordinator.onSwipe = onSwipe
        scroll.panGestureRecognizer.addTarget(
            context.coordinator, action: #selector(Coordinator.panEnded(_:))
        )
        let doubleTap = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.doubleTap(_:))
        )
        doubleTap.numberOfTapsRequired = 2
        scroll.addGestureRecognizer(doubleTap)
        return scroll
    }

    func updateUIView(_ scroll: UIScrollView, context: Context) {
        context.coordinator.onSwipe = onSwipe
        guard let photo = context.coordinator.photo else { return }
        // A reused detail view must never retain another picture's zoom.
        if photo.image !== image {
            scroll.setZoomScale(scroll.minimumZoomScale, animated: false)
            photo.image = image
        }
    }
}

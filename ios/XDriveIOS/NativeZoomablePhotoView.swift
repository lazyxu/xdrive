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

        // Keep the exact image identity during a gesture; a superseded Owner,
        // PhotoKit selection or Video transition must never receive its swipe.
        private var gestureImage: UIImage?

        @objc func panEnded(_ recognizer: UIPanGestureRecognizer) {
            guard let scroll, let photo else { return }
            let delta = recognizer.translation(in: scroll)
            switch recognizer.state {
            case .began:
                gestureImage = photo.image
                photo.transform = .identity
            case .changed:
                guard onSwipe != nil, let image = gestureImage,
                      photo.image === image,
                      scroll.zoomScale <= scroll.minimumZoomScale + 0.01
                else {
                    photo.transform = .identity
                    return
                }
                // UIKit receives the real moving pan, not just its terminal
                // threshold. Keep vertical drags and zoom/pinch in UIScrollView.
                let dx = delta.x, dy = delta.y
                if abs(dx) < 8 || abs(dx) <= abs(dy) * 1.18 { return }
                let width = max(1, scroll.bounds.width)
                // A constrained, resistance-free translation for loaded pages;
                // no speculative PhotoKit/Server reads before finger-up.
                let follow = max(-width, min(width, dx))
                scroll.contentOffset = .zero
                photo.transform = CGAffineTransform(translationX: follow, y: 0)
            case .ended:
                guard let image = gestureImage, photo.image === image else {
                    gestureImage = nil
                    photo.transform = .identity
                    return
                }
                gestureImage = nil
                let direction = onSwipe == nil ? nil :
                    XDriveIOSNativeViewerSwipePolicy.direction(
                        horizontal: delta.x, vertical: delta.y,
                        zoom: scroll.zoomScale, minimum: scroll.minimumZoomScale
                    )
                guard let direction else {
                    UIView.animate(withDuration: 0.18, delay: 0,
                                   options: [.curveEaseOut, .beginFromCurrentState]) {
                        photo.transform = .identity
                    }
                    return
                }
                // The image visibly finishes sliding before the authorized
                // Viewer selects its already-loaded neighbor. A replaced image
                // must not inherit this earlier gesture or its callback.
                if UIAccessibility.isReduceMotionEnabled {
                    photo.transform = .identity
                    onSwipe?(direction)
                    return
                }
                UIView.animate(withDuration: 0.14, delay: 0,
                               options: [.curveEaseOut, .beginFromCurrentState]) {
                    photo.transform = CGAffineTransform(
                        translationX: CGFloat(-direction) * max(1, scroll.bounds.width), y: 0
                    )
                } completion: { [weak self, weak photo] completed in
                    guard completed, let self, let photo, photo.image === image else { return }
                    photo.transform = .identity
                    self.onSwipe?(direction)
                }
            case .cancelled, .failed:
                gestureImage = nil
                UIView.animate(withDuration: 0.18, delay: 0,
                               options: [.curveEaseOut, .beginFromCurrentState]) {
                    photo.transform = .identity
                }
            default:
                break
            }
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
            // Cancel any outstanding pan/slide before swapping identity.
            photo.layer.removeAllAnimations()
            photo.transform = .identity
            scroll.setZoomScale(scroll.minimumZoomScale, animated: false)
            photo.image = image
        }
    }
}

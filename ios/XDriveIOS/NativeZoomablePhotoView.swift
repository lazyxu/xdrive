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

    final class Coordinator: NSObject, UIScrollViewDelegate, UIGestureRecognizerDelegate {
        weak var photo: UIImageView?
        weak var scroll: UIScrollView?
        var onSwipe: ((Int) -> Void)?

        private var pagingEpoch: UInt64 = 0

        // A separate, strictly horizontal 1-finger recognizer owns paging at
        // 1x. UIScrollView keeps its native pan for zoomed images and its pinch
        // recognizer; File previews with no onSwipe never acquire a page drag.
        func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
            guard let scroll, onSwipe != nil,
                  scroll.zoomScale <= scroll.minimumZoomScale + 0.01,
                  let pan = recognizer as? UIPanGestureRecognizer,
                  pan.numberOfTouches == 1 else { return false }
            let velocity = pan.velocity(in: scroll)
            return abs(velocity.x) > abs(velocity.y) * 1.15
        }

        private func snap(_ photo: UIImageView, to offset: CGFloat,
                          turn direction: Int? = nil) {
            let epoch = pagingEpoch
            UIView.animate(
                withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.17,
                delay: 0, options: [.curveEaseOut, .beginFromCurrentState],
                animations: { photo.transform = CGAffineTransform(translationX: offset, y: 0) },
                completion: { [weak self, weak photo] completed in
                    guard let self, let photo, self.pagingEpoch == epoch else { return }
                    if completed, let direction { self.onSwipe?(direction) }
                    if self.pagingEpoch == epoch { photo.transform = .identity }
                }
            )
        }

        @objc func pagePan(_ recognizer: UIPanGestureRecognizer) {
            guard let scroll, let photo else { return }
            switch recognizer.state {
            case .began:
                pagingEpoch &+= 1
                photo.layer.removeAllAnimations()
                photo.transform = .identity
            case .changed:
                guard scroll.zoomScale <= scroll.minimumZoomScale + 0.01,
                      recognizer.numberOfTouches == 1 else {
                    snap(photo, to: 0)
                    return
                }
                let displacement = recognizer.translation(in: scroll)
                guard abs(displacement.x) > abs(displacement.y) * 1.05 else { return }
                let width = max(1, scroll.bounds.width)
                // Move the actual decoded still in place: no new PhotoKit or
                // Owner request while the user's finger is down.
                photo.transform = CGAffineTransform(
                    translationX: max(-width, min(width, displacement.x)), y: 0
                )
            case .ended:
                let displacement = recognizer.translation(in: scroll)
                guard let direction = XDriveIOSNativeViewerSwipePolicy.direction(
                    horizontal: displacement.x, vertical: displacement.y,
                    zoom: scroll.zoomScale, minimum: scroll.minimumZoomScale
                ), onSwipe != nil else {
                    snap(photo, to: 0)
                    return
                }
                let width = max(1, scroll.bounds.width)
                snap(photo, to: direction > 0 ? -width : width, turn: direction)
            case .cancelled, .failed:
                snap(photo, to: 0)
            default:
                break
            }
        }

        func retirePageAnimation() {
            pagingEpoch &+= 1
            photo?.layer.removeAllAnimations()
            photo?.transform = .identity
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
        // The explicit horizontal pager tracks 1x swipes; disable UIKit's
        // parallel rubber-band so the still does not move twice.
        scroll.alwaysBounceHorizontal = false
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
        let pagingPan = UIPanGestureRecognizer(
            target: context.coordinator, action: #selector(Coordinator.pagePan(_:))
        )
        pagingPan.maximumNumberOfTouches = 1
        pagingPan.delegate = context.coordinator
        scroll.addGestureRecognizer(pagingPan)
        // Native scroll pan must win for magnified images and vertical moves,
        // but wait for an eligible horizontal 1x page gesture.
        scroll.panGestureRecognizer.require(toFail: pagingPan)
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
            context.coordinator.retirePageAnimation()
            scroll.setZoomScale(scroll.minimumZoomScale, animated: false)
            photo.image = image
        }
    }
}

import UIKit
import MapKit

/// One owner-independent native MapKit marker geometry. All visible photo
/// pin states use this presentation policy; it never grants photo access.
enum XDriveIOSNativeMapMarkerVisualPolicy {
    // Photo cover stays 68pt square. The white pointer beneath it aligns
    // the tip with MapKit's precise GPS anchor instead of offsetting the pin.
    static let frame = CGRect(x: 0, y: 0, width: 68, height: 78)
    static let centerOffset = CGPoint(x: 0, y: -39)
    static let imageFrame = CGRect(x: 2, y: 2, width: 64, height: 64)
    static let placeholderFrame = CGRect(x: 20, y: 20, width: 28, height: 28)
    // Match the inset badge in the system Photos map rather than a floating bubble.
    static let badgeFrame = CGRect(x: 8, y: 44, width: 56, height: 18)
    static let coverCornerRadius: CGFloat = 9
    static let badgeCornerRadius: CGFloat = 5
    static let badgeFont = UIFont.monospacedDigitSystemFont(ofSize: 11, weight: .semibold)
    static let photoBorderWidth: CGFloat = 2
    static let badgeBorderWidth: CGFloat = 0
    static let badgeBackgroundColor = UIColor.black.withAlphaComponent(0.66)
    static let minimumTouchTarget: CGFloat = 44

    /// One stable photograph-card shadow across all native MapKit maps.
    static func decorate(_ view: MKAnnotationView) {
        view.clipsToBounds = false
        view.layer.shadowColor = UIColor.black.cgColor
        view.layer.shadowOpacity = 0.22
        view.layer.shadowRadius = 5
        view.layer.shadowOffset = CGSize(width: 0, height: 3)
        // Shared presentation for PhotoKit, Owner and reconciled-source pins.
        // One white callout tip per reusable annotation; it never grants
        // media access and does not intercept hit-testing.
        if view.layer.sublayers?.contains(where: {
            $0.name == "xdrive-native-photo-pin-pointer"
        }) != true {
            let pointer = CAShapeLayer()
            pointer.name = "xdrive-native-photo-pin-pointer"
            let path = UIBezierPath()
            path.move(to: CGPoint(x: 27, y: 64))
            path.addLine(to: CGPoint(x: 34, y: 77))
            path.addLine(to: CGPoint(x: 41, y: 64))
            path.close()
            pointer.path = path.cgPath
            pointer.fillColor = UIColor.white.cgColor
            view.layer.insertSublayer(pointer, at: 0)
        }
    }

    /// Selected marker scale/animation follows Reduce Motion.
    static func updateSelection(_ selected: Bool, view: MKAnnotationView,
                                animated: Bool) {
        // MapKit can deliver a selection after the current PhotoKit/Owner
        // lease was revoked. An inert or reused cover must never retain
        // an enlarged selected state, even for a single animation frame.
        guard view.isEnabled else {
            resetSelection(view)
            return
        }
        let change = {
            // Selection floats above adjacent image covers while maintaining
            // one stable origin and MapKit's own camera animation.
            view.layer.zPosition = selected ? 10 : 0
            view.layer.shadowOpacity = selected ? 0.32 : 0.22
            view.transform = selected
                ? CGAffineTransform(scaleX: 1.09, y: 1.09)
                : .identity
        }
        if animated && !UIAccessibility.isReduceMotionEnabled {
            UIView.animate(withDuration: 0.18, delay: 0,
                           options: [.beginFromCurrentState, .allowUserInteraction],
                           animations: change)
        } else {
            change()
        }
    }

    /// Retain the actual verified photo count, even above 1,000.
    /// This presentation helper does not change source admission.
    /// Reused annotations must not inherit a previous place's visual depth.
    static func resetSelection(_ view: MKAnnotationView) {
        view.transform = .identity
        view.layer.zPosition = 0
        view.layer.shadowOpacity = 0.22
    }

    static func badgeText(count: Int) -> String {
        NumberFormatter.localizedString(
            from: NSNumber(value: max(0, count)), number: .decimal)
    }

    /// A short dark inset adapts to the number, keeping one-digit badges
    /// compact while preserving a legible full count on dense places.
    static func resizeBadge(_ badge: UILabel) {
        badge.adjustsFontSizeToFitWidth = true
        badge.minimumScaleFactor = 0.75
        badge.isAccessibilityElement = false
        let intrinsicWidth = badge.intrinsicContentSize.width
        let fittedWidth = intrinsicWidth.isFinite && intrinsicWidth > 0
            ? intrinsicWidth + 10 : 22
        let width = min(badgeFrame.width, max(22, ceil(fittedWidth)))
        badge.frame = CGRect(x: badgeFrame.minX, y: badgeFrame.minY,
                             width: width, height: badgeFrame.height)
    }
}

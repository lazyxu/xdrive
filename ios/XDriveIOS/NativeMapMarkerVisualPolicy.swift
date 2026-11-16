import UIKit
import MapKit

/// One owner-independent native MapKit marker geometry. All visible photo
/// pin states use this presentation policy; it never grants photo access.
enum XDriveIOSNativeMapMarkerVisualPolicy {
    static let frame = CGRect(x: 0, y: 0, width: 68, height: 68)
    static let centerOffset = CGPoint(x: 0, y: -16)
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
    }

    /// Selected marker scale/animation follows Reduce Motion.
    static func updateSelection(_ selected: Bool, view: MKAnnotationView,
                                animated: Bool) {
        let change = {
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
    /// This presentation helper does not change PhotoKit/Owner admission.
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

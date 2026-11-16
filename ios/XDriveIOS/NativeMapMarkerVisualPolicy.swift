import UIKit
import MapKit

/// One owner-independent native MapKit marker geometry. All visible photo
/// pin states use this presentation policy; it never grants photo access.
enum XDriveIOSNativeMapMarkerVisualPolicy {
    static let frame = CGRect(x: 0, y: 0, width: 68, height: 68)
    static let centerOffset = CGPoint(x: 0, y: -16)
    static let imageFrame = CGRect(x: 2, y: 2, width: 64, height: 64)
    static let placeholderFrame = CGRect(x: 20, y: 20, width: 28, height: 28)
    static let badgeFrame = CGRect(x: 41, y: -7, width: 33, height: 28)
    static let coverCornerRadius: CGFloat = 9
    static let badgeCornerRadius: CGFloat = 14
    static let badgeFont = UIFont.boldSystemFont(ofSize: 11)
    static let photoBorderWidth: CGFloat = 2
    static let badgeBorderWidth: CGFloat = 2
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

    static func badgeText(count: Int) -> String {
        count >= 1000 ? "999+" : String(max(0, count))
    }
}

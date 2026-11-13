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

    static func badgeText(count: Int) -> String {
        count >= 1000 ? "999+" : String(max(0, count))
    }
}

import Foundation

/// Keeps VoiceOver zoom announcements from trapping on invalid UIKit scale.
/// UIKit configures a maximum 5x zoom; 100x is a generous diagnostic bound.
/// No media loading, navigation, or Owner permissions are affected.
enum XDriveIOSNativeZoomAccessibilityPolicy {
    static func label(scale: Double) -> String {
        guard scale.isFinite, scale > 0, scale <= 100 else {
            return "缩放比例不可用"
        }
        let percent = (scale * 100).rounded()
        guard percent.isFinite, percent >= 0,
              percent < Double(Int.max) else { return "缩放比例不可用" }
        return "缩放 \(Int(percent))%"
    }
}

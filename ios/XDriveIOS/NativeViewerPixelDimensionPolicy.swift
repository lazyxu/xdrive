import Foundation

/// Converts UIImage point geometry to pixel metadata without a Swift Int trap.
/// Used only when a UIImage has no CGImage dimensions; it never authorizes or
/// decodes media, changes Owner access, or allocates an image surface.
enum XDriveIOSNativeViewerPixelDimensionPolicy {
    static func pixels(points: Double, scale: Double) -> Int? {
        guard points.isFinite, points > 0, scale.isFinite, scale > 0 else {
            return nil
        }
        let product = points * scale
        // Double(Int.max) rounds up to 2^63. Strictly less avoids a trap
        // when Swift converts the result to Int on 64-bit iOS.
        guard product.isFinite, product >= 1,
              product < Double(Int.max) else { return nil }
        return Int(product)
    }
}

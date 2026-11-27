import Foundation

@main
struct NativeViewerPixelDimensionPolicyChecks {
    static func main() {
        let pixels = XDriveIOSNativeViewerPixelDimensionPolicy.pixels
        precondition(pixels(640, 2) == 1280)
        precondition(pixels(1024.75, 1) == 1024)
        precondition(pixels(0.4, 2) == nil)
        precondition(pixels(0, 1) == nil)
        precondition(pixels(-1, 2) == nil)
        precondition(pixels(.nan, 1) == nil)
        precondition(pixels(.infinity, 1) == nil)
        precondition(pixels(-.infinity, 1) == nil)
        precondition(pixels(1, .nan) == nil)
        precondition(pixels(1, .infinity) == nil)
        precondition(pixels(1, 0) == nil)
        precondition(pixels(1, -2) == nil)
        precondition(pixels(Double.greatestFiniteMagnitude, 2) == nil)
        precondition(pixels(Double(Int.max), 1) == nil)
        precondition(pixels(Double(Int.max) / 2, 2) == nil)
        // A finite value below the rounded Int limit remains a valid Int.
        precondition(pixels(4096, 1.25) == 5120)
        print("native Viewer pixel-dimension conversion: 16 boundary cases passed")
    }
}

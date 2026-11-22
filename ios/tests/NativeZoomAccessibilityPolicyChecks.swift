import Foundation

@main
struct NativeZoomAccessibilityPolicyChecks {
    static func main() {
        let label = XDriveIOSNativeZoomAccessibilityPolicy.label(scale:)
        precondition(label(1) == "缩放 100%")
        precondition(label(1.5) == "缩放 150%")
        precondition(label(3) == "缩放 300%")
        precondition(label(5) == "缩放 500%")
        precondition(label(0.01) == "缩放 1%")
        precondition(label(100) == "缩放 10000%")
        precondition(label(0) == "缩放比例不可用")
        precondition(label(-1) == "缩放比例不可用")
        precondition(label(.nan) == "缩放比例不可用")
        precondition(label(.infinity) == "缩放比例不可用")
        precondition(label(-.infinity) == "缩放比例不可用")
        precondition(label(Double.greatestFiniteMagnitude) == "缩放比例不可用")
        precondition(label(Double(Int.max)) == "缩放比例不可用")
        precondition(label(100.0001) == "缩放比例不可用")
        print("Native zoom accessibility conversion: 14 boundary cases passed")
    }
}

import Foundation

@main
struct NativePhotoWallDensityPolicyChecks {
    static func main() {
        typealias Density = XDriveIOSNativePhotoWallDensity
        precondition(Density.allCases.map(\.title) == ["紧凑", "标准", "大图"])
        precondition(Set(Density.allCases.map(\.id)).count == 3)
        precondition(Density.compact.minimumCellWidth < Density.standard.minimumCellWidth)
        precondition(Density.standard.minimumCellWidth < Density.large.minimumCellWidth)
        precondition(Density.allCases.allSatisfy {
            $0.minimumCellWidth > 0 &&
            $0.maximumCellWidth >= $0.minimumCellWidth
        })

        precondition(Density.compact.zoomedIn() == .standard)
        precondition(Density.standard.zoomedIn() == .large)
        precondition(Density.large.zoomedIn() == .large)
        precondition(Density.large.zoomedOut() == .standard)
        precondition(Density.standard.zoomedOut() == .compact)
        precondition(Density.compact.zoomedOut() == .compact)

        for d in Density.allCases {
            precondition(d.applyingPinch(1.0) == d)
            precondition(d.applyingPinch(1.12) == d)
            precondition(d.applyingPinch(0.91) == d)
            precondition(d.applyingPinch(.nan) == d)
            precondition(d.applyingPinch(0) == d)
            precondition(d.applyingPinch(.infinity) == d)
        }
        precondition(Density.standard.applyingPinch(1.35) == .large)
        precondition(Density.standard.applyingPinch(0.7) == .compact)
        precondition(Density.large.applyingPinch(0.7) == .standard)
        precondition(Density.compact.applyingPinch(1.35) == .standard)
        typealias Framing = XDriveIOSNativePhotoWallFraming
        precondition(Framing.allCases == [.square, .complete])
        precondition(Framing.square.title == "方形裁切")
        precondition(Framing.complete.title == "完整图片（原比例）")
        typealias Window = XDriveIOSNativePhotoWallWindowPolicy
        precondition(Window.shouldAdvance(footVisible: true, hasNext: true,
            busy: false, failed: false, viewerOpen: false, scopeActive: true))
        for gate in 0..<6 {
            precondition(!Window.shouldAdvance(
                footVisible: gate != 0, hasNext: gate != 1,
                busy: gate == 2, failed: gate == 3,
                viewerOpen: gate == 4, scopeActive: gate != 5))
        }
        precondition(Window.canRestore(4, in: [2, 4, 6], scopeActive: true))
        precondition(!Window.canRestore(3, in: [2, 4, 6], scopeActive: true))
        precondition(!Window.canRestore(4, in: [2, 4, 6], scopeActive: false))
        print("native local PhotoKit square wall density and framing: PASS")
    }
}

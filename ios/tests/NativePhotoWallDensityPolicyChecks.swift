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
        print("native local PhotoKit square wall density: PASS")
    }
}

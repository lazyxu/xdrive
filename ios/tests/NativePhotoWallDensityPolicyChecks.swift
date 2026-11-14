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
        let revisions = [(id: 1, revision: 5), (id: 2, revision: 3)]
        precondition(Window.canRestore((id: 2, revision: 3),
            in: revisions, scopeActive: true,
            matches: { $0.id == $1.id && $0.revision == $1.revision }))
        precondition(!Window.canRestore((id: 2, revision: 4),
            in: revisions, scopeActive: true,
            matches: { $0.id == $1.id && $0.revision == $1.revision }))
        precondition(!Window.canRestore(4, in: [2, 4, 4, 6],
                                        scopeActive: true),
                     "duplicate tile IDs must not steal the Viewer return anchor")
        precondition(!Window.canRestore(
            (id: 2, revision: 3),
            in: revisions + [(id: 2, revision: 3)], scopeActive: true,
            matches: { $0.id == $1.id && $0.revision == $1.revision }
        ), "duplicate exact Node revisions must not restore ambiguously")
        // Local PhotoKit and signed cloud use the same bounded,
        // order-preserving *visible-window* date sections. Never infer the
        // dates of an entire 100k library from a 48-item verified Range.
        let captured = ["2026-11-12", "2026-11-12", "unknown",
                        "2026-11-12", "2026-11-11"]
        let grouped = xdriveIOSNativePhotoWallVisibleSections(
            captured, scale: .day, key: { $0 }
        )
        precondition(grouped.map(\.key) ==
            ["2026-11-12", "unknown", "2026-11-12", "2026-11-11"])
        precondition(grouped.map(\.id) == [0, 1, 2, 3])
        precondition(grouped.flatMap(\.items) == captured)
        let ungrouped = xdriveIOSNativePhotoWallVisibleSections(
            captured, scale: .all, key: { $0 }
        )
        precondition(ungrouped.count == 1 &&
                     ungrouped[0].items == captured &&
                     ungrouped[0].key == "all")
        precondition(xdriveIOSNativePhotoWallVisibleSections(
            [String](), scale: .day, key: { $0 }).isEmpty)
        // Signed 48-item cloud pages suppress the repeated heading only
        // for an immediately adjacent, same-total, verified chronology.
        let boundary = XDriveIOSNativePhotoWallVerifiedPageDateBoundary(
            offset: 0, count: 48, total: 96,
            lastCapturedAt: "2026-11-14T08:00:00Z"
        )
        precondition(boundary.continues(
            nextOffset: 48, nextTotal: 96,
            firstCapturedAt: "2026-11-14T09:10:00Z", scale: .day))
        precondition(boundary.continues(
            nextOffset: 48, nextTotal: 96,
            firstCapturedAt: "2026-11-30T09:10:00Z", scale: .month))
        precondition(!boundary.continues(
            nextOffset: 96, nextTotal: 96,
            firstCapturedAt: "2026-11-14T09:10:00Z", scale: .day))
        precondition(!boundary.continues(
            nextOffset: 48, nextTotal: 97,
            firstCapturedAt: "2026-11-14T09:10:00Z", scale: .day))
        precondition(!boundary.continues(
            nextOffset: 48, nextTotal: 96,
            firstCapturedAt: "2026-11-15T08:00:00Z", scale: .day))
        precondition(!boundary.continues(
            nextOffset: 48, nextTotal: 96,
            firstCapturedAt: nil, scale: .day))
        precondition(!boundary.continues(
            nextOffset: 48, nextTotal: 96,
            firstCapturedAt: "2026-11-14T08:00:00Z", scale: .all))
        let incomplete = XDriveIOSNativePhotoWallVerifiedPageDateBoundary(
            offset: 0, count: 22, total: 96,
            lastCapturedAt: "2026-11-14T08:00:00Z")
        precondition(!incomplete.continues(
            nextOffset: 22, nextTotal: 96,
            firstCapturedAt: "2026-11-14T08:00:00Z", scale: .day))
        print("native local PhotoKit square wall density and framing: PASS")
    }
}

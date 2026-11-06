import Foundation

@main struct XDrivePhotoBackupTieBoundaryPolicyChecks {
    static func main() {
        let p = XDrivePhotoBackupTieBoundaryPolicy.self
        let names = (0..<257).map { String(format: "photo-%04d", 256 - $0) }
        guard let first = p.mappingForGroup(identifiers: names,
            groupStart: 0, windowStart: 0, windowEnd: 256),
              let second = p.mappingForGroup(identifiers: names,
            groupStart: 0, windowStart: 256, windowEnd: 512) else {
            preconditionFailure("Stable mapping unavailable for a bounded tied boundary")
        }
        precondition(first.count == 256 && second.count == 1)
        let combined = first + second
        precondition(combined.map(\.logicalIndex) == Array(0..<257))
        precondition(Set(combined.map(\.physicalIndex)).count == 257)
        precondition(combined.map { names[$0.physicalIndex] } == names.sorted())

        // A group can straddle an arbitrary pair of 256-slot windows.
        let pair = ["z-photo", "a-photo"]
        let left = p.mappingForGroup(identifiers: pair,
            groupStart: 255, windowStart: 0, windowEnd: 256)
        let right = p.mappingForGroup(identifiers: pair,
            groupStart: 255, windowStart: 256, windowEnd: 512)
        precondition(left == [.init(logicalIndex: 255, physicalIndex: 256)])
        precondition(right == [.init(logicalIndex: 256, physicalIndex: 255)])

        let reverse = Array(names.reversed())
        let other = (p.mappingForGroup(identifiers: reverse, groupStart: 0,
            windowStart: 0, windowEnd: 256) ?? []) +
            (p.mappingForGroup(identifiers: reverse, groupStart: 0,
                windowStart: 256, windowEnd: 512) ?? [])
        precondition(other.map { reverse[$0.physicalIndex] } == names.sorted())
        // 100k-equivalent equal-timestamp groups: every bounded 257-item
        // group straddles stable 256-slot windows without duplication.
        // Only one group is kept in memory at any time.
        for groupIndex in 0..<390 {
            let start = groupIndex * 257
            let windowStart = (start / 256) * 256
            let mapped = (p.mappingForGroup(
                identifiers: names, groupStart: start,
                windowStart: windowStart, windowEnd: windowStart + 256
            ) ?? []) + (p.mappingForGroup(
                identifiers: names, groupStart: start,
                windowStart: windowStart + 256, windowEnd: windowStart + 512
            ) ?? [])
            precondition(mapped.count == 257, "Tie group lost entries")
            precondition(mapped.map(\.logicalIndex) == Array(start..<(start + 257)))
            precondition(Set(mapped.map(\.physicalIndex)).count == 257)
        }
        precondition(p.mappingForGroup(identifiers: ["a", "a"],
            groupStart: 0, windowStart: 0, windowEnd: 256) == nil)
        precondition(p.mappingForGroup(identifiers: [""],
            groupStart: 0, windowStart: 0, windowEnd: 256) == nil)
        precondition(p.mappingForGroup(identifiers: Array(repeating: "a", count: 4097),
            groupStart: 0, windowStart: 0, windowEnd: 256) == nil)
        precondition(p.mappingForGroup(identifiers: ["a", "b"],
            groupStart: Int.max, windowStart: 0, windowEnd: 256) == nil)
        precondition(p.mappingForGroup(identifiers: ["a"],
            groupStart: 0, windowStart: 2, windowEnd: 3) == [])
        print("iOS PhotoKit bounded deterministic tie-boundary mapping: PASS")
    }
}

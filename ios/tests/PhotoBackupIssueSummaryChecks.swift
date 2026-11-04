import Foundation

@main struct XDriveIOSPhotoBackupIssueSummaryChecks {
    static func main() {
        let reasons: [XDriveIOSPhotoBackupIssueReason] = [
            .notVisible, .originalMissing, .incompleteLivePair,
            .resourceTooLarge, .sourceChanged, .unsupported, .unavailable
        ]
        precondition(reasons.allSatisfy { !$0.displayText.isEmpty })
        var report = XDriveIOSPhotoBackupIssueSummary()
        report.append(position: 0, mediaKind: "image", reason: .unavailable)
        precondition(report.total == 0)
        for index in 1...64 {
            report.append(
                position: index, mediaKind: index == 1 ? "live" : "video",
                reason: index == 1 ? .incompleteLivePair : .resourceTooLarge
            )
        }
        precondition(report.total == 64)
        precondition(report.entries.count == 20)
        precondition(report.additionalCount == 44)
        precondition(report.entries.first?.id == 1)
        precondition(report.entries.first?.mediaLabel == "实况照片")
        precondition(report.entries.last?.position == 20)
        precondition(report.entries.allSatisfy { $0.position > 0 })
        precondition(report.entries.first?.reason == .incompleteLivePair)
        precondition(report.entries.last?.reason == .resourceTooLarge)
        print("iOS original-backup bounded per-window issue summary: PASS")
    }
}

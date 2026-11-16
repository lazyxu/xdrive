import Foundation

/// Restore only an identical verified Node and current mode-change generation.
enum XDriveIOSNativeFilesViewModePolicy {
    static func anchor(preferred: UInt64?, loaded: [UInt64]) -> UInt64? {
        guard !loaded.isEmpty, loaded.allSatisfy({ $0 > 0 }),
              Set(loaded).count == loaded.count else { return nil }
        if let preferred, loaded.contains(preferred) { return preferred }
        return loaded.first
    }

    /// Relative row position, shared by List/Grid and collection restore.
    /// A negative result represents a partially clipped top row.
    static func relativeAlignment(
        rowTop: Double, rowHeight: Double, viewportHeight: Double
    ) -> Double {
        guard rowTop.isFinite, rowHeight.isFinite, viewportHeight.isFinite,
              rowHeight > 0, viewportHeight > rowHeight else { return 0 }
        return min(0.95, max(-0.25, rowTop / (viewportHeight - rowHeight)))
    }

    static func canRestore(
        ticketCurrent: Bool, ownerValid: Bool, pageValid: Bool,
        anchorVisible: Bool, screenVisible: Bool,
        expectedMode: String, currentMode: String,
        active: Bool
    ) -> Bool {
        ticketCurrent && ownerValid && pageValid && anchorVisible && screenVisible && active &&
            (expectedMode == "list" || expectedMode == "grid") &&
            expectedMode == currentMode
    }
}

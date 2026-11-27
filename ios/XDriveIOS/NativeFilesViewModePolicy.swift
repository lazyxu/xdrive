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

    /// Only reuse a row's measured geometry when that exact verified row
    /// remains selected. Page eviction or an Owner switch may choose a new
    /// fallback row; carrying the previous row's offset produces a jump.
    static func matchedAlignment(
        visibleAnchor: UInt64?, selectedAnchor: UInt64?, measured: Double
    ) -> Double? {
        guard let visibleAnchor, visibleAnchor == selectedAnchor,
              measured.isFinite, (-0.25...0.95).contains(measured)
        else { return nil }
        return measured
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

import Foundation

/// Restore only an identical verified Node and current mode-change generation.
enum XDriveIOSNativeFilesViewModePolicy {
    static func anchor(preferred: UInt64?, loaded: [UInt64]) -> UInt64? {
        guard !loaded.isEmpty, loaded.allSatisfy({ $0 > 0 }),
              Set(loaded).count == loaded.count else { return nil }
        if let preferred, loaded.contains(preferred) { return preferred }
        return loaded.first
    }

    static func canRestore(
        ticketCurrent: Bool, ownerValid: Bool, pageValid: Bool,
        anchorVisible: Bool, expectedMode: String, currentMode: String,
        active: Bool
    ) -> Bool {
        ticketCurrent && ownerValid && pageValid && anchorVisible && active &&
            (expectedMode == "list" || expectedMode == "grid") &&
            expectedMode == currentMode
    }
}

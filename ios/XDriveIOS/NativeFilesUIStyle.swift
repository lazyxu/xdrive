import SwiftUI

/// Presentation-only layout shared across Browse, collections and Viewer.
enum XDriveIOSNativeFilesUIStyle {
    static let rowHeight: CGFloat = 52
    static let tapHeight: CGFloat = 44
    static let selectionDockHeight: CGFloat = 52
    static let actionIconSize: CGFloat = 18
    static let cardRadius: CGFloat = 14
    static let metadataFont: Font = .caption
    static let dockLabelFont: Font = .caption2.weight(.semibold)

    static func rowName(_ value: String) -> some View {
        Text(value).font(.subheadline.weight(.medium)).lineLimit(2)
    }

    static func tileName(_ value: String) -> some View {
        Text(value).font(.footnote.weight(.medium)).lineLimit(2)
    }

    static func metadata(_ value: String) -> some View {
        Text(value).font(metadataFont).foregroundStyle(.secondary).lineLimit(1)
    }
}

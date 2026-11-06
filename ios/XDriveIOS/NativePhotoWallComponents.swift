import SwiftUI

/// Shared presentation-only photo wall for PhotoKit albums, GPS place sheets,
/// and authorized Owner PhotoAsset ranges. The caller keeps its own bounded
/// cursor, membership proof, thumbnail request and Viewer admission.
struct XDriveIOSNativePhotoWallGrid<Content: View>: View {
    let density: XDriveIOSNativePhotoWallDensity
    let spacing: CGFloat
    private let content: Content

    init(density: XDriveIOSNativePhotoWallDensity,
         spacing: CGFloat = 2,
         @ViewBuilder content: () -> Content) {
        self.density = density
        self.spacing = spacing
        self.content = content()
    }

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(
            minimum: density.minimumCellWidth,
            maximum: density.maximumCellWidth
        ), spacing: spacing)], spacing: spacing) {
            content
        }
    }
}

/// Identical square loading cell for local PhotoKit and signed cloud ranges.
/// Pure presentation: no Owner grant, PhotoKit identity, or network lifecycle.
struct XDriveIOSNativePhotoWallPlaceholderTile: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 3)
            .fill(Color(uiColor: .secondarySystemGroupedBackground))
            .aspectRatio(1, contentMode: .fit)
            .accessibilityHidden(true)
    }
}

/// A day heading only for a capture-time-ordered collection. Location ranges
/// are not automatically chronological and must not show invented headings.
struct XDriveIOSNativePhotoWallDayHeader: View {
    let title: String
    var topPadding: CGFloat = 0

    var body: some View {
        Text(title)
            .font(.headline)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, topPadding)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Shared density menu actions: callers retain their own guards, cursors,
/// current Owner, photo filters and Viewer presentation and dismissal.
@ViewBuilder
func xdrivePhotoWallDensityButtons(
    _ density: Binding<XDriveIOSNativePhotoWallDensity>
) -> some View {
    ForEach(XDriveIOSNativePhotoWallDensity.allCases) { option in
        Button {
            density.wrappedValue = option
        } label: {
            Label(option.title, systemImage: density.wrappedValue == option
                ? "checkmark.circle.fill" : "square.grid.3x3")
        }
    }
}

 
/// Shared inert retry presentation. The parent retains the actual authorization,
/// exact scope, request cancellation, and retry action.
struct XDriveIOSNativePhotoWallRetryMessage: View {
    let message: String
    let buttonTitle: String
    let canRetry: Bool
    var accessibilityID: String? = nil
    var textFont: Font = .footnote
    let onRetry: () -> Void

    var body: some View {
        Text(message).font(textFont).foregroundStyle(.secondary)
        if let accessibilityID {
            Button(buttonTitle, action: onRetry)
                .disabled(!canRetry)
                .buttonStyle(.bordered)
                .accessibilityIdentifier(accessibilityID)
        } else {
            Button(buttonTitle, action: onRetry)
                .disabled(!canRetry)
                .buttonStyle(.bordered)
        }
    }
}

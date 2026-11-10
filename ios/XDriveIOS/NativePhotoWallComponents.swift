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

/// Presentation-only busy indicator. The caller owns task lifetime and
/// never starts a reader or makes an authorization decision here.
struct XDriveIOSNativePhotoWallLoadingMessage: View {
    let message: String
    var accessibilityID: String? = nil

    @ViewBuilder var body: some View {
        if let accessibilityID {
            ProgressView(message)
                .font(.footnote)
                .accessibilityIdentifier(accessibilityID)
        } else {
            ProgressView(message).font(.footnote)
        }
    }
}

/// Presentation-only secondary/empty text. The caller decides whether its
/// verified range is empty, filtered, temporarily loading or unavailable.
struct XDriveIOSNativePhotoWallStatusMessage: View {
    let message: String
    var minHeight: CGFloat = 0

    var body: some View {
        Text(message)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: minHeight, alignment: .leading)
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
    var systemImage: String? = nil
    let onRetry: () -> Void

    var body: some View {
        if let systemImage {
            Label(message, systemImage: systemImage)
                .font(textFont)
                .foregroundStyle(.secondary)
        } else {
            Text(message).font(textFont).foregroundStyle(.secondary)
        }
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

 
/// Presentation-only media type badge shared by local PhotoKit, cloud Owner,
/// map-place and unified Gallery square tiles. Only an independently verified
/// PhotoKit duration may be displayed; unknown cloud duration stays an icon.
/// The parent tile owns the accessible media label and all authorization.
struct XDriveIOSNativePhotoWallMediaBadge: View {
    let isVideo: Bool
    let isLive: Bool
    var verifiedDuration: String? = nil

    var body: some View {
        Group {
            if isVideo {
                Group {
                    if let verifiedDuration {
                        Text(verifiedDuration).monospacedDigit()
                    } else {
                        Image(systemName: "play.fill")
                    }
                }
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 5)
                .padding(.vertical, 3)
                .background(Color.black.opacity(0.55),
                            in: RoundedRectangle(cornerRadius: 4))
                .padding(4)
            } else if isLive {
                Image(systemName: "livephoto")
                    .font(.title3)
                    .foregroundStyle(.white)
                    .padding(5)
                    .shadow(radius: 2)
            }
        }
        .accessibilityHidden(true)
    }
}

/// The only square tile *presentation* shared by local PhotoKit, signed Owner
/// ranges, place clusters and the reconciled timeline. It accepts rendered
/// pixels, never a photo ID, Reader, Owner scope, or authorization callback.
/// Source-specific tasks and foreground cancellation remain in each caller.
struct XDriveIOSNativePhotoWallTileShell<Content: View>: View {
    let isVideo: Bool
    let isLive: Bool
    let verifiedDuration: String?
    let badgeAlignment: Alignment
    private let content: Content

    init(isVideo: Bool, isLive: Bool, verifiedDuration: String? = nil,
         badgeAlignment: Alignment = .bottomTrailing,
         @ViewBuilder content: () -> Content) {
        self.isVideo = isVideo
        self.isLive = isLive
        self.verifiedDuration = verifiedDuration
        self.badgeAlignment = badgeAlignment
        self.content = content()
    }

    var body: some View {
        content
            .aspectRatio(1, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 3))
            .overlay(alignment: badgeAlignment) {
                XDriveIOSNativePhotoWallMediaBadge(
                    isVideo: isVideo, isLive: isLive,
                    verifiedDuration: verifiedDuration
                )
            }
    }
}

/// Selection indicator only. The page remains responsible for membership,
/// batch-action rights, accessibility text and selection lifecycle.
struct XDriveIOSNativePhotoWallSelectionIndicator: View {
    let selected: Bool
    var accented: Bool = false

    var body: some View {
        if accented {
            Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                .font(.title2)
                .symbolRenderingMode(.palette)
                .foregroundStyle(.white, Color.accentColor)
                .padding(6)
        } else {
            Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                .font(.title2)
                .foregroundStyle(.white)
                .padding(6)
        }
    }
}


/// One native pinch recognizer for bounded PhotoKit and signed Owner photo
/// walls. The caller provides the current eligibility (scene/Owner/Viewer);
/// this modifier never consults PhotoKit, reads media, or changes a cursor.
struct XDriveIOSNativePhotoWallPinchModifier: ViewModifier {
    @Binding var density: XDriveIOSNativePhotoWallDensity
    let enabled: Bool

    func body(content: Content) -> some View {
        content.simultaneousGesture(
            MagnificationGesture(minimumScaleDelta: 0.14).onEnded { scale in
                guard enabled else { return }
                density = density.applyingPinch(scale)
            }
        )
    }
}

extension View {
    func xdrivePhotoWallPinch(
        density: Binding<XDriveIOSNativePhotoWallDensity>,
        enabled: Bool
    ) -> some View {
        modifier(XDriveIOSNativePhotoWallPinchModifier(
            density: density, enabled: enabled
        ))
    }
}

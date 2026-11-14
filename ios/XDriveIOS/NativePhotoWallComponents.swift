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

/// The same four date-scale controls for native Gallery and Owner MapKit.
/// This never requests or grants an unsent photo range.
struct XDriveIOSNativePhotoWallTimeScaleControls: View {
    @Binding var scale: XDriveIOSNativePhotoWallTimeScale

    var body: some View {
        Picker("照片时间分组", selection: $scale) {
            ForEach(XDriveIOSNativePhotoWallTimeScale.allCases) { option in
                Text(option.title).tag(option)
            }
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("native-ios-shared-photo-time-scale")
    }
}

/// Presentation-only crop/contain options. Sources, Owners and authenticated
/// thumbnail lifetimes remain in the callers, never in this shared component.
@ViewBuilder
func xdrivePhotoWallFramingButtons(
    _ framing: Binding<XDriveIOSNativePhotoWallFraming>
) -> some View {
    ForEach(XDriveIOSNativePhotoWallFraming.allCases) { option in
        Button {
            framing.wrappedValue = option
        } label: {
            Label(option.title, systemImage: framing.wrappedValue == option
                ? "checkmark.circle.fill" : "square.dashed")
        }
        .accessibilityIdentifier("native-ios-shared-framing-" + option.rawValue)
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

// Pure view composition for local album, local map and signed Owner pages.
// The enclosing ScrollViewReader, paging sentinel and authorization stay
// with each caller; only chronological headers, adaptive grid and tiles live
// here. A visible section never implies an unrequested page was loaded.
struct XDriveIOSNativePhotoWallSectionList<Section: Identifiable, Item: Identifiable, Tile: View>: View {
    let sections: [Section]
    let density: XDriveIOSNativePhotoWallDensity
    let spacing: CGFloat
    private let title: (Section) -> String?
    private let items: (Section) -> [Item]
    private let tile: (Item) -> Tile

    init(
        sections: [Section], density: XDriveIOSNativePhotoWallDensity,
        spacing: CGFloat = 10,
        title: @escaping (Section) -> String?,
        items: @escaping (Section) -> [Item],
        @ViewBuilder tile: @escaping (Item) -> Tile
    ) {
        self.sections = sections
        self.density = density
        self.spacing = spacing
        self.title = title
        self.items = items
        self.tile = tile
    }

    var body: some View {
        LazyVStack(alignment: .leading, spacing: spacing) {
            ForEach(sections) { section in
                if let heading = title(section) {
                    XDriveIOSNativePhotoWallDayHeader(title: heading)
                }
                XDriveIOSNativePhotoWallGrid(density: density) {
                    ForEach(items(section)) { item in tile(item) }
                }
            }
        }
    }
}

/// Consistent layout actions without exporting PhotoKit/cloud permissions.
/// Extra actions (sort, map, refresh) belong to the authorized caller.
struct XDriveIOSNativePhotoWallDisplayMenu<Extra: View>: View {
    @Binding var density: XDriveIOSNativePhotoWallDensity
    @Binding var framing: XDriveIOSNativePhotoWallFraming
    let accessibilityID: String
    private let extra: () -> Extra

    init(
        density: Binding<XDriveIOSNativePhotoWallDensity>,
        framing: Binding<XDriveIOSNativePhotoWallFraming>,
        accessibilityID: String,
        @ViewBuilder extra: @escaping () -> Extra
    ) {
        _density = density
        _framing = framing
        self.accessibilityID = accessibilityID
        self.extra = extra
    }

    var body: some View {
        Menu {
            Section("照片网格") { xdrivePhotoWallDensityButtons($density) }
            Section("显示比例") { xdrivePhotoWallFramingButtons($framing) }
            extra()
        } label: {
            Label("显示选项", systemImage: "square.grid.3x3")
                .frame(minWidth: 44, minHeight: 44)
        }
        .accessibilityLabel("照片显示选项")
        .accessibilityIdentifier(accessibilityID)
    }
}

/// Identical low-emphasis summary styling across all photo-wall scopes.
struct XDriveIOSNativePhotoWallScopeSummary: View {
    let message: String
    var progress: String? = nil

    var body: some View {
        Text(message)
            .font(.caption)
            .foregroundStyle(.secondary)
            .accessibilityValue(progress ?? message)
    }
}

/// The caller MUST first verify the exact current PhotoKit/Owner range.
/// This helper handles only presentation; it cannot grant Viewer access.
@MainActor
func xdrivePhotoWallFocusVerifiedTile<ID: Hashable>(
    _ id: ID,
    scroll: ScrollViewProxy,
    focus: AccessibilityFocusState<ID?>.Binding,
    anchor: UnitPoint = .center
) {
    scroll.scrollTo(id, anchor: anchor)
    focus.wrappedValue = id
}

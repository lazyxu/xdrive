import SwiftUI

/// Shared presentation metrics. Never a credential or page count.
enum XDriveIOSNativePhotoWallLayout {
    static let sectionSpacing: CGFloat = 10
    static let horizontalInset: CGFloat = 8
    static let maximumSkeletonCount = 64
}

/// Compact status remains INSIDE MapKit instead of shrinking the photo map.
/// Authorization, source counts, retries and media access remain caller-owned.
struct XDriveIOSNativePhotoMapStatusPill: View {
    let message: String
    let accessibilityID: String
    var systemImage = "mappin.and.ellipse"

    var body: some View {
        Label(message, systemImage: systemImage)
            .font(.caption)
            .foregroundStyle(.primary)
            .lineLimit(2)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.regularMaterial, in: Capsule())
            .shadow(color: .black.opacity(0.14), radius: 5, y: 2)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(accessibilityID)
            .padding(10)
    }
}


/// One system-style right-side control group, shared by PhotoKit, Owner and
/// reconciled-source maps. UIKit MapKit retains all gestures and camera state;
/// these controls never authorize a marker or read photos.
struct XDriveIOSNativePhotoMapFloatingTools: View {
    let satellite: Bool
    let locateEnabled: Bool
    let locateID: String
    let styleID: String
    let onLocate: () -> Void
    let onToggleStyle: () -> Void

    var body: some View {
        VStack(spacing: 2) {
            Button(action: onToggleStyle) {
                Image(systemName: satellite ? "map" : "square.3.layers.3d")
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel(satellite ? "标准地图" : "卫星地图")
            .accessibilityIdentifier(styleID)
            Divider().padding(.horizontal, 8)
            Button(action: onLocate) {
                Image(systemName: "location")
                    .frame(width: 44, height: 44)
            }
            .disabled(!locateEnabled)
            .accessibilityLabel("我的位置")
            .accessibilityIdentifier(locateID)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.16), radius: 5, y: 2)
    }
}

/// Opens the CURRENT reader's verified map membership in its already existing
/// photo wall. The caller must validate current permissions and viewport.
/// In particular, this control cannot broaden to an unfiltered Gallery.
struct XDriveIOSNativePhotoMapGridAction: View {
    let enabled: Bool
    let accessibilityID: String
    // This exact reader's already-verified photo count is available to
    // VoiceOver without covering the map with a permanent counter capsule.
    var verifiedSummary: String? = nil
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            Image(systemName: "square.grid.3x3")
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
        .disabled(!enabled)
        .background(.regularMaterial, in: Circle())
        .shadow(color: .black.opacity(0.16), radius: 5, y: 2)
        .accessibilityLabel("显示当前地图照片网格")
        .accessibilityHint("仅打开当前已核验地图范围内的照片")
        .accessibilityValue(verifiedSummary ?? "")
        .accessibilityIdentifier(accessibilityID)
    }
}

/// Photo-first, accessible location header shared by local/Owner/source
/// Sheets; a count supplied by a caller must already be scope-verified.
struct XDriveIOSNativePhotoMapPlaceHeader: View {
    let title: String
    let count: Int?
    var detail: String? = nil
    var titleAccessibilityID = "native-ios-map-place-title"
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.title2.weight(.semibold))
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                .minimumScaleFactor(0.92)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier(titleAccessibilityID)
            if let count {
                Text("\(count) 张照片")
                    .font(.subheadline)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            if let detail {
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .padding(.bottom, 6)
    }
}

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

/// Bounded, square first-paint placeholders, with no invented media rows.
struct XDriveIOSNativePhotoWallSkeletonGrid: View {
    let density: XDriveIOSNativePhotoWallDensity
    let count: Int

    var body: some View {
        XDriveIOSNativePhotoWallGrid(density: density) {
            ForEach(0..<max(0, min(count, XDriveIOSNativePhotoWallLayout.maximumSkeletonCount)),
                    id: \.self) { _ in
                XDriveIOSNativePhotoWallPlaceholderTile()
            }
        }
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

/// Shared empty-scope layout; deciding that an authorized range is really
/// empty remains the responsibility of each PhotoKit/Owner caller.
struct XDriveIOSNativePhotoWallEmptyState: View {
    let message: String
    var body: some View {
        XDriveIOSNativePhotoWallStatusMessage(message: message, minHeight: 96)
            .padding(.horizontal, XDriveIOSNativePhotoWallLayout.horizontalInset)
    }
}

/// One date-header visibility contract for all verified Gallery/Places pages.
/// A preceding heading is suppressed ONLY by a caller-proven adjacent range;
/// an inferred date membership never grants a missing photo.
func xdriveIOSNativePhotoWallHeading(
    scale: XDriveIOSNativePhotoWallTimeScale,
    key: String,
    firstSection: Bool,
    verifiedContinuation: Bool = false
) -> String? {
    guard scale != .all else { return nil }
    if firstSection && verifiedContinuation { return nil }
    return scale.label(for: key)
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
    var onDensityChange: ((XDriveIOSNativePhotoWallDensity) -> Void)? = nil

    func body(content: Content) -> some View {
        content.simultaneousGesture(
            MagnificationGesture(minimumScaleDelta: 0.14).onEnded { scale in
                guard enabled else { return }
                let changed = density.applyingPinch(scale)
                guard changed != density else { return }
                onDensityChange?(changed)
                density = changed
            }
        )
    }
}

extension View {
    func xdrivePhotoWallPinch(
        density: Binding<XDriveIOSNativePhotoWallDensity>,
        enabled: Bool,
        onDensityChange: ((XDriveIOSNativePhotoWallDensity) -> Void)? = nil
    ) -> some View {
        modifier(XDriveIOSNativePhotoWallPinchModifier(
            density: density, enabled: enabled,
            onDensityChange: onDensityChange
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


/// Shared scrolling host for native Gallery/Places photo walls. The caller
/// retains ScrollViewReader, authorization, paging sentinel, Viewer lifecycle,
/// and all current media/thumbnail identities.
struct XDriveIOSNativePhotoWallScrollContainer<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ScrollView {
            content
        }
    }
}

/// A single lazy chronology/sentinel stack for Gallery and both Places
/// routes. The enclosing reader still owns its authenticated page windows.
struct XDriveIOSNativePhotoWallCollectionStack<Content: View>: View {
    private let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }
    var body: some View {
        LazyVStack(alignment: .leading,
                   spacing: XDriveIOSNativePhotoWallLayout.sectionSpacing) {
            content
        }
    }
}

/// One bounded native filmstrip host. Source callers own authorization,
/// scrubbing, exact Owner/PhotoKit revisions, and Viewer selection.
struct XDriveIOSNativePhotoWallViewerFilmstripScroll<Content: View>: View {
    let height: CGFloat
    private let content: Content

    init(height: CGFloat = 72, @ViewBuilder content: () -> Content) {
        self.height = height
        self.content = content()
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(alignment: .center, spacing: 4) {
                content
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
        }
        .frame(height: height)
        .background(.ultraThinMaterial)
    }
}

/// Loading and retry messages share a visual layout across local and cloud
/// place sheets. Source readers still own onRetry, cancellation and authority.
struct XDriveIOSNativePhotoWallFeedback: View {
    let isLoading: Bool
    let loadingMessage: String
    let error: String?
    let canRetry: Bool
    let buttonTitle: String
    var retryAccessibilityID: String? = nil
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error {
                XDriveIOSNativePhotoWallRetryMessage(
                    message: error, buttonTitle: buttonTitle, canRetry: canRetry,
                    accessibilityID: retryAccessibilityID
                ) { onRetry() }
            }
            if isLoading {
                XDriveIOSNativePhotoWallLoadingMessage(message: loadingMessage)
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

/// Presentation-only scrolling after the caller has revalidated its
/// own PhotoKit/Owner window and unique tile; never authorizes a photo read.
@MainActor
func xdrivePhotoWallScrollVerifiedTile<ID: Hashable>(
    _ id: ID, scroll: ScrollViewProxy, anchor: UnitPoint = .center
) {
    scroll.scrollTo(id, anchor: anchor)
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


/// Pure presentation geometry. No PhotoKit IDs are persisted; the source
/// reader remains the only authority to expose a tile or Viewer.
struct XDriveIOSNativePhotoWallTileFramesKey: PreferenceKey {
    static var defaultValue: [String: CGRect] = [:]
    static func reduce(value: inout [String: CGRect],
                       nextValue: () -> [String: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { _, newer in newer })
    }
}

/// Shared transient view geometry; measurement never grants media access.
private struct XDriveIOSNativePhotoWallMeasureTile: ViewModifier {
    let id: String
    let coordinateSpace: String
    func body(content: Content) -> some View {
        content.background {
            if !id.isEmpty {
                GeometryReader { tile in
                    Color.clear.preference(
                        key: XDriveIOSNativePhotoWallTileFramesKey.self,
                        value: [id: tile.frame(in: .named(coordinateSpace))]
                    )
                }
            }
        }
    }
}

extension View {
    func xdrivePhotoWallMeasureTile(_ id: String,
                                   in coordinateSpace: String) -> some View {
        modifier(XDriveIOSNativePhotoWallMeasureTile(
            id: id, coordinateSpace: coordinateSpace))
    }
}

/// A transient same-window tile placement. Caller must already have verified
/// the current Owner/PhotoKit grant, page membership and exact unique tile.
struct XDriveIOSNativePhotoWallViewportAnchor: Equatable {
    let itemID: String
    let windowIndex: Int
    let viewportOffset: CGFloat
    let tileHeight: CGFloat

    func alignment(for verifiedID: String, window: Int,
                   viewportHeight: CGFloat) -> UnitPoint? {
        guard verifiedID == itemID, window == windowIndex,
              viewportOffset.isFinite, tileHeight.isFinite,
              viewportHeight.isFinite, tileHeight > 0,
              viewportHeight > tileHeight,
              viewportOffset >= 0,
              viewportOffset <= viewportHeight - tileHeight else { return nil }
        return UnitPoint(x: 0.5, y: viewportOffset / (viewportHeight - tileHeight))
    }
}

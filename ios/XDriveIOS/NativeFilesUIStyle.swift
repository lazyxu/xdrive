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
        XDriveIOSNativeFilesAdaptiveText(value: value, isTitle: true)
    }

    static func tileName(_ value: String) -> some View {
        Text(value).font(.footnote.weight(.medium)).lineLimit(2)
    }

    static func metadata(_ value: String) -> some View {
        XDriveIOSNativeFilesAdaptiveText(value: value, isTitle: false)
    }
}

/// Two-line normal list layout with accessible expansion at large text sizes.
/// No fixed font-scale reduction or hardcoded foreground colors.
private struct XDriveIOSNativeFilesAdaptiveText: View {
    let value: String
    let isTitle: Bool
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Text(value)
            .font(isTitle ? .subheadline.weight(.medium) : .caption)
            .foregroundStyle(isTitle ? Color.primary : Color.secondary)
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
            .accessibilityLabel(value)
    }
}


/// The same server-backed filter state as Web/PWA: each visible chip removes
/// only its own predicate. No local 64-row filtering or new network source.
/// Keep this isolated from the already deep native Files SwiftUI view graph.
struct XDriveIOSNativeFilesAppliedFiltersBar: View {
    @Binding var filters: XDriveIOSNativeFilesSearchFilterState
    let sourceName: String
    let tagName: String

    private struct AppliedFilter: Identifiable {
        let id: String
        let label: String
    }

    private var chips: [AppliedFilter] {
        var result: [AppliedFilter] = []
        if filters.kind != "all" {
            result.append(.init(
                id: "kind",
                label: "类型：" + XDriveIOSNativeFilesPagePolicy.searchKindLabel(filters.kind)
            ))
        }
        if filters.hasDateFilter {
            let from = filters.modifiedFrom.map { String($0.prefix(10)) }
            let to = filters.modifiedTo.map { String($0.prefix(10)) }
            let label: String
            if let from, let to {
                label = "修改：" + from + " – " + to
            } else if let from {
                label = "修改：" + from + " 起"
            } else if let to {
                label = "修改：" + to + " 前"
            } else {
                label = "修改时间已筛选"
            }
            result.append(.init(id: "modified", label: label))
        }
        if filters.hasSizeFilter {
            let min = filters.minSize.map {
                ByteCountFormatter.string(fromByteCount: $0, countStyle: .file)
            }
            let max = filters.maxSize.map {
                ByteCountFormatter.string(fromByteCount: $0, countStyle: .file)
            }
            let label: String
            if let min, let max {
                label = "大小：" + min + " – " + max
            } else if let min {
                label = "大小：≥ " + min
            } else if let max {
                label = "大小：≤ " + max
            } else {
                label = "文件大小已筛选"
            }
            result.append(.init(id: "size", label: label))
        }
        if filters.hasSourceFilter {
            result.append(.init(id: "source", label: "来源：" + sourceName))
        }
        if filters.hasTagFilter {
            result.append(.init(id: "tag", label: "标签：" + tagName))
        }
        return result
    }

    private func clear(_ id: String) {
        switch id {
        case "kind":
            filters.kind = "all"
        case "modified":
            filters.modifiedFrom = nil
            filters.modifiedTo = nil
        case "size":
            filters.minSize = nil
            filters.maxSize = nil
        case "source":
            filters.sourceID = nil
        case "tag":
            filters.tagID = nil
        default:
            break
        }
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(chips) { chip in
                    Button { clear(chip.id) } label: {
                        HStack(spacing: 5) {
                            Text(chip.label)
                                .font(.caption)
                                .lineLimit(1)
                            Image(systemName: "xmark.circle.fill")
                                .font(.caption)
                                .accessibilityHidden(true)
                        }
                        .padding(.horizontal, 10)
                        .frame(minHeight: XDriveIOSNativeFilesUIStyle.tapHeight)
                        .foregroundStyle(Color.accentColor)
                        .background(Color.accentColor.opacity(0.1), in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("清除" + chip.label + "筛选")
                    .accessibilityIdentifier("native-ios-files-applied-filter-" + chip.id)
                }
            }
            .padding(.horizontal, 2)
        }
        .accessibilityIdentifier("native-ios-files-applied-filter-chips")
    }
}

/// File extensions inform presentation only: never treat badges as MIME proof.
extension XDriveIOSNativeFilesUIStyle {
    static func fileAppearance(_ node: XDriveIOSNativeFilesNode)
        -> (label: String, symbol: String, tint: Color) {
        if node.isDirectory {
            return ("文件夹", "folder.fill", .accentColor)
        }
        switch (node.name as NSString).pathExtension.lowercased() {
        case "pdf": return ("PDF", "doc.richtext", .red)
        case "doc", "docx", "odt": return ("DOC", "doc.text", .blue)
        case "xls", "xlsx", "csv", "ods": return ("XLS", "tablecells", .green)
        case "ppt", "pptx", "odp": return ("PPT", "rectangle.on.rectangle", .orange)
        case "zip", "7z", "rar", "tar", "gz": return ("ZIP", "archivebox", .indigo)
        case "mp4", "mov", "m4v", "avi", "mkv": return ("视频", "video.fill", .purple)
        case "jpg", "jpeg", "png", "heic", "webp", "gif": return ("图片", "photo", .teal)
        case "mp3", "m4a", "wav", "flac", "aac": return ("音频", "waveform", .pink)
        case "swift", "go", "py", "js", "ts", "json", "html", "css", "xml":
            return ("代码", "curlybraces", .indigo)
        case "txt", "md", "log": return ("TXT", "doc.plaintext", .secondary)
        default: return ("文件", "doc", .secondary)
        }
    }

    /// Compact path-first metadata used across Browse/Recent/Favorites.
    static func compactMetadata(_ node: XDriveIOSNativeFilesNode, path: String? = nil) -> String {
        if let path, !path.isEmpty { return path }
        var parts: [String] = [fileAppearance(node).label]
        if !node.isDirectory {
            parts.append(ByteCountFormatter.string(fromByteCount: node.size, countStyle: .file))
        }
        if let date = node.modifiedDate {
            parts.append(XDriveIOSNativeFilesDatePolicy.display(date))
        }
        return parts.joined(separator: " · ")
    }

    /// Shared single-line grid subtitle for Browse/Recent/Favorites. The full
    /// timestamp remains in the List metadata and verified Properties.
    static func gridMetadata(_ node: XDriveIOSNativeFilesNode, path: String? = nil) -> String {
        if let path, !path.isEmpty { return path }
        return node.isDirectory ? "文件夹" :
            ByteCountFormatter.string(fromByteCount: node.size, countStyle: .file)
    }

    /// Choose only the nearest visible verified row, carrying its viewport
    /// fraction. Group headers and stale/evicted IDs are never scroll targets.
    static func topVisibleAnchor(
        frames: [UInt64: CGRect], accepted: [UInt64], viewportHeight: CGFloat
    ) -> (nodeID: UInt64, alignment: Double)? {
        guard viewportHeight > 0, viewportHeight.isFinite else { return nil }
        let allowed = Set(accepted)
        guard let nearest = frames.filter({
            allowed.contains($0.key) && $0.value.maxY > 0 &&
                $0.value.minY < viewportHeight
        }).min(by: { abs($0.value.minY) < abs($1.value.minY) })
        else { return nil }
        return (nearest.key, XDriveIOSNativeFilesViewModePolicy.relativeAlignment(
            rowTop: Double(nearest.value.minY),
            rowHeight: Double(nearest.value.height),
            viewportHeight: Double(viewportHeight)
        ))
    }

    static func typeBadge(_ node: XDriveIOSNativeFilesNode) -> some View {
        let appearance = fileAppearance(node)
        return Text(appearance.label)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(appearance.tint)
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(appearance.tint.opacity(0.10), in: Capsule())
            .accessibilityLabel("文件类型：" + appearance.label)
    }
}

/// Shared iOS-native rendering of the PWA's blue folder and format-band design.
/// Pure presentation: no extra network request or source MIME guess.
struct XDriveIOSNativeFilesFallbackIcon: View {
    let node: XDriveIOSNativeFilesNode
    let size: CGFloat

    var body: some View {
        Group {
            if node.isDirectory {
                Image(systemName: "folder.fill")
                    .resizable().scaledToFit()
                    .foregroundStyle(LinearGradient(
                        colors: [
                            Color(red: 0.49, green: 0.81, blue: 0.94),
                            Color(red: 0.30, green: 0.68, blue: 0.86)
                        ], startPoint: .top, endPoint: .bottom))
            } else {
                ZStack(alignment: .bottom) {
                    Image(systemName: "doc.fill")
                        .resizable().scaledToFit()
                        .foregroundStyle(Color(uiColor: .secondarySystemBackground))
                    Image(systemName: "doc")
                        .resizable().scaledToFit()
                        .foregroundStyle(Color(uiColor: .tertiaryLabel))
                    Text(XDriveIOSNativeFilesUIStyle.fileAppearance(node).label)
                        .font(.system(size: max(7, size * 0.18), weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 3).padding(.vertical, 1)
                        .background(XDriveIOSNativeFilesUIStyle.fileAppearance(node).tint,
                                    in: RoundedRectangle(cornerRadius: 2))
                        .padding(.bottom, size * 0.16)
                }
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

// The renderer observes only mounted, Owner-verified rows. Geometry is never
// persisted and never used as authorization for a directory or file mutation.
struct XDriveIOSNativeFilesRowFramesKey: PreferenceKey {
    static var defaultValue: [UInt64: CGRect] = [:]
    static func reduce(value: inout [UInt64: CGRect],
                       nextValue: () -> [UInt64: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

struct XDriveIOSNativeFilesViewportHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

struct XDriveIOSNativeFilesRowFrameReporter: ViewModifier {
    let nodeID: UInt64
    let spaceName: String
    func body(content: Content) -> some View {
        content.background(GeometryReader { geometry in
            Color.clear.preference(
                key: XDriveIOSNativeFilesRowFramesKey.self,
                value: [nodeID: geometry.frame(in: .named(spaceName))]
            )
        })
    }
}

/// Read-only, Owner-fenced metadata from an already verified list snapshot.
/// This view never requests file contents or performs a second mutation.
struct XDriveIOSNativeFilesQuickInfoPanel: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let expectedOwner: XDriveNativeOwnerRoot
    let node: XDriveIOSNativeFilesNode
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            List {
                if XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner) {
                    Section {
                        HStack(spacing: 12) {
                            Image(systemName: XDriveIOSNativeFilesUIStyle.fileAppearance(node).symbol)
                                .font(.title2)
                                .foregroundStyle(XDriveIOSNativeFilesUIStyle.fileAppearance(node).tint)
                                .frame(width: 44, height: 44)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(node.name).font(.headline).lineLimit(3)
                                XDriveIOSNativeFilesUIStyle.typeBadge(node)
                            }
                        }
                    }
                    Section("属性") {
                        LabeledContent("名称", value: node.name)
                        LabeledContent("类型", value: XDriveIOSNativeFilesUIStyle.fileAppearance(node).label)
                        if !node.isDirectory {
                            LabeledContent("大小", value: ByteCountFormatter.string(
                                fromByteCount: node.size, countStyle: .file))
                        }
                        LabeledContent("版本", value: String(node.revision))
                        if let created = node.createdDate {
                            LabeledContent("创建", value: XDriveIOSNativeFilesDatePolicy.display(created))
                        }
                        if let updated = node.modifiedDate {
                            LabeledContent("修改", value: XDriveIOSNativeFilesDatePolicy.display(updated))
                        }
                    }
                    Section {
                        Text("属性来自已核验的文件列表；任何写入仍会重新检查账户与文件版本。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                } else {
                    Text("账户已变化，请关闭后重新打开文件属性。")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("属性")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成", action: onClose)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .accessibilityIdentifier("native-ios-files-quick-info-sheet")
    }
}

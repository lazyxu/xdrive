import Combine
import Photos
import SwiftUI
import UIKit

/// Only the continuous PhotoKit wall uses this 1:1 thumbnail.
/// Legacy album/map/photo Viewer dimensions are intentionally unchanged.
private struct XDriveIOSNativeSquarePhotoTile: View {
    let candidate: XDrivePhotoKitScanCandidate
    @StateObject private var loader = XDriveIOSPhotoImageLoader()

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            GeometryReader { geometry in
                Group {
                    if let image = loader.image {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFill()
                    } else {
                        Rectangle()
                            .fill(Color(uiColor: .secondarySystemGroupedBackground))
                            .overlay {
                                Image(systemName: "photo").foregroundStyle(.secondary)
                            }
                    }
                }
                .frame(width: geometry.size.width, height: geometry.size.height)
                .clipped()
            }
            if candidate.kind == "video" || candidate.isLive {
                Image(systemName: candidate.kind == "video" ? "play.circle.fill" : "livephoto")
                    .font(.title3)
                    .foregroundStyle(.white)
                    .padding(5)
                    .shadow(radius: 2)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 3))
        .task(id: candidate.id) {
            // Only visible cells request local PhotoKit derivatives; never
            // fetch iCloud originals when zooming the thumbnail grid.
            loader.load(candidate.id, size: CGSize(width: 420, height: 420))
        }
        .onDisappear { loader.cancel() }
        .accessibilityLabel(candidate.isLive ? "实况照片" :
            candidate.kind == "video" ? "视频" : "照片")
    }
}

/// Metadata-only virtual page. The existing permission/change-fenced PhotoKit
/// scanner is the single source of truth; this screen never touches backup cursors.
private struct XDriveIOSNativeVirtualPhotoPage: View {
    let offset: Int
    let expectedTotal: Int
    let generation: UUID
    let mediaFilter: XDriveIOSNativePhotoMediaFilter
    let density: XDriveIOSNativePhotoWallDensity
    let selectionMode: Bool
    let selectedIDs: Set<String>
    let onSelect: (XDrivePhotoKitScanCandidate, XDrivePhotoKitScanPage) -> Void
    let onShare: (XDrivePhotoKitScanCandidate, Bool) -> Void
    let onRead: (XDrivePhotoKitScanPage) -> Void
    let onFailure: () -> Void
    @State private var page: XDrivePhotoKitScanPage?
    @State private var precedingCapturedAt: Date?
    @State private var scanner: XDriveIOSNativeGalleryMediaScanner?


    private var placeholderTile: some View {
        RoundedRectangle(cornerRadius: 3)
            .fill(Color(uiColor: .secondarySystemGroupedBackground))
            .aspectRatio(1, contentMode: .fit)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            if let page {
                let daySections = XDriveIOSNativePhotoDayGroupingPolicy.sections(
                    dates: page.items.map(\.capturedAt),
                    previousCapturedAt: precedingCapturedAt,
                    hasPreviousPage: offset > 0, calendar: .current
                )
                HStack {
                    Text("当前照片页")
                    Spacer(minLength: 4)
                    Text("\(page.startOffset + 1)–\(page.nextOffset) / \(page.totalAccessibleAssets)")
                        .monospacedDigit()
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                ForEach(daySections) { section in
                    if !section.continuesPreviousPage {
                        Text(section.title)
                            .font(.headline)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.top, 4)
                            .accessibilityAddTraits(.isHeader)
                    }
                    LazyVGrid(columns: [GridItem(.adaptive(
                        minimum: density.minimumCellWidth,
                        maximum: density.maximumCellWidth
                    ), spacing: 2)], spacing: 2) {
                        ForEach(page.items[section.startIndex..<section.endIndex]) { candidate in
                        if candidate.kind != "unsupported" {
                            Button { onSelect(candidate, page) } label: {
                                ZStack(alignment: .topTrailing) {
                                    XDriveIOSNativeSquarePhotoTile(candidate: candidate)
                                    if selectionMode {
                                        Image(systemName: selectedIDs.contains(candidate.id)
                                            ? "checkmark.circle.fill" : "circle")
                                            .font(.title2)
                                            .symbolRenderingMode(.palette)
                                            .foregroundStyle(.white, Color.accentColor)
                                            .padding(6)
                                    }
                                }
                            }
                            .accessibilityLabel(
                                selectionMode
                                    ? (selectedIDs.contains(candidate.id) ? "已选择照片" : "选择照片")
                                    : (candidate.kind == "video" ? "播放视频" : "查看照片")
                            )
                            .buttonStyle(.plain)
                            .contextMenu {
                                Button("分享本机原件") { onShare(candidate, false) }
                                Button("从 iCloud 下载原件并分享") {
                                    onShare(candidate, true)
                                }
                            }
                            .id("photo:\(candidate.id)")
                        } else {
                            placeholderTile.accessibilityHidden(true)
                        }
                    }
                    }
                }
            } else {
                HStack {
                    Text("正在读取第 \(offset / 64 + 1) 组照片…")
                    Spacer()
                    ProgressView()
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                // Match the number of real grid cells before PhotoKit finishes.
                // A one-row spinner would shift the entire scroll offset later.
                LazyVGrid(columns: [GridItem(.adaptive(
                        minimum: density.minimumCellWidth,
                        maximum: density.maximumCellWidth
                    ), spacing: 2)], spacing: 2) {
                    ForEach(0..<min(64, expectedTotal - offset), id: \.self) { _ in
                        placeholderTile.accessibilityHidden(true)
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .id("page:\(offset)")
        .task(id: "\(generation)-\(offset)-\(mediaFilter.rawValue)") {
            page = nil
            precedingCapturedAt = nil
            let reader = XDriveIOSNativeGalleryMediaScanner()
            scanner = reader
            do {
                let count = try await reader.start(atOffset: offset, mediaFilter: mediaFilter)
                let loaded = try await reader.nextPage()
                var preceding: Date?
                if offset > 0 {
                    preceding = try await reader.precedingCaptureDate(beforeOffset: offset)
                }
                try Task.checkCancellation()
                guard count == expectedTotal,
                      loaded.startOffset == offset,
                      loaded.totalAccessibleAssets == expectedTotal else {
                    await reader.reset()
                    scanner = nil
                    onFailure()
                    return
                }
                precedingCapturedAt = preceding
                page = loaded
                onRead(loaded)
            } catch is CancellationError {
            } catch {
                if !Task.isCancelled { onFailure() }
            }
            await reader.reset()
            if !Task.isCancelled { scanner = nil }
        }
        .onDisappear {
            page = nil
            precedingCapturedAt = nil
            if let scanner { Task { await scanner.reset() } }
            scanner = nil
        }
    }
}

private final class XDriveIOSNativeVirtualWallChangeMonitor: NSObject, PHPhotoLibraryChangeObserver {
    private let changed: () -> Void
    private var registered = false
    init(changed: @escaping () -> Void) { self.changed = changed }
    func start() {
        guard !registered else { return }
        PHPhotoLibrary.shared().register(self)
        registered = true
    }
    func stop() {
        guard registered else { return }
        PHPhotoLibrary.shared().unregisterChangeObserver(self)
        registered = false
    }
    func photoLibraryDidChange(_ change: PHChange) {
        DispatchQueue.main.async { [changed] in changed() }
    }
    deinit { stop() }
}

private struct XDriveIOSNativeVirtualViewerSelection: Identifiable {
    let candidate: XDrivePhotoKitScanCandidate
    let page: XDrivePhotoKitScanPage
    var id: String { candidate.id }
}

/// Continuous PhotoKit scroll, without loading all PhotoKit identifiers into
/// Swift. LazyVStack mounts at most the visible 64-slot page views; each page
/// uses the existing scanner and releases IDs/thumbnail loaders on disappearance.
struct XDriveIOSNativeLocalContinuousGalleryScreen: View {
    @Binding var savedOffset: Int
    @Binding var mediaFilter: XDriveIOSNativePhotoMediaFilter
    @Environment(\.scenePhase) private var phase
    @State private var total = 0
    @State private var density: XDriveIOSNativePhotoWallDensity = .standard
    @State private var permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    @State private var loading = false
    @State private var failure: String?
    @State private var generation = UUID()
    @State private var scanTask: Task<Void, Never>?
    @State private var monitor: XDriveIOSNativeVirtualWallChangeMonitor?
    @State private var selected: XDriveIOSNativeVirtualViewerSelection?
    @State private var returnID: String?
    @State private var returnDate: Date?
    @State private var returnModified: Date?
    @State private var returnPageOffset: Int?
    @State private var requestedOffset: Int?
    @State private var selectionMode = false
    @State private var selectedCandidates: [String: XDrivePhotoKitScanCandidate] = [:]
    @State private var confirmingDelete = false
    @State private var actionBusy = false
    @State private var actionToken = UUID()
    @State private var actionMessage: String?
    @State private var shareTask: Task<Void, Never>?
    @State private var shareEpoch = UUID()
    @State private var shareBusy = false
    @State private var shareSession: XDriveIOSNativeLocalPhotoShareSession?
    @State private var retainedShare: XDriveIOSNativeLocalPhotoShareSession?
    @State private var shareMessage: String?

    var body: some View {
        ScrollViewReader { scroll in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if permission == .notDetermined {
                        Button("允许查看本机相册") {
                            Task {
                                _ = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
                                permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                                if authorized { reload() }
                            }
                        }
                        .buttonStyle(.borderedProminent).padding(12)
                    } else if !authorized {
                        Label("相册权限不可用，请在 iOS 设置中允许访问。", systemImage: "lock")
                        if let settings = URL(string: UIApplication.openSettingsURLString) {
                            Link("打开 iOS 设置", destination: settings)
                        }
                    } else {
                        HStack(spacing: 10) {
                            Text("本机已授权\(mediaFilter.title) · 按日分组")
                                .font(.subheadline).foregroundStyle(.secondary)
                            Spacer(minLength: 6)
                            Menu {
                                ForEach(XDriveIOSNativePhotoWallDensity.allCases) { option in
                                    Button {
                                        density = option
                                    } label: {
                                        Label(option.title, systemImage: density == option
                                              ? "checkmark.circle.fill" : "square.grid.3x3")
                                    }
                                }
                            } label: {
                                Image(systemName: "square.grid.3x3")
                                    .frame(width: 44, height: 44)
                            }
                            .accessibilityLabel("缩略图大小：\(density.title)")
                            .accessibilityIdentifier("native-ios-local-wall-density")
                            Button(selectionMode ? "取消选择" : "选择") {
                                selectionMode.toggle()
                                selectedCandidates.removeAll()
                                actionMessage = nil
                            }
                            .disabled(actionBusy)
                            .accessibilityIdentifier("native-ios-photos-local-select-mode")
                        }
                        .padding(.horizontal, 12)
                        Picker("媒体类型", selection: $mediaFilter) {
                            ForEach(XDriveIOSNativePhotoMediaFilter.allCases) { option in
                                Text(option.title).tag(option)
                            }
                        }
                        .pickerStyle(.segmented)
                        .padding(.horizontal, 12)
                        .accessibilityIdentifier("native-ios-local-gallery-media-filter")
                        if selectionMode {
                            HStack(spacing: 10) {
                                Text("已选择 \(selectedCandidates.count) 项（上限 \(XDriveIOSNativePhotoSelectionPolicy.maximumItems)）")
                                    .font(.caption).monospacedDigit()
                                Spacer(minLength: 4)
                                Menu("操作") {
                                    Button("分享选中原件") {
                                        prepareShare(Array(selectedCandidates.values),
                                                     allowICloudDownload: false)
                                    }
                                    .disabled(selectedCandidates.count >
                                        XDriveIOSNativeLocalPhotoSharePolicy.maximumItems)
                                    Button("从 iCloud 下载后分享") {
                                        prepareShare(Array(selectedCandidates.values),
                                                     allowICloudDownload: true)
                                    }
                                    .disabled(selectedCandidates.count >
                                        XDriveIOSNativeLocalPhotoSharePolicy.maximumItems)
                                    Button("收藏选中") { updateFavorites(true) }
                                    Button("取消收藏") { updateFavorites(false) }
                                    Button("删除选中", role: .destructive) {
                                        confirmingDelete = true
                                    }
                                }
                                .disabled(selectedCandidates.isEmpty || actionBusy)
                                .accessibilityIdentifier("native-ios-photos-local-selected-actions")
                            }
                            .padding(.horizontal, 12)
                        }
                        if selectedCandidates.count >
                            XDriveIOSNativeLocalPhotoSharePolicy.maximumItems {
                            Text("批量分享最多 8 项；收藏与删除支持最多 128 项。")
                                .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 12)
                        }
                        if shareBusy {
                            ProgressView("正在准备本机原件…").padding(.horizontal, 12)
                        }
                        if let shareMessage {
                            Text(shareMessage).font(.caption)
                                .foregroundStyle(.secondary).padding(.horizontal, 12)
                        }
                        if actionBusy { ProgressView("正在更新系统照片库…").padding(.horizontal, 12) }
                        if let actionMessage {
                            Text(actionMessage).font(.caption)
                                .foregroundStyle(.secondary).padding(.horizontal, 12)
                        }
                        if total > 0 {
                            ForEach(0..<XDriveIOSNativePhotoVirtualPagePolicy.pageCount(total: total), id: \.self) { number in
                                let offset = number * 64
                                XDriveIOSNativeVirtualPhotoPage(
                                    offset: offset, expectedTotal: total, generation: generation,
                                    mediaFilter: mediaFilter, density: density,
                                    selectionMode: selectionMode,
                                    selectedIDs: Set(selectedCandidates.keys),
                                    onSelect: { asset, page in
                                        if selectionMode { toggleSelection(asset) }
                                        else { openViewer(asset, in: page) }
                                    },
                                    onShare: { candidate, allowICloud in
                                        prepareShare([candidate],
                                                     allowICloudDownload: allowICloud)
                                    },
                                    onRead: { page in
                                        if let expected = returnID, returnPageOffset == page.startOffset,
                                           let candidate = page.items.first(where: {
                                               $0.id == expected && $0.capturedAt == returnDate &&
                                               $0.modifiedAt == returnModified
                                           }) {
                                            DispatchQueue.main.async {
                                                guard phase == .active, returnID == expected else { return }
                                                scroll.scrollTo("photo:\(candidate.id)", anchor: .center)
                                                clearReturn()
                                            }
                                        }
                                    },
                                    onFailure: { invalidate(with: "照片库已变化，旧页面已废弃，请重新读取。") }
                                )
                                .onAppear { savedOffset = offset }
                            }
                        } else if loading {
                            ProgressView("正在读取已授权图库…")
                                .frame(maxWidth: .infinity).padding()
                        } else if failure == nil {
                            Text(mediaFilter == .videos ? "当前已授权图库中没有视频。" :
                                 mediaFilter == .photos ? "当前已授权图库中没有照片。" :
                                 mediaFilter == .favorites ? "当前已授权图库中没有收藏照片。" :
                                 "当前已授权图库中没有可浏览的照片或视频。")
                                .foregroundStyle(.secondary).padding(12)
                        }
                        if let failure {
                            Text(failure).foregroundStyle(.secondary).padding(.horizontal, 12)
                            Button("重新读取") { reload() }.buttonStyle(.bordered).padding(12)
                        }
                    }
                }
                .padding(.vertical, 8)
            }
            .simultaneousGesture(
                MagnificationGesture(minimumScaleDelta: 0.14).onEnded { value in
                    guard authorized, phase == .active, selected == nil,
                          !actionBusy && !shareBusy else { return }
                    density = density.applyingPinch(value)
                }
            )
            .onChange(of: total) { count in
                guard count > 0, phase == .active else { return }
                let start = XDriveIOSNativePhotoVirtualPagePolicy.normalizedAnchor(
                    requested: returnPageOffset ?? requestedOffset ?? savedOffset, total: count
                )
                DispatchQueue.main.async {
                    guard phase == .active else { return }
                    scroll.scrollTo("page:\(start)", anchor: .top)
                    requestedOffset = nil
                }
            }
        }
        .navigationTitle("本机照片")
        .sheet(item: $shareSession, onDismiss: {
            retainedShare?.discard()
            retainedShare = nil
        }) { session in
            XDriveIOSNativeLocalPhotoActivitySheet(fileURLs: session.fileURLs)
        }
        .confirmationDialog(
            "确定删除选中的 \(selectedCandidates.count) 项系统照片吗？",
            isPresented: $confirmingDelete, titleVisibility: .visible
        ) {
            Button("删除选中照片", role: .destructive) { deleteSelection() }
            Button("取消", role: .cancel) {}
        } message: {
            Text("系统照片会按 iOS 的照片删除规则处理；xDrive 云端备份不会在这里删除。")
        }
        .fullScreenCover(item: $selected, onDismiss: restoreAfterViewer) { current in
            XDriveIOSNativeLocalPhotoDetail(
                candidate: current.candidate,
                loadedItems: current.page.items.filter { $0.kind != "unsupported" },
                onViewed: { next in
                    returnID = next.id
                    returnDate = next.capturedAt
                    returnModified = next.modifiedAt
                },
                loadedPage: current.page,
                onCrossPage: { page, anchor, direction in
                    guard phase == .active, authorized else {
                        throw XDrivePhotoKitScanFailure.notAuthorized
                    }
                    let currentFilter = mediaFilter
                    let reader = XDriveIOSNativeGalleryMediaScanner()
                    do {
                        let count = try await reader.start(
                            atOffset: page.startOffset, mediaFilter: currentFilter
                        )
                        guard count == page.totalAccessibleAssets else {
                            throw XDrivePhotoKitScanFailure.snapshotChanged
                        }
                        let next = try await reader.adjacentPage(
                            from: page, anchoredAt: anchor, direction: direction
                        )
                        await reader.reset()
                        guard phase == .active, authorized,
                              mediaFilter == currentFilter else {
                            throw XDrivePhotoKitScanFailure.snapshotChanged
                        }
                        return next
                    } catch {
                        await reader.reset()
                        throw error
                    }
                },
                onCrossedPage: { next, page in
                    returnPageOffset = page.startOffset
                    savedOffset = page.startOffset
                    returnID = next.id
                    returnDate = next.capturedAt
                    returnModified = next.modifiedAt
                }
            )
        }
        .onAppear {
            permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
            if monitor == nil {
                let observer = XDriveIOSNativeVirtualWallChangeMonitor {
                    permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                    if selected == nil && authorized && phase == .active { reload() }
                    else { invalidate(with: nil) }
                }
                observer.start()
                monitor = observer
            }
            if authorized && selected == nil && !loading && total == 0 { reload() }
        }
        .onChange(of: mediaFilter) { _ in
            guard phase == .active else { return }
            selectionMode = false
            selectedCandidates.removeAll()
            actionMessage = nil
            clearReturn()
            savedOffset = 0
            reload()
        }
        .onChange(of: phase) { value in
            permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
            if value != .active {
                cancelSharePreparation()
                invalidate(with: nil)
            }
            else if selected == nil && authorized { reload() }
        }
        .onDisappear {
            cancelSharePreparation()
            actionToken = UUID()
            actionBusy = false
            selectedCandidates.removeAll()
            selectionMode = false
            invalidate(with: nil)
            monitor?.stop()
            monitor = nil
        }
    }

    private var authorized: Bool { permission == .authorized || permission == .limited }

    private func toggleSelection(_ candidate: XDrivePhotoKitScanCandidate) {
        guard selectionMode, authorized, !actionBusy, phase == .active else { return }
        if selectedCandidates.removeValue(forKey: candidate.id) != nil { return }
        guard XDriveIOSNativePhotoSelectionPolicy.canAdd(
            selectedCount: selectedCandidates.count,
            identifier: candidate.id,
            alreadySelected: false
        ) else {
            actionMessage = "最多选择 \(XDriveIOSNativePhotoSelectionPolicy.maximumItems) 项。"
            return
        }
        selectedCandidates[candidate.id] = candidate
    }

    private func prepareShare(
        _ candidates: [XDrivePhotoKitScanCandidate],
        allowICloudDownload: Bool
    ) {
        guard authorized, phase == .active, !actionBusy, !shareBusy,
              shareSession == nil else { return }
        guard !candidates.isEmpty,
              candidates.count <= XDriveIOSNativeLocalPhotoSharePolicy.maximumItems else {
            shareMessage = "一次最多分享 8 项原件；可分批选择。"
            return
        }
        cancelSharePreparation()
        let epoch = shareEpoch
        shareBusy = true
        shareMessage = nil
        // Deterministic order for multi-file Share Sheet destinations.
        let ordered = candidates.sorted { $0.id < $1.id }
        shareTask = Task { @MainActor in
            do {
                let prepared = try await XDriveIOSNativeLocalOriginalSharer.prepare(
                    ordered, allowICloudDownload: allowICloudDownload
                )
                guard !Task.isCancelled, shareEpoch == epoch,
                      phase == .active, authorized else {
                    prepared.discard()
                    return
                }
                retainedShare = prepared
                shareSession = prepared
                if prepared.containsLivePair {
                    shareMessage = "Live Photo 作为静态原件和 MOV 动态视频分享；目标 App 不一定自动还原实况配对。"
                }
            } catch is CancellationError {
            } catch {
                if shareEpoch == epoch {
                    shareMessage = allowICloudDownload
                        ? "无法准备原件，请检查 iCloud 网络、照片访问权限与可用空间。"
                        : "无法读取本机原件；如照片仅在 iCloud，请明确选择“从 iCloud 下载原件并分享”。"
                }
            }
            if shareEpoch == epoch {
                shareBusy = false
                shareTask = nil
            }
        }
    }

    private func cancelSharePreparation() {
        shareEpoch = UUID()
        shareTask?.cancel()
        shareTask = nil
        shareBusy = false
    }

    private func updateFavorites(_ value: Bool) {
        runSelectionAction(delete: false, favorite: value)
    }

    private func deleteSelection() {
        runSelectionAction(delete: true, favorite: nil)
    }

    private func runSelectionAction(delete: Bool, favorite: Bool?) {
        guard authorized, phase == .active, !actionBusy,
              !selectedCandidates.isEmpty else { return }
        let batch = Array(selectedCandidates.values)
        let token = UUID()
        actionToken = token
        actionBusy = true
        actionMessage = nil
        Task { @MainActor in
            do {
                if delete {
                    try await XDriveIOSNativeLocalPhotoSelectionActions.delete(batch)
                } else if let favorite {
                    try await XDriveIOSNativeLocalPhotoSelectionActions.setFavorite(batch, to: favorite)
                }
                guard actionToken == token else { return }
                actionBusy = false
                selectionMode = false
                selectedCandidates.removeAll()
                reload()
                actionMessage = delete ? "照片删除操作已完成。" :
                    (favorite == true ? "已收藏选中照片。" : "已取消选中照片的收藏。")
            } catch is CancellationError {
                guard actionToken == token else { return }
                actionBusy = false
                selectedCandidates.removeAll()
                actionMessage = "照片操作已取消，请重新选择。"
            } catch {
                guard actionToken == token else { return }
                actionBusy = false
                selectedCandidates.removeAll()
                actionMessage = "系统照片操作未完成，可能是授权或照片已变化；请重新选择。"
            }
        }
    }

    private func openViewer(_ candidate: XDrivePhotoKitScanCandidate, in page: XDrivePhotoKitScanPage) {
        guard authorized, phase == .active, selected == nil,
              let asset = PHAsset.fetchAssets(
                withLocalIdentifiers: [candidate.id], options: nil
              ).firstObject,
              asset.creationDate == candidate.capturedAt,
              asset.modificationDate == candidate.modifiedAt,
              ((candidate.kind == "image" && asset.mediaType == .image &&
                candidate.isLive == asset.mediaSubtypes.contains(.photoLive)) ||
               (candidate.kind == "video" && asset.mediaType == .video)) else {
            invalidate(with: "这张照片已经变化，请重新读取。")
            return
        }
        // The detail view revalidates ID, type and timestamps before any pixels.
        returnID = candidate.id
        returnDate = candidate.capturedAt
        returnModified = candidate.modifiedAt
        returnPageOffset = page.startOffset
        selected = XDriveIOSNativeVirtualViewerSelection(candidate: candidate, page: page)
    }

    private func restoreAfterViewer() {
        if phase == .active && authorized { reload() }
        else { clearReturn(); invalidate(with: nil) }
    }

    private func clearReturn() {
        returnID = nil
        returnDate = nil
        returnModified = nil
        returnPageOffset = nil
    }

    private func reload() {
        requestedOffset = returnPageOffset ?? savedOffset
        invalidate(with: nil)
        guard authorized, phase == .active else { return }
        let epoch = generation
        loading = true
        scanTask = Task { @MainActor in
            let reader = XDriveIOSNativeGalleryMediaScanner()
            do {
                let count = try await reader.start(atOffset: 0, mediaFilter: mediaFilter)
                try Task.checkCancellation()
                guard epoch == generation, phase == .active else {
                    await reader.reset()
                    return
                }
                total = count
            } catch is CancellationError {
            } catch {
                if epoch == generation { failure = "照片库发生变化，请重新读取。" }
            }
            await reader.reset()
            if epoch == generation { loading = false; scanTask = nil }
        }
    }

    private func invalidate(with message: String?) {
        cancelSharePreparation()
        selectedCandidates.removeAll()
        confirmingDelete = false
        generation = UUID()
        scanTask?.cancel()
        scanTask = nil
        total = 0
        loading = false
        failure = message
    }
}

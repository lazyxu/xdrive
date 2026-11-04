import Combine
import Foundation
import Photos
import SwiftUI
import UIKit

struct XDriveIOSNativePhotoMetadataSearchPage {
    let items: [XDrivePhotoKitScanCandidate]
    let startSlot: Int
    let nextSlot: Int
    let totalAuthorizedSlots: Int
    var hasMore: Bool { nextSlot < totalAuthorizedSlots }
}

private final class XDriveIOSPhotoSearchSnapshotObserver: NSObject, PHPhotoLibraryChangeObserver {
    private let lock = NSLock()
    private var value: UInt64 = 0
    func generation() -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
    func photoLibraryDidChange(_ changeInstance: PHChange) {
        lock.lock()
        value &+= 1
        lock.unlock()
    }
}

/// Search-result order is strictly capture date, not "date added".
/// This presentation mode changes the PhotoKit fetch cursor itself.
enum XDriveIOSNativePhotoSearchSortOrder: String, CaseIterable, Identifiable {
    case newest, oldest

    var id: String { rawValue }
    var title: String {
        switch self {
        case .newest: return "最新拍摄在前"
        case .oldest: return "最早拍摄在前"
        }
    }
    var ascending: Bool { self == .oldest }
}

private enum XDriveIOSNativePhotoSearchFailure: Error {
    case invalidQuery
    case notAuthorized
    case changed
    case invalidOffset
}

/// Scan at most 2,048 metadata slots per bounded read, returning no
/// more than 64 matches. Never download original pixels or iCloud resources.
private actor XDriveIOSNativePhotoMetadataSearchReader {
    static let maximumScanned = 2048
    static let maximumMatches = 64

    func read(query: String, startingAt requested: Int,
              sortOrder: XDriveIOSNativePhotoSearchSortOrder = .newest) async throws
        -> XDriveIOSNativePhotoMetadataSearchPage {
        guard let term = XDriveIOSNativePhotoSearchQueryPolicy.normalized(query) else {
            throw XDriveIOSNativePhotoSearchFailure.invalidQuery
        }
        let permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard permission == .authorized || permission == .limited else {
            throw XDriveIOSNativePhotoSearchFailure.notAuthorized
        }
        let observer = XDriveIOSPhotoSearchSnapshotObserver()
        PHPhotoLibrary.shared().register(observer)
        defer { PHPhotoLibrary.shared().unregisterChangeObserver(observer) }
        let revision = observer.generation()

        let options = PHFetchOptions()
        options.sortDescriptors = [
            NSSortDescriptor(key: "creationDate", ascending: sortOrder.ascending),
            NSSortDescriptor(key: "modificationDate", ascending: sortOrder.ascending)
        ]
        let assets = PHAsset.fetchAssets(with: options)
        guard requested >= 0 && requested <= assets.count else {
            throw XDriveIOSNativePhotoSearchFailure.invalidOffset
        }
        let limit = min(assets.count, requested + Self.maximumScanned)
        var matches: [XDrivePhotoKitScanCandidate] = []
        matches.reserveCapacity(Self.maximumMatches)
        var nextSlot = requested
        for slot in requested..<limit {
            if slot % 64 == 0 {
                try Task.checkCancellation()
                guard observer.generation() == revision,
                      PHPhotoLibrary.authorizationStatus(for: .readWrite) == permission
                else { throw XDriveIOSNativePhotoSearchFailure.changed }
                await Task.yield()
            }
            let asset = assets.object(at: slot)
            nextSlot = slot + 1
            let kind: String
            switch asset.mediaType {
            case .image: kind = "image"
            case .video: kind = "video"
            default: continue
            }
            let isLive = kind == "image" && asset.mediaSubtypes.contains(.photoLive)
            let isScreenshot = kind == "image" &&
                asset.mediaSubtypes.contains(.photoScreenshot)
            let category = XDriveIOSNativePhotoSearchQueryPolicy.matchesKind(
                kind, live: isLive, screenshot: isScreenshot, query: term
            )
            let dated = XDriveIOSNativePhotoSearchQueryPolicy.matchesDate(
                asset.creationDate, query: term
            )
            let fileNamed = !category && !dated &&
                PHAssetResource.assetResources(for: asset).contains {
                    $0.originalFilename.localizedStandardContains(term)
                }
            if category || dated || fileNamed {
                matches.append(XDrivePhotoKitScanCandidate(
                    id: asset.localIdentifier, kind: kind, isLive: isLive,
                    capturedAt: asset.creationDate, modifiedAt: asset.modificationDate
                ))
                if matches.count == Self.maximumMatches { break }
            }
        }
        try Task.checkCancellation()
        guard observer.generation() == revision,
              PHPhotoLibrary.authorizationStatus(for: .readWrite) == permission
        else { throw XDriveIOSNativePhotoSearchFailure.changed }
        return XDriveIOSNativePhotoMetadataSearchPage(
            items: matches, startSlot: requested, nextSlot: nextSlot,
            totalAuthorizedSlots: assets.count
        )
    }
}

/// Numeric descriptors, not a growing array of PhotoKit identifiers.
private struct XDriveIOSNativePhotoSearchWindow: Identifiable, Equatable {
    let startSlot: Int
    let nextSlot: Int
    let totalAuthorizedSlots: Int
    let matchCount: Int
    var id: Int { startSlot }
}

@MainActor
private final class XDriveIOSNativePhotoMetadataSearchModel: ObservableObject {
    @Published private(set) var windows: [XDriveIOSNativePhotoSearchWindow] = []
    @Published private(set) var currentQuery: String?
    @Published private(set) var currentSortOrder: XDriveIOSNativePhotoSearchSortOrder = .newest
    @Published private(set) var scannedThrough = 0
    @Published private(set) var totalAuthorizedSlots: Int?
    @Published private(set) var matchCount = 0
    @Published private(set) var generation = UUID()
    @Published private(set) var busy = false
    @Published private(set) var message: String?
    private var task: Task<Void, Never>?

    var hasMore: Bool {
        guard currentQuery != nil else { return false }
        return totalAuthorizedSlots.map { scannedThrough < $0 } ?? true
    }

    func cancel() {
        generation = UUID()
        task?.cancel()
        task = nil
        windows = []
        currentQuery = nil
        scannedThrough = 0
        totalAuthorizedSlots = nil
        matchCount = 0
        busy = false
        message = nil
    }

    func invalidate() {
        cancel()
        message = "系统照片库或访问权限已变化，请重新搜索。"
    }

    func search(_ query: String,
                sortOrder: XDriveIOSNativePhotoSearchSortOrder = .newest) {
        cancel()
        guard let term = XDriveIOSNativePhotoSearchQueryPolicy.normalized(query) else {
            message = "请输入文件名、年份、月份或媒体类型（照片、视频、实况、截屏）。"
            return
        }
        currentSortOrder = sortOrder
        currentQuery = term
        scanMore()
    }

    /// Called by a newly visible tail, never by a separate Next Page button.
    /// A run skips empty matches automatically but stops after its first
    /// nonempty 64-match window. All historical ranges retain only four ints.
    func scanMore(after visibleWindowID: Int? = nil) {
        guard !busy, let term = currentQuery,
              UIApplication.shared.applicationState == .active else { return }
        if let visibleWindowID {
            guard windows.last?.id == visibleWindowID else { return }
        }
        if let total = totalAuthorizedSlots, scannedThrough >= total { return }

        let request = generation
        let order = currentSortOrder
        var offset = scannedThrough
        var expectedTotal = totalAuthorizedSlots
        busy = true
        task = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                while true {
                    let page = try await XDriveIOSNativePhotoMetadataSearchReader()
                        .read(query: term, startingAt: offset, sortOrder: order)
                    try Task.checkCancellation()
                    guard self.generation == request,
                          self.currentQuery == term,
                          self.currentSortOrder == order,
                          UIApplication.shared.applicationState == .active else { return }
                    // An insertion/deletion or permission-scope change between
                    // bounded reads must retire all previously displayed hits.
                    guard page.startSlot == offset,
                          page.nextSlot > offset || offset == page.totalAuthorizedSlots,
                          page.nextSlot <= page.totalAuthorizedSlots,
                          expectedTotal == nil || expectedTotal == page.totalAuthorizedSlots,
                          page.items.count <= XDriveIOSNativePhotoMetadataSearchReader.maximumMatches
                    else { self.invalidate(); return }

                    expectedTotal = page.totalAuthorizedSlots
                    self.totalAuthorizedSlots = page.totalAuthorizedSlots
                    self.scannedThrough = page.nextSlot
                    if !page.items.isEmpty {
                        self.windows.append(XDriveIOSNativePhotoSearchWindow(
                            startSlot: page.startSlot,
                            nextSlot: page.nextSlot,
                            totalAuthorizedSlots: page.totalAuthorizedSlots,
                            matchCount: page.items.count
                        ))
                        self.matchCount += page.items.count
                    }
                    offset = page.nextSlot
                    if !page.hasMore || !page.items.isEmpty { break }
                    // A query with no matches must not require fifty manual
                    // taps to scan a 100k-item library.
                    await Task.yield()
                }
            } catch is CancellationError {
            } catch {
                if self.generation == request { self.invalidate() }
            }
            if self.generation == request {
                self.busy = false
                self.task = nil
            }
        }
    }
}

private final class XDriveIOSNativePhotoSearchChangeMonitor: NSObject,
    ObservableObject, PHPhotoLibraryChangeObserver {
    @Published private(set) var revision = 0
    private var registered = false
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
    func photoLibraryDidChange(_ changeInstance: PHChange) {
        DispatchQueue.main.async { [weak self] in self?.revision &+= 1 }
    }
    deinit { stop() }
}

private struct XDriveIOSNativePhotoSearchTile: View {
    let candidate: XDrivePhotoKitScanCandidate
    let framing: XDriveIOSNativePhotoWallFraming
    @StateObject private var loader = XDriveIOSPhotoImageLoader()

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            GeometryReader { geometry in
                Group {
                    if let image = loader.image {
                        if framing == .complete {
                            Image(uiImage: image).resizable().scaledToFit()
                        } else {
                            Image(uiImage: image).resizable().scaledToFill()
                        }
                    } else {
                        Rectangle().fill(Color(uiColor: .secondarySystemGroupedBackground))
                            .overlay {
                                Image(systemName: "photo").foregroundStyle(.secondary)
                            }
                    }
                }
                .frame(width: geometry.size.width, height: geometry.size.height)
                .background(Color(uiColor: .secondarySystemGroupedBackground))
                .clipped()
            }
            if candidate.kind == "video" || candidate.isLive {
                Image(systemName: candidate.kind == "video" ?
                      "play.circle.fill" : "livephoto")
                    .foregroundStyle(.white).padding(5).shadow(radius: 2)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 3))
        .task(id: "\(candidate.id)-\(framing.rawValue)") {
            loader.load(
                candidate.id, size: CGSize(width: 420, height: 420),
                contentMode: framing == .complete ? .aspectFit : .aspectFill
            )
        }
        .onDisappear { loader.cancel() }
    }
}

/// One visible result range. It reads the same PhotoKit metadata cursor
/// again and verifies its numeric descriptor, then releases IDs when offscreen.
private struct XDriveIOSNativePhotoSearchWindowView: View {
    let window: XDriveIOSNativePhotoSearchWindow
    let query: String
    let sortOrder: XDriveIOSNativePhotoSearchSortOrder
    let framing: XDriveIOSNativePhotoWallFraming
    let generation: UUID
    let onSelect: (XDrivePhotoKitScanCandidate, [XDrivePhotoKitScanCandidate]) -> Void
    let onFailure: (UUID) -> Void
    let onVisibility: (Int, Bool) -> Void

    @State private var page: XDriveIOSNativePhotoMetadataSearchPage?

    var body: some View {
        LazyVGrid(columns: [
            GridItem(.adaptive(minimum: 95, maximum: 150), spacing: 3)
        ], spacing: 3) {
            if let page {
                ForEach(page.items) { item in
                    Button {
                        onSelect(item, page.items)
                    } label: {
                        XDriveIOSNativePhotoSearchTile(candidate: item, framing: framing)
                    }
                    .buttonStyle(.plain)
                    .id("search:\(item.id)")
                    .accessibilityLabel(item.kind == "video" ?
                                        "查看匹配视频" : "查看匹配照片")
                    .accessibilityIdentifier("native-ios-photo-search-result")
                }
            } else {
                // Exactly the same number of square cells retains the scroll
                // geometry while a visible descriptor is revalidated.
                ForEach(0..<window.matchCount, id: \.self) { _ in
                    Rectangle()
                        .fill(Color(uiColor: .secondarySystemGroupedBackground))
                        .aspectRatio(1, contentMode: .fit)
                        .accessibilityHidden(true)
                }
            }
        }
        .id("search-window:\(window.id)")
        .onAppear { onVisibility(window.id, true) }
        .task(id: "\(generation)-\(window.startSlot)-\(query)-\(sortOrder.rawValue)") {
            page = nil
            do {
                let fresh = try await XDriveIOSNativePhotoMetadataSearchReader()
                    .read(query: query, startingAt: window.startSlot, sortOrder: sortOrder)
                try Task.checkCancellation()
                guard fresh.startSlot == window.startSlot,
                      fresh.nextSlot == window.nextSlot,
                      fresh.totalAuthorizedSlots == window.totalAuthorizedSlots,
                      fresh.items.count == window.matchCount,
                      [.authorized, .limited].contains(
                        PHPhotoLibrary.authorizationStatus(for: .readWrite)
                      ) else {
                    onFailure(generation)
                    return
                }
                page = fresh
            } catch is CancellationError {
            } catch {
                if !Task.isCancelled { onFailure(generation) }
            }
        }
        .onDisappear {
            page = nil
            onVisibility(window.id, false)
        }
    }
}

private struct XDriveIOSNativePhotoSearchSelection: Identifiable {
    let candidate: XDrivePhotoKitScanCandidate
    let loadedItems: [XDrivePhotoKitScanCandidate]
    var id: String { candidate.id }
}

/// Photos-like continuous search results over the authorized local library.
/// Numeric descriptors are cheap even for 100k assets; only visible matched
/// pages hold ephemeral IDs and request PhotoKit thumbnails.
struct XDriveIOSNativePhotoSearchScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @StateObject private var model = XDriveIOSNativePhotoMetadataSearchModel()
    @StateObject private var monitor = XDriveIOSNativePhotoSearchChangeMonitor()
    @State private var query = ""
    @State private var acceptedQuery = ""
    @State private var sortOrder: XDriveIOSNativePhotoSearchSortOrder = .newest
    @State private var framing: XDriveIOSNativePhotoWallFraming = .square
    @State private var selected: XDriveIOSNativePhotoSearchSelection?
    @State private var visibleTailWindowID: Int?

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 8) {
                        TextField("原始文件名、2026-11、视频、实况…", text: $query)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .textFieldStyle(.roundedBorder)
                            .onSubmit { submitNew() }
                            .accessibilityIdentifier("native-ios-photo-search-input")
                        Button("搜索") { submitNew() }
                            .disabled(model.busy || query.trimmingCharacters(
                                in: .whitespacesAndNewlines).isEmpty)
                            .accessibilityIdentifier("native-ios-photo-search-submit")
                    }
                    Text("搜索当前已授权的本机照片元数据：原始文件名、拍摄日期及媒体类型。不是人物、内容识别或云端搜索。")
                        .font(.caption).foregroundStyle(.secondary)
                    HStack {
                        Text("结果顺序")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Spacer(minLength: 8)
                        Picker("按拍摄时间排序", selection: $sortOrder) {
                            ForEach(XDriveIOSNativePhotoSearchSortOrder.allCases) { order in
                                Text(order.title).tag(order)
                            }
                        }
                        .pickerStyle(.menu)
                        .accessibilityIdentifier("native-ios-photo-search-capture-order")
                    }
                    HStack {
                        Text("图片显示")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Spacer(minLength: 8)
                        Picker("预览构图", selection: $framing) {
                            ForEach(XDriveIOSNativePhotoWallFraming.allCases) { mode in
                                Text(mode.title).tag(mode)
                            }
                        }
                        .pickerStyle(.menu)
                        .accessibilityIdentifier("native-ios-photo-search-framing")
                    }

                    if let total = model.totalAuthorizedSlots {
                        Text("已检查 \(model.scannedThrough) / \(total) 项，当前找到 \(model.matchCount) 项")
                            .font(.caption).monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                    if let message = model.message {
                        Text(message).font(.footnote).foregroundStyle(.secondary)
                    }
                    if let currentQuery = model.currentQuery {
                        ForEach(model.windows) { window in
                            XDriveIOSNativePhotoSearchWindowView(
                                window: window, query: currentQuery,
                                sortOrder: sortOrder, framing: framing,
                                generation: model.generation,
                                onSelect: { candidate, neighbors in
                                    selected = XDriveIOSNativePhotoSearchSelection(
                                        candidate: candidate, loadedItems: neighbors
                                    )
                                },
                                onFailure: { failedGeneration in
                                    guard model.generation == failedGeneration else { return }
                                    model.invalidate()
                                },
                                onVisibility: { visibleID, isVisible in
                                    if isVisible {
                                        if model.windows.last?.id == visibleID {
                                            visibleTailWindowID = visibleID
                                            if selected == nil && phase == .active {
                                                model.scanMore(after: visibleID)
                                            }
                                        }
                                    } else if visibleTailWindowID == visibleID {
                                        visibleTailWindowID = nil
                                    }
                                }
                            )
                        }
                        if model.busy {
                            ProgressView("正在继续搜索本机照片…")
                                .frame(maxWidth: .infinity)
                        } else if !model.hasMore {
                            if model.windows.isEmpty {
                                Text("已检查完当前授权照片，没有找到匹配项。")
                                    .foregroundStyle(.secondary)
                            } else {
                                Label("当前授权照片已全部检查", systemImage: "checkmark.circle")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .padding(12)
            }
            .navigationTitle("搜索本机照片")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .fullScreenCover(item: $selected) { first in
            XDriveIOSNativeLocalPhotoDetail(
                candidate: first.candidate, loadedItems: first.loadedItems
            )
        }
        .onAppear { monitor.start() }
        .onChange(of: sortOrder) { _ in
            // A new PhotoKit sort order changes numeric slot identity.
            // Never reuse the old windows or a previously selected Viewer item.
            visibleTailWindowID = nil
            guard selected == nil, phase == .active,
                  XDriveIOSNativePhotoSearchQueryPolicy.normalized(query) ==
                    acceptedQuery else {
                model.cancel()
                return
            }
            model.search(acceptedQuery, sortOrder: sortOrder)
        }
        .onChange(of: query) { _ in
            if XDriveIOSNativePhotoSearchQueryPolicy.normalized(query) !=
                acceptedQuery {
                visibleTailWindowID = nil
                model.cancel()
            }
        }
        .onChange(of: model.busy) { busy in
            // A visible last window may have appeared while its next scan was
            // still busy. Resume exactly once on completion, not via a button.
            if !busy, selected == nil, phase == .active,
               let visibleTailWindowID {
                model.scanMore(after: visibleTailWindowID)
            }
        }
        .onChange(of: monitor.revision) { _ in
            visibleTailWindowID = nil
            model.invalidate()
        }
        .onChange(of: phase) { state in
            if state != .active {
                visibleTailWindowID = nil
                model.cancel()
            }
        }
        .onDisappear {
            if selected == nil {
                monitor.stop()
                visibleTailWindowID = nil
                model.cancel()
            }
        }
    }

    private func submitNew() {
        guard phase == .active,
              let normalized = XDriveIOSNativePhotoSearchQueryPolicy.normalized(query)
        else { model.search(query, sortOrder: sortOrder); return }
        acceptedQuery = normalized
        visibleTailWindowID = nil
        model.search(normalized, sortOrder: sortOrder)
    }
}

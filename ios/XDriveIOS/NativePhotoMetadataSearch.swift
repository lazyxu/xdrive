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

private enum XDriveIOSNativePhotoSearchFailure: Error {
    case invalidQuery
    case notAuthorized
    case changed
    case invalidOffset
}

/// Scan at most 2,048 metadata slots per explicit user action, returning no
/// more than 64 matches. Never download original pixels or iCloud resources.
private actor XDriveIOSNativePhotoMetadataSearchReader {
    static let maximumScanned = 2048
    static let maximumMatches = 64

    func read(query: String, startingAt requested: Int) async throws
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
            NSSortDescriptor(key: "creationDate", ascending: false),
            NSSortDescriptor(key: "modificationDate", ascending: false)
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

@MainActor
private final class XDriveIOSNativePhotoMetadataSearchModel: ObservableObject {
    @Published private(set) var page: XDriveIOSNativePhotoMetadataSearchPage?
    @Published private(set) var busy = false
    @Published private(set) var message: String?
    private var epoch = UUID()
    private var task: Task<Void, Never>?

    func cancel() {
        epoch = UUID()
        task?.cancel()
        task = nil
        page = nil
        busy = false
        message = nil
    }

    func invalidate() {
        cancel()
        message = "系统照片库或访问权限已变化，请重新搜索。"
    }

    func search(_ query: String, from offset: Int) {
        cancel()
        guard let term = XDriveIOSNativePhotoSearchQueryPolicy.normalized(query) else {
            message = "请输入文件名、年份、月份或媒体类型（照片、视频、实况、截屏）。"
            return
        }
        let request = epoch
        busy = true
        task = Task { @MainActor [weak self] in
            do {
                let result = try await XDriveIOSNativePhotoMetadataSearchReader()
                    .read(query: term, startingAt: offset)
                try Task.checkCancellation()
                guard self?.epoch == request,
                      UIApplication.shared.applicationState == .active else { return }
                self?.page = result
            } catch is CancellationError {
            } catch {
                if self?.epoch == request {
                    self?.message = "搜索期间照片库或授权已变化，请重新搜索。"
                }
            }
            if self?.epoch == request {
                self?.busy = false
                self?.task = nil
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
    @StateObject private var loader = XDriveIOSPhotoImageLoader()

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            GeometryReader { geometry in
                Group {
                    if let image = loader.image {
                        Image(uiImage: image).resizable().scaledToFill()
                    } else {
                        Rectangle().fill(Color(uiColor: .secondarySystemGroupedBackground))
                            .overlay {
                                Image(systemName: "photo").foregroundStyle(.secondary)
                            }
                    }
                }
                .frame(width: geometry.size.width, height: geometry.size.height)
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
        .task(id: candidate.id) {
            loader.load(candidate.id, size: CGSize(width: 420, height: 420))
        }
        .onDisappear { loader.cancel() }
    }
}

/// A real local PhotoKit search with explicit bounded continuation. The
/// result count is per examined segment, never misrepresented as all hits.
struct XDriveIOSNativePhotoSearchScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @StateObject private var model = XDriveIOSNativePhotoMetadataSearchModel()
    @StateObject private var monitor = XDriveIOSNativePhotoSearchChangeMonitor()
    @State private var query = ""
    @State private var acceptedQuery = ""
    @State private var selected: XDrivePhotoKitScanCandidate?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
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
                    if model.busy { ProgressView("正在搜索本机照片元数据…") }
                    if let message = model.message {
                        Text(message).font(.footnote).foregroundStyle(.secondary)
                    }
                    if let page = model.page {
                        Text("本批扫描 \(page.nextSlot - page.startSlot) 项，匹配 \(page.items.count) 项；已检查到第 \(page.nextSlot) / \(page.totalAuthorizedSlots) 项。")
                            .font(.caption).monospacedDigit()
                        if page.items.isEmpty {
                            Text(page.hasMore ?
                                 "本批没有匹配结果，可继续扫描后续照片。" :
                                 "已检查完当前授权照片，没有找到匹配项。")
                                .foregroundStyle(.secondary)
                        } else {
                            LazyVGrid(columns: [
                                GridItem(.adaptive(minimum: 95, maximum: 150), spacing: 3)
                            ], spacing: 3) {
                                ForEach(page.items) { item in
                                    Button { selected = item } label: {
                                        XDriveIOSNativePhotoSearchTile(candidate: item)
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel(item.kind == "video" ?
                                                        "查看匹配视频" : "查看匹配照片")
                                    .accessibilityIdentifier("native-ios-photo-search-result")
                                }
                            }
                        }
                        if page.hasMore {
                            Button("继续搜索后续照片") {
                                guard XDriveIOSNativePhotoSearchQueryPolicy.normalized(
                                    query
                                ) == acceptedQuery else { return }
                                model.search(acceptedQuery, from: page.nextSlot)
                            }
                            .disabled(model.busy)
                            .accessibilityIdentifier("native-ios-photo-search-more")
                        } else {
                            Label("当前授权照片已全部检查", systemImage: "checkmark.circle")
                                .font(.caption).foregroundStyle(.secondary)
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
                candidate: first, loadedItems: model.page?.items ?? []
            )
        }
        .onAppear { monitor.start() }
        .onChange(of: query) { _ in
            if XDriveIOSNativePhotoSearchQueryPolicy.normalized(query) !=
                acceptedQuery { model.cancel() }
        }
        .onChange(of: monitor.revision) { _ in
            if selected == nil { model.invalidate() }
        }
        .onChange(of: phase) { state in
            if state != .active { model.cancel() }
        }
        .onDisappear {
            if selected == nil {
                monitor.stop()
                model.cancel()
            }
        }
    }

    private func submitNew() {
        guard phase == .active,
              let normalized = XDriveIOSNativePhotoSearchQueryPolicy.normalized(query)
        else { model.search(query, from: 0); return }
        acceptedQuery = normalized
        model.search(normalized, from: 0)
    }
}

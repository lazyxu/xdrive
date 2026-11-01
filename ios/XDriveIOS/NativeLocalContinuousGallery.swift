import Combine
import Photos
import SwiftUI
import UIKit

/// Metadata-only virtual page. The existing permission/change-fenced PhotoKit
/// scanner is the single source of truth; this screen never touches backup cursors.
private struct XDriveIOSNativeVirtualPhotoPage: View {
    let offset: Int
    let expectedTotal: Int
    let generation: UUID
    let onSelect: (XDrivePhotoKitScanCandidate, XDrivePhotoKitScanPage) -> Void
    let onRead: (XDrivePhotoKitScanPage) -> Void
    let onFailure: () -> Void
    @State private var page: XDrivePhotoKitScanPage?
    @State private var scanner: XDrivePhotoKitBoundedSnapshotScanner?


    private var placeholderTile: some View {
        RoundedRectangle(cornerRadius: 7)
            .fill(Color(uiColor: .secondarySystemGroupedBackground))
            .frame(height: 108)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            if let page {
                let first = page.items.first(where: { $0.kind != "unsupported" })
                HStack {
                    if let date = first?.capturedAt {
                        Text("起始日期：\(date.formatted(date: .abbreviated, time: .omitted))")
                            .lineLimit(1)
                    }
                    Spacer(minLength: 4)
                    Text("\(page.startOffset + 1)–\(page.nextOffset) / \(page.totalAccessibleAssets)")
                        .monospacedDigit()
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 95, maximum: 150), spacing: 3)], spacing: 3) {
                    ForEach(page.items) { candidate in
                        if candidate.kind != "unsupported" {
                            Button { onSelect(candidate, page) } label: {
                                XDriveIOSLocalPhotoTile(candidate: candidate)
                            }
                            .buttonStyle(.plain)
                            .id("photo:\(candidate.id)")
                        } else {
                            placeholderTile.accessibilityHidden(true)
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
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 95, maximum: 150), spacing: 3)], spacing: 3) {
                    ForEach(offset..<min(offset + 64, expectedTotal), id: \.self) { _ in
                        placeholderTile.accessibilityHidden(true)
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .id("page:\(offset)")
        .task(id: "\(generation)-\(offset)") {
            page = nil
            let reader = XDrivePhotoKitBoundedSnapshotScanner()
            scanner = reader
            do {
                let count = try await reader.start(atOffset: offset)
                let loaded = try await reader.nextPage()
                try Task.checkCancellation()
                guard count == expectedTotal,
                      loaded.startOffset == offset,
                      loaded.totalAccessibleAssets == expectedTotal else {
                    await reader.reset()
                    scanner = nil
                    onFailure()
                    return
                }
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
    @Environment(\.scenePhase) private var phase
    @State private var total = 0
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
                        Text("本机已授权照片 · 连续滚动")
                            .font(.subheadline).foregroundStyle(.secondary).padding(.horizontal, 12)
                        if total > 0 {
                            ForEach(0..<XDriveIOSNativePhotoVirtualPagePolicy.pageCount(total: total), id: \.self) { number in
                                let offset = number * 64
                                XDriveIOSNativeVirtualPhotoPage(
                                    offset: offset, expectedTotal: total, generation: generation,
                                    onSelect: { asset, page in openViewer(asset, in: page) },
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
                            Text("当前授权的相册没有可浏览的照片。")
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
        .fullScreenCover(item: $selected, onDismiss: restoreAfterViewer) { current in
            XDriveIOSNativeLocalPhotoDetail(
                candidate: current.candidate,
                loadedItems: current.page.items.filter { $0.kind != "unsupported" },
                onViewed: { next in
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
        .onChange(of: phase) { value in
            permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
            if value != .active { invalidate(with: nil) }
            else if selected == nil && authorized { reload() }
        }
        .onDisappear {
            invalidate(with: nil)
            monitor?.stop()
            monitor = nil
        }
    }

    private var authorized: Bool { permission == .authorized || permission == .limited }

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
            let reader = XDrivePhotoKitBoundedSnapshotScanner()
            do {
                let count = try await reader.start(atOffset: 0)
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
        generation = UUID()
        scanTask?.cancel()
        scanTask = nil
        total = 0
        loading = false
        failure = message
    }
}

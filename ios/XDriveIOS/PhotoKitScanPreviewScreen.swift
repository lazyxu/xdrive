import Photos
import SwiftUI
import UIKit

/// A bounded, read-only metadata window. Only visible 64-slot ranges retain
/// transient identifiers; scrolling never grows a library-sized Swift array.
private struct XDriveIOSNativeScanPreviewWindow: View {
    let offset: Int
    let expectedTotal: Int
    let generation: UUID
    let onFailure: (UUID) -> Void

    @State private var page: XDrivePhotoKitScanPage?
    @State private var scanner: XDrivePhotoKitBoundedSnapshotScanner?

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 0) {
            if let page {
                ForEach(page.items) { item in
                    HStack(spacing: 12) {
                        Image(systemName: item.kind == "video" ? "video" :
                              item.kind == "image" ? "photo" : "questionmark.square")
                            .frame(width: 26)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(item.isLive ? "Live Photo" :
                                 item.kind == "video" ? "视频" :
                                 item.kind == "image" ? "照片" : "其他媒体")
                            Text(item.capturedAt?.formatted(
                                date: .abbreviated, time: .shortened
                            ) ?? "拍摄日期未知")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                    }
                    .frame(minHeight: 58)
                    .accessibilityElement(children: .combine)
                    Divider()
                }
            } else {
                // Preserve approximate height while this visible range loads.
                ForEach(0..<min(XDrivePhotoKitBoundedSnapshotScanner.pageSize,
                                 max(0, expectedTotal - offset)), id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Color(uiColor: .tertiarySystemFill))
                        .frame(height: 58)
                        .accessibilityHidden(true)
                    Divider()
                }
            }
        }
        .id("scan-window:\(offset)")
        .task(id: "\(generation)-\(offset)") {
            page = nil
            let current = XDrivePhotoKitBoundedSnapshotScanner()
            scanner = current
            do {
                let count = try await current.start(atOffset: offset)
                let next = try await current.nextPage()
                try Task.checkCancellation()
                guard count == expectedTotal,
                      next.totalAccessibleAssets == expectedTotal,
                      next.startOffset == offset,
                      next.nextOffset == min(expectedTotal,
                                             offset + XDrivePhotoKitBoundedSnapshotScanner.pageSize),
                      next.items.count == next.nextOffset - offset else {
                    await current.reset()
                    if !Task.isCancelled { onFailure(generation) }
                    return
                }
                page = next
            } catch is CancellationError {
            } catch {
                if !Task.isCancelled { onFailure(generation) }
            }
            await current.reset()
            if !Task.isCancelled { scanner = nil }
        }
        .onDisappear {
            page = nil
            if let scanner { Task { await scanner.reset() } }
            scanner = nil
        }
    }
}

/// Revokes all visible PhotoKit metadata when the library or its Limited
/// selection changes; each range independently revalidates on the next read.
private final class XDriveIOSNativeScanPreviewChangeMonitor:
    NSObject, PHPhotoLibraryChangeObserver {
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

/// Diagnostic metadata view: no manual pagination, thumbnails, GPS reads,
/// network downloads, upload actions or persistent PhotoKit identifiers.
/// Virtual windows use the existing bounded scanner, not a second PhotoKit
/// ordering or a backup cursor.
struct XDrivePhotoKitScanPreviewScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    @State private var total: Int?
    @State private var scanTask: Task<Void, Never>?
    @State private var generation = UUID()
    @State private var monitor: XDriveIOSNativeScanPreviewChangeMonitor?
    @State private var busy = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    Label("授权范围内的照片候选", systemImage: "photo.stack")
                        .font(.headline)
                    Text("连续滚动浏览当前授权的媒体元数据。只按需读取屏幕附近的最多 64 项，不下载缩略图或原件、不读取 GPS、不上传，也不记录备份进度。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    if permission == .limited {
                        Label("仅包含已授权的 iOS 照片子集",
                              systemImage: "lock.shield")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else if permission != .authorized {
                        Text("相册访问不可用，请先在 iOS 设置中授权。")
                            .foregroundStyle(.secondary)
                        if let settings = URL(string: UIApplication.openSettingsURLString) {
                            Link("打开 iOS 设置", destination: settings)
                        }
                    }
                    if let total {
                        Text(total == 0 ? "当前没有可访问的照片或视频。" :
                             "共 \(total) 项 · 连续滚动")
                            .font(.subheadline.weight(.medium))
                            .monospacedDigit()
                        if total > 0 {
                            ForEach(0..<XDriveIOSNativePhotoVirtualPagePolicy.pageCount(
                                total: total
                            ), id: \.self) { number in
                                let offset = number * XDrivePhotoKitBoundedSnapshotScanner.pageSize
                                XDriveIOSNativeScanPreviewWindow(
                                    offset: offset, expectedTotal: total,
                                    generation: generation,
                                    onFailure: { staleGeneration in
                                        guard generation == staleGeneration,
                                              scenePhase == .active else { return }
                                        invalidate()
                                        errorMessage = "照片库或访问权限已变化，已清除旧的元数据；请重新扫描。"
                                    }
                                )
                            }
                        }
                    }
                    if busy { ProgressView("正在检查已授权的照片数量…") }
                    if let errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    Button("重新扫描") { begin() }
                        .buttonStyle(.bordered)
                        .disabled(busy || (permission != .authorized && permission != .limited))
                        .accessibilityIdentifier("native-photokit-scan-restart")
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .navigationTitle("相册元数据")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .onAppear {
            if monitor == nil {
                let observer = XDriveIOSNativeScanPreviewChangeMonitor {
                    invalidate()
                    errorMessage = "照片库已更新，请重新扫描。"
                }
                observer.start()
                monitor = observer
            }
            if scenePhase == .active { begin() }
        }
        .onChange(of: scenePhase) { phase in
            if phase != .active { invalidate() }
            else { begin() }
        }
        .onDisappear {
            invalidate()
            monitor?.stop()
            monitor = nil
        }
    }

    private func begin() {
        invalidate()
        permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard permission == .authorized || permission == .limited,
              scenePhase == .active else { return }
        let token = generation
        busy = true
        scanTask = Task { @MainActor in
            let reader = XDrivePhotoKitBoundedSnapshotScanner()
            do {
                let count = try await reader.start()
                try Task.checkCancellation()
                if generation == token, scenePhase == .active {
                    total = count
                }
            } catch is CancellationError {
            } catch {
                if generation == token {
                    errorMessage = "无法读取当前授权范围内的照片数量，请重新检查授权。"
                }
            }
            await reader.reset()
            if generation == token { busy = false; scanTask = nil }
        }
    }

    private func invalidate() {
        generation = UUID()
        scanTask?.cancel()
        scanTask = nil
        total = nil
        busy = false
        errorMessage = nil
    }
}

import Photos
import SwiftUI

/// Separate, user-opened read-only scan preview. This UI shows one bounded
/// metadata page at a time and never sends PhotoKit IDs to xDrive Server.
struct XDrivePhotoKitScanPreviewScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    @State private var scanner: XDrivePhotoKitBoundedSnapshotScanner?
    @State private var latest: XDrivePhotoKitScanPage?
    @State private var scanTask: Task<Void, Never>?
    @State private var generation = UUID()
    @State private var busy = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Label("授权范围内的照片候选", systemImage: "photo.stack")
                        .font(.headline)
                    Text("每次最多读取 64 项的本机元数据，不下载图片、不读取 GPS、不上传、不记录同步完成状态。系统相册或授权发生变化时，旧位置立即失效，必须重新扫描。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)

                    if let page = latest {
                        Text("已检查位置 \(page.nextOffset) / \(page.totalAccessibleAssets)")
                            .font(.subheadline.weight(.medium))
                            .monospacedDigit()
                        if page.limitedAuthorization {
                            Label("仅包含已授权的 iOS 照片子集", systemImage: "lock.shield")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        if page.items.isEmpty {
                            Text("本页没有可识别的图片或视频。")
                                .foregroundStyle(.secondary)
                        }
                        ForEach(page.items) { candidate in
                            HStack(spacing: 12) {
                                Image(systemName: candidate.kind == "video" ? "video" : "photo")
                                    .frame(width: 24)
                                    .accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(candidate.isLive
                                        ? "Live Photo"
                                        : candidate.kind == "video" ? "视频" : "照片")
                                    if let date = candidate.capturedAt {
                                        Text(date.formatted(date: .abbreviated, time: .shortened))
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                Spacer()
                            }
                            Divider()
                        }
                        if page.finished {
                            Label("当前快照已全部检查；未执行上传或备份", systemImage: "checkmark.circle")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        } else {
                            Button("继续检查下一批（最多 64 项）") { nextPage() }
                                .buttonStyle(.borderedProminent)
                                .disabled(busy)
                                .accessibilityIdentifier("native-photokit-scan-next")
                        }
                    }
                    if busy {
                        ProgressView("读取本机相册候选元数据…")
                    }
                    if let errorMessage {
                        Text(errorMessage)
                            .foregroundStyle(.secondary)
                            .font(.footnote)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Button("从头重新扫描") { begin() }
                        .buttonStyle(.bordered)
                        .disabled(busy)
                        .accessibilityIdentifier("native-photokit-scan-restart")
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .navigationTitle("相册有界扫描")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .task { begin() }
        .onChange(of: scenePhase) { phase in
            if phase != .active { invalidate() }
        }
        .onDisappear { invalidate() }
    }

    private func begin() {
        invalidate()
        let scanner = XDrivePhotoKitBoundedSnapshotScanner()
        self.scanner = scanner
        let token = generation
        busy = true
        scanTask = Task { @MainActor in
            do {
                _ = try await scanner.start()
                let first = try await scanner.nextPage()
                try Task.checkCancellation()
                guard generation == token else { return }
                latest = first
            } catch is CancellationError {
                // Closing the sheet must never expose a stale private page.
            } catch {
                guard generation == token else { return }
                latest = nil
                errorMessage = "相册授权或照片库已变化，当前扫描位置不可复用；请重新授权或从头开始。"
            }
            if generation == token { busy = false }
        }
    }

    private func nextPage() {
        guard let scanner, let latest, !latest.finished, !busy else { return }
        let token = generation
        busy = true
        scanTask = Task { @MainActor in
            do {
                let next = try await scanner.nextPage()
                try Task.checkCancellation()
                guard generation == token else { return }
                latest = next
            } catch is CancellationError {
                // A cancelled page is never committed to the UI cursor.
            } catch {
                guard generation == token else { return }
                latest = nil
                errorMessage = "扫描期间照片库或访问权限发生变化，已废弃旧位置；请从头扫描。"
            }
            if generation == token { busy = false }
        }
    }

    private func invalidate() {
        generation = UUID()
        scanTask?.cancel()
        scanTask = nil
        if let scanner {
            Task { await scanner.reset() }
        }
        scanner = nil
        latest = nil
        errorMessage = nil
        busy = false
    }
}

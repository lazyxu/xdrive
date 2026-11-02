import Photos
import SwiftUI

/// Native destination chooser for already-selected, still-authorized PhotoKit
/// items. It reads 32 album summaries at a time and never persists asset IDs.
struct XDriveIOSNativeAlbumDestinationPicker: View {
    let candidates: [XDrivePhotoKitScanCandidate]
    let excludingCollectionID: String?
    let onAdded: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @State private var page: XDriveLocalPhotoAlbumPage?
    @State private var offset = 0
    @State private var busy = false
    @State private var writing = false
    @State private var message: String?
    @State private var epoch = UUID()
    @State private var readTask: Task<Void, Never>?
    @State private var writeTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("将已选择的 \(candidates.count) 张照片或视频添加到 iOS 用户相簿。不会删除原图，也不会上传到 xDrive。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if let page {
                    Section("用户相簿") {
                        ForEach(page.items.filter {
                            $0.kind == "用户相册" &&
                            $0.collectionIdentifier != excludingCollectionID
                        }) { album in
                            Button {
                                add(to: album)
                            } label: {
                                HStack {
                                    Image(systemName: "rectangle.stack")
                                    Text(album.name)
                                    Spacer()
                                    Text("\(album.accessibleAssetCount)")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                .frame(minHeight: 44)
                            }
                            .disabled(writing || candidates.isEmpty)
                            .accessibilityIdentifier("native-ios-album-destination")
                        }
                        if page.items.allSatisfy({
                            $0.kind != "用户相册" ||
                            $0.collectionIdentifier == excludingCollectionID
                        }) {
                            Text("本页没有可选的用户相簿。")
                                .foregroundStyle(.secondary)
                        }
                    }
                    HStack {
                        Button("上一页") {
                            load(at: max(0, page.offset - XDriveLocalPhotoAlbumPager.pageSize))
                        }
                        .disabled(busy || writing || !page.hasPrevious)
                        Spacer()
                        Text("\(page.offset + page.items.count) / \(page.total)")
                            .font(.caption).monospacedDigit()
                        Spacer()
                        Button("下一页") {
                            load(at: page.offset + page.items.count)
                        }
                        .disabled(busy || writing || !page.hasNext)
                    }
                }
                if busy { ProgressView("读取系统相簿…") }
                if writing { ProgressView("正在添加到系统相簿…") }
                if let message {
                    Text(message).foregroundStyle(.secondary)
                    if !writing {
                        Button("重新读取相簿") { load(at: offset) }
                    }
                }
            }
            .navigationTitle("添加到相簿")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") { dismiss() }
                        .disabled(writing)
                }
            }
        }
        .onAppear { if phase == .active { load(at: 0) } }
        .onChange(of: phase) { state in
            if state == .active && !writing { load(at: offset) }
            else if state != .active { stopRead() }
        }
        .onDisappear {
            stopRead()
            writeTask?.cancel()
            writeTask = nil
        }
    }

    private func stopRead() {
        epoch = UUID()
        readTask?.cancel()
        readTask = nil
        busy = false
        page = nil
    }

    private func load(at requested: Int) {
        guard !writing else { return }
        stopRead()
        offset = requested
        let ticket = epoch
        busy = true
        message = nil
        readTask = Task { @MainActor in
            do {
                let result = try await XDriveLocalPhotoAlbumPager.readPage(
                    offset: requested
                )
                try Task.checkCancellation()
                guard epoch == ticket, phase == .active else { return }
                page = result
                offset = result.offset
            } catch is CancellationError {
            } catch {
                if epoch == ticket { message = "系统相簿或访问权限已变化，请重试。" }
            }
            if epoch == ticket { busy = false; readTask = nil }
        }
    }

    private func add(to target: XDriveLocalPhotoAlbumSummary) {
        guard !writing, phase == .active,
              [.authorized, .limited].contains(
                PHPhotoLibrary.authorizationStatus(for: .readWrite)
              ), !candidates.isEmpty else { return }
        stopRead()
        writing = true
        message = nil
        writeTask = Task { @MainActor in
            do {
                try await XDriveIOSNativePhotoAlbumMutations.add(
                    candidates, to: target
                )
                guard !Task.isCancelled, phase == .active else { return }
                writing = false
                onAdded()
                dismiss()
            } catch is CancellationError {
            } catch {
                message = "无法加入相簿：成员、相簿或授权可能已变化。原图未删除，请刷新后重试。"
            }
            writing = false
            writeTask = nil
        }
    }
}

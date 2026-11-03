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
    @State private var busy = false
    // Key visibility by the page end offset: old tail disappearance must not
    // clear the newly mounted tail's visibility after an append.
    @State private var visibleTailOffset: Int?
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
                            Text(page.hasNext ? "正在继续查找可添加的相簿…" :
                                "没有可添加的用户相簿。")
                                .foregroundStyle(.secondary)
                        }
                    }
                    if page.hasNext && !writing {
                        let tailOffset = page.items.count
                        ProgressView("正在查找更多相簿…")
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .id("album-destination-tail:\(tailOffset)")
                            .onAppear {
                                // Each newly visible tail advances one 32-item
                                // PhotoKit directory segment; no page buttons.
                                visibleTailOffset = tailOffset
                                if !busy && message == nil { load(at: tailOffset) }
                            }
                            .onDisappear {
                                if visibleTailOffset == tailOffset {
                                    visibleTailOffset = nil
                                }
                            }
                    }
                }
                if busy { ProgressView("读取系统相簿…") }
                if writing { ProgressView("正在添加到系统相簿…") }
                if let message {
                    Text(message).foregroundStyle(.secondary)
                    if !writing {
                        Button("重新读取相簿") { load(at: 0) }
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
        .onChange(of: busy) { inProgress in
            // SwiftUI can mount the tail while its first page request is
            // still active. Once it finishes, do not require a second tap.
            guard !inProgress, message == nil,
                  let page, page.hasNext,
                  visibleTailOffset == page.items.count else { return }
            load(at: page.items.count)
        }
        .onChange(of: phase) { state in
            if state == .active && !writing { load(at: 0) }
            else if state != .active { stopRead() }
        }
        .onDisappear {
            stopRead()
            writeTask?.cancel()
            writeTask = nil
        }
    }

    private func stopRead() {
        visibleTailOffset = nil
        epoch = UUID()
        readTask?.cancel()
        readTask = nil
        busy = false
        page = nil
    }

    /// A virtual, append-only directory view: one verified PhotoKit page per
    /// visible tail. Photo originals and selected identifiers are never paged.
    private func load(at requested: Int) {
        guard !writing, !busy, phase == .active,
              requested >= 0,
              requested % XDriveLocalPhotoAlbumPager.pageSize == 0 else { return }
        if requested > 0 {
            guard let previous = page, previous.offset == 0,
                  previous.items.count == requested, previous.hasNext else { return }
        } else {
            stopRead()
        }
        let ticket = epoch
        busy = true
        message = nil
        readTask = Task { @MainActor in
            do {
                let result = try await XDriveLocalPhotoAlbumPager.readPage(offset: requested)
                try Task.checkCancellation()
                guard epoch == ticket, phase == .active,
                      [.authorized, .limited].contains(
                        PHPhotoLibrary.authorizationStatus(for: .readWrite)
                      ) else { return }
                if requested == 0 {
                    page = result
                } else {
                    // Never append stale, repeated, re-ordered or differently
                    // authorized PhotoKit collections to a former snapshot.
                    guard let previous = page, previous.offset == 0,
                          previous.items.count == requested,
                          previous.total == result.total,
                          previous.limitedAuthorization == result.limitedAuthorization,
                          !result.items.isEmpty,
                          Set(previous.items.map(\.collectionIdentifier)).isDisjoint(
                            with: Set(result.items.map(\.collectionIdentifier))
                          ) else {
                        stopRead()
                        message = "系统相簿目录或授权已变化，请重新读取。"
                        return
                    }
                    page = XDriveLocalPhotoAlbumPage(
                        items: previous.items + result.items,
                        offset: 0, total: result.total,
                        limitedAuthorization: result.limitedAuthorization
                    )
                }
            } catch is CancellationError {
            } catch {
                if epoch == ticket {
                    stopRead()
                    message = "系统相簿或访问权限已变化，请重新读取。"
                    return
                }
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

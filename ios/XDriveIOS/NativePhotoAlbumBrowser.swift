import Foundation
import Photos
import SwiftUI
import UIKit

import Combine

/// PhotoKit change callbacks may arrive off-main. The visible album wall
/// drops its page immediately instead of keeping a revoked/changed member.
private final class XDriveIOSNativeAlbumChangeMonitor: NSObject, ObservableObject,
    PHPhotoLibraryChangeObserver {
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
        DispatchQueue.main.async { [weak self] in
            self?.revision &+= 1
        }
    }

    deinit { stop() }
}

// Local PhotoKit collection IDs are transient, in-memory view identities.
// Never persist them, send them to xDrive Server, or use them as backup receipts.
private enum XDriveIOSAlbumReadFailure: Error {
    case unauthorized
    case changed
    case missing
}

private final class XDriveIOSAlbumLibraryObserver: NSObject, PHPhotoLibraryChangeObserver {
    private let lock = NSLock()
    private var version: UInt64 = 0

    func current() -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return version
    }

    func photoLibraryDidChange(_ changeInstance: PHChange) {
        lock.lock()
        version &+= 1
        lock.unlock()
    }
}

/// A dedicated read-only album cursor. Does not change the whole-library
/// scanner used by the encrypted original-upload ledger.
actor XDriveIOSNativeAlbumPageReader {
    private let observer = XDriveIOSAlbumLibraryObserver()
    private var registered = false
    private var snapshot: PHFetchResult<PHAsset>?
    private var permission: PHAuthorizationStatus?
    private var version: UInt64 = 0

    deinit {
        if registered {
            PHPhotoLibrary.shared().unregisterChangeObserver(observer)
        }
    }

    func open(_ album: XDriveLocalPhotoAlbumSummary) throws -> Int {
        reset()
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited else {
            throw XDriveIOSAlbumReadFailure.unauthorized
        }
        guard let collection = PHAssetCollection.fetchAssetCollections(
            withLocalIdentifiers: [album.collectionIdentifier], options: nil
        ).firstObject else {
            throw XDriveIOSAlbumReadFailure.missing
        }
        let name = collection.localizedTitle?.trimmingCharacters(in: .whitespacesAndNewlines)
        let currentName = name?.isEmpty == false ? name! : "未命名相册"
        let kind = collection.assetCollectionType == .album ? "用户相册" :
            collection.assetCollectionType == .smartAlbum ? "系统智能相册" : ""
        guard currentName == album.name, kind == album.kind else {
            throw XDriveIOSAlbumReadFailure.changed
        }

        PHPhotoLibrary.shared().register(observer)
        registered = true
        version = observer.current()
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        let result = PHAsset.fetchAssets(in: collection, options: options)
        guard observer.current() == version,
              PHPhotoLibrary.authorizationStatus(for: .readWrite) == status else {
            reset()
            throw XDriveIOSAlbumReadFailure.changed
        }
        snapshot = result
        permission = status
        return result.count
    }

    func page(offset: Int) throws -> XDrivePhotoKitScanPage {
        guard let result = snapshot, let permission else {
            throw XDriveIOSAlbumReadFailure.missing
        }
        try verify(permission)
        guard offset >= 0, offset <= result.count else {
            throw XDriveIOSAlbumReadFailure.changed
        }
        let end = min(result.count, offset + 64)
        var items: [XDrivePhotoKitScanCandidate] = []
        items.reserveCapacity(end - offset)
        if end > offset {
            for position in offset..<end {
                try Task.checkCancellation()
                let asset = result.object(at: position)
                let kind: String
                switch asset.mediaType {
                case .image: kind = "image"
                case .video: kind = "video"
                default: kind = "unsupported"
                }
                items.append(XDrivePhotoKitScanCandidate(
                    id: asset.localIdentifier,
                    kind: kind,
                    isLive: kind == "image" && asset.mediaSubtypes.contains(.photoLive),
                    capturedAt: asset.creationDate,
                    modifiedAt: asset.modificationDate
                ))
            }
        }
        try verify(permission)
        return XDrivePhotoKitScanPage(
            totalAccessibleAssets: result.count,
            startOffset: offset, nextOffset: end,
            limitedAuthorization: permission == .limited, items: items
        )
    }

    /// Admit exactly one neighbor album page from a newly verified PhotoKit
    /// snapshot. Validate EVERY slot of the previous 64-item page and the
    /// exact edge item; an insertion, edit or album membership change must not
    /// let an old Viewer index jump into a different media item.
    func adjacentPage(
        from current: XDrivePhotoKitScanPage,
        anchoredAt selected: XDrivePhotoKitScanCandidate,
        direction: Int
    ) throws -> XDrivePhotoKitScanPage? {
        guard let snapshot, let permission else {
            throw XDriveIOSAlbumReadFailure.missing
        }
        try verify(permission)
        try Task.checkCancellation()
        let total = snapshot.count
        guard total > 0, current.totalAccessibleAssets == total,
              current.limitedAuthorization == (permission == .limited),
              current.startOffset >= 0, current.startOffset < total,
              current.startOffset % 64 == 0,
              current.items.count == min(64, total - current.startOffset),
              current.nextOffset == current.startOffset + current.items.count,
              direction == -1 || direction == 1 else {
            throw XDriveIOSAlbumReadFailure.changed
        }
        let supported = current.items.filter {
            $0.kind == "image" || $0.kind == "video"
        }
        guard let edge = direction > 0 ? supported.last : supported.first,
              Self.sameCandidate(edge, selected) else {
            throw XDriveIOSAlbumReadFailure.changed
        }

        for (index, expected) in current.items.enumerated() {
            try Task.checkCancellation()
            let asset = snapshot.object(at: current.startOffset + index)
            let kind: String
            switch asset.mediaType {
            case .image: kind = "image"
            case .video: kind = "video"
            default: kind = "unsupported"
            }
            guard asset.localIdentifier == expected.id,
                  asset.creationDate == expected.capturedAt,
                  asset.modificationDate == expected.modifiedAt,
                  kind == expected.kind,
                  expected.isLive == (kind == "image" &&
                      asset.mediaSubtypes.contains(.photoLive))
            else { throw XDriveIOSAlbumReadFailure.changed }
        }
        try verify(permission)
        guard let offset = XDriveIOSNativePhotoVirtualPagePolicy.adjacentOffset(
            current: current.startOffset, total: total, direction: direction
        ) else { return nil }
        let neighbor = try page(offset: offset)
        // Do not silently skip an all-unsupported album page.
        return neighbor.items.contains {
            $0.kind == "image" || $0.kind == "video"
        } ? neighbor : nil
    }

    private static func sameCandidate(
        _ lhs: XDrivePhotoKitScanCandidate, _ rhs: XDrivePhotoKitScanCandidate
    ) -> Bool {
        lhs.id == rhs.id && lhs.kind == rhs.kind &&
        lhs.isLive == rhs.isLive && lhs.capturedAt == rhs.capturedAt &&
        lhs.modifiedAt == rhs.modifiedAt
    }

    func reset() {
        snapshot = nil
        permission = nil
        version = 0
        if registered {
            PHPhotoLibrary.shared().unregisterChangeObserver(observer)
            registered = false
        }
    }

    private func verify(_ status: PHAuthorizationStatus) throws {
        guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == status,
              observer.current() == version else {
            reset()
            throw XDriveIOSAlbumReadFailure.changed
        }
        try Task.checkCancellation()
    }
}

/// Visible album-cover cells request one locally available PhotoKit image.
/// Image requests are canceled when a cover leaves the viewport.
private struct XDriveIOSNativeAlbumCover: View {
    let album: XDriveLocalPhotoAlbumSummary
    @StateObject private var loader = XDriveIOSPhotoImageLoader()

    var body: some View {
        HStack(spacing: 12) {
            Group {
                if let image = loader.image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Rectangle().fill(Color(uiColor: .secondarySystemGroupedBackground))
                        .overlay { Image(systemName: "rectangle.stack").foregroundStyle(.secondary) }
                }
            }
            .frame(width: 74, height: 74)
            .clipped()
            .clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 5) {
                Text(album.name).font(.body.weight(.medium)).lineLimit(2)
                Text("\(album.accessibleAssetCount) 项 · \(album.kind)")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").foregroundStyle(.tertiary)
        }
        .contentShape(Rectangle())
        .task(id: album.collectionIdentifier) {
            guard [.authorized, .limited].contains(
                PHPhotoLibrary.authorizationStatus(for: .readWrite)
            ), let collection = PHAssetCollection.fetchAssetCollections(
                withLocalIdentifiers: [album.collectionIdentifier], options: nil
            ).firstObject else { return }
            if let asset = PHAsset.fetchAssets(in: collection, options: nil).firstObject {
                loader.load(asset.localIdentifier, size: CGSize(width: 220, height: 220))
            }
        }
        .onDisappear { loader.cancel() }
    }
}

/// Genuine album-specific, bounded native media wall with the existing
/// still/video/Live Viewer. No full album array, upload, or iCloud download.
struct XDriveIOSNativeAlbumContentsScreen: View {
    let album: XDriveLocalPhotoAlbumSummary
    @Environment(\.scenePhase) private var phase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showingAlbumHelp = false
    @StateObject private var libraryMonitor = XDriveIOSNativeAlbumChangeMonitor()
    @State private var reader: XDriveIOSNativeAlbumPageReader?
    @State private var page: XDrivePhotoKitScanPage?
    @State private var selected: XDrivePhotoKitScanCandidate?
    @State private var selectionMode = false
    @State private var selectedCandidates: [String: XDrivePhotoKitScanCandidate] = [:]
    @State private var confirmingAlbumDelete = false
    @State private var confirmingAlbumRemove = false
    @State private var showingDestinationPicker = false
    @State private var destinationCandidates: [XDrivePhotoKitScanCandidate] = []
    @State private var albumActionBusy = false
    @State private var albumActionTask: Task<Void, Never>?
    @State private var albumActionEpoch = UUID()
    @State private var albumActionMessage: String?
    @State private var albumShareBusy = false
    @State private var albumShareTask: Task<Void, Never>?
    @State private var albumShareEpoch = UUID()
    @State private var albumShareMessage: String?
    @State private var albumShareSession: XDriveIOSNativeLocalPhotoShareSession?
    @State private var retainedAlbumShare: XDriveIOSNativeLocalPhotoShareSession?
    // Only the one currently viewed verified page is retained in memory.
    // It may change when L3 crosses a 64-slot album boundary.
    @State private var viewerPage: XDrivePhotoKitScanPage?
    @State private var loading = false
    @State private var task: Task<Void, Never>?
    @State private var epoch = UUID()
    @State private var error: String?
    @State private var savedOffset = 0
    // Viewer return anchor stays in current SwiftUI view memory only.
    @State private var viewerReturnID: String?
    @State private var shouldRestoreViewerTile = false
    // VoiceOver focus is transient, like the in-memory Viewer tile anchor.
    // Never persist PhotoKit local identifiers in a route snapshot.
    @AccessibilityFocusState private var accessibilityFocusedTileID: String?
    @State private var pageRenderRevision: UInt64 = 0
    @State private var permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)

    var body: some View {
        GeometryReader { viewport in
        let compactGallery = viewport.size.width >= 680 &&
            viewport.size.height < 500 && !dynamicTypeSize.isAccessibilitySize
        ScrollViewReader { returnScroll in
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if permission == .limited {
                    Label("仅显示 iOS 已授权的部分照片", systemImage: "lock.shield")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let page {
                    HStack(spacing: 8) {
                        Text(page.totalAccessibleAssets == 0 ? "相簿内没有可访问的媒体。" :
                            "已显示 \(page.startOffset + 1)–\(page.nextOffset) / \(page.totalAccessibleAssets) 项")
                            .font(.caption).foregroundStyle(.secondary)
                        Spacer(minLength: 4)
                        Button(selectionMode ? "取消选择" : "选择") {
                            selectionMode.toggle()
                            selectedCandidates.removeAll()
                            albumActionMessage = nil
                            albumShareMessage = nil
                        }
                        .disabled(loading || albumActionBusy || albumShareBusy)
                        .accessibilityIdentifier("native-ios-album-select-mode")
                    }
                    if selectionMode {
                        HStack(spacing: 8) {
                            Text("本页已选择 \(selectedCandidates.count) 项")
                                .font(.caption).monospacedDigit()
                            Spacer(minLength: 4)
                            Menu("操作") {
                                Button("分享选中原件") {
                                    prepareAlbumShare(allowICloud: false)
                                }
                                .disabled(selectedCandidates.count >
                                    XDriveIOSNativeLocalPhotoSharePolicy.maximumItems)
                                Button("从 iCloud 下载后分享") {
                                    prepareAlbumShare(allowICloud: true)
                                }
                                .disabled(selectedCandidates.count >
                                    XDriveIOSNativeLocalPhotoSharePolicy.maximumItems)
                                Button("收藏选中") { runAlbumAction(favorite: true) }
                                Button("取消收藏") { runAlbumAction(favorite: false) }
                                Button("添加到其他相簿") {
                                    destinationCandidates = selectedCandidates.values.sorted {
                                        $0.id < $1.id
                                    }
                                    showingDestinationPicker = true
                                }
                                Button("从此相簿移除") {
                                    confirmingAlbumRemove = true
                                }
                                .disabled(album.kind != "用户相册")
                                Button("删除选中", role: .destructive) {
                                    confirmingAlbumDelete = true
                                }
                            }
                            .disabled(selectedCandidates.isEmpty ||
                                albumActionBusy || albumShareBusy)
                            .accessibilityIdentifier("native-ios-album-selected-actions")
                        }
                        if selectedCandidates.count >
                            XDriveIOSNativeLocalPhotoSharePolicy.maximumItems {
                            Text("一次最多分享 8 项原件；收藏和删除仅限当前页。")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    if albumShareBusy { ProgressView("准备相簿原件…") }
                    if albumActionBusy { ProgressView("正在更新系统照片库…") }
                    if let albumShareMessage {
                        Text(albumShareMessage).font(.caption).foregroundStyle(.secondary)
                    }
                    if let albumActionMessage {
                        Text(albumActionMessage).font(.caption).foregroundStyle(.secondary)
                    }
                    LazyVGrid(
                        columns: [GridItem(.adaptive(minimum: 95, maximum: 150), spacing: 3)],
                        spacing: 3
                    ) {
                        ForEach(page.items.filter { $0.kind != "unsupported" }) { item in
                            Button {
                                if selectionMode {
                                    toggleAlbumSelection(item)
                                } else {
                                    viewerReturnID = item.id
                                    accessibilityFocusedTileID = nil
                                    viewerPage = page
                                    selected = item
                                }
                            } label: {
                                ZStack(alignment: .topTrailing) {
                                    XDriveIOSLocalPhotoTile(candidate: item)
                                    if selectionMode {
                                        Image(systemName: selectedCandidates[item.id] != nil
                                            ? "checkmark.circle.fill" : "circle")
                                            .font(.title2).foregroundStyle(.white)
                                            .padding(6)
                                    }
                                }
                            }
                            .buttonStyle(.plain)
                            .id(item.id)
                            .accessibilityFocused($accessibilityFocusedTileID, equals: item.id)
                        }
                    }
                    HStack {
                        Button("上一页") { load(offset: max(0, page.startOffset - 64)) }
                            .disabled(loading || page.startOffset == 0)
                        Spacer()
                        Button("下一页") { load(offset: page.nextOffset) }
                            .disabled(loading || page.finished)
                    }
                    .buttonStyle(.bordered)
                }
                if loading { ProgressView("读取相册内容…") }
                if let error {
                    Text(error).foregroundStyle(.red)
                    Button("重新读取") { savedOffset = 0; reload() }
                }
                if !compactGallery {
                    Text("仅操作当前授权相簿的媒体；原件分享需明确点击，不上传或持久保存相簿成员标识。")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(12)
        }
        .onChange(of: pageRenderRevision) { _ in
            restoreViewerTile(using: returnScroll)
        }
        }
        }
        .navigationTitle(album.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { showingAlbumHelp = true } label: {
                    Label("相册说明", systemImage: "info.circle")
                }
                .accessibilityIdentifier("native-ios-local-album-layout-help")
            }
        }
        .alert("相册说明", isPresented: $showingAlbumHelp) {
            Button("完成", role: .cancel) {}
        } message: {
            Text("每页最多读取 64 项；只可选择当前页成员。分享原件需明确点击，删除遵循系统确认规则，不影响云端备份。")
        }
        .confirmationDialog(
            "删除本页选中的 \(selectedCandidates.count) 张系统照片？",
            isPresented: $confirmingAlbumDelete, titleVisibility: .visible
        ) {
            Button("删除选中照片", role: .destructive) {
                runAlbumAction(delete: true)
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("系统照片删除操作不影响 xDrive 云端备份。")
        }
        .confirmationDialog(
            "从当前相簿移除选中的 \(selectedCandidates.count) 项？",
            isPresented: $confirmingAlbumRemove, titleVisibility: .visible
        ) {
            Button("只从相簿移除", role: .destructive) {
                runAlbumAction(removeFromAlbum: true)
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("这些照片仍保留在系统照片库及其他相簿，不会删除原件或云端备份。")
        }
        .sheet(isPresented: $showingDestinationPicker) {
            XDriveIOSNativeAlbumDestinationPicker(
                candidates: destinationCandidates,
                excludingCollectionID: album.collectionIdentifier,
                onAdded: {
                    selectionMode = false
                    selectedCandidates.removeAll()
                    destinationCandidates.removeAll()
                    reload()
                    albumActionMessage = "已加入所选相簿。"
                }
            )
        }
        .sheet(item: $albumShareSession, onDismiss: {
            retainedAlbumShare?.discard()
            retainedAlbumShare = nil
        }) { session in
            XDriveIOSNativeLocalPhotoActivitySheet(fileURLs: session.fileURLs)
        }
        .fullScreenCover(item: $selected, onDismiss: { restoreAfterViewer() }) { initial in
            XDriveIOSNativeLocalPhotoDetail(
                candidate: initial,
                // The album owns one verified 64-slot page at a time. The
                // Viewer can request only the immediate neighbor on demand.
                loadedItems: (viewerPage ?? page)?.items.filter {
                    $0.kind != "unsupported"
                } ?? [],
                onViewed: { next in
                    // Use the currently verified Viewer page, not the original
                    // wall page after a cross-page move.
                    guard phase == .active, selected?.id == initial.id,
                          [.authorized, .limited].contains(
                            PHPhotoLibrary.authorizationStatus(for: .readWrite)
                          ),
                          viewerPage?.items.contains(where: {
                            $0.id == next.id && $0.kind == next.kind &&
                            $0.isLive == next.isLive &&
                            $0.capturedAt == next.capturedAt &&
                            $0.modifiedAt == next.modifiedAt
                          }) == true
                    else { return }
                    viewerReturnID = next.id
                    accessibilityFocusedTileID = nil
                },
                loadedPage: viewerPage ?? page,
                onCrossPage: { oldPage, anchor, direction in
                    guard phase == .active, selected?.id == initial.id,
                          [.authorized, .limited].contains(
                            PHPhotoLibrary.authorizationStatus(for: .readWrite)
                          ) else { throw XDriveIOSAlbumReadFailure.changed }
                    let adjacentReader = XDriveIOSNativeAlbumPageReader()
                    do {
                        let count = try await adjacentReader.open(album)
                        guard count == oldPage.totalAccessibleAssets else {
                            throw XDriveIOSAlbumReadFailure.changed
                        }
                        let neighbor = try await adjacentReader.adjacentPage(
                            from: oldPage, anchoredAt: anchor, direction: direction
                        )
                        await adjacentReader.reset()
                        guard phase == .active, selected?.id == initial.id,
                              [.authorized, .limited].contains(
                                PHPhotoLibrary.authorizationStatus(for: .readWrite)
                              ) else { throw XDriveIOSAlbumReadFailure.changed }
                        return neighbor
                    } catch {
                        await adjacentReader.reset()
                        throw error
                    }
                },
                onCrossedPage: { next, verifiedPage in
                    guard phase == .active, selected?.id == initial.id else { return }
                    viewerPage = verifiedPage
                    savedOffset = verifiedPage.startOffset
                    viewerReturnID = next.id
                    accessibilityFocusedTileID = nil
                }
            )
        }
        .onAppear {
            libraryMonitor.start()
            if selected == nil && page == nil && !loading { reload() }
        }
        .onChange(of: libraryMonitor.revision) { _ in
            clearViewerTileAnchor()
            invalidate()
            error = "系统相册发生变化，请重新读取当前页面。"
        }
        .onChange(of: phase) { state in
            permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
            if state != .active {
                if selected != nil {
                    // Keep the transient tile anchor only until reauthorized
                    // Viewer dismissal; revoke accessibility focus immediately.
                    accessibilityFocusedTileID = nil
                    // Redact the hidden album page, but let the fullscreen
                    // Viewer own its selected media and foreground recheck.
                    suspendForViewer()
                    page = nil
                    error = nil
                } else {
                    clearViewerTileAnchor()
                    invalidate()
                }
            } else if selected != nil {
                // The Viewer revalidates its selected PhotoKit asset. Never
                // scan the album wall behind a still-presented modal.
                if permission != .authorized && permission != .limited {
                    clearViewerTileAnchor()
                    invalidate()
                    error = "本机相册访问权限已失效，请返回相册重新授权。"
                }
            } else {
                reload()
            }
        }
        .onDisappear {
            if selected != nil { suspendForViewer() }
            else { libraryMonitor.stop(); invalidate() }
        }
    }

    private var albumAuthorized: Bool {
        permission == .authorized || permission == .limited
    }

    private func toggleAlbumSelection(_ item: XDrivePhotoKitScanCandidate) {
        guard selectionMode, !loading, !albumActionBusy, !albumShareBusy,
              albumAuthorized, phase == .active, selected == nil,
              page?.items.contains(where: {
                $0.id == item.id && $0.kind == item.kind &&
                $0.isLive == item.isLive && $0.capturedAt == item.capturedAt &&
                $0.modifiedAt == item.modifiedAt
              }) == true else { return }
        if selectedCandidates.removeValue(forKey: item.id) != nil { return }
        guard XDriveIOSNativePhotoSelectionPolicy.canAdd(
            selectedCount: selectedCandidates.count, identifier: item.id,
            alreadySelected: false
        ) else {
            albumActionMessage = "选择数量超过当前支持上限。"
            return
        }
        selectedCandidates[item.id] = item
    }

    /// Reopen exactly this authorized album, and compare EVERY slot of the
    /// current 64-item page before changing or sharing the selected originals.
    private func revalidateAlbumSelection(
        _ batch: [XDrivePhotoKitScanCandidate],
        expected: XDrivePhotoKitScanPage
    ) async throws {
        guard !batch.isEmpty, batch.count <= 64, let current = page,
              current.startOffset == expected.startOffset,
              current.totalAccessibleAssets == expected.totalAccessibleAssets,
              current.items.count == expected.items.count,
              batch.allSatisfy({ candidate in
                expected.items.contains(where: {
                    $0.id == candidate.id && $0.kind == candidate.kind &&
                    $0.isLive == candidate.isLive &&
                    $0.capturedAt == candidate.capturedAt &&
                    $0.modifiedAt == candidate.modifiedAt
                })
              })
        else { throw XDriveIOSAlbumReadFailure.changed }
        let verifier = XDriveIOSNativeAlbumPageReader()
        do {
            let count = try await verifier.open(album)
            let now = try await verifier.page(offset: expected.startOffset)
            try Task.checkCancellation()
            guard count == expected.totalAccessibleAssets,
                  now.items.count == expected.items.count,
                  zip(now.items, expected.items).allSatisfy({
                    $0.0.id == $0.1.id && $0.0.kind == $0.1.kind &&
                    $0.0.isLive == $0.1.isLive &&
                    $0.0.capturedAt == $0.1.capturedAt &&
                    $0.0.modifiedAt == $0.1.modifiedAt
                  })
            else { throw XDriveIOSAlbumReadFailure.changed }
            await verifier.reset()
        } catch {
            await verifier.reset()
            throw error
        }
    }

    private func prepareAlbumShare(allowICloud: Bool) {
        guard selectionMode, albumAuthorized, phase == .active,
              selected == nil, !albumShareBusy, !albumActionBusy,
              albumShareSession == nil, let sourcePage = page else { return }
        let batch = selectedCandidates.values.sorted { $0.id < $1.id }
        guard !batch.isEmpty,
              batch.count <= XDriveIOSNativeLocalPhotoSharePolicy.maximumItems else {
            albumShareMessage = "一次最多分享 8 项系统原件。"
            return
        }
        let token = UUID()
        albumShareEpoch = token
        albumShareBusy = true
        albumShareMessage = nil
        albumShareTask = Task { @MainActor in
            defer {
                if albumShareEpoch == token {
                    albumShareBusy = false
                    albumShareTask = nil
                }
            }
            do {
                try await revalidateAlbumSelection(batch, expected: sourcePage)
                let session = try await XDriveIOSNativeLocalOriginalSharer.prepare(
                    batch, allowICloudDownload: allowICloud
                )
                guard albumShareEpoch == token, !Task.isCancelled,
                      phase == .active, albumAuthorized,
                      page?.startOffset == sourcePage.startOffset
                else {
                    session.discard()
                    return
                }
                do {
                    try await revalidateAlbumSelection(batch, expected: sourcePage)
                } catch {
                    session.discard()
                    throw error
                }
                retainedAlbumShare = session
                albumShareSession = session
                if session.containsLivePair {
                    albumShareMessage = "实况原件以照片与 MOV 分享，目标 App 可能无法自动配对。"
                }
            } catch is CancellationError {
            } catch {
                if albumShareEpoch == token {
                    albumShareMessage = allowICloud
                        ? "无法准备原件，请核对 iCloud、相簿成员和授权。"
                        : "原件不可用，若仅在 iCloud 请显式选择下载后分享。"
                }
            }
        }
    }

    private func runAlbumAction(
        delete: Bool = false, favorite: Bool? = nil,
        removeFromAlbum: Bool = false
    ) {
        guard selectionMode, albumAuthorized, phase == .active,
              selected == nil, !albumActionBusy, !albumShareBusy,
              let sourcePage = page,
              delete || favorite != nil || removeFromAlbum else { return }
        let batch = selectedCandidates.values.sorted { $0.id < $1.id }
        guard !batch.isEmpty, batch.count <= 64 else { return }
        let token = UUID()
        albumActionEpoch = token
        albumActionBusy = true
        albumActionMessage = nil
        albumActionTask = Task { @MainActor in
            do {
                try await revalidateAlbumSelection(batch, expected: sourcePage)
                if removeFromAlbum {
                    try await XDriveIOSNativePhotoAlbumMutations.remove(
                        batch, from: album
                    )
                } else if delete {
                    try await XDriveIOSNativeLocalPhotoSelectionActions.delete(batch)
                } else if let favorite {
                    try await XDriveIOSNativeLocalPhotoSelectionActions.setFavorite(
                        batch, to: favorite
                    )
                }
                guard albumActionEpoch == token, !Task.isCancelled else { return }
                albumActionBusy = false
                albumActionTask = nil
                // A PhotoKit change callback can independently invalidate
                // the old page. Never keep selected IDs after an edit.
                reload()
                albumActionMessage = removeFromAlbum ? "已从相簿移除，系统原图未删除。" :
                    delete ? "系统照片删除操作已完成。" :
                    (favorite == true ? "已收藏选中照片。" : "已取消选中照片的收藏。")
            } catch is CancellationError {
            } catch {
                if albumActionEpoch == token {
                    albumActionMessage = "系统相簿或照片已变化；请重新选择后操作。"
                }
            }
            if albumActionEpoch == token {
                albumActionBusy = false
                albumActionTask = nil
            }
        }
    }

    private func cancelAlbumOperations() {
        albumActionEpoch = UUID()
        albumActionTask?.cancel()
        albumActionTask = nil
        albumActionBusy = false
        albumShareEpoch = UUID()
        albumShareTask?.cancel()
        albumShareTask = nil
        albumShareBusy = false
        selectionMode = false
        selectedCandidates.removeAll()
        confirmingAlbumDelete = false
        confirmingAlbumRemove = false
        showingDestinationPicker = false
        destinationCandidates.removeAll()
    }

    private func restoreAfterViewer() {
        viewerPage = nil
        shouldRestoreViewerTile = viewerReturnID != nil && phase == .active
        // Open the same album/page only after fresh PhotoKit authorization.
        if phase == .active { reload() }
        else {
            clearViewerTileAnchor()
            invalidate()
        }
    }

    private func restoreViewerTile(using scroll: ScrollViewProxy) {
        guard shouldRestoreViewerTile else { return }
        let authorized = permission == .authorized || permission == .limited
        let target = XDriveIOSNativePhotoViewerReturnAnchorPolicy.target(
            viewerReturnID, in: page?.items.map(\.id) ?? [],
            authorized: authorized
        )
        clearViewerTileAnchor()
        if let target {
            scroll.scrollTo(target, anchor: .center)
            // Restore VoiceOver only to the reauthorized originating tile.
            accessibilityFocusedTileID = target
        }
    }

    private func clearViewerTileAnchor() {
        viewerReturnID = nil
        shouldRestoreViewerTile = false
        accessibilityFocusedTileID = nil
    }

    private func reload() {
        permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        invalidate()
        guard permission == .authorized || permission == .limited else {
            clearViewerTileAnchor()
            error = "本机相册访问权限已失效，请返回相册重新授权。"
            return
        }
        load(offset: savedOffset)
    }

    private func load(offset: Int) {
        invalidate()
        let ticket = epoch
        let next = XDriveIOSNativeAlbumPageReader()
        reader = next
        loading = true
        task = Task { @MainActor in
            do {
                _ = try await next.open(album)
                let page = try await next.page(offset: offset)
                try Task.checkCancellation()
                guard epoch == ticket, phase == .active else { return }
                permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                self.page = page
                savedOffset = page.startOffset
                pageRenderRevision &+= 1
            } catch is CancellationError {
            } catch {
                guard epoch == ticket else { return }
                self.error = "相册内容或授权发生变化，旧结果已撤销；请返回或重新读取。"
            }
            if epoch == ticket { loading = false }
        }
    }

    private func suspendForViewer() {
        epoch = UUID()
        task?.cancel()
        task = nil
        if let reader { Task { await reader.reset() } }
        reader = nil
        loading = false
        // The modal owns selected until dismissal; library monitor remains live.
    }

    private func invalidate() {
        cancelAlbumOperations()
        epoch = UUID()
        task?.cancel()
        task = nil
        if let reader { Task { await reader.reset() } }
        reader = nil
        page = nil
        selected = nil
        viewerPage = nil
        loading = false
        error = nil
    }
}

/// Photos-first list of local smart/user albums. Entries come from the
/// existing 32-at-a-time PhotoKit album pager, never a 100k-sized array.
struct XDriveIOSNativePhotoAlbumsScreen: View {
    // Parent-owned route hint, never a PhotoKit album ID.
    @Binding var savedOffset: Int
    @Environment(\.scenePhase) private var phase
    @StateObject private var libraryMonitor = XDriveIOSNativeAlbumChangeMonitor()
    @State private var page: XDriveLocalPhotoAlbumPage?
    @State private var permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    @State private var loading = false
    @State private var error: String?
    @State private var epoch = UUID()
    @State private var task: Task<Void, Never>?
    @State private var showingCreateAlbum = false
    @State private var showingRenameAlbum = false
    @State private var createName = ""
    @State private var renameName = ""
    @State private var renameTarget: XDriveLocalPhotoAlbumSummary?
    @State private var showingDeleteAlbum = false
    @State private var deleteTarget: XDriveLocalPhotoAlbumSummary?
    @State private var albumMutationBusy = false
    @State private var albumMutationMessage: String?
    @State private var albumMutationTask: Task<Void, Never>?
    @State private var albumMutationEpoch = UUID()

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if permission == .notDetermined {
                    Button("允许查看本机相册") {
                        Task {
                            _ = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
                            reload()
                        }
                    }
                    .buttonStyle(.borderedProminent)
                } else if permission == .denied || permission == .restricted {
                    Label("相册访问权限不可用", systemImage: "lock")
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        Link("打开 iOS 设置", destination: url)
                    }
                } else {
                    if permission == .limited {
                        Label("仅可查看 iOS 已授权的相册成员", systemImage: "lock.shield")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    NavigationLink {
                        XDriveIOSNativeLocalPhotoTimelineScreen()
                    } label: {
                        Label("按年、月、日浏览全部照片", systemImage: "calendar")
                            .font(.headline)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(
                                Color(uiColor: .secondarySystemGroupedBackground),
                                in: RoundedRectangle(cornerRadius: 12)
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("native-ios-gallery-timeline-entry")

                    if let page {
                        Text(page.total == 0 ? "没有可访问的相册。" :
                            "相册 \(page.offset + 1)–\(page.offset + page.items.count) / \(page.total)")
                            .font(.caption).foregroundStyle(.secondary)
                        ForEach(page.items) { album in
                            HStack(spacing: 8) {
                                NavigationLink {
                                    XDriveIOSNativeAlbumContentsScreen(album: album)
                                } label: {
                                    XDriveIOSNativeAlbumCover(album: album)
                                }
                                .buttonStyle(.plain)
                                .disabled(albumMutationBusy)
                                .accessibilityIdentifier("native-ios-gallery-album-open")
                                if album.kind == "用户相册" {
                                    Menu {
                                        Button("重命名相簿") {
                                            renameTarget = album
                                            renameName = album.name
                                            showingRenameAlbum = true
                                        }
                                        Button("删除相簿", role: .destructive) {
                                            deleteTarget = album
                                            showingDeleteAlbum = true
                                        }
                                    } label: {
                                        Image(systemName: "ellipsis.circle")
                                            .frame(width: 44, height: 44)
                                    }
                                    .disabled(albumMutationBusy)
                                    .accessibilityIdentifier("native-ios-album-manage-menu")
                                }
                            }
                        }
                        HStack {
                            Button("上一页") { load(offset: max(0, page.offset - 32)) }
                                .disabled(loading || !page.hasPrevious)
                            Spacer()
                            Button("下一页") { load(offset: page.offset + page.items.count) }
                                .disabled(loading || !page.hasNext)
                        }
                        .buttonStyle(.bordered)
                    }
                }
                if loading { ProgressView("读取已授权相册…") }
                if albumMutationBusy { ProgressView("正在更新系统相簿…") }
                if let albumMutationMessage {
                    Text(albumMutationMessage).font(.footnote).foregroundStyle(.secondary)
                }
                if let error {
                    Text(error).foregroundStyle(.red)
                    Button("从第一页重试") { savedOffset = 0; reload() }
                }
                Button("刷新相册") { reload() }
                    .disabled(loading || permission == .denied || permission == .restricted)
            }
            .padding(12)
        }
        .navigationTitle("相册")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    createName = ""
                    showingCreateAlbum = true
                } label: {
                    Label("新建相簿", systemImage: "plus")
                }
                .disabled(albumMutationBusy ||
                    (permission != .authorized && permission != .limited))
                .accessibilityIdentifier("native-ios-album-create")
            }
        }
        .alert("新建相簿", isPresented: $showingCreateAlbum) {
            TextField("相簿名称", text: $createName)
            Button("新建") {
                let proposed = createName
                runAlbumMutation(success: "已创建系统用户相簿。") {
                    try await XDriveIOSNativePhotoAlbumMutations.create(proposed)
                }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("创建 iOS 本机相簿，不会创建 xDrive 云端目录。")
        }
        .alert("重命名相簿", isPresented: $showingRenameAlbum) {
            TextField("相簿名称", text: $renameName)
            Button("保存") {
                if let target = renameTarget {
                    let proposed = renameName
                    runAlbumMutation(success: "系统相簿已重命名。") {
                        try await XDriveIOSNativePhotoAlbumMutations.rename(
                            target, to: proposed
                        )
                    }
                }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("仅修改用户相簿名称，不会修改照片或云端文件。")
        }
        .confirmationDialog(
            "删除这个用户相簿？", isPresented: $showingDeleteAlbum,
            titleVisibility: .visible
        ) {
            Button("只删除相簿", role: .destructive) {
                if let target = deleteTarget {
                    runAlbumMutation(success: "系统相簿已删除，原有照片保留。") {
                        try await XDriveIOSNativePhotoAlbumMutations.delete(target)
                    }
                }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("仅删除相簿本身，照片仍在系统照片库，云端备份不受影响。")
        }
        .onAppear { libraryMonitor.start(); reload() }
        .onChange(of: libraryMonitor.revision) { _ in
            // External changes and our own successful PhotoKit mutations
            // both require a new authorized 32-item album directory.
            if phase == .active && !albumMutationBusy { reload() }
            else { invalidate() }
        }
        .onChange(of: phase) { state in
            if state == .active { reload() } else { invalidate() }
        }
        .onDisappear {
            libraryMonitor.stop()
            suspendForNavigation()
        }
    }

    private func runAlbumMutation(
        success: String,
        _ operation: @escaping @MainActor () async throws -> Void
    ) {
        guard !albumMutationBusy, phase == .active,
              permission == .authorized || permission == .limited else { return }
        let ticket = UUID()
        albumMutationEpoch = ticket
        albumMutationBusy = true
        albumMutationMessage = nil
        albumMutationTask = Task { @MainActor in
            do {
                try await operation()
                guard albumMutationEpoch == ticket else { return }
                reload()
                albumMutationMessage = success
            } catch {
                if albumMutationEpoch == ticket {
                    albumMutationMessage =
                        "相簿名称、访问权限或系统相簿已发生变化；本次操作未确认，请刷新。"
                }
            }
            if albumMutationEpoch == ticket {
                albumMutationBusy = false
                albumMutationTask = nil
            }
        }
    }

    private func suspendForNavigation() {
        // Album NavigationLink must keep its originating row alive.
        epoch = UUID()
        task?.cancel()
        task = nil
        loading = false
    }

    private func reload() {
        permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        invalidate()
        guard permission == .authorized || permission == .limited else { return }
        load(offset: savedOffset)
    }

    private func load(offset requestedOffset: Int) {
        invalidate()
        let ticket = epoch
        loading = true
        task = Task { @MainActor in
            do {
                // Saved 32-slot offsets may become invalid after album deletion.
                // Recheck the currently authorized index, never stale IDs.
                var page: XDriveLocalPhotoAlbumPage
                do {
                    page = try await XDriveLocalPhotoAlbumPager.readPage(
                        offset: requestedOffset
                    )
                } catch XDriveLocalPhotoAlbumFailure.invalidRange {
                    let first = try await XDriveLocalPhotoAlbumPager.readPage(offset: 0)
                    try Task.checkCancellation()
                    let bounded = XDriveIOSNativeAlbumDirectoryCursorPolicy.clamp(
                        requested: requestedOffset, currentTotal: first.total
                    )
                    if bounded == 0 {
                        page = first
                    } else {
                        page = try await XDriveLocalPhotoAlbumPager.readPage(
                            offset: bounded
                        )
                    }
                }
                try Task.checkCancellation()
                if requestedOffset > 0 && page.total > 0 && page.items.isEmpty {
                    let bounded = XDriveIOSNativeAlbumDirectoryCursorPolicy.clamp(
                        requested: requestedOffset, currentTotal: page.total
                    )
                    if bounded != page.offset {
                        page = try await XDriveLocalPhotoAlbumPager.readPage(
                            offset: bounded
                        )
                    }
                }
                try Task.checkCancellation()
                guard epoch == ticket, phase == .active,
                      PHPhotoLibrary.authorizationStatus(for: .readWrite) == permission
                else { return }
                self.page = page
                savedOffset = page.offset
            } catch is CancellationError {
            } catch {
                guard epoch == ticket else { return }
                self.error = "相册目录或授权发生变化，请刷新后重新查看。"
            }
            if epoch == ticket { loading = false }
        }
    }

    private func invalidate() {
        epoch = UUID()
        task?.cancel()
        task = nil
        page = nil
        loading = false
        error = nil
    }
}

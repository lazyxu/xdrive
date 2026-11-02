import AVKit
import Combine
import Photos
import SwiftUI
import UIKit

/// Only one 48-item logical PhotoAsset range is held at a time.
@MainActor
final class XDriveIOSNativeMediaWallModel: ObservableObject {
    @Published private(set) var page: XDriveIOSNativeMediaRange?
    @Published private(set) var busy = false
    @Published private(set) var error: String?
    @Published private(set) var failedOffset: Int?

    private var pageScope: XDriveNativeOwnerRoot?
    private var pageAlbumID: String?
    private var pagePlaceID: String?
    private var pageSearch = ""
    private var epoch = UUID()
    private var job: Task<Void, Never>?
    private var currentReader: XDriveIOSNativeMediaGalleryReader?

    func invalidate() {
        epoch = UUID()
        job?.cancel()
        job = nil
        currentReader = nil
        page = nil
        pageScope = nil
        pageAlbumID = nil
        pagePlaceID = nil
        pageSearch = ""
        failedOffset = nil
        busy = false
        error = nil
    }

    func suspendForViewer() {
        // A Viewer or an album child route can temporarily cover the wall.
        // Keep its 48-item page and exact source anchor for the return path.
        // Retire the request generation so a cancelled URLSession error
        // cannot overwrite the returned page after navigation.
        epoch = UUID()
        job?.cancel()
        job = nil
        busy = false
    }

    func suspendForNavigation() {
        suspendForViewer()
    }

    /// Adopt only a Viewer-revalidated immediate 48-item Owner Range. Keeps
    /// the original reader for scoped thumbnails when returning to L2.
    func acceptVerifiedViewerRange(
        _ next: XDriveIOSNativeMediaRange,
        after previous: XDriveIOSNativeMediaRange,
        login: XDriveIOSNativeOwnerLoginModel,
        albumID: String?, placeID: String?, search: String
    ) -> Bool {
        guard let existing = page, let reader = currentReader,
              let expected = pageScope,
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected),
              XDriveIOSNativePhotoOwnerScope.matches(reader.owner, expected),
              pageAlbumID == albumID, pagePlaceID == placeID,
              pageSearch == search, !busy,
              existing.sameVisibleSnapshot(as: previous),
              next.total_count == previous.total_count,
              next.limit == XDriveIOSNativeMediaGalleryReader.pageSize,
              XDriveIOSNativePhotoAssetRangeCursorPolicy.validPage(
                offset: next.offset, count: next.items.count,
                total: next.total_count
              ),
              Set(next.items.map(\.id)).count == next.items.count
        else { return false }
        page = next
        failedOffset = nil
        error = nil
        return true
    }

    /// Retain a previously verified page only for a transient transport
    /// problem. Access revocation, missing albums, invalid responses, TLS
    /// trust failures and malformed media must immediately clear old rows.
    private static func canRetainPage(after error: Error) -> Bool {
        if let failure = error as? XDriveIOSNativeMediaReadFailure {
            switch failure {
            case .response(let status):
                return XDriveIOSNativeMediaPageRetryPolicy
                    .permitsRetainingPreviousPage(httpStatus: status)
            case .invalidScope, .invalidPage, .unsupported,
                 .malformed, .tooLarge:
                return false
            }
        }
        guard let network = error as? URLError else { return false }
        return XDriveIOSNativeMediaPageRetryPolicy
            .permitsRetainingPreviousPage(urlError: network.code)
    }

    func load(login: XDriveIOSNativeOwnerLoginModel,
              albumID: String?, placeID: String? = nil,
              offset: Int = 0, search: String = "") {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.unicodeScalars.count <= 200 else {
            error = "搜索关键词最多 200 个字符。"
            return
        }
        guard placeID == nil || (
            albumID == nil &&
            XDriveIOSNativeOwnerMapSelectionPolicy.canonicalPlaceID(placeID!)
        ) else {
            invalidate()
            error = "地图地点已失效，请返回云端地图刷新后重试。"
            return
        }
        guard let expected = login.owner else {
            invalidate()
            error = "当前尚未建立经过验证的服务器账户。"
            return
        }
        // Only the same verified Owner AND album may retain an earlier page
        // while the requested range loads. A different scope clears it first.
        let keepOldPage = pageScope.map {
            XDriveIOSNativePhotoOwnerScope.matches(expected, $0)
        } == true && pageAlbumID == albumID &&
            pagePlaceID == placeID && pageSearch == query
        epoch = UUID()
        job?.cancel()
        job = nil
        if !keepOldPage {
            page = nil
            currentReader = nil
            pageScope = nil
            pageAlbumID = nil
            pagePlaceID = nil
            pageSearch = ""
        }
        failedOffset = nil
        error = nil
        let ticket = epoch
        busy = true
        job = Task { @MainActor [weak self] in
            defer {
                if self?.epoch == ticket {
                    self?.busy = false
                    self?.job = nil
                }
            }
            do {
                // Reverify Owner/root before retaining any previous page. A
                // revoked/expired native account cannot keep cached filenames.
                let auth: (owner: XDriveNativeOwnerRoot, accessToken: String)
                do {
                    auth = try await login.verifiedAuthorization()
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    guard self?.epoch == ticket else { return }
                    self?.invalidate()
                    self?.error = "当前账户身份验证失败，已隐藏旧云端照片；请重新登录或重试。"
                    return
                }
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected) else {
                    self?.invalidate()
                    self?.error = "当前服务器或 Owner 已变化，旧图库已清除。"
                    return
                }
                let reader = XDriveIOSNativeMediaGalleryReader(
                    owner: auth.owner, accessToken: auth.accessToken
                )
                let result = try await reader.page(
                    offset: offset, albumID: albumID,
                    placeID: placeID, search: query
                )
                try Task.checkCancellation()
                guard self?.epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                self?.currentReader = reader
                self?.page = result
                self?.pageScope = expected
                self?.pageAlbumID = albumID
                self?.pagePlaceID = placeID
                self?.pageSearch = query
                self?.failedOffset = nil
            } catch is CancellationError {
            } catch {
                guard self?.epoch == ticket else { return }
                // A verified Server can still revoke access or delete an
                // album between page requests. Never show cached rows after
                // a definitive 4xx/invalid response, even if the Owner was
                // verified immediately before this request.
                guard XDriveIOSNativeMediaWallModel.canRetainPage(after: error) else {
                    self?.invalidate()
                    self?.error = "云端照片访问权限已变化或内容无效；旧页面已清除。"
                    return
                }
                // Only transient network/rate-limit/server failures may
                // preserve the old verified page and retry the exact offset.
                self?.failedOffset = offset
                self?.error = "云端 PhotoAsset 读取失败；已保留当前浏览页，可重试刚才的分页请求。"
            }
        }
    }

    func thumbnail(_ item: XDriveIOSNativeMediaItem,
                   login: XDriveIOSNativeOwnerLoginModel) async throws -> UIImage {
        let ticket = epoch
        guard let reader = currentReader,
              page?.items.contains(where: {
                $0.id == item.id && $0.node.revision == item.node.revision
              }) == true,
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, reader.owner)
        else { throw XDriveIOSNativeMediaReadFailure.invalidScope }
        let image = try await reader.thumbnail(item)
        try Task.checkCancellation()
        guard epoch == ticket,
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, reader.owner)
        else { throw XDriveIOSNativeMediaReadFailure.invalidScope }
        return image
    }
}

/// Retire a tile's private UIImage when its authoritative Node revision or
/// verified Owner/root changes. Keep the ForEach Node ID for scroll focus.
private struct XDriveIOSNativeMediaWallTileIdentity: Hashable {
    let nodeID: UInt64
    let revision: UInt64
    let origin: URL?
    let instanceID: String?
    let ownerID: UInt64?
    let username: String?
    let rootNodeID: UInt64?

    init(item: XDriveIOSNativeMediaItem, owner: XDriveNativeOwnerRoot?) {
        nodeID = item.id
        revision = item.node.revision
        origin = owner?.origin
        instanceID = owner?.instanceID
        ownerID = owner?.ownerID
        username = owner?.username
        rootNodeID = owner?.rootNodeID
    }
}

private struct XDriveIOSNativeMediaWallTile: View {
    let item: XDriveIOSNativeMediaItem
    let viewerActive: Bool
    @ObservedObject var model: XDriveIOSNativeMediaWallModel
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @State private var image: UIImage?

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
                    .frame(maxWidth: .infinity).frame(height: 112).clipped()
            } else {
                Rectangle().fill(Color(uiColor: .secondarySystemGroupedBackground))
                    .overlay {
                        Image(systemName: item.isVideo ? "video" : "photo")
                            .foregroundStyle(.secondary)
                    }
                    .frame(height: 112)
            }
            if item.isVideo || item.isLive {
                Image(systemName: item.isVideo ? "play.circle.fill" : "livephoto")
                    .foregroundStyle(.white).padding(6).shadow(radius: 2)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityLabel(
            item.isLive ? "实况媒体：\(item.node.name)" :
                item.isVideo ? "视频：\(item.node.name)" : "照片：\(item.node.name)"
        )
        .task(id: "\(item.id)-\(item.node.revision)-\(viewerActive)") {
            // A selected L3 Viewer cancels thumbnail work even if the L2
            // ScrollView is still mounted behind fullScreenCover.
            guard !viewerActive, image == nil else { return }
            do {
                let result = try await model.thumbnail(item, login: login)
                try Task.checkCancellation()
                image = result
            } catch {
                // No thumbnail derivative does NOT mean the original is absent.
            }
        }
        .onDisappear {
            if !viewerActive { image = nil }
        }
    }
}

/// Fullscreen media View. Playback is dismissed immediately when the verified
/// Owner changes; cloud Live motion is not faked from the representative still.
struct XDriveIOSNativeServerMediaPreview: View {
    let item: XDriveIOSNativeMediaItem
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    /// Immutable L2 Owner Range captured before presenting this one L3 Viewer.
    var loadedItems: [XDriveIOSNativeMediaItem] = []
    var loadedRange: XDriveIOSNativeMediaRange? = nil
    var openedOwner: XDriveNativeOwnerRoot? = nil
    var onNavigate: ((XDriveIOSNativeMediaItem) -> Bool)? = nil
    var onCrossRange: ((
        XDriveIOSNativeMediaRange, XDriveIOSNativeMediaItem, Int
    ) async throws -> XDriveIOSNativeMediaRange?)? = nil
    var onCrossedRange: ((
        XDriveIOSNativeMediaItem, XDriveIOSNativeMediaRange
    ) -> Bool)? = nil
    @State private var crossedRange: XDriveIOSNativeMediaRange?
    @State private var rangeCrossing = false
    @State private var rangeCrossingEpoch = UUID()
    @State private var rangeCrossingTask: Task<Void, Never>?
    @State private var rangeCrossingMessage: String?
    @State private var activeItem: XDriveIOSNativeMediaItem?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @State private var previewRequestID = UUID()
    @State private var image: UIImage?
    @State private var imageIsThumbnailOnly = false
    @State private var player: AVPlayer?
    @State private var failure: String?
    // Paired originals belong to this single verified L3 Viewer, never the wall.
    @State private var liveResources: XDriveIOSLivePreviewFiles?
    @State private var liveOwner: XDriveNativeOwnerRoot?
    @State private var nativeLiveReady = false
    @State private var nativeLiveUnavailable = false
    @State private var livePlaybackRequest: UUID?
    @State private var showingLiveMotion = false
    // Live pairing remains available, but a user can inspect the still
    // at full zoom without starting the motion or a new network transfer.
    @State private var showsStaticStill = false

    // Explicit native Photos restore belongs to this one L3 Viewer and its
    // presenting Owner. It never runs from Gallery thumbnails or background.
    @State private var photosRestoreTask: Task<Void, Never>?
    @State private var photosRestoreEpoch = UUID()
    @State private var photosRestoreBusy = false
    @State private var photosPermissionPrompt = false
    @State private var photosRestoreNotice = ""
    @State private var photosRestoreNoticePresented = false

    private var viewed: XDriveIOSNativeMediaItem { activeItem ?? item }

    private var ownerAuthorized: Bool {
        phase == .active && openedOwner.map {
            XDriveIOSNativePhotoOwnerScope.matches(login.owner, $0)
        } == true
    }

    private var visibleRange: XDriveIOSNativeMediaRange? {
        crossedRange ?? loadedRange
    }

    private var visibleItems: [XDriveIOSNativeMediaItem] {
        crossedRange?.items ?? loadedItems
    }

    private var loadedKeys: [XDriveIOSNativePhotoAssetViewerNeighborKey] {
        visibleItems.map {
            XDriveIOSNativePhotoAssetViewerNeighborKey(
                nodeID: $0.id, revision: $0.node.revision,
                previewable: $0.supportsPreview
            )
        }
    }

    private var currentKey: XDriveIOSNativePhotoAssetViewerNeighborKey {
        XDriveIOSNativePhotoAssetViewerNeighborKey(
            nodeID: viewed.id, revision: viewed.node.revision,
            previewable: viewed.supportsPreview
        )
    }

    private var loadedPosition: Int? {
        XDriveIOSNativePhotoAssetViewerNeighborPolicy.loadedIndex(
            current: currentKey, in: loadedKeys, ownerAuthorized: ownerAuthorized
        )
    }

    private func neighbor(_ direction: Int) -> XDriveIOSNativeMediaItem? {
        guard let index = XDriveIOSNativePhotoAssetViewerNeighborPolicy.neighborIndex(
            current: currentKey, in: loadedKeys, direction: direction,
            ownerAuthorized: ownerAuthorized
        ) else { return nil }
        // The neighbor index comes from the active crossed Range, not the
        // 48 items frozen when the Viewer first opened. The last Range may
        // contain fewer rows; indexing the old array can show the wrong Node.
        return visibleItems[index]
    }

    private func canCrossRange(_ direction: Int) -> Bool {
        guard ownerAuthorized, !rangeCrossing, onCrossRange != nil,
              let page = visibleRange, let position = loadedPosition,
              page.items.count == visibleItems.count else { return false }
        return XDriveIOSNativePhotoAssetRangeCursorPolicy.adjacentOffset(
            current: page.offset, count: page.items.count,
            total: page.total_count, selectedIndex: position,
            direction: direction
        ) != nil
    }

    private func navigateLoaded(_ direction: Int) {
        guard ownerAuthorized, !rangeCrossing, !photosRestoreBusy else { return }
        if neighbor(direction) != nil {
            guard let next = neighbor(direction), onNavigate?(next) == true
            else { return }
            // Switching a PhotoAsset also revokes a pending native Photos import.
            cancelPhotosRestore()
            // Cancel old signed streams, AVPlayer, Live pairing and temporary
            // resources before admitting exactly one foreground preview.
            retirePreview()
            activeItem = next
            return
        }
        crossRange(direction)
    }

    private func crossRange(_ direction: Int) {
        guard canCrossRange(direction), let previous = visibleRange,
              let onCrossRange else { return }
        let target = viewed
        let ticket = UUID()
        rangeCrossingEpoch = ticket
        rangeCrossing = true
        rangeCrossingMessage = nil
        rangeCrossingTask = Task { @MainActor in
            defer {
                if rangeCrossingEpoch == ticket {
                    rangeCrossing = false
                    rangeCrossingTask = nil
                }
            }
            do {
                let nextPage = try await onCrossRange(previous, target, direction)
                try Task.checkCancellation()
                guard rangeCrossingEpoch == ticket, ownerAuthorized,
                      viewed.id == target.id,
                      viewed.node.revision == target.node.revision,
                      visibleRange?.sameVisibleSnapshot(as: previous) == true
                else { return }
                guard let nextPage,
                      let next = direction > 0
                        ? nextPage.items.first : nextPage.items.last,
                      next.supportsPreview else {
                    rangeCrossingMessage = "相邻云端页没有可直接查看的媒体。"
                    return
                }
                guard onCrossedRange?(next, nextPage) == true else {
                    rangeCrossingMessage = "云端范围或账户已变化，请返回图库重新读取。"
                    return
                }
                cancelPhotosRestore()
                retirePreview()
                crossedRange = nextPage
                activeItem = next
            } catch is CancellationError {
            } catch {
                guard rangeCrossingEpoch == ticket, ownerAuthorized else { return }
                rangeCrossingMessage = "无法安全切换相邻云端照片；请检查网络后重试。"
            }
        }
    }

    private func cancelRangeCrossing() {
        rangeCrossingEpoch = UUID()
        rangeCrossingTask?.cancel()
        rangeCrossingTask = nil
        rangeCrossing = false
        rangeCrossingMessage = nil
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                if viewed.isLive, let still = image {
                    if showingLiveMotion, let player {
                        XDriveIOSNativeAVPlayerStatusObserver(
                            player: player,
                            content: VideoPlayer(player: player)
                                .onAppear { if ownerAuthorized { player.play() } }
                                .onDisappear { player.pause() },
                            onFailed: { playbackLoadFailed($0) }
                        )
                    } else if let resources = liveResources,
                              !nativeLiveUnavailable && !showsStaticStill {
                        ZStack {
                            Image(uiImage: still).resizable().scaledToFit()
                            XDriveIOSNativeCloudPairedLivePhotoView(
                                files: resources,
                                placeholder: still,
                                playbackRequest: livePlaybackRequest
                            ) { ready in
                                // Old Photos callbacks cannot revive a retired
                                // Owner, scene, Viewer or temporary resource set.
                                guard phase == .active,
                                      let currentOwner = liveOwner,
                                      XDriveIOSNativePhotoOwnerScope.matches(
                                        login.owner, currentOwner
                                      ),
                                      liveResources?.folderURL == resources.folderURL
                                else { return }
                                nativeLiveReady = ready
                                if !ready { nativeLiveUnavailable = true }
                            }
                            .id(resources.folderURL)
                        }
                        .accessibilityLabel("云端 Live Photo，长按播放")
                    } else {
                        XDriveIOSNativeZoomablePhotoView(image: still)
                            .onNavigateSwipe { navigateLoaded($0) }
                    }
                    if liveResources != nil {
                        HStack(spacing: 12) {
                            if ownerAuthorized && !nativeLiveUnavailable &&
                                !showingLiveMotion {
                                Button(showsStaticStill ? "返回原生实况" : "放大静态照片") {
                                    guard ownerAuthorized else { return }
                                    // Unmount PHLivePhotoView (stopping playback)
                                    // before displaying the native zoom/swipe still.
                                    livePlaybackRequest = nil
                                    nativeLiveReady = false
                                    showsStaticStill.toggle()
                                }
                                .accessibilityIdentifier("native-ios-photoasset-live-still-toggle")
                            }
                            if nativeLiveReady && !nativeLiveUnavailable &&
                                !showingLiveMotion && !showsStaticStill {
                                Button("播放原生实况") {
                                    guard phase == .active,
                                          let currentOwner = liveOwner,
                                          XDriveIOSNativePhotoOwnerScope.matches(
                                            login.owner, currentOwner
                                          ) else { return }
                                    livePlaybackRequest = UUID()
                                }
                                .accessibilityIdentifier("native-ios-photoasset-live-play")
                            }
                            if ownerAuthorized && nativeLiveUnavailable &&
                                !showingLiveMotion {
                                Button("重试原生实况配对") {
                                    guard ownerAuthorized, liveResources != nil else { return }
                                    // Re-pair the existing verified still/MOV locally;
                                    // a failed Photos pairing needs no new Server ticket.
                                    livePlaybackRequest = nil
                                    nativeLiveReady = false
                                    showsStaticStill = false
                                    nativeLiveUnavailable = false
                                }
                                .accessibilityIdentifier("native-ios-photoasset-live-pair-retry")
                            }
                            Button(showingLiveMotion ? "返回静态照片" : "播放原始动态视频") {
                                guard ownerAuthorized, player != nil,
                                      let currentOwner = liveOwner,
                                      XDriveIOSNativePhotoOwnerScope.matches(
                                        login.owner, currentOwner
                                      ) else { return }
                                if showingLiveMotion {
                                    player?.pause()
                                } else {
                                    // Dismantle Photos' paired player before
                                    // starting the independent local MOV.
                                    livePlaybackRequest = nil
                                    nativeLiveReady = false
                                }
                                showingLiveMotion.toggle()
                            }
                            .disabled(!ownerAuthorized || player == nil)
                            .accessibilityIdentifier("native-ios-photoasset-live-motion")
                        }
                        Text(nativeLiveUnavailable
                             ? "原生 Live 配对不可用，仍可播放已校验的动态资源。"
                             : "已取得当前账户的 Live 双资源；原生配对优先，视频为回退。")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if let failure {
                        Text(failure).foregroundStyle(.secondary)
                            .font(.caption).padding(.horizontal)
                        Button("重试") {
                            if ownerAuthorized {
                                retirePreview()
                            }
                        }
                        .accessibilityIdentifier("native-ios-photoasset-viewer-retry")
                    }
                } else if let player {
                    XDriveIOSNativeAVPlayerStatusObserver(
                        player: player,
                        content: VideoPlayer(player: player)
                            .onAppear { if ownerAuthorized { player.play() } }
                            .onDisappear { player.pause() },
                        onFailed: { playbackLoadFailed($0) }
                    )
                } else if let image {
                    VStack(spacing: 6) {
                        XDriveIOSNativeZoomablePhotoView(image: image)
                            .onNavigateSwipe { navigateLoaded($0) }
                        if imageIsThumbnailOnly {
                            Text("原件适屏预览过大或无法解码，当前仅显示低清缩略图。可从顶部重试。")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 8)
                                .accessibilityIdentifier("native-ios-photoasset-still-lowres")
                        }
                    }
                } else if let failure {
                    VStack(spacing: 8) {
                        Text(failure).foregroundStyle(.secondary).padding(.horizontal)
                        Button("重试") {
                            if ownerAuthorized {
                                retirePreview()
                            }
                        }
                        .accessibilityIdentifier("native-ios-photoasset-viewer-retry")
                    }
                } else {
                    ProgressView("正在验证并打开云端媒体…")
                }
                if rangeCrossing {
                    ProgressView("正在核验相邻云端照片页…")
                        .accessibilityIdentifier("native-ios-photoasset-viewer-range-loading")
                }
                if let rangeCrossingMessage {
                    Text(rangeCrossingMessage).font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("native-ios-photoasset-viewer-range-error")
                }
            }
            .overlay(alignment: .topLeading) {
                if let image {
                    XDriveIOSNativeViewerQualityPanel(
                        fileName: viewed.node.name,
                        source: imageIsThumbnailOnly ? "缩略图回退" :
                            viewed.isLive ? "实况静态原件 · 适屏解码" :
                            "原件 · 适屏解码",
                        image: image,
                        originalBytes: viewed.node.size,
                        archiveOriginal: viewed.node.name.lowercased().hasSuffix(".livp"),
                        liveFiles: liveResources
                    )
                }
            }
            .navigationTitle(viewed.node.name)
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom) {
                if visibleItems.count > 1 || canCrossRange(-1) ||
                    canCrossRange(1) || rangeCrossing {
                    HStack(spacing: 12) {
                        Button("上一项") { navigateLoaded(-1) }
                            .disabled((neighbor(-1) == nil && !canCrossRange(-1)) ||
                                rangeCrossing || photosRestoreBusy)
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("native-ios-photoasset-viewer-previous")
                        Spacer(minLength: 4)
                        Text(loadedPosition.map { index in
                            if let range = visibleRange {
                                return "\(range.offset + index + 1)/\(range.total_count)"
                            }
                            return "\(index + 1)/\(visibleItems.count)（已加载）"
                        } ?? "当前媒体已变化")
                            .font(.caption).monospacedDigit()
                            .accessibilityIdentifier("native-ios-photoasset-viewer-position")
                        Spacer(minLength: 4)
                        Button("下一项") { navigateLoaded(1) }
                            .disabled((neighbor(1) == nil && !canCrossRange(1)) ||
                                rangeCrossing || photosRestoreBusy)
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("native-ios-photoasset-viewer-next")
                    }
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(.ultraThinMaterial)
                }
            }
            .toolbar {
                // Available even if an AVPlayer stalls without a terminal
                // status or the bottom controls are cramped in landscape.
                ToolbarItem(placement: .navigationBarLeading) {
                    if ownerAuthorized, player != nil {
                        Button {
                            retirePreview()
                        } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                        .accessibilityLabel("重新加载云端视频")
                        .accessibilityIdentifier("native-ios-photoasset-player-reload")
                    }
                }
                ToolbarItem(placement: .navigationBarLeading) {
                    if ownerAuthorized && imageIsThumbnailOnly {
                        Button { retirePreview() } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                        .accessibilityLabel("重新加载高清照片预览")
                        .accessibilityIdentifier("native-ios-photoasset-still-reload")
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    if photosRestoreBusy {
                        ProgressView().accessibilityLabel("正在保存云端原件到 iOS 照片")
                    } else {
                        Button {
                            if viewed.isLive {
                                photosRestoreNotice =
                                    "此云端 Live Photo 尚未提供完整原件配对导入；不能把静态预览保存为实况。已校验的 iPhone Live ZIP 可从“云端备份原件”恢复。"
                                photosRestoreNoticePresented = true
                            } else {
                                restorePhotoAssetOriginal()
                            }
                        } label: {
                            Label("保存到 iOS 照片", systemImage: "square.and.arrow.down")
                        }
                        .disabled(!ownerAuthorized || !viewed.supportsPreview)
                        .accessibilityIdentifier("native-ios-photoasset-original-save-to-photos")
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
            .alert("保存到 iOS 照片", isPresented: $photosRestoreNoticePresented) {
                Button("完成", role: .cancel) {}
            } message: {
                Text(photosRestoreNotice)
            }
        }
        .task(id: previewRequestID) {
            // Signed previews must not survive a scene/Owner generation.
            // The Viewer remains bound to the source Owner captured by L2,
            // even if the account has switched before this task begins.
            guard phase == .active, let expected = openedOwner,
                  ownerAuthorized,
                  XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
            else { return }
            let requestID = previewRequestID
            let target = viewed
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard phase == .active, previewRequestID == requestID,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected),
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected)
                else { return }
                if target.isLive {
                    let reader = XDriveIOSNativeMediaGalleryReader(
                        owner: auth.owner, accessToken: auth.accessToken
                    )
                    do {
                        let live = try await reader.livePreview(target)
                        // If a logout/scene change races the final download,
                        // discard both local originals before returning.
                        guard !Task.isCancelled, phase == .active,
                              previewRequestID == requestID,
                              XDriveIOSNativePhotoOwnerScope.matches(
                                login.owner, expected
                              ),
                              XDriveIOSNativePhotoOwnerScope.matches(
                                auth.owner, expected
                              ) else {
                            live.files.discard()
                            return
                        }
                        liveResources?.discard()
                        liveResources = live.files
                        liveOwner = expected
                        image = live.image
                        imageIsThumbnailOnly = false
                        player = AVPlayer(url: live.files.motionURL)
                        failure = nil
                    } catch is CancellationError {
                        throw CancellationError()
                    } catch {
                        // An unsupported or revoked pair is NEVER presented as
                        // a working Live Photo. Retain a verified still where
                        // possible; allow an explicit retry, not background polling.
                        guard phase == .active, previewRequestID == requestID,
                              XDriveIOSNativePhotoOwnerScope.matches(
                                login.owner, expected
                              ) else { return }
                        failure = "Live 动态资源暂不可用；可重试配对，静态封面将独立读取。"
                        if let still = try? await reader.thumbnail(target) {
                            try Task.checkCancellation()
                            guard phase == .active, previewRequestID == requestID,
                                  XDriveIOSNativePhotoOwnerScope.matches(
                                    login.owner, expected
                                  ) else { return }
                            image = still
                            imageIsThumbnailOnly = true
                        }
                    }
                } else {
                    let reader = XDriveIOSNativeMediaGalleryReader(
                        owner: auth.owner, accessToken: auth.accessToken
                    )
                    do {
                        // Preserve the verified one-shot preview contract.
                        // The fallback Reader below is constructed with the
                        // identical frozen Owner and bearer only on demand.
                        let media = try await XDriveIOSNativeMediaGalleryReader(
                            owner: auth.owner, accessToken: auth.accessToken
                        ).preview(target)
                        try Task.checkCancellation()
                        guard phase == .active, previewRequestID == requestID,
                              XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected),
                              XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected)
                        else { return }
                        image = media.image
                        imageIsThumbnailOnly = false
                        if let url = media.videoURL { player = AVPlayer(url: url) }
                    } catch XDriveIOSNativeMediaStillPreviewFallback.unavailable {
                        // Never hide access revocation or a failed video/Live
                        // behind a thumbnail. Only this already selected still
                        // can use its independent bounded revision derivative.
                        guard target.supportsPreview, !target.isLive, !target.isVideo
                        else { throw XDriveIOSNativeMediaReadFailure.unsupported }
                        let thumbnail = try await reader.thumbnail(target)
                        try Task.checkCancellation()
                        guard phase == .active, previewRequestID == requestID,
                              XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected),
                              XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected)
                        else { return }
                        image = thumbnail
                        imageIsThumbnailOnly = true
                        failure = nil
                    }
                }
            } catch is CancellationError {
                // The generation has retired. Do not display a stale error.
            } catch {
                guard phase == .active, previewRequestID == requestID,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                failure = "该云端媒体预览暂不可用，未读取其他账户的数据。"
            }
        }
        // AVPlayer may fail after the signed URL has already been accepted.
        // Handle only this exact active item; an old player must not change
        // the new Viewer during rapid left/right navigation or account switch.
        .onReceive(NotificationCenter.default.publisher(
            for: .AVPlayerItemFailedToPlayToEndTime
        ).receive(on: RunLoop.main)) { notification in
            guard ownerAuthorized,
                  let failed = notification.object as? AVPlayerItem,
                  let playing = player?.currentItem, failed === playing else { return }
            player?.pause()
            player?.replaceCurrentItem(with: nil)
            player = nil
            showingLiveMotion = false
            failure = "媒体播放失败，请重试当前云端照片或视频。"
        }
        .onChange(of: phase) { _ in
            if phase != .active { cancelRangeCrossing() }
            // The iOS Photos permission dialog can briefly make the scene
            // inactive. No download starts until it has returned; a genuine
            // background transition always cancels the pending restore.
            if phase != .active &&
                (phase == .background || !photosPermissionPrompt) {
                cancelPhotosRestore()
            }
            // iOS app switcher must not expose signed still/video or local
            // Live originals. Foreground re-verifies Owner before fetching.
            retirePreview()
        }
        .onChange(of: login.owner) { _ in
            cancelRangeCrossing()
            cancelPhotosRestore()
            retirePreview()
            dismiss()
        }
        .onDisappear { cancelRangeCrossing() }
        .onDisappear { cancelPhotosRestore() }
        .onDisappear { retirePreview() }
    }

    private func cancelPhotosRestore() {
        photosRestoreEpoch = UUID()
        photosRestoreTask?.cancel()
        photosRestoreTask = nil
        photosRestoreBusy = false
        photosPermissionPrompt = false
        photosRestoreNoticePresented = false
    }

    private func canCommitPhotosRestore(
        _ selected: XDriveIOSNativeMediaItem,
        owner: XDriveNativeOwnerRoot, epoch: UUID
    ) -> Bool {
        ownerAuthorized && !Task.isCancelled &&
        photosRestoreEpoch == epoch &&
        viewed.id == selected.id &&
        viewed.node.revision == selected.node.revision &&
        viewed.node.name == selected.node.name &&
        viewed.isVideo == selected.isVideo && !viewed.isLive &&
        XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner)
    }

    /// User-initiated import of this verified cloud PhotoAsset's original
    /// still or video. The independent L3 export does not touch backup
    /// receipts, upload sessions, cloud Nodes, or the local PhotoKit inventory.
    private func restorePhotoAssetOriginal() {
        guard !photosRestoreBusy, ownerAuthorized, !viewed.isLive,
              viewed.supportsPreview, let owner = openedOwner else { return }
        let selected = viewed
        let epoch = UUID()
        photosRestoreEpoch = epoch
        photosRestoreBusy = true
        photosRestoreTask = Task { @MainActor in
            defer {
                if photosRestoreEpoch == epoch {
                    photosRestoreBusy = false
                    photosRestoreTask = nil
                }
            }
            do {
                photosPermissionPrompt = true
                let permission = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
                if photosRestoreEpoch == epoch {
                    photosPermissionPrompt = false
                }
                try Task.checkCancellation()
                guard canCommitPhotosRestore(selected, owner: owner, epoch: epoch)
                else { return }
                guard permission == .authorized || permission == .limited else {
                    photosRestoreNotice = "请先在 iOS 设置中允许 xDrive 向系统照片添加内容。"
                    photosRestoreNoticePresented = true
                    return
                }
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard canCommitPhotosRestore(selected, owner: owner, epoch: epoch),
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, owner)
                else { return }
                let reader = XDriveIOSNativeMediaGalleryReader(
                    owner: auth.owner, accessToken: auth.accessToken
                )
                let originalURL = try await reader.downloadOriginalForPhotos(selected)
                defer {
                    try? FileManager.default.removeItem(
                        at: originalURL.deletingLastPathComponent()
                    )
                }
                guard canCommitPhotosRestore(selected, owner: owner, epoch: epoch)
                else { return }
                let kind: PHAssetResourceType = selected.isVideo ? .video : .photo
                try await PHPhotoLibrary.shared().performChanges {
                    let asset = PHAssetCreationRequest.forAsset()
                    asset.addResource(with: kind, fileURL: originalURL, options: nil)
                }
                try Task.checkCancellation()
                guard canCommitPhotosRestore(selected, owner: owner, epoch: epoch)
                else { return }
                photosRestoreNotice = "已将云端原件添加到 iOS 照片，原云端照片保持不变。"
                photosRestoreNoticePresented = true
            } catch is CancellationError {
                // A retired Viewer/Owner/scene discards the temporary original.
            } catch {
                guard canCommitPhotosRestore(selected, owner: owner, epoch: epoch)
                else { return }
                photosRestoreNotice =
                    "保存未完成，请检查网络、系统照片权限、存储空间及云端原件格式后重试。"
                photosRestoreNoticePresented = true
            }
        }
    }

    @MainActor
    private func playbackLoadFailed(_ failed: AVPlayerItem) {
        guard ownerAuthorized,
              let playing = player?.currentItem, failed === playing else { return }
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        player = nil
        showingLiveMotion = false
        failure = "媒体播放失败，请重试当前云端照片或视频。"
    }

    private func retirePreview() {
        // Also cancels the .task(id:) network/decoder generation.
        previewRequestID = UUID()
        player?.pause()
        player = nil
        image = nil
        imageIsThumbnailOnly = false
        failure = nil
        liveResources?.discard()
        liveResources = nil
        liveOwner = nil
        livePlaybackRequest = nil
        nativeLiveReady = false
        nativeLiveUnavailable = false
        showingLiveMotion = false
        showsStaticStill = false
    }
}

/// Root and album-specific media wall share one Owner-verified ranged source.
struct XDriveIOSNativeServerMediaWall: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let album: XDriveIOSNativeMediaAlbum?
    var placeID: String? = nil
    // Focus visibility belongs to the owning native five-tab shell.
    var onFocusChange: ((Bool) -> Void)? = nil
    @StateObject private var model = XDriveIOSNativeMediaWallModel()
    @Environment(\.scenePhase) private var phase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showingGalleryHelp = false
    @State private var selected: XDriveIOSNativeMediaItem?
    @State private var viewerLoadedItems: [XDriveIOSNativeMediaItem] = []
    @State private var viewerLoadedRange: XDriveIOSNativeMediaRange?
    @State private var viewerOpenedOwner: XDriveNativeOwnerRoot?
    @State private var searchDraft = ""
    @State private var appliedSearch = ""
    @State private var lastOpenedMediaID: UInt64?
    @State private var lastOpenedRevision: UInt64?
    @State private var lastOpenedOwner: XDriveNativeOwnerRoot?
    // VoiceOver focus is transient and remains scoped to the current Owner.
    @AccessibilityFocusState private var accessibilityFocusedMediaID: UInt64?
    @State private var focusedBrowsing = false

    var body: some View {
        GeometryReader { viewport in
        // Presentation-only safe-area measurement. The exact Owner, 48-item
        // current page, L2 intent and L3 Viewer are owned outside this branch.
        let compactGallery = viewport.size.width >= 680 &&
            viewport.size.height < 500 && !dynamicTypeSize.isAccessibilitySize
        ScrollViewReader { returnScroll in
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if !compactGallery {
                    Text(placeID != nil ?
                        "当前 Owner 原始 GPS 地点的授权 PhotoAsset 分页（非全库）。" :
                        album == nil ?
                        "服务器 PhotoAsset 全库照片墙（非仅 iPhone 备份目录）。" :
                        "已验证的云端相册成员，按服务器分页读取。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                HStack(spacing: 8) {
                    TextField("搜索当前云端图库", text: $searchDraft)
                        .textFieldStyle(.roundedBorder)
                        .submitLabel(.search)
                        .onSubmit { applySearch() }
                        .accessibilityIdentifier("native-ios-server-gallery-search")
                    Button("搜索") { applySearch() }
                        .disabled(model.busy || searchDraft.unicodeScalars.count > 200)
                    if !appliedSearch.isEmpty {
                        Button("清除") {
                            searchDraft = ""
                            appliedSearch = ""
                            model.load(login: login, albumID: album?.id, placeID: placeID, search: "")
                        }
                        .disabled(model.busy)
                    }
                }
                if searchDraft.unicodeScalars.count > 200 {
                    Text("搜索词不能超过 200 个字符。")
                        .font(.caption).foregroundStyle(.red)
                }
                if let page = model.page {
                    Text(page.total_count == 0 ?
                        "当前没有已索引且可访问的云端媒体；这不代表服务器没有原件。" :
                        "照片 \(page.offset + 1)–\(page.offset + page.items.count) / \(page.total_count)")
                        .font(.caption).foregroundStyle(.secondary)
                    LazyVGrid(
                        columns: [GridItem(.adaptive(minimum: 90, maximum: 145), spacing: 3)],
                        spacing: 3
                    ) {
                        ForEach(page.items) { item in
                            Button {
                                // Freeze the already-authorized 48-item page.
                                // The hidden L2 wall never fetches new neighbors.
                                viewerLoadedItems = model.page?.items ?? []
                                viewerLoadedRange = model.page
                                viewerOpenedOwner = login.owner
                                selected = item
                            } label: {
                                XDriveIOSNativeMediaWallTile(
                                    item: item, viewerActive: selected != nil,
                                    model: model, login: login
                                )
                                // Reset stale thumbnail pixels, not the Node-ID focus anchor.
                                .id(XDriveIOSNativeMediaWallTileIdentity(
                                    item: item, owner: login.owner
                                ))
                            }
                            .buttonStyle(.plain)
                            .disabled(!item.supportsPreview)
                            .accessibilityIdentifier("native-ios-server-media-tile")
                            .id(item.id)
                            .accessibilityFocused($accessibilityFocusedMediaID, equals: item.id)
                        }
                    }
                    HStack {
                        Button("上一页") {
                            model.load(login: login, albumID: album?.id, placeID: placeID,
                                       offset: max(0, page.offset - 48), search: appliedSearch)
                        }
                        .disabled(model.busy || page.offset == 0)
                        Spacer()
                        Button("下一页") {
                            model.load(login: login, albumID: album?.id, placeID: placeID,
                                       offset: page.offset + page.items.count, search: appliedSearch)
                        }
                        .disabled(model.busy || page.offset + page.items.count >= page.total_count)
                    }.buttonStyle(.bordered)
                }
                if model.busy { ProgressView("读取云端图库…") }
                if let message = model.error {
                    Text(message).foregroundStyle(.red)
                    Button("重试读取") {
                        model.load(login: login, albumID: album?.id, placeID: placeID,
                                   offset: model.failedOffset ?? model.page?.offset ?? 0,
                                   search: appliedSearch)
                    }
                }
                if !compactGallery {
                    Text("每次最多保留 48 个逻辑媒体；只有当前可见图片申请授权缩略图。缩略图缺失不代表原件丢失。")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(12)
        }
        .onChange(of: selected?.id) { selectedID in
            if let selectedID {
                lastOpenedMediaID = selectedID
                lastOpenedRevision = selected?.node.revision
                lastOpenedOwner = login.owner
                accessibilityFocusedMediaID = nil
                // Guaranteed foreground priority, independent of whether
                // SwiftUI sends onDisappear to the covered photo wall.
                model.suspendForViewer()
            } else {
                viewerLoadedItems = []
                viewerLoadedRange = nil
                viewerOpenedOwner = nil
                // Only return focus to the identical current Node revision
                // under the same verified Owner. A different revision/page
                // cannot inherit the prior Viewer focus just by reusing ID.
                let ownerAuthorized = lastOpenedOwner.map {
                    XDriveIOSNativePhotoOwnerScope.matches(login.owner, $0)
                } ?? false
                let anchor = XDriveIOSNativePhotoViewerReturnAnchorPolicy.cloudTarget(
                    lastOpenedID: lastOpenedMediaID,
                    lastOpenedRevision: lastOpenedRevision,
                    in: model.page?.items.map {
                        (id: $0.id, revision: $0.node.revision)
                    } ?? [],
                    ownerAuthorized: ownerAuthorized && phase == .active
                )
                lastOpenedMediaID = nil
                lastOpenedRevision = nil
                lastOpenedOwner = nil
                if let anchor {
                    returnScroll.scrollTo(anchor, anchor: .center)
                    accessibilityFocusedMediaID = anchor
                } else {
                    accessibilityFocusedMediaID = nil
                }
            }
        }
        .navigationTitle(placeID == nil ? (album?.name ?? "云端图库") : "地点照片")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if album == nil && placeID == nil {
                ToolbarItem(placement: .navigationBarTrailing) {
                    NavigationLink {
                        XDriveIOSNativeOwnerPhotoMapScreen(
                            login: login, onFocusChange: onFocusChange
                        )
                    } label: {
                        Label("云端地图", systemImage: "map")
                    }
                    .accessibilityIdentifier("native-ios-server-gallery-map")
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    NavigationLink {
                        XDriveIOSNativeServerMediaAlbums(
                            login: login, onFocusChange: onFocusChange
                        )
                    } label: {
                        Label("云端相册", systemImage: "rectangle.stack")
                    }
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    focusedBrowsing.toggle()
                    onFocusChange?(focusedBrowsing)
                } label: {
                    Label(
                        focusedBrowsing ? "显示底部导航" : "专注浏览",
                        systemImage: focusedBrowsing ?
                            "arrow.down.right.and.arrow.up.left" :
                            "arrow.up.left.and.arrow.down.right"
                    )
                }
                .accessibilityIdentifier("native-ios-gallery-focus-toggle")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { showingGalleryHelp = true } label: {
                    Image(systemName: "info.circle")
                        .frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("云端图库说明")
                .accessibilityIdentifier("native-ios-cloud-gallery-layout-help")
            }
        }
        .alert("云端图库说明", isPresented: $showingGalleryHelp) {
            Button("完成", role: .cancel) {}
        } message: {
            Text("图库范围属于当前已验证 Server Owner：普通云端图库、指定相册和地图地点分别按授权读取，每页最多保留 48 个逻辑媒体。只有可见缩略图才发起请求；缩略图缺失不代表原件丢失。")
        }
        // The owning five-tab shell controls its custom bar; never show a
        // second system strip through a child toolbar override.
        .fullScreenCover(item: $selected) { initial in
            XDriveIOSNativeServerMediaPreview(
                item: initial, login: login,
                loadedItems: viewerLoadedItems,
                loadedRange: viewerLoadedRange,
                openedOwner: viewerOpenedOwner,
                onNavigate: { next in
                    guard phase == .active, selected?.id == initial.id,
                          let opened = viewerOpenedOwner,
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, opened),
                          let current = model.page,
                          current.items.count == viewerLoadedItems.count,
                          current.items.count <= 48,
                          zip(current.items, viewerLoadedItems).allSatisfy({
                            $0.0.id == $0.1.id &&
                            $0.0.node.revision == $0.1.node.revision
                          }),
                          next.supportsPreview,
                          current.items.contains(where: {
                            $0.id == next.id &&
                            $0.node.revision == next.node.revision
                          })
                    else { return false }
                    // L3 keeps the initial fullScreenCover identity. On close,
                    // focus the LAST accepted Node+revision, not the first.
                    lastOpenedMediaID = next.id
                    lastOpenedRevision = next.node.revision
                    lastOpenedOwner = opened
                    accessibilityFocusedMediaID = nil
                    return true
                },
                onCrossRange: { previous, anchor, direction in
                    guard phase == .active, selected?.id == initial.id,
                          let opened = viewerOpenedOwner,
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, opened),
                          model.page?.sameVisibleSnapshot(as: previous) == true,
                          viewerLoadedRange?.sameVisibleSnapshot(as: previous) == true,
                          let selectedIndex = previous.items.firstIndex(where: {
                            $0.sameVisibleRevision(as: anchor)
                          }),
                          let targetOffset =
                            XDriveIOSNativePhotoAssetRangeCursorPolicy.adjacentOffset(
                                current: previous.offset, count: previous.items.count,
                                total: previous.total_count,
                                selectedIndex: selectedIndex, direction: direction
                            )
                    else { throw XDriveIOSNativeMediaReadFailure.invalidScope }

                    let owner = try await login.verifiedAuthorization()
                    try Task.checkCancellation()
                    guard phase == .active, selected?.id == initial.id,
                          XDriveIOSNativePhotoOwnerScope.matches(owner.owner, opened),
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, opened)
                    else { throw XDriveIOSNativeMediaReadFailure.invalidScope }
                    let reader = XDriveIOSNativeMediaGalleryReader(
                        owner: owner.owner, accessToken: owner.accessToken
                    )
                    // The Server must prove the old page still has exactly
                    // the same members before an adjacent Range is accepted.
                    let reread = try await reader.page(
                        offset: previous.offset, albumID: album?.id,
                        placeID: placeID, search: appliedSearch
                    )
                    guard previous.sameVisibleSnapshot(as: reread) else {
                        throw XDriveIOSNativeMediaReadFailure.invalidPage
                    }
                    let next = try await reader.page(
                        offset: targetOffset, albumID: album?.id,
                        placeID: placeID, search: appliedSearch
                    )
                    try Task.checkCancellation()
                    guard next.total_count == previous.total_count,
                          next.offset == targetOffset,
                          next.limit == XDriveIOSNativeMediaGalleryReader.pageSize,
                          XDriveIOSNativePhotoAssetRangeCursorPolicy.validPage(
                            offset: next.offset, count: next.items.count,
                            total: next.total_count
                          ),
                          Set(next.items.map(\.id)).count == next.items.count,
                          phase == .active, selected?.id == initial.id,
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, opened),
                          model.page?.sameVisibleSnapshot(as: previous) == true
                    else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
                    return next
                },
                onCrossedRange: { next, verifiedRange in
                    guard phase == .active, selected?.id == initial.id,
                          let opened = viewerOpenedOwner,
                          let previous = viewerLoadedRange,
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, opened),
                          verifiedRange.items.contains(where: {
                            $0.sameVisibleRevision(as: next)
                          }),
                          model.acceptVerifiedViewerRange(
                            verifiedRange, after: previous, login: login,
                            albumID: album?.id, placeID: placeID,
                            search: appliedSearch
                          ) else { return false }
                    viewerLoadedItems = verifiedRange.items
                    viewerLoadedRange = verifiedRange
                    lastOpenedMediaID = next.id
                    lastOpenedRevision = next.node.revision
                    lastOpenedOwner = opened
                    accessibilityFocusedMediaID = nil
                    return true
                }
            )
        }
        .onAppear {
            if model.page == nil, !model.busy {
                model.load(login: login, albumID: album?.id, placeID: placeID, search: appliedSearch)
            }
        }
        .onChange(of: login.owner) { _ in
            viewerLoadedItems = []
            viewerLoadedRange = nil
            viewerOpenedOwner = nil
            focusedBrowsing = false
            onFocusChange?(false)
            lastOpenedMediaID = nil
            lastOpenedRevision = nil
            lastOpenedOwner = nil
            accessibilityFocusedMediaID = nil
            selected = nil
            model.invalidate()
            if login.owner != nil && phase == .active {
                model.load(login: login, albumID: album?.id, placeID: placeID, search: appliedSearch)
            }
        }
        .onChange(of: phase) { state in
            if state != .active {
                viewerLoadedItems = []
                viewerLoadedRange = nil
                viewerOpenedOwner = nil
                focusedBrowsing = false
                onFocusChange?(false)
                lastOpenedMediaID = nil
                lastOpenedRevision = nil
                lastOpenedOwner = nil
                accessibilityFocusedMediaID = nil
                selected = nil
                model.invalidate()
            } else if model.page == nil {
                model.load(login: login, albumID: album?.id, placeID: placeID, search: appliedSearch)
            }
        }
        .onDisappear {
            if selected != nil {
                model.suspendForViewer()
            } else {
                viewerLoadedItems = []
                viewerLoadedRange = nil
                viewerOpenedOwner = nil
                // A different feature/album should not inherit this wall's
                // L2 focus state or hide the global bottom navigation.
                focusedBrowsing = false
                onFocusChange?(false)
                accessibilityFocusedMediaID = nil
                model.suspendForNavigation()
                lastOpenedMediaID = nil
                lastOpenedRevision = nil
                lastOpenedOwner = nil
            }
        }
        }
        }

    }

    private func applySearch() {
        let query = searchDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.unicodeScalars.count <= 200 else { return }
        if query == appliedSearch && model.page != nil { return }
        appliedSearch = query
        lastOpenedMediaID = nil
        lastOpenedRevision = nil
        lastOpenedOwner = nil
        accessibilityFocusedMediaID = nil
        model.load(login: login, albumID: album?.id, placeID: placeID, offset: 0, search: query)
    }
}

/// Server collection index is distinct from local PhotoKit smart/user albums.
struct XDriveIOSNativeServerMediaAlbums: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    var onFocusChange: ((Bool) -> Void)? = nil
    @Environment(\.scenePhase) private var phase
    @State private var albums: [XDriveIOSNativeMediaAlbum] = []
    @State private var error: String?
    @State private var busy = false
    @State private var job: Task<Void, Never>?
    @State private var epoch = UUID()

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                Text("云端相册归属于当前 Server Owner，与 iPhone 本机相册分开管理。")
                    .font(.caption).foregroundStyle(.secondary)
                ForEach(albums) { album in
                    NavigationLink {
                        XDriveIOSNativeServerMediaWall(
                            login: login, album: album, onFocusChange: onFocusChange
                        )
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "rectangle.stack")
                            VStack(alignment: .leading, spacing: 4) {
                                Text(album.name)
                                Text("\(album.item_count) 项 · \(album.kind)")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, 6)
                    }
                    .buttonStyle(.plain)
                }
                if busy { ProgressView("读取云端相册…") }
                if let error {
                    Text(error).foregroundStyle(.red)
                    Button("重新读取") { reload() }
                }
                if !busy && error == nil && albums.isEmpty {
                    Text("当前 Owner 没有云端相册，或没有可显示的相册。")
                        .foregroundStyle(.secondary)
                }
            }
            .padding(12)
        }
        .navigationTitle("云端相册")
        .onAppear { if albums.isEmpty { reload() } }
        .onChange(of: login.owner) { _ in
            invalidate()
            if login.owner != nil { reload() }
        }
        .onChange(of: phase) { state in
            if state == .active { reload() } else { invalidate() }
        }
        .onDisappear {
            // Pushing an album wall must not remove the NavigationLink's
            // underlying album identity from its original list. Retire the
            // generation before cancelling so late results cannot write back.
            epoch = UUID()
            job?.cancel()
            job = nil
            busy = false
        }
    }

    private func reload() {
        invalidate()
        guard let expected = login.owner else {
            error = "当前未登录已验证的服务器账户。"
            return
        }
        let ticket = epoch
        busy = true
        job = Task { @MainActor in
            defer { if epoch == ticket { busy = false; job = nil } }
            do {
                let auth = try await login.verifiedAuthorization()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected)
                else { throw XDriveIOSNativeMediaReadFailure.invalidScope }
                let items = try await XDriveIOSNativeMediaGalleryReader(
                    owner: auth.owner, accessToken: auth.accessToken
                ).albums()
                try Task.checkCancellation()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                albums = items
            } catch is CancellationError {
            } catch {
                guard epoch == ticket else { return }
                self.error = "无法读取当前 Owner 的云端相册，请检查网络或权限。"
            }
        }
    }

    private func invalidate() {
        epoch = UUID()
        job?.cancel()
        job = nil
        albums = []
        error = nil
        busy = false
    }
}

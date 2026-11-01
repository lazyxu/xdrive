import AVFoundation
import AVKit
import Combine
import Photos
import PhotosUI
import SwiftUI
import UIKit

/// One locally authorized image resource. Neither source IDs nor pixels are
/// persisted or uploaded by the read-only Photos viewer.
@MainActor
final class XDriveIOSPhotoImageLoader: ObservableObject {
    @Published private(set) var image: UIImage?
    private var request: PHImageRequestID = PHInvalidImageRequestID
    private var epoch = UUID()

    func load(_ id: String, size: CGSize) {
        cancel()
        let token = epoch
        guard [.authorized, .limited].contains(
            PHPhotoLibrary.authorizationStatus(for: .readWrite)
        ), let asset = PHAsset.fetchAssets(
            withLocalIdentifiers: [id], options: nil
        ).firstObject else { return }
        let settings = PHImageRequestOptions()
        settings.isNetworkAccessAllowed = false
        settings.deliveryMode = .opportunistic
        settings.resizeMode = .fast
        request = PHImageManager.default().requestImage(
            for: asset, targetSize: size, contentMode: .aspectFill,
            options: settings
        ) { [weak self] result, _ in
            Task { @MainActor [weak self] in
                guard let self, self.epoch == token,
                      [.authorized, .limited].contains(
                        PHPhotoLibrary.authorizationStatus(for: .readWrite)
                      ) else { return }
                if let result { self.image = result }
            }
        }
    }

    func cancel() {
        epoch = UUID()
        if request != PHInvalidImageRequestID {
            PHImageManager.default().cancelImageRequest(request)
            request = PHInvalidImageRequestID
        }
        image = nil
    }
}

struct XDriveIOSLocalPhotoTile: View {
    let candidate: XDrivePhotoKitScanCandidate
    @StateObject private var loader = XDriveIOSPhotoImageLoader()

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            if let image = loader.image {
                Image(uiImage: image)
                    .resizable().scaledToFill()
                    .frame(maxWidth: .infinity).frame(height: 108).clipped()
            } else {
                Rectangle().fill(Color(uiColor: .secondarySystemGroupedBackground))
                    .overlay { Image(systemName: "photo").foregroundStyle(.secondary) }
                    .frame(height: 108)
            }
            if candidate.kind == "video" || candidate.isLive {
                Image(systemName: candidate.kind == "video" ? "play.circle.fill" : "livephoto")
                    .font(.title3).foregroundStyle(.white)
                    .padding(6).shadow(radius: 2)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 7))
        .task(id: candidate.id) {
            loader.load(candidate.id, size: CGSize(width: 280, height: 280))
        }
        .onDisappear { loader.cancel() }
        .accessibilityLabel(candidate.isLive ? "实况照片" :
            candidate.kind == "video" ? "视频" : "照片")
    }
}

@MainActor
final class XDriveIOSLocalPhotoDetailModel: ObservableObject {
    @Published var still: UIImage?
    @Published var live: PHLivePhoto?
    @Published var player: AVPlayer?
    @Published var message: String?
    // iCloud originals are requested only after a direct tap in the Viewer.
    // Thumbnail/wall requests and the automatic backup runner remain unchanged.
    @Published private(set) var needsICloudFetch = false
    @Published private(set) var downloadingFromICloud = false
    private var pendingICloudParts = Set<String>()
    private var requests: [PHImageRequestID] = []
    private var epoch = UUID()

    func load(_ candidate: XDrivePhotoKitScanCandidate, allowICloud: Bool = false) {
        cancel()
        let token = epoch
        guard [.authorized, .limited].contains(
            PHPhotoLibrary.authorizationStatus(for: .readWrite)
        ), let asset = PHAsset.fetchAssets(
            withLocalIdentifiers: [candidate.id], options: nil
        ).firstObject else {
            message = "照片授权已更改，或这张原件已不可访问。"
            return
        }
        if allowICloud {
            pendingICloudParts.insert("primary")
            if candidate.isLive { pendingICloudParts.insert("live") }
            downloadingFromICloud = true
        }

        if candidate.kind == "video" {
            let options = PHVideoRequestOptions()
            options.isNetworkAccessAllowed = allowICloud
            let id = PHImageManager.default().requestAVAsset(
                forVideo: asset, options: options
            ) { [weak self] movie, _, _ in
                Task { @MainActor [weak self] in
                    guard let self, self.epoch == token,
                          [.authorized, .limited].contains(
                            PHPhotoLibrary.authorizationStatus(for: .readWrite)
                          ) else { return }
                    if let movie {
                        self.player = AVPlayer(playerItem: AVPlayerItem(asset: movie))
                        self.needsICloudFetch = false
                    } else {
                        self.needsICloudFetch = true
                        self.message = allowICloud ?
                            "从 iCloud 获取当前视频失败，可检查网络后重试。" :
                            "本机视频不可读取（可能仅保存在 iCloud）。"
                    }
                    self.finishICloudPart("primary", token: token)
                }
            }
            requests.append(id)
        } else {
            let options = PHImageRequestOptions()
            options.isNetworkAccessAllowed = allowICloud
            options.deliveryMode = .highQualityFormat
            let id = PHImageManager.default().requestImage(
                for: asset, targetSize: CGSize(width: 1800, height: 1800),
                contentMode: .aspectFit, options: options
            ) { [weak self] picture, info in
                // PhotoKit can return no local pixels for an iCloud-only
                // original when network access is intentionally disabled.
                // Never leave a permanent spinner for this terminal result.
                let degraded = info?[PHImageResultIsDegradedKey] as? Bool == true
                let cancelled = info?[PHImageCancelledKey] as? Bool == true
                let inCloud = info?[PHImageResultIsInCloudKey] as? Bool == true
                Task { @MainActor [weak self] in
                    guard let self, self.epoch == token,
                          [.authorized, .limited].contains(
                            PHPhotoLibrary.authorizationStatus(for: .readWrite)
                          ) else { return }
                    if let picture {
                        self.still = picture
                        self.message = nil
                        if !degraded && !candidate.isLive {
                            self.needsICloudFetch = false
                        }
                    } else if !degraded && !cancelled && self.live == nil {
                        self.needsICloudFetch = true
                        if self.still == nil {
                            self.message = allowICloud ?
                                "从 iCloud 获取当前照片失败，可检查网络后重试。" :
                                "本机照片暂不可读取（可能仅保存在 iCloud）。"
                        }
                    }
                    if !allowICloud && inCloud { self.needsICloudFetch = true }
                    if !degraded { self.finishICloudPart("primary", token: token) }
                }
            }
            requests.append(id)
            if candidate.isLive {
                let liveOptions = PHLivePhotoRequestOptions()
                liveOptions.isNetworkAccessAllowed = allowICloud
                let liveID = PHImageManager.default().requestLivePhoto(
                    for: asset, targetSize: CGSize(width: 1800, height: 1800),
                    contentMode: .aspectFit, options: liveOptions
                ) { [weak self] photo, info in
                    let degraded = info?[PHImageResultIsDegradedKey] as? Bool == true
                    let cancelled = info?[PHImageCancelledKey] as? Bool == true
                    Task { @MainActor [weak self] in
                        guard let self, self.epoch == token,
                              [.authorized, .limited].contains(
                                PHPhotoLibrary.authorizationStatus(for: .readWrite)
                              ) else { return }
                        if let photo {
                            self.live = photo
                            self.needsICloudFetch = false
                            self.message = nil
                        } else if !degraded && !cancelled {
                            self.needsICloudFetch = true
                            if allowICloud {
                                self.message = "iCloud 实况动态资源暂不可用，仍可查看静态照片并重试。"
                            }
                        }
                        if !degraded { self.finishICloudPart("live", token: token) }
                    }
                }
                requests.append(liveID)
            }
        }
    }

    private func finishICloudPart(_ part: String, token: UUID) {
        guard epoch == token else { return }
        pendingICloudParts.remove(part)
        downloadingFromICloud = !pendingICloudParts.isEmpty
    }

    /// A failed AVPlayer item must not leave a blank native VideoPlayer.
    /// Retire only the item currently owned by this PhotoKit detail model.
    func playbackFailed(_ failed: AVPlayerItem) {
        guard let active = player?.currentItem, active === failed else { return }
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        player = nil
        message = "本机视频播放失败，请重试当前媒体。"
    }

    func cancel() {
        epoch = UUID()
        pendingICloudParts.removeAll()
        downloadingFromICloud = false
        needsICloudFetch = false
        player?.pause()
        for id in requests { PHImageManager.default().cancelImageRequest(id) }
        requests = []
        player = nil
        live = nil
        still = nil
        message = nil
    }
}

private struct XDriveIOSNativeLivePhotoView: UIViewRepresentable {
    let live: PHLivePhoto
    let playbackRequest: UUID?

    final class Coordinator {
        var lastPlayed: UUID?
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> PHLivePhotoView {
        let view = PHLivePhotoView()
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ view: PHLivePhotoView, context: Context) {
        if view.livePhoto !== live {
            view.stopPlayback()
            view.livePhoto = live
            context.coordinator.lastPlayed = nil
        }
        // A stable render or rotation must not restart a Live Photo. Playback
        // begins only after a fresh tap, or by the system's normal long press.
        if let playbackRequest, context.coordinator.lastPlayed != playbackRequest {
            context.coordinator.lastPlayed = playbackRequest
            view.startPlayback(with: .full)
        }
    }

    static func dismantleUIView(_ view: PHLivePhotoView, coordinator: Coordinator) {
        view.stopPlayback()
        view.livePhoto = nil
        coordinator.lastPlayed = nil
    }
}

/// A full-screen detail has its own observer: the presenting wall suspends
/// PhotoKit scans while the Viewer is open. Revoke on any library mutation,
/// not only when the source grid happens to refresh.
private final class XDriveIOSNativePhotoDetailChangeMonitor: NSObject,
    ObservableObject, PHPhotoLibraryChangeObserver {
    @Published private(set) var generation = 0
    private var listening = false

    func start() {
        guard !listening else { return }
        PHPhotoLibrary.shared().register(self)
        listening = true
    }

    func stop() {
        guard listening else { return }
        PHPhotoLibrary.shared().unregisterChangeObserver(self)
        listening = false
    }

    func photoLibraryDidChange(_ change: PHChange) {
        DispatchQueue.main.async { [weak self] in
            self?.generation &+= 1
        }
    }

    deinit { stop() }
}

struct XDriveIOSNativeLocalPhotoDetail: View {
    let candidate: XDrivePhotoKitScanCandidate
    /// A bounded copy of the currently authorized PhotoKit page, never full-library.
    var loadedItems: [XDrivePhotoKitScanCandidate] = []
    var onViewed: ((XDrivePhotoKitScanCandidate) -> Void)? = nil
    @State private var activeItem: XDrivePhotoKitScanCandidate?
    @State private var requestedICloudForCurrentItem = false
    @State private var showsLiveStill = false
    @State private var livePlaybackRequest: UUID?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @StateObject private var model = XDriveIOSLocalPhotoDetailModel()
    @StateObject private var changes = XDriveIOSNativePhotoDetailChangeMonitor()

    private var viewed: XDrivePhotoKitScanCandidate { activeItem ?? candidate }

    private var currentPageAuthorized: Bool {
        phase == .active && changes.generation == 0 &&
        [.authorized, .limited].contains(
            PHPhotoLibrary.authorizationStatus(for: .readWrite)
        )
    }

    private var loadedPosition: Int? {
        XDriveIOSNativePhotoViewerReturnAnchorPolicy.localLoadedIndex(
            currentID: viewed.id, in: loadedItems.map(\.id),
            authorized: currentPageAuthorized
        )
    }

    private func neighbor(_ direction: Int) -> XDrivePhotoKitScanCandidate? {
        guard let id = XDriveIOSNativePhotoViewerReturnAnchorPolicy.localNeighborID(
            currentID: viewed.id, in: loadedItems.map(\.id),
            direction: direction, authorized: currentPageAuthorized
        ) else { return nil }
        return loadedItems.first(where: { $0.id == id })
    }

    private func showNeighbor(_ direction: Int) {
        guard let next = neighbor(direction),
              let asset = PHAsset.fetchAssets(
                withLocalIdentifiers: [next.id], options: nil
              ).firstObject,
              asset.creationDate == next.capturedAt,
              asset.modificationDate == next.modifiedAt,
              (next.kind == "image" && asset.mediaType == .image &&
                 next.isLive == asset.mediaSubtypes.contains(.photoLive)) ||
              (next.kind == "video" && asset.mediaType == .video)
        else { return }
        // Revoke the previous item's PhotoKit requests and playback before
        // admitting a replacement. No hidden wall/next-page fetch or upload.
        showsLiveStill = false
        livePlaybackRequest = nil
        requestedICloudForCurrentItem = false
        model.cancel()
        activeItem = next
        onViewed?(next)
    }

    private func loadCurrentFromICloud() {
        // The action must never fetch an older deleted/edited/restricted ID.
        guard currentPageAuthorized,
              let asset = PHAsset.fetchAssets(
                withLocalIdentifiers: [viewed.id], options: nil
              ).firstObject,
              asset.creationDate == viewed.capturedAt,
              asset.modificationDate == viewed.modifiedAt,
              (viewed.kind == "image" && asset.mediaType == .image &&
               viewed.isLive == asset.mediaSubtypes.contains(.photoLive)) ||
              (viewed.kind == "video" && asset.mediaType == .video)
        else {
            model.cancel()
            return
        }
        requestedICloudForCurrentItem = true
        model.load(viewed, allowICloud: true)
    }

    var body: some View {
        NavigationStack {
            Group {
                if let player = model.player {
                    VideoPlayer(player: player)
                        .onAppear { player.play() }
                } else if let live = model.live, !showsLiveStill {
                    XDriveIOSNativeLivePhotoView(
                        live: live, playbackRequest: livePlaybackRequest
                    )
                    .accessibilityLabel("实况照片，长按播放，或点击播放实况")
                } else if let image = model.still {
                    XDriveIOSNativeZoomablePhotoView(image: image)
                        .accessibilityLabel("本机照片，可双指缩放或双击放大")
                } else if let message = model.message {
                    VStack(spacing: 8) {
                        Text(message).foregroundStyle(.secondary)
                        // The permission-revoked error is informative only:
                        // do not offer an enabled action that cannot run.
                        if phase == .active,
                           [.authorized, .limited].contains(
                             PHPhotoLibrary.authorizationStatus(for: .readWrite)
                           ) {
                            Button("重试") {
                                // Cancel old requests and re-fetch only this
                                // still-authorized PhotoKit ID, never iCloud.
                                guard phase == .active,
                                      [.authorized, .limited].contains(
                                        PHPhotoLibrary.authorizationStatus(for: .readWrite)
                                      ) else { return }
                                model.load(viewed)
                            }
                            .accessibilityIdentifier("native-ios-local-viewer-retry")
                        }
                    }
                } else {
                    ProgressView("正在读取已授权的本机媒体…")
                }
            }
            .navigationTitle(viewed.isLive ? "实况照片" :
                viewed.kind == "video" ? "视频" : "照片")
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom) {
                if model.needsICloudFetch || model.downloadingFromICloud ||
                   loadedItems.count > 1 || (viewed.isLive && model.live != nil) {
                    VStack(spacing: 8) {
                        if viewed.isLive && model.live != nil && currentPageAuthorized {
                            HStack(spacing: 12) {
                                Button(showsLiveStill ? "返回实况" : "放大静态照片") {
                                    guard currentPageAuthorized else { return }
                                    showsLiveStill.toggle()
                                    livePlaybackRequest = nil
                                }
                                .disabled(model.still == nil)
                                .accessibilityIdentifier("native-ios-local-live-still-toggle")

                                Button("播放实况") {
                                    guard currentPageAuthorized else { return }
                                    showsLiveStill = false
                                    livePlaybackRequest = UUID()
                                }
                                .accessibilityIdentifier("native-ios-local-live-play")
                            }
                            .frame(minHeight: 44)
                        }
                        if model.downloadingFromICloud {
                            ProgressView("正在从 iCloud 获取当前原件…")
                                .accessibilityIdentifier("native-ios-local-viewer-icloud-progress")
                        } else if model.needsICloudFetch && currentPageAuthorized {
                            Button(requestedICloudForCurrentItem ?
                                   "重试从 iCloud 加载当前原件" : "从 iCloud 加载当前原件") {
                                loadCurrentFromICloud()
                            }
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("native-ios-local-viewer-icloud-load")
                        }
                        if loadedItems.count > 1 {
                            HStack(spacing: 12) {
                                Button("上一项") { showNeighbor(-1) }
                                    .disabled(neighbor(-1) == nil)
                                Spacer(minLength: 4)
                                Text(loadedPosition.map {
                                    "\($0 + 1)/\(loadedItems.count)（已加载）"
                                } ?? "当前媒体已变化")
                                    .font(.caption).monospacedDigit()
                                    .accessibilityIdentifier("native-ios-local-viewer-position")
                                Spacer(minLength: 4)
                                Button("下一项") { showNeighbor(1) }
                                    .disabled(neighbor(1) == nil)
                            }
                            .accessibilityIdentifier("native-ios-local-viewer-neighbors")
                        }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(.ultraThinMaterial)
                }
            }
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .onAppear { changes.start() }
        .task(id: viewed.id) {
            // Never materialize PhotoKit pixels while the App is inactive.
            if phase == .active { model.load(viewed) }
        }
        .onChange(of: changes.generation) { _ in
            // Library mutation may revoke the selected media even when
            // the visible PhotoKit permission level stays Full or Limited.
            model.cancel()
            dismiss()
        }
        .onChange(of: phase) { state in
            if state != .active {
                requestedICloudForCurrentItem = false
                showsLiveStill = false
                livePlaybackRequest = nil
                // Remove still/Live/video from the app-switcher snapshot and
                // fence any asynchronous PhotoKit callbacks immediately.
                model.cancel()
            } else if [.authorized, .limited].contains(
                PHPhotoLibrary.authorizationStatus(for: .readWrite)
            ) {
                // Re-check the exact selected ID in the currently allowed
                // PhotoKit subset; never reuse an old image/pixel buffer.
                model.load(viewed)
            } else {
                model.cancel()
                dismiss()
            }
        }
        // A PhotoKit AVAsset can fail only after a successful requestAVAsset.
        // Reject failures from previous neighbors or retired modal players.
        .onReceive(NotificationCenter.default.publisher(
            for: .AVPlayerItemFailedToPlayToEndTime
        ).receive(on: RunLoop.main)) { notice in
            guard currentPageAuthorized,
                  let failed = notice.object as? AVPlayerItem,
                  model.player?.currentItem === failed else { return }
            model.playbackFailed(failed)
        }
        .onDisappear {
            changes.stop()
            model.cancel()
        }
    }
}

/// Read-only, 64-at-a-time PhotoKit grid. No 100k-sized Swift arrays.
struct XDriveIOSNativeLocalGalleryScreen: View {
    // Gallery shell retains only the coarse cursor across source/tab switches.
    // A newly mounted view always scans the currently authorized PhotoKit set.
    @Binding var savedOffset: Int
    @Environment(\.scenePhase) private var phase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showingGalleryHelp = false
    @State private var scanner: XDrivePhotoKitBoundedSnapshotScanner?
    @State private var page: XDrivePhotoKitScanPage?
    @State private var selected: XDrivePhotoKitScanCandidate?
    @State private var busy = false
    @State private var generation = UUID()
    @State private var task: Task<Void, Never>?
    @State private var errorMessage: String?
    // Page offset only: no PhotoKit ID is persisted across Viewer dismissal.
    // This localIdentifier is in-memory only and never part of route persistence.
    @State private var viewerReturnID: String?
    @State private var shouldRestoreViewerTile = false
    // VoiceOver focus is transient, like the in-memory Viewer tile anchor.
    // Never persist PhotoKit local identifiers in a route snapshot.
    @AccessibilityFocusState private var accessibilityFocusedTileID: String?
    @State private var pageRenderRevision: UInt64 = 0
    @State private var authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)

    var body: some View {
        GeometryReader { viewport in
        let compactGallery = viewport.size.width >= 680 &&
            viewport.size.height < 500 && !dynamicTypeSize.isAccessibilitySize
        ScrollViewReader { returnScroll in
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Always display the limited-access notice, even when short.
                if authorization == .limited || !compactGallery {
                    Text(authorization == .limited
                        ? "仅展示 iOS 已授权的部分照片与视频"
                        : "本机照片、视频、Live Photo")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                if authorization == .notDetermined {
                    Button("允许查看本机相册") {
                        Task {
                            _ = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
                            refresh()
                        }
                    }.buttonStyle(.borderedProminent)
                } else if authorization == .denied || authorization == .restricted {
                    Label("相册权限不可用，请在 iOS 设置中允许访问。", systemImage: "lock")
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        Link("打开 iOS 设置", destination: url)
                    }
                } else if let page {
                    Text("当前显示 \(page.startOffset + 1)–\(page.nextOffset) / \(page.totalAccessibleAssets)")
                        .font(.footnote).monospacedDigit()
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 95, maximum: 150), spacing: 3)], spacing: 3) {
                        ForEach(page.items.filter { $0.kind != "unsupported" }) { candidate in
                            Button {
                                viewerReturnID = candidate.id
                                accessibilityFocusedTileID = nil
                                selected = candidate
                            } label: {
                                XDriveIOSLocalPhotoTile(candidate: candidate)
                            }
                            .buttonStyle(.plain)
                            .id(candidate.id)
                            .accessibilityFocused($accessibilityFocusedTileID, equals: candidate.id)
                        }
                    }
                    HStack {
                        Button("上一页") { load(offset: max(0, page.startOffset - 64)) }
                            .disabled(busy || page.startOffset == 0)
                        Spacer()
                        Button("下一页") { load(offset: page.nextOffset) }
                            .disabled(busy || page.finished)
                    }
                    .buttonStyle(.bordered)
                } else if !busy {
                    Button("重新读取本机相册") { refresh() }
                        .buttonStyle(.bordered)
                }
                if busy { ProgressView("读取本机相册…") }
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
                if !compactGallery {
                    Text("只读取当前授权子集，缩略图不自动下载 iCloud 原件。权限、相册或 App 状态变化时旧页立即废弃。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Button("刷新") { refresh() }.disabled(busy)
            }.padding(12)
        }
        .onChange(of: pageRenderRevision) { _ in
            restoreViewerTile(using: returnScroll)
        }
        }
        }
        .navigationTitle("本机相册")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { showingGalleryHelp = true } label: {
                    Label("图库说明", systemImage: "info.circle")
                }
                .accessibilityIdentifier("native-ios-local-gallery-layout-help")
            }
        }
        .alert("本机相册说明", isPresented: $showingGalleryHelp) {
            Button("完成", role: .cancel) {}
        } message: {
            Text("仅展示 iOS 当前授权的照片、视频与 Live Photo；缩略图不自动下载 iCloud 原件，权限、相册或 App 状态变化时旧页立即废弃。每次最多读取 64 项。")
        }
        .fullScreenCover(item: $selected, onDismiss: { restoreAfterViewer() }) { initial in
            XDriveIOSNativeLocalPhotoDetail(
                candidate: initial,
                loadedItems: page?.items.filter { $0.kind != "unsupported" } ?? [],
                onViewed: { next in
                    // Keep the last actually viewed local item for the normal
                    // post-dismiss authorized re-read + focus restoration.
                    guard phase == .active, selected?.id == initial.id,
                          [.authorized, .limited].contains(
                            PHPhotoLibrary.authorizationStatus(for: .readWrite)
                          ),
                          page?.items.contains(where: {
                            $0.id == next.id && $0.kind == next.kind &&
                            $0.isLive == next.isLive &&
                            $0.capturedAt == next.capturedAt &&
                            $0.modifiedAt == next.modifiedAt
                          }) == true
                    else { return }
                    viewerReturnID = next.id
                    accessibilityFocusedTileID = nil
                }
            )
        }
        .onAppear {
            // Returning from a full-screen Viewer must not discard its source.
            if selected == nil && page == nil && !busy { refresh(at: savedOffset) }
        }
        .onChange(of: phase) { new in
            authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
            if new != .active {
                if selected != nil {
                    // Keep only the in-memory source anchor; dismissal still
                    // rereads PhotoKit and checks current authorization.
                    accessibilityFocusedTileID = nil
                    // The fullscreen Viewer owns its own privacy and PhotoKit
                    // revalidation. Retire the hidden wall, not the modal.
                    suspendForViewer()
                    page = nil
                    errorMessage = nil
                } else {
                    clearViewerTileAnchor()
                    invalidate()
                }
            } else if selected != nil {
                // Do not start a hidden 64-item scan while L3 is visible.
                // On reactivation the Viewer revalidates this exact asset.
                if authorization != .authorized && authorization != .limited {
                    clearViewerTileAnchor()
                    invalidate()
                }
            } else {
                refresh(at: savedOffset)
            }
        }
        .onDisappear {
            // fullScreenCover may hide its presenter before the Viewer closes.
            // Suspend disposable reads, not the presentation's selected identity.
            if selected != nil { suspendForViewer() }
            else { invalidate() }
        }
    }

    private func restoreAfterViewer() {
        // Never scroll to a stale position until PhotoKit has returned the
        // currently authorized page after the full-screen Viewer exits.
        shouldRestoreViewerTile = viewerReturnID != nil && phase == .active
        if phase == .active { refresh(at: savedOffset) }
        else {
            clearViewerTileAnchor()
            invalidate()
        }
    }

    private func restoreViewerTile(using scroll: ScrollViewProxy) {
        guard shouldRestoreViewerTile else { return }
        let authorized = authorization == .authorized || authorization == .limited
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

    private func refresh(at requestedOffset: Int = 0) {
        authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        invalidate()
        guard authorization == .authorized || authorization == .limited else {
            clearViewerTileAnchor()
            return
        }
        load(offset: max(0, requestedOffset))
    }

    private func load(offset: Int) {
        invalidate()
        let token = generation
        let current = XDrivePhotoKitBoundedSnapshotScanner()
        scanner = current
        busy = true
        task = Task { @MainActor in
            do {
                let total = try await current.start(atOffset: offset)
                let bounded = XDriveIOSNativeLocalGalleryPageCursorPolicy.clamp(
                    requested: offset, currentTotal: total
                )
                if bounded != offset {
                    // Only an out-of-range or invalid old cursor needs a
                    // second, freshly authorized PhotoKit snapshot.
                    _ = try await current.start(atOffset: bounded)
                }
                let next = try await current.nextPage()
                try Task.checkCancellation()
                guard generation == token, phase == .active else { return }
                page = next
                savedOffset = next.startOffset
                authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                pageRenderRevision &+= 1
            } catch is CancellationError {
            } catch {
                guard generation == token else { return }
                errorMessage = "照片库或授权发生变化，旧页已废弃；请刷新后再查看。"
            }
            if generation == token { busy = false }
        }
    }

    private func suspendForViewer() {
        generation = UUID()
        task?.cancel()
        task = nil
        if let scanner { Task { await scanner.reset() } }
        scanner = nil
        busy = false
        // Retain selected + current page until the full-screen Viewer closes.
    }

    private func invalidate() {
        generation = UUID()
        task?.cancel()
        task = nil
        if let scanner { Task { await scanner.reset() } }
        scanner = nil
        page = nil
        selected = nil
        busy = false
        errorMessage = nil
    }
}

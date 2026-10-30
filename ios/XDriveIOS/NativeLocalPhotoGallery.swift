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
    private var requests: [PHImageRequestID] = []
    private var epoch = UUID()

    func load(_ candidate: XDrivePhotoKitScanCandidate) {
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

        if candidate.kind == "video" {
            let options = PHVideoRequestOptions()
            options.isNetworkAccessAllowed = false
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
                    } else {
                        self.message = "本机视频不可读取（可能仅保存在 iCloud）。"
                    }
                }
            }
            requests.append(id)
        } else {
            let options = PHImageRequestOptions()
            options.isNetworkAccessAllowed = false
            options.deliveryMode = .highQualityFormat
            let id = PHImageManager.default().requestImage(
                for: asset, targetSize: CGSize(width: 1800, height: 1800),
                contentMode: .aspectFit, options: options
            ) { [weak self] picture, _ in
                Task { @MainActor [weak self] in
                    guard let self, self.epoch == token,
                          [.authorized, .limited].contains(
                            PHPhotoLibrary.authorizationStatus(for: .readWrite)
                          ) else { return }
                    if let picture { self.still = picture }
                }
            }
            requests.append(id)
            if candidate.isLive {
                let liveOptions = PHLivePhotoRequestOptions()
                liveOptions.isNetworkAccessAllowed = false
                let liveID = PHImageManager.default().requestLivePhoto(
                    for: asset, targetSize: CGSize(width: 1800, height: 1800),
                    contentMode: .aspectFit, options: liveOptions
                ) { [weak self] photo, _ in
                    Task { @MainActor [weak self] in
                        guard let self, self.epoch == token,
                              [.authorized, .limited].contains(
                                PHPhotoLibrary.authorizationStatus(for: .readWrite)
                              ) else { return }
                        if let photo { self.live = photo }
                    }
                }
                requests.append(liveID)
            }
        }
    }

    func cancel() {
        epoch = UUID()
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
    func makeUIView(context: Context) -> PHLivePhotoView {
        PHLivePhotoView()
    }
    func updateUIView(_ view: PHLivePhotoView, context: Context) {
        view.livePhoto = live
    }
}

struct XDriveIOSNativeLocalPhotoDetail: View {
    let candidate: XDrivePhotoKitScanCandidate
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model = XDriveIOSLocalPhotoDetailModel()

    var body: some View {
        NavigationStack {
            Group {
                if let player = model.player {
                    VideoPlayer(player: player)
                        .onAppear { player.play() }
                } else if let live = model.live {
                    XDriveIOSNativeLivePhotoView(live: live)
                        .accessibilityLabel("实况照片，长按播放")
                } else if let image = model.still {
                    XDriveIOSNativeZoomablePhotoView(image: image)
                        .accessibilityLabel("本机照片，可双指缩放或双击放大")
                } else if let message = model.message {
                    Text(message).foregroundStyle(.secondary)
                } else {
                    ProgressView("正在读取已授权的本机媒体…")
                }
            }
            .navigationTitle(candidate.isLive ? "实况照片" :
                candidate.kind == "video" ? "视频" : "照片")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .task(id: candidate.id) { model.load(candidate) }
        .onDisappear { model.cancel() }
    }
}

/// Read-only, 64-at-a-time PhotoKit grid. No 100k-sized Swift arrays.
struct XDriveIOSNativeLocalGalleryScreen: View {
    @Environment(\.scenePhase) private var phase
    @State private var scanner: XDrivePhotoKitBoundedSnapshotScanner?
    @State private var page: XDrivePhotoKitScanPage?
    @State private var selected: XDrivePhotoKitScanCandidate?
    @State private var busy = false
    @State private var generation = UUID()
    @State private var task: Task<Void, Never>?
    @State private var errorMessage: String?
    // Page offset only: no PhotoKit ID is persisted across Viewer dismissal.
    @State private var savedOffset = 0
    @State private var authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(authorization == .limited
                    ? "仅展示 iOS 已授权的部分照片与视频"
                    : "本机照片、视频、Live Photo")
                    .font(.subheadline).foregroundStyle(.secondary)
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
                            Button { selected = candidate } label: {
                                XDriveIOSLocalPhotoTile(candidate: candidate)
                            }.buttonStyle(.plain)
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
                Text("只读取当前授权子集，缩略图不自动下载 iCloud 原件。权限、相册或 App 状态变化时旧页立即废弃。")
                    .font(.footnote).foregroundStyle(.secondary)
                Button("刷新") { refresh() }.disabled(busy)
            }.padding(12)
        }
        .navigationTitle("本机相册")
        .fullScreenCover(item: $selected, onDismiss: { restoreAfterViewer() }) {
            XDriveIOSNativeLocalPhotoDetail(candidate: $0)
        }
        .onAppear {
            // Returning from a full-screen Viewer must not discard its source.
            if selected == nil && page == nil && !busy { refresh(at: savedOffset) }
        }
        .onChange(of: phase) { new in
            if new != .active { invalidate() }
            else { refresh(at: savedOffset) }
        }
        .onDisappear {
            // fullScreenCover may hide its presenter before the Viewer closes.
            // Suspend disposable reads, not the presentation's selected identity.
            if selected != nil { suspendForViewer() }
            else { invalidate() }
        }
    }

    private func restoreAfterViewer() {
        // Revalidate permission and re-open the originating 64-slot page.
        if phase == .active { refresh(at: savedOffset) }
        else { invalidate() }
    }

    private func refresh(at requestedOffset: Int = 0) {
        authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        invalidate()
        guard authorization == .authorized || authorization == .limited else { return }
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
                _ = try await current.start(atOffset: offset)
                let next = try await current.nextPage()
                try Task.checkCancellation()
                guard generation == token, phase == .active else { return }
                page = next
                savedOffset = next.startOffset
                authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
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

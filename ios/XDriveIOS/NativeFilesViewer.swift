import AVKit
import Combine
import PDFKit
import SwiftUI

private struct XDriveIOSNativePDFDocumentSurface: UIViewRepresentable {
    let document: PDFDocument

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.backgroundColor = .systemBackground
        view.document = document
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        if view.document !== document { view.document = document }
    }
}

/// Native audio, without hidden autoplay after app suspension or route exit.
private struct XDriveIOSNativeFileAudioSurface: View {
    let player: AVPlayer
    let autoplay: Bool
    @Environment(\.scenePhase) private var phase
    @State private var playing = false
    @State private var position = 0.0
    @State private var duration = 0.0
    @State private var seeking = false
    private let ticker = Timer.publish(
        every: 0.35, on: .main, in: .common
    ).autoconnect()

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "waveform").font(.system(size: 56))
            Text("音频预览").font(.headline)
            Slider(
                value: $position, in: 0...max(duration, 1),
                onEditingChanged: { editing in
                    seeking = editing
                    if !editing && duration > 0 && phase == .active {
                        player.seek(to: CMTime(seconds: position, preferredTimescale: 600))
                    }
                }
            )
            .disabled(duration <= 0 || phase != .active)
            HStack {
                Text(timestamp(position))
                Spacer()
                Text(duration > 0 ? timestamp(duration) : "--:--")
            }
            .font(.caption.monospacedDigit())
            Button {
                guard phase == .active else { return }
                if player.rate > 0 {
                    player.pause()
                    playing = false
                } else {
                    player.play()
                    playing = true
                }
            } label: {
                Label(playing ? "暂停" : "播放",
                      systemImage: playing ? "pause.fill" : "play.fill")
                    .frame(minWidth: 96, minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .disabled(phase != .active)
        }
        .padding(24)
        .onAppear {
            guard phase == .active, autoplay else { return }
            player.play()
            playing = true
        }
        .onChange(of: phase) { state in
            if state != .active {
                player.pause()
                playing = false
                seeking = false
            }
        }
        .onReceive(ticker) { _ in
            guard phase == .active else { return }
            let seconds = player.currentTime().seconds
            let total = player.currentItem?.duration.seconds ?? 0
            if total.isFinite && total > 0 { duration = total }
            if !seeking && seconds.isFinite && seconds >= 0 {
                // Slider range is 0...max(duration, 1): never publish an out-of-range value.
                position = min(seconds, max(duration, 1))
            }
            playing = player.rate > 0
        }
        .onDisappear { player.pause() }
    }

    private func timestamp(_ seconds: Double) -> String {
        let safe = Int(max(0, seconds.isFinite ? seconds : 0))
        return String(format: "%02d:%02d", safe / 60, safe % 60)
    }
}

/// Single modal for Files: still, video, PDF, audio and UTF-8 text all share
/// an exact Owner/Node/revision lifetime. Different file types never get
/// distinct navigation stacks or fall back to WebKit.
struct XDriveIOSNativeFilesViewer: View {
    let initial: XDriveIOSNativeFilesNode
    let loadedItems: [XDriveIOSNativeFilesNode]
    let openedOwner: XDriveNativeOwnerRoot
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let onNavigate: (XDriveIOSNativeFilesNode) -> Bool
    // Extend a bounded, verified directory window without guessing search/collection ranges.
    var onLoadNeighbor: ((XDriveIOSNativeFilesNode, Int) async throws -> [XDriveIOSNativeFilesNode])? = nil

    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @State private var active: XDriveIOSNativeFilesNode?
    @State private var attempt = UUID()
    @State private var isClosing = false
    @State private var allowAudioAutoplay = true
    @State private var display: XDriveIOSNativeFilesPreviewPayload?
    @State private var player: AVPlayer?
    @State private var failure: String?
    @State private var loading = true
    // Reuse Files' existing verified, signed original-export model. This
    // staged file belongs to exactly this L3 item, never the hidden page.
    @StateObject private var exporter = XDriveIOSNativeFilesExportModel()
    @Environment(\.xdriveNativeTransfers) private var transfers
    @State private var exportFallbackEligible = false
    @State private var showImageChrome = true
    @State private var showVideoChrome = true
    @State private var streamedWindow: [XDriveIOSNativeFilesNode] = []
    @State private var neighborBusy = false
    @State private var neighborError: String?
    @State private var reachedEnd = Set<Int>()
    @State private var neighborEpoch = UUID()
    @State private var neighborJob: Task<Void, Never>?

    private var viewed: XDriveIOSNativeFilesNode { active ?? initial }

    private var isStillImage: Bool {
        guard let display else { return false }
        switch display {
        case .image(_), .imageThumbnail(_): return true
        default: return false
        }
    }

    private var isNativeVideo: Bool {
        guard let display else { return false }
        if case .video = display { return true }
        return false
    }

    private var chromeVisible: Bool {
        (!isStillImage || showImageChrome) &&
            (!isNativeVideo || showVideoChrome)
    }

    private func toggleImageChrome() {
        guard authorized, isStillImage else { return }
        withAnimation(.easeInOut(duration: 0.18)) { showImageChrome.toggle() }
    }

    private func toggleVideoChrome() {
        guard authorized, isNativeVideo else { return }
        withAnimation(.easeInOut(duration: 0.18)) { showVideoChrome.toggle() }
    }

    private var authorized: Bool {
        phase == .active &&
        XDriveIOSNativePhotoOwnerScope.matches(login.owner, openedOwner)
    }

    private var visibleWindow: [XDriveIOSNativeFilesNode] {
        streamedWindow.isEmpty ? loadedItems : streamedWindow
    }

    private func neighbor(_ direction: Int) -> XDriveIOSNativeFilesNode? {
        XDriveIOSNativeFilesViewerPolicy.neighbor(
            current: viewed, in: visibleWindow,
            direction: direction, authorized: authorized
        )
    }

    private func mayNavigate(_ direction: Int) -> Bool {
        neighbor(direction) != nil ||
            (onLoadNeighbor != nil && !reachedEnd.contains(direction))
    }

    var body: some View {
        NavigationStack {
            Group {
                if let display {
                    switch display {
                    case .image(let image):
                        XDriveIOSNativeZoomablePhotoView(image: image)
                            .onNavigateSwipe { move($0) }
                            .onChromeTap { toggleImageChrome() }
                            .accessibilityLabel("图片，可双指缩放或双击")
                            .overlay(alignment: .topLeading) {
                                if showImageChrome {
                                XDriveIOSNativeViewerQualityPanel(
                                    fileName: viewed.name,
                                    source: "原件 · 适屏解码",
                                    image: image,
                                    originalBytes: viewed.size
                                )
                                }
                            }
                    case .imageThumbnail(let image):
                        VStack(spacing: 6) {
                            XDriveIOSNativeZoomablePhotoView(image: image)
                                .onNavigateSwipe { move($0) }
                                .onChromeTap { toggleImageChrome() }
                                .accessibilityLabel("低清缩略图，可双指缩放")
                                .overlay(alignment: .topLeading) {
                                    if showImageChrome {
                                    XDriveIOSNativeViewerQualityPanel(
                                        fileName: viewed.name,
                                        source: "缩略图回退",
                                        image: image,
                                        originalBytes: viewed.size
                                    )
                                    }
                                }
                            // The selected 1 GiB-or-smaller original is exported
                            // only after a user tap. Keep controls scrollable in
                            // short landscape and at large Dynamic Type sizes.
                            if showImageChrome {
                            ScrollView {
                                VStack(spacing: 8) {
                                    Text("当前仅显示云端低清缩略图。可以在此下载当前版本原件，再选择保存到“文件”或用其他 App 打开；不会自动下载或保存。")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .multilineTextAlignment(.center)
                                    originalExportFallback
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                            }
                            .frame(maxHeight: 160)
                            .accessibilityIdentifier("native-ios-files-viewer-thumbnail-recovery")
                            }
                        }
                    case .video:
                        if let player {
                            observingPlayer(
                                XDriveIOSNativePhotoVideoSurface(
                                    player: player, showChrome: showVideoChrome,
                                    onChromeTap: { toggleVideoChrome() },
                                    onNavigateSwipe: { move($0) }
                                )
                                .id(viewed.id)
                                .onAppear { if authorized { player.play() } }
                                .onDisappear { player.pause() },
                                player: player
                            )
                        }
                    case .audio:
                        if let player {
                            observingPlayer(
                                XDriveIOSNativeFileAudioSurface(player: player, autoplay: allowAudioAutoplay)
                                    .id(viewed.id),
                                player: player
                            )
                        }
                    case .pdf(let document):
                        XDriveIOSNativePDFDocumentSurface(document: document)
                    case .text(let content, let truncated):
                        ScrollView {
                            VStack(alignment: .leading, spacing: 12) {
                                if truncated {
                                    Text("仅展示文件前 1 MiB 文本")
                                        .foregroundStyle(.secondary)
                                        .font(.caption)
                                }
                                Text(content.isEmpty ? "空文本文件" : content)
                                    .font(.system(.body, design: .monospaced))
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .textSelection(.enabled)
                            }
                            .padding(16)
                        }
                    }
                } else if let failure {
                    // The error and its verified original-export fallback must
                    // stay reachable on a short iPhone landscape viewport.
                    ScrollView {
                        VStack(spacing: 14) {
                            Label(failure, systemImage: "exclamationmark.circle")
                                .multilineTextAlignment(.center)
                                .foregroundStyle(.secondary)
                            if authorized {
                                Button("重试") { reloadCurrent() }
                                    .frame(minWidth: 96, minHeight: 48)
                                    .accessibilityIdentifier("native-ios-files-viewer-retry")
                                if exportFallbackEligible {
                                    originalExportFallback
                                }
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(24)
                    }
                    .accessibilityIdentifier("native-ios-files-viewer-error-scroll")
                } else if loading {
                    ProgressView("正在读取当前文件…")
                } else {
                    Text("文件预览不可用").foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(isStillImage || isNativeVideo ? Color.black : Color(uiColor: .systemBackground))
            .overlay(alignment: .bottom) {
                if neighborBusy {
                    ProgressView("正在核验相邻文件…")
                        .padding(12)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
                        .padding(.bottom, 16)
                        .accessibilityIdentifier("native-ios-files-viewer-neighbor-loading")
                } else if let neighborError {
                    Text(neighborError)
                        .font(.footnote)
                        .padding(12)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
                        .padding(.bottom, 16)
                        .accessibilityIdentifier("native-ios-files-viewer-neighbor-error")
                }
            }
            .navigationTitle(viewed.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("完成") { close() }
                        .frame(minWidth: 44, minHeight: 44)
                }
                // This remains reachable on short landscape layouts, including
                // when the player stalls without emitting a terminal error.
                ToolbarItem(placement: .navigationBarTrailing) {
                    if authorized, player != nil {
                        Button("重新加载媒体") { reloadCurrent() }
                            .accessibilityIdentifier("native-ios-files-player-reload")
                    }
                }
                ToolbarItemGroup(placement: .bottomBar) {
                    Button {
                        move(-1)
                    } label: {
                        Label("上一项", systemImage: "chevron.left")
                    }
                    .disabled(neighborBusy || !mayNavigate(-1))
                    Spacer()
                    if authorized,
                       let index = XDriveIOSNativeFilesViewerPolicy.loadedIndex(
                           current: viewed, in: visibleWindow, authorized: true
                       ) {
                        Text("\(index + 1)/\(visibleWindow.count)（窗口）")
                            .font(.caption.monospacedDigit())
                    }
                    Spacer()
                    Button {
                        move(1)
                    } label: {
                        Label("下一项", systemImage: "chevron.right")
                    }
                    .disabled(neighborBusy || !mayNavigate(1))
                }
            }
            .toolbar(chromeVisible ? .visible : .hidden,
                     for: .navigationBar, .bottomBar)
        }
        .statusBarHidden(!chromeVisible)
        .task(id: attempt) {
            guard !isClosing else { return }
            await openCurrent()
        }
        // AVPlayer may fail AFTER a valid signed ticket and initial render.
        // Only this modal's current item may produce terminal retry feedback.
        .onReceive(NotificationCenter.default.publisher(
            for: .AVPlayerItemFailedToPlayToEndTime
        ).receive(on: RunLoop.main)) { notification in
            guard authorized, !isClosing,
                  let failed = notification.object as? AVPlayerItem,
                  let current = player?.currentItem, failed === current
            else { return }
            retire()
            failure = "媒体播放失败，请重试当前文件。"
            exportFallbackEligible = true
            loading = false
        }
        .onChange(of: login.owner) { _ in close() }
        .onChange(of: phase) { next in
            if next != .active {
                allowAudioAutoplay = false
                retire()
            } else if !isClosing &&
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, openedOwner) {
                attempt = UUID()
            } else {
                close()
            }
        }
        .onDisappear { retire() }
    }

    /// An unsupported/oversized/undecodable original is still a file; keep
    /// the user inside this L3 Viewer rather than requiring a second visit to
    /// the Files row's management menu. Never download without a tap.
    @ViewBuilder
    private var originalExportFallback: some View {
        if authorized && exportFallbackEligible {
            if viewed.size > XDriveIOSNativeFilesExportCapacityPolicy.maximumSingleFileBytes {
                Text("原件超过当前平台可表示的文件大小，无法导出。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("native-ios-files-viewer-export-over-limit")
            } else if let staged = exporter.prepared,
               staged.nodeID == viewed.id && staged.revision == viewed.revision {
                ShareLink(item: staged.fileURL) {
                    Label("用其他 App 打开或保存原件",
                          systemImage: "square.and.arrow.up")
                        .frame(minHeight: 48)
                }
                .accessibilityIdentifier("native-ios-files-viewer-export-share")
            } else {
                Button {
                    guard authorized, exportFallbackEligible else { return }
                    exporter.prepare(viewed, login: login, transfers: transfers)
                } label: {
                    Label("下载原件以使用其他 App",
                          systemImage: "square.and.arrow.down")
                        .frame(minHeight: 48)
                }
                .disabled(exporter.busy)
                .accessibilityIdentifier("native-ios-files-viewer-export-prepare")
            }
            if exporter.busy {
                ProgressView("正在准备原件…")
                Button("取消下载") { exporter.invalidate() }
                    .accessibilityIdentifier("native-ios-files-viewer-export-cancel")
            }
            if let status = exporter.status {
                Text(status)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("native-ios-files-viewer-export-status")
            }
        }
    }

    /// Observe both initial stream-load failures and later item failures.
    /// KVO subscriptions are owned by the currently rendered player surface;
    /// retiring the player removes them, preventing stale cross-item errors.
    @ViewBuilder
    private func observingPlayer<Content: View>(
        _ content: Content, player: AVPlayer
    ) -> some View {
        if let item = player.currentItem {
            content
                .onReceive(
                    item.publisher(for: \.status, options: [.initial, .new])
                        .receive(on: RunLoop.main)
                ) { status in
                    if status == .failed { playbackFailed(item) }
                }
                .onReceive(
                    player.publisher(for: \.status, options: [.initial, .new])
                        .receive(on: RunLoop.main)
                ) { status in
                    if status == .failed { playbackFailed(item) }
                }
        } else {
            content
        }
    }

    @MainActor
    private func reloadCurrent() {
        guard authorized, !isClosing else { return }
        retire()
        failure = nil
        loading = true
        attempt = UUID()
    }

    @MainActor
    private func playbackFailed(_ failed: AVPlayerItem) {
        guard authorized, !isClosing, let current = player?.currentItem,
              failed === current else { return }
        retire()
        failure = "媒体播放失败，请重试当前文件。"
        exportFallbackEligible = true
    }

    @MainActor
    private func openCurrent() async {
        guard !isClosing else { return }
        let current = viewed
        let generation = attempt
        retire()
        failure = nil
        loading = true
        guard authorized else {
            failure = "当前账户或应用状态已变化，请返回文件列表。"
            loading = false
            return
        }
        do {
            let credentials = try await login.verifiedAuthorization()
            try Task.checkCancellation()
            guard XDriveIOSNativePhotoOwnerScope.matches(credentials.owner, openedOwner),
                  authorized else { throw XDriveIOSNativeFilesPreviewError.invalidOwner }
            let reader = XDriveIOSNativeFilesPreviewReader(
                owner: credentials.owner, accessToken: credentials.accessToken
            )
            let result = try await reader.preview(current)
            try Task.checkCancellation()
            guard generation == attempt, viewed == current, authorized,
                  !isClosing else { return }
            switch result {
            case .video(let url), .audio(let url):
                player = AVPlayer(url: url)
            default: break
            }
            // A successful bounded thumbnail still needs a separate, explicit
            // foreground original-export tap. Reuse the exact Node/revision
            // reader already used for unsupported formats, never auto-fetch.
            if case .imageThumbnail = result {
                exportFallbackEligible = true
            }
            display = result
            failure = nil
            loading = false
            XDriveIOSNativeFilesRecentRecorder.recordLoadedPreview(
                current, owner: credentials.owner,
                accessToken: credentials.accessToken, login: login
            )
        } catch is CancellationError {
            // A replacement Viewer owns its own read and progress.
        } catch {
            guard !Task.isCancelled, generation == attempt,
                  viewed == current, authorized, !isClosing else { return }
            retire()
            loading = false
            if let reason = error as? XDriveIOSNativeFilesPreviewError {
                switch reason {
                case .unsupported:
                    failure = "当前格式不支持原生预览。可以在本机空间足够时下载原件，再通过系统分享使用其他 App。"
                    exportFallbackEligible = true
                case .tooLarge:
                    failure = "文件超过本机预览上限。可在本机空间足够时下载原件，再通过系统分享使用其他 App。"
                    exportFallbackEligible = true
                case .malformed:
                    failure = "原生预览无法解码当前文件。可以在本机空间足够时导出原件至其他 App。"
                    exportFallbackEligible = true
                case .noThumbnail:
                    failure = "原图过大或格式无法解码，且没有可用的云端缩略图。可在本机空间足够时下载原件，再通过系统分享使用其他 App。"
                    exportFallbackEligible = true
                case .changed, .invalidOwner, .response(401), .response(403), .response(404):
                    failure = "文件版本或当前账户已变化，请返回目录重新读取。"
                default:
                    failure = "预览读取失败，请检查网络或文件格式后重试。"
                }
            } else {
                failure = "预览读取失败，请检查网络后重试。"
            }
        }
    }

    @MainActor
    private func commitNeighbor(_ next: XDriveIOSNativeFilesNode) {
        guard !isClosing, authorized, onNavigate(next) else { return }
        retire()
        active = next
        attempt = UUID()
    }

    /// Only one user-initiated, cancellable boundary read at a time. The Server
    /// proves the exact Owner, file revision and arrangement before admission.
    @MainActor
    private func move(_ direction: Int) {
        guard !isClosing, authorized, !neighborBusy else { return }
        neighborError = nil
        if let next = neighbor(direction) {
            commitNeighbor(next)
            return
        }
        guard let read = onLoadNeighbor, !reachedEnd.contains(direction) else { return }
        let source = viewed
        let ticket = UUID()
        neighborEpoch = ticket
        neighborBusy = true
        neighborJob = Task { @MainActor in
            defer {
                if neighborEpoch == ticket {
                    neighborBusy = false
                    neighborJob = nil
                }
            }
            do {
                let batch = try await read(source, direction)
                try Task.checkCancellation()
                guard neighborEpoch == ticket, !isClosing, authorized,
                      viewed == source else { return }
                if batch.isEmpty {
                    reachedEnd.insert(direction)
                    neighborError = direction > 0 ? "已经到达此文件夹最后一个文件。" :
                        "已经到达此文件夹第一个文件。"
                    return
                }
                let concatenated = direction > 0 ?
                    visibleWindow + batch : batch + visibleWindow
                var seen = Set<UInt64>()
                let unique = concatenated.filter { item in
                    item.type == "file" && seen.insert(item.id).inserted
                }
                let limit = XDriveIOSNativeFilesViewerPolicy.maximumLoadedRows
                streamedWindow = direction > 0 ?
                    Array(unique.suffix(limit)) : Array(unique.prefix(limit))
                guard let next = neighbor(direction) else {
                    neighborError = "相邻文件已发生变化，请返回目录刷新。"
                    return
                }
                reachedEnd.removeAll()
                commitNeighbor(next)
            } catch is CancellationError {
                // Dismissal, logout and later gestures retire the old read.
            } catch {
                guard neighborEpoch == ticket, !isClosing, authorized else { return }
                neighborError = "无法核验下一页文件；请重试或返回目录刷新。"
            }
        }
    }

    @MainActor
    private func retire() {
        neighborEpoch = UUID()
        neighborJob?.cancel()
        neighborJob = nil
        neighborBusy = false
        neighborError = nil
        // A failed load, Owner change, scene retirement, dismissal or next
        // image must always restore visible escape and retry controls.
        showImageChrome = true
        showVideoChrome = true
        // Cancel the old item's signed download and delete any staged bytes
        // before a swipe, retry, Owner/scene exit or Viewer dismissal.
        exporter.invalidate()
        exportFallbackEligible = false
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        player = nil
        display = nil
        loading = false
    }

    @MainActor
    private func close() {
        isClosing = true
        retire()
        dismiss()
    }
}

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
                    if !editing && duration > 0 {
                        player.seek(to: CMTime(seconds: position, preferredTimescale: 600))
                    }
                }
            )
            .disabled(duration <= 0)
            HStack {
                Text(timestamp(position))
                Spacer()
                Text(duration > 0 ? timestamp(duration) : "--:--")
            }
            .font(.caption.monospacedDigit())
            Button {
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
        }
        .padding(24)
        .onAppear { player.play(); playing = true }
        .onReceive(ticker) { _ in
            let seconds = player.currentTime().seconds
            let total = player.currentItem?.duration.seconds ?? 0
            if total.isFinite && total > 0 { duration = total }
            if !seeking && seconds.isFinite && seconds >= 0 {
                position = min(seconds, max(duration, seconds))
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

    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @State private var active: XDriveIOSNativeFilesNode?
    @State private var attempt = UUID()
    @State private var display: XDriveIOSNativeFilesPreviewPayload?
    @State private var player: AVPlayer?
    @State private var failure: String?
    @State private var loading = true

    private var viewed: XDriveIOSNativeFilesNode { active ?? initial }
    private var authorized: Bool {
        phase == .active &&
        XDriveIOSNativePhotoOwnerScope.matches(login.owner, openedOwner)
    }

    private func neighbor(_ direction: Int) -> XDriveIOSNativeFilesNode? {
        XDriveIOSNativeFilesViewerPolicy.neighbor(
            current: viewed, in: loadedItems,
            direction: direction, authorized: authorized
        )
    }

    var body: some View {
        NavigationStack {
            Group {
                if let display {
                    switch display {
                    case .image(let image):
                        XDriveIOSNativeZoomablePhotoView(image: image)
                            .accessibilityLabel("图片，可双指缩放或双击")
                    case .imageThumbnail(let image):
                        VStack(spacing: 0) {
                            XDriveIOSNativeZoomablePhotoView(image: image)
                                .accessibilityLabel("低清缩略图，可双指缩放")
                            Text("当前只显示已索引的云端缩略图（低清）。查看原件请返回文件列表，通过“更多”→“下载并准备导出”。")
                                .font(.caption).foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                                .padding(8)
                        }
                    case .video:
                        if let player {
                            VideoPlayer(player: player)
                                .onAppear { if phase == .active { player.play() } }
                        }
                    case .audio:
                        if let player {
                            XDriveIOSNativeFileAudioSurface(player: player)
                                .id(viewed.id)
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
                    VStack(spacing: 16) {
                        Label(failure, systemImage: "exclamationmark.circle")
                            .multilineTextAlignment(.center)
                            .foregroundStyle(.secondary)
                        if authorized {
                            Button("重试") {
                                retire()
                                attempt = UUID()
                            }
                            .frame(minWidth: 96, minHeight: 48)
                            .accessibilityIdentifier("native-ios-files-viewer-retry")
                        }
                    }
                    .padding(24)
                } else if loading {
                    ProgressView("正在读取当前文件…")
                } else {
                    Text("文件预览不可用").foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle(viewed.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("完成") { close() }
                        .frame(minWidth: 44, minHeight: 44)
                }
                ToolbarItemGroup(placement: .bottomBar) {
                    Button {
                        move(-1)
                    } label: {
                        Label("上一项", systemImage: "chevron.left")
                    }
                    .disabled(neighbor(-1) == nil)
                    Spacer()
                    if authorized,
                       let index = XDriveIOSNativeFilesViewerPolicy.loadedIndex(
                           current: viewed, in: loadedItems, authorized: true
                       ) {
                        Text("\(index + 1)/\(loadedItems.count)（已加载）")
                            .font(.caption.monospacedDigit())
                    }
                    Spacer()
                    Button {
                        move(1)
                    } label: {
                        Label("下一项", systemImage: "chevron.right")
                    }
                    .disabled(neighbor(1) == nil)
                }
            }
        }
        .task(id: attempt) { await openCurrent() }
        // AVPlayer may fail AFTER a valid signed ticket and initial render.
        // Only this modal's current item may produce terminal retry feedback.
        .onReceive(NotificationCenter.default.publisher(
            for: .AVPlayerItemFailedToPlayToEndTime
        ).receive(on: RunLoop.main)) { notification in
            guard authorized, let failed = notification.object as? AVPlayerItem,
                  let current = player?.currentItem, failed === current
            else { return }
            retire()
            failure = "媒体播放失败，请重试当前文件。"
            loading = false
        }
        .onChange(of: login.owner) { _ in close() }
        .onChange(of: phase) { next in
            if next != .active {
                retire()
            } else if XDriveIOSNativePhotoOwnerScope.matches(login.owner, openedOwner) {
                attempt = UUID()
            } else {
                close()
            }
        }
        .onDisappear { retire() }
    }

    @MainActor
    private func openCurrent() async {
        let current = viewed
        let generation = attempt
        retire()
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
            guard generation == attempt, viewed == current, authorized else { return }
            switch result {
            case .video(let url), .audio(let url):
                player = AVPlayer(url: url)
            default: break
            }
            display = result
            failure = nil
            loading = false
        } catch is CancellationError {
            // A replacement Viewer owns its own read and progress.
        } catch {
            guard generation == attempt, viewed == current else { return }
            retire()
            loading = false
            if let reason = error as? XDriveIOSNativeFilesPreviewError {
                switch reason {
                case .unsupported:
                    failure = "当前文件格式不支持原生预览。"
                case .tooLarge:
                    failure = "文件超过本机预览上限。请返回文件列表，从“更多”中下载并导出原件。"
                case .noThumbnail:
                    failure = "原图过大或格式无法解码，且没有可用的云端缩略图。请返回文件列表，从“更多”中下载并导出原件（当前导出上限 512 MiB）。"
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
    private func move(_ direction: Int) {
        guard let next = neighbor(direction), onNavigate(next) else { return }
        retire()
        active = next
        attempt = UUID()
    }

    @MainActor
    private func retire() {
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        player = nil
        display = nil
        loading = false
    }

    @MainActor
    private func close() {
        retire()
        dismiss()
    }
}

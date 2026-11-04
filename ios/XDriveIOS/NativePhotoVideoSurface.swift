import AVFoundation
import Combine
import SwiftUI
import UIKit

/// A video-only AVPlayerLayer. The owning Viewer retains playback credentials,
/// player failure handling, Owner gates and signed URL lifetime.
private final class XDriveIOSNativePhotoVideoLayerHost: UIView {
    override static var layerClass: AnyClass { AVPlayerLayer.self }
    var playbackLayer: AVPlayerLayer { layer as! AVPlayerLayer }
}

private struct XDriveIOSNativePhotoVideoLayer: UIViewRepresentable {
    let player: AVPlayer

    final class Coordinator {}
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> XDriveIOSNativePhotoVideoLayerHost {
        let view = XDriveIOSNativePhotoVideoLayerHost()
        view.backgroundColor = .black
        view.playbackLayer.videoGravity = .resizeAspect
        view.playbackLayer.player = player
        return view
    }

    func updateUIView(_ view: XDriveIOSNativePhotoVideoLayerHost, context: Context) {
        if view.playbackLayer.player !== player {
            view.playbackLayer.player = player
        }
    }

    static func dismantleUIView(
        _ view: XDriveIOSNativePhotoVideoLayerHost, coordinator: Coordinator
    ) {
        view.playbackLayer.player = nil
    }
}

/// One native Photos-style video timeline shared by still/video/Live Viewers.
/// The parent is responsible for authorizing and starting playback; there is
/// no implicit load, signed ticket request, background resume or own player.
struct XDriveIOSNativePhotoVideoSurface: View {
    let player: AVPlayer
    let showChrome: Bool
    let onChromeTap: () -> Void
    let onNavigateSwipe: ((Int) -> Void)?

    init(player: AVPlayer, showChrome: Bool,
         onChromeTap: @escaping () -> Void,
         onNavigateSwipe: ((Int) -> Void)? = nil) {
        self.player = player
        self.showChrome = showChrome
        self.onChromeTap = onChromeTap
        self.onNavigateSwipe = onNavigateSwipe
    }

    @Environment(\.scenePhase) private var phase
    @State private var position = 0.0
    @State private var duration = 0.0
    @State private var seeking = false
    @State private var playing = false
    @State private var muted = false
    // An AVPlayer seek is asynchronous. Remember the exact current item and
    // retire late completion handlers when a Viewer changes media or leaves.
    @State private var scrubbedItem: AVPlayerItem?
    @State private var resumesAfterScrub = false
    @State private var finishingScrub = false
    @State private var scrubEpoch = UUID()
    @State private var lastPreviewSeekAt: TimeInterval = -.infinity
    @State private var replayEpoch = UUID()
    @State private var replayInProgress = false
    private let ticker = Timer.publish(every: 0.3, on: .main, in: .common).autoconnect()

    private var canControl: Bool {
        phase == .active && player.currentItem != nil
    }

    private func refresh() {
        let rawDuration = player.currentItem?.duration.seconds ?? 0
        duration = rawDuration.isFinite && rawDuration > 0 &&
            rawDuration < Double(Int.max) ? rawDuration : 0
        let now = player.currentTime().seconds
        if !seeking, now.isFinite, now >= 0 {
            position = duration > 0 ? min(now, duration) : 0
        }
        playing = player.rate > 0
        muted = player.isMuted
    }


    /// A finished AVPlayerItem remains at its duration. A second Play tap
    /// must seek the SAME item to zero; plain player.play() will not rewind.
    /// The owning Gallery/Files Viewer still handles player failures.
    private func togglePlayback() {
        guard canControl, !seeking, !replayInProgress,
              let item = player.currentItem else { return }
        if player.rate > 0 {
            player.pause()
            refresh()
            return
        }
        let elapsed = player.currentTime().seconds
        let length = item.duration.seconds
        guard length.isFinite, length > 0.1,
              elapsed.isFinite, elapsed >= max(0, length - 0.08) else {
            player.play()
            refresh()
            return
        }
        let token = UUID()
        replayEpoch = token
        replayInProgress = true
        player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero) {
            completed in
            Task { @MainActor in
                guard replayEpoch == token else { return }
                replayInProgress = false
                guard completed, phase == .active, !seeking,
                      player.currentItem === item else { return }
                player.play()
                refresh()
            }
        }
    }

    private func retireReplay() {
        replayEpoch = UUID()
        replayInProgress = false
    }

    /// Pause while dragging so the decoded frame follows the user's finger
    /// instead of running ahead of the seek slider.
    private func beginScrub() {
        guard canControl, duration > 0, let item = player.currentItem else { return }
        retireReplay()
        scrubEpoch = UUID()
        scrubbedItem = item
        resumesAfterScrub = player.rate > 0
        finishingScrub = false
        lastPreviewSeekAt = -.infinity
        seeking = true
        player.pause()
    }

    /// Coalesce intermediate seeks to bound signed cloud video Range traffic.
    /// Final finger-up positioning remains exact and is never throttled.
    private func previewScrub(at value: Double) -> CMTime? {
        guard seeking, !finishingScrub, canControl,
              player.currentItem === scrubbedItem, duration > 0,
              value.isFinite else { return nil }
        let now = ProcessInfo.processInfo.systemUptime
        guard now - lastPreviewSeekAt >= 0.14 else { return nil }
        lastPreviewSeekAt = now
        return CMTime(
            seconds: min(max(0, value), duration), preferredTimescale: 600
        )
    }

    private func finishScrub() {
        guard seeking, !finishingScrub else { return }
        guard canControl, duration > 0, let item = scrubbedItem,
              player.currentItem === item else {
            abortScrub()
            return
        }
        finishingScrub = true
        let token = scrubEpoch
        let resume = resumesAfterScrub
        let target = CMTime(
            seconds: min(max(0, position), duration), preferredTimescale: 600
        )
        player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { completed in
            Task { @MainActor in
                guard scrubEpoch == token else { return }
                abortScrub()
                guard completed, phase == .active,
                      player.currentItem === item else { return }
                if resume { player.play() }
                refresh()
            }
        }
    }

    private func abortScrub() {
        scrubEpoch = UUID()
        seeking = false
        finishingScrub = false
        scrubbedItem = nil
        resumesAfterScrub = false
        lastPreviewSeekAt = -.infinity
    }

    private func timestamp(_ value: Double) -> String {
        guard value.isFinite, value >= 0, value < Double(Int.max) else {
            return "--:--"
        }
        let seconds = Int(value)
        if seconds >= 3600 {
            return String(format: "%d:%02d:%02d",
                          seconds / 3600, (seconds / 60) % 60, seconds % 60)
        }
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            XDriveIOSNativePhotoVideoLayer(player: player)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Rectangle())
                .onTapGesture(perform: onChromeTap)
                // Recognize page swipes only on the video canvas. The timeline
                // Slider above this layer keeps its own drag-to-seek gesture.
                .simultaneousGesture(
                    DragGesture(minimumDistance: 72, coordinateSpace: .local)
                        .onEnded { value in
                            guard canControl, !seeking,
                                  let onNavigateSwipe,
                                  let direction = XDriveIOSNativeViewerSwipePolicy.direction(
                                    horizontal: value.translation.width,
                                    vertical: value.translation.height,
                                    zoom: 1, minimum: 1
                                  ) else { return }
                            onNavigateSwipe(direction)
                        }
                )
                .accessibilityLabel("视频，轻点显示或隐藏控制栏")

            if showChrome {
                HStack(spacing: 10) {
                    Button {
                        togglePlayback()
                    } label: {
                        Image(systemName: playing ? "pause.fill" : "play.fill")
                            .frame(minWidth: 32, minHeight: 44)
                    }
                    .accessibilityLabel(playing ? "暂停视频" : "播放视频")
                    .accessibilityIdentifier("native-ios-photo-video-play")
                    .disabled(!canControl || seeking)

                    Slider(
                        value: $position, in: 0...max(duration, 1),
                        onEditingChanged: { editing in
                            if editing { beginScrub() }
                            else { finishScrub() }
                        }
                    )
                    .onChange(of: position) { value in
                        if let target = previewScrub(at: value) {
                            let tolerance = CMTime(seconds: 0.1, preferredTimescale: 600)
                            player.seek(
                                to: target, toleranceBefore: tolerance,
                                toleranceAfter: tolerance
                            )
                        }
                    }
                    .disabled(!canControl || duration <= 0)
                    .accessibilityLabel("视频进度")
                    .accessibilityHint("拖动时预览画面；松开后定位，原本播放中的视频将继续播放")
                    .accessibilityIdentifier("native-ios-photo-video-timeline")

                    Text("\(timestamp(position)) / \(duration > 0 ? timestamp(duration) : "--:--")")
                        .font(.caption2.monospacedDigit())
                        .lineLimit(1)
                        .fixedSize()

                    Button {
                        guard canControl else { return }
                        player.isMuted = !player.isMuted
                        muted = player.isMuted
                    } label: {
                        Image(systemName: muted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                            .frame(minWidth: 32, minHeight: 44)
                    }
                    .accessibilityLabel(muted ? "取消静音" : "静音")
                    .accessibilityIdentifier("native-ios-photo-video-mute")
                    .disabled(!canControl)
                }
                .padding(.horizontal, 10)
                .background(.ultraThinMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal, 12)
                .padding(.bottom, 8)
            }
        }
        .background(Color.black)
        .onAppear { refresh() }
        .onChange(of: phase) { next in
            if next != .active {
                abortScrub()
                retireReplay()
            } else { refresh() }
        }
        .onDisappear { abortScrub() }
        .onDisappear { retireReplay() }
        .onReceive(ticker) { _ in
            if phase == .active { refresh() }
        }
    }
}

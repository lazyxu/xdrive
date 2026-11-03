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
                        guard canControl else { return }
                        if player.rate > 0 { player.pause() }
                        else { player.play() }
                        refresh()
                    } label: {
                        Image(systemName: playing ? "pause.fill" : "play.fill")
                            .frame(minWidth: 32, minHeight: 44)
                    }
                    .accessibilityLabel(playing ? "暂停视频" : "播放视频")
                    .accessibilityIdentifier("native-ios-photo-video-play")
                    .disabled(!canControl)

                    Slider(
                        value: $position, in: 0...max(duration, 1),
                        onEditingChanged: { editing in
                            seeking = editing
                            if !editing && canControl && duration > 0 {
                                let target = CMTime(seconds: position, preferredTimescale: 600)
                                player.seek(
                                    to: target, toleranceBefore: .zero,
                                    toleranceAfter: .zero
                                )
                            }
                        }
                    )
                    .disabled(!canControl || duration <= 0)
                    .accessibilityLabel("视频进度")
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
        .onReceive(ticker) { _ in
            if phase == .active { refresh() }
        }
    }
}

import AVKit
import Combine
import SwiftUI

/// A presentation-scoped KVO subscription for the *visible* native player.
/// It observes initial/late item AND player failures, including errors before
/// playback reaches an end-of-stream notification. The owning Viewer must
/// independently fence Owner, scene and AVPlayerItem identity in onFailed.
struct XDriveIOSNativeAVPlayerStatusObserver<Content: View>: View {
    let player: AVPlayer
    let content: Content
    let onFailed: (AVPlayerItem) -> Void

    var body: some View {
        Group {
            if let item = player.currentItem {
                content
                    .onReceive(
                        item.publisher(for: \.status, options: [.initial, .new])
                            .receive(on: RunLoop.main)
                    ) { status in
                        if status == .failed { onFailed(item) }
                    }
                    .onReceive(
                        player.publisher(for: \.status, options: [.initial, .new])
                            .receive(on: RunLoop.main)
                    ) { status in
                        if status == .failed { onFailed(item) }
                    }
            } else {
                content
            }
        }
    }
}

import SwiftUI
import UIKit

/// Read-only L3 still-image surface: pinch to zoom, double-tap to toggle,
/// then pan in either direction. No PhotoKit original export or network write.
struct XDriveIOSNativeZoomableImage: View {
    let image: UIImage
    @State private var settledScale: CGFloat = 1
    @GestureState private var gestureScale: CGFloat = 1

    private var currentScale: CGFloat {
        min(5, max(1, settledScale * gestureScale))
    }

    var body: some View {
        GeometryReader { bounds in
            ScrollView([.horizontal, .vertical]) {
                Image(uiImage: image)
                    .resizable().scaledToFit()
                    .frame(
                        width: max(1, bounds.size.width) * currentScale,
                        height: max(1, bounds.size.height) * currentScale
                    )
                    .frame(
                        minWidth: bounds.size.width,
                        minHeight: bounds.size.height
                    )
                    .gesture(
                        MagnificationGesture()
                            .updating($gestureScale) { value, state, _ in
                                state = value
                            }
                            .onEnded { value in
                                settledScale = min(5, max(1, settledScale * value))
                            }
                    )
                    .onTapGesture(count: 2) {
                        settledScale = settledScale > 1.05 ? 1 : 2.5
                    }
            }
            .scrollIndicators(.hidden)
        }
        .accessibilityLabel("可缩放的照片")
        .accessibilityAction(named: "放大") {
            settledScale = min(5, settledScale * 1.5)
        }
        .accessibilityAction(named: "缩小") {
            settledScale = max(1, settledScale / 1.5)
        }
    }
}

import Foundation

/// AVPlayer may report malformed or unbounded finite timestamps. Converting an
/// out-of-range Double to Int traps, even when its `isFinite` flag is true.
enum XDriveIOSNativeFileAudioTimecodePolicy {
    // Avoid both an overflowing integer conversion and an unbounded Slider.
    private static let maximumSeconds = Double(Int32.max)

    static func acceptedDuration(_ seconds: Double) -> Double {
        seconds.isFinite && seconds > 0 && seconds <= maximumSeconds ? seconds : 0
    }

    static func label(seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0,
              seconds <= maximumSeconds else { return "--:--" }
        let wholeSeconds = Int(seconds)
        return String(format: "%02d:%02d", wholeSeconds / 60, wholeSeconds % 60)
    }
}

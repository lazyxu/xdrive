import Foundation

@main
struct XDriveIOSNativeFileAudioTimecodeChecks {
    private static func require(_ condition: @autoclosure () -> Bool, _ message: String) {
        if !condition() {
            fputs("native Files audio timecode failed: \(message)\n", stderr)
            exit(1)
        }
    }

    static func main() {
        typealias Policy = XDriveIOSNativeFileAudioTimecodePolicy

        require(Policy.label(seconds: 0) == "00:00", "zero timecode")
        require(Policy.label(seconds: 59.99) == "00:59", "fractional seconds")
        require(Policy.label(seconds: 123.45) == "02:03", "normal timecode")
        require(Policy.label(seconds: 3600) == "60:00", "long audio timecode")
        require(Policy.acceptedDuration(123.45) == 123.45, "valid duration retained")
        require(Policy.acceptedDuration(0) == 0, "unknown duration not seekable")
        require(Policy.acceptedDuration(Double(Int32.max)) == Double(Int32.max),
                "largest admitted duration")

        // Invalid time sources must never reach Int(Double) or SwiftUI Slider.
        for invalid in [Double.nan, .infinity, -.infinity,
                        .greatestFiniteMagnitude, Double(Int.max),
                        Double(Int32.max) + 1, -1.0] {
            require(Policy.label(seconds: invalid) == "--:--", "invalid timecode rejected")
            require(Policy.acceptedDuration(invalid) == 0, "invalid duration rejected")
        }
        require(Policy.label(seconds: Double.leastNonzeroMagnitude) == "00:00",
                "finite subsecond timecode")
        print("native Files audio timecode bounds passed")
    }
}

import AppKit
import Foundation

/// Compare actual paired Apple Photos and xDrive map PNG screenshots from the
/// same device, OS, scale and cropped region. Source changes alone are never
/// evidence of Apple pixel parity. No input screenshots are committed to Git.
@main
struct XDriveIOSMapPixelAudit {
    static func pixels(_ url: URL) throws -> NSBitmapImageRep {
        let bytes = try Data(contentsOf: url)
        guard let value = NSBitmapImageRep(data: bytes),
              value.pixelsWide > 0, value.pixelsHigh > 0 else {
            throw NSError(domain: "M11", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Invalid PNG input"])
        }
        return value
    }

    static func main() throws {
        // Cropped matching regions only; status bar, clock, icons and personal
        // content must be excluded in source captures before comparison.
        let args = CommandLine.arguments
        guard args.count == 7,
              let perChannelTolerance = Double(args[5]),
              let maxMismatchRatio = Double(args[6]),
              (0...1).contains(perChannelTolerance),
              (0...1).contains(maxMismatchRatio) else {
            throw NSError(domain: "M11", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "Usage: compare-native-map-pixels <apple-reference.png> <xdrive-candidate.png> <diff.png> <summary.json> <channel-tolerance-0..1> <max-mismatch-ratio-0..1>"
            ])
        }
        let reference = try pixels(URL(fileURLWithPath: args[1]))
        let candidate = try pixels(URL(fileURLWithPath: args[2]))
        guard reference.pixelsWide == candidate.pixelsWide,
              reference.pixelsHigh == candidate.pixelsHigh else {
            throw NSError(domain: "M11", code: 3, userInfo: [
                NSLocalizedDescriptionKey: "Reference and candidate crops must have identical pixel dimensions"
            ])
        }
        let width = reference.pixelsWide
        let height = reference.pixelsHigh
        guard let diff = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
            isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0,
            bitsPerPixel: 0) else {
            throw NSError(domain: "M11", code: 4, userInfo: [
                NSLocalizedDescriptionKey: "Could not allocate M11 numeric diff image"
            ])
        }
        var mismatched = 0
        var maximumDelta = 0.0
        for y in 0..<height {
            for x in 0..<width {
                guard let a = reference.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB),
                      let b = candidate.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else {
                    throw NSError(domain: "M11", code: 5, userInfo: [
                        NSLocalizedDescriptionKey: "Invalid pixel color conversion"
                    ])
                }
                let channels = [
                    abs(a.redComponent - b.redComponent),
                    abs(a.greenComponent - b.greenComponent),
                    abs(a.blueComponent - b.blueComponent),
                    abs(a.alphaComponent - b.alphaComponent)
                ]
                let error = channels.max() ?? 0
                maximumDelta = max(maximumDelta, error)
                if error > perChannelTolerance { mismatched += 1 }
                diff.setColor(NSColor(
                    calibratedRed: error, green: 0, blue: 0, alpha: 1),
                    atX: x, y: y)
            }
        }
        let ratio = Double(mismatched) / Double(width * height)
        guard let png = diff.representation(using: .png, properties: [:]) else {
            throw NSError(domain: "M11", code: 6, userInfo: [
                NSLocalizedDescriptionKey: "Could not write M11 image diff"
            ])
        }
        try png.write(to: URL(fileURLWithPath: args[3]), options: .atomic)
        let result: [String: Any] = [
            "schema": "xdrive.m11.pixel-parity.v1",
            "reference_type": "paired genuine Apple Photos screenshot crop",
            "candidate_type": "paired actual xDrive native MapKit screenshot crop",
            "width_pixels": width, "height_pixels": height,
            "mismatched_pixels": mismatched, "mismatch_ratio": ratio,
            "max_channel_delta": maximumDelta,
            "per_channel_tolerance": perChannelTolerance,
            "maximum_allowed_mismatch_ratio": maxMismatchRatio,
            "passed": ratio <= maxMismatchRatio
        ]
        let json = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys, .prettyPrinted])
        try json.write(to: URL(fileURLWithPath: args[4]), options: .atomic)
        print("IOS_M11_NATIVE_MAP_PIXEL_COMPARE ratio=\(ratio) max_delta=\(maximumDelta) passed=\(ratio <= maxMismatchRatio)")
        if ratio > maxMismatchRatio {
            throw NSError(domain: "M11", code: 7, userInfo: [
                NSLocalizedDescriptionKey: "Actual paired pixel mismatch exceeds specified threshold"
            ])
        }
    }
}

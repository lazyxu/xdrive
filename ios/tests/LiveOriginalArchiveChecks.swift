import Foundation

@main
struct XDriveIOSLiveOriginalArchiveChecks {
    static func main() throws {
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("xdrive-live-archive-check-" + UUID().uuidString,
                                    isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: folder) }
        let image = folder.appendingPathComponent("resource-0")
        let video = folder.appendingPathComponent("resource-1")
        let imageBytes = Data([0, 1, 2, 3, 0, 255, 128, 64])
        let videoBytes = Data((0..<65_536).map { UInt8($0 % 251) })
        try imageBytes.write(to: image)
        try videoBytes.write(to: video)
        let still = XDriveIOSLiveArchiveInput(
            role: "still", fileURL: image, originalFilename: "IMG_001.HEIC",
            byteCount: Int64(imageBytes.count)
        )
        let motion = XDriveIOSLiveArchiveInput(
            role: "motion", fileURL: video, originalFilename: "IMG_001.MOV",
            byteCount: Int64(videoBytes.count)
        )
        let output = folder.appendingPathComponent("live-original.zip")
        let count = try XDriveIOSLiveOriginalArchive.create(
            still: still, motion: motion, outputURL: output
        )
        let recorded = try FileManager.default.attributesOfItem(atPath: output.path)
        precondition(count == (recorded[.size] as? NSNumber)?.int64Value)
        // macOS's own ZIP reader validates the STORE entries and CRC32.
        func unzip(_ arguments: [String]) throws -> Data {
            let task = Process()
            task.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
            task.arguments = arguments
            let stdout = Pipe()
            task.standardOutput = stdout
            task.standardError = Pipe()
            try task.run()
            let bytes = stdout.fileHandleForReading.readDataToEndOfFile()
            task.waitUntilExit()
            precondition(task.terminationStatus == 0, "Invalid original ZIP entries")
            return bytes
        }
        _ = try unzip(["-t", output.path])
        let extractedStill = try unzip(["-p", output.path, "media/still.heic"])
        let extractedMotion = try unzip(["-p", output.path, "media/motion.mov"])
        precondition(extractedStill == imageBytes)
        precondition(extractedMotion == videoBytes)
        let manifestData = try unzip(["-p", output.path, "manifest.json"])
        let manifest = try JSONSerialization.jsonObject(with: manifestData)
        guard let root = manifest as? [String: Any],
              root["format"] as? String == "xdrive-live-originals",
              root["version"] as? Int == 1,
              let items = root["resources"] as? [[String: Any]],
              items.count == 2,
              items[0]["role"] as? String == "still",
              items[0]["originalFilename"] as? String == "IMG_001.HEIC",
              items[1]["role"] as? String == "motion",
              items[1]["originalFilename"] as? String == "IMG_001.MOV" else {
            preconditionFailure("Original pair manifest incomplete")
        }
        // Refuse a missing/mutated motion byte sequence without leaving a
        // partial final artifact or returning a false backup receipt.
        let badOutput = folder.appendingPathComponent("invalid.zip")
        let invalidMotion = XDriveIOSLiveArchiveInput(
            role: "motion", fileURL: video, originalFilename: "IMG_001.MOV",
            byteCount: Int64(videoBytes.count + 1)
        )
        do {
            _ = try XDriveIOSLiveOriginalArchive.create(
                still: still, motion: invalidMotion, outputURL: badOutput
            )
            preconditionFailure("A changed original must fail")
        } catch {
            precondition(!FileManager.default.fileExists(atPath: badOutput.path))
        }
        print("Live Photo original still/motion single-Node ZIP: PASS")
    }
}

import Foundation

@main
struct XDriveIOSLivePreviewArchiveChecks {
    static func main() throws {
        let manager = FileManager.default
        let directory = manager.temporaryDirectory.appendingPathComponent("xdrive-preview-test-" + UUID().uuidString)
        try manager.createDirectory(at: directory, withIntermediateDirectories: false)
        defer { try? manager.removeItem(at: directory) }
        let stillURL = directory.appendingPathComponent("source-still")
        let motionURL = directory.appendingPathComponent("source-motion")
        let still = Data((0..<512).map { UInt8($0 % 251) })
        let motion = Data((0..<130_003).map { UInt8($0 % 233) })
        try still.write(to: stillURL)
        try motion.write(to: motionURL)
        let zip = directory.appendingPathComponent("original.zip")
        _ = try XDriveIOSLiveOriginalArchive.create(
            still: XDriveIOSLiveArchiveInput(role: "still", fileURL: stillURL,
                                             originalFilename: "IMG_0001.HEIC", byteCount: Int64(still.count)),
            motion: XDriveIOSLiveArchiveInput(role: "motion", fileURL: motionURL,
                                              originalFilename: "IMG_0001.MOV", byteCount: Int64(motion.count)),
            outputURL: zip)
        let live = try XDriveIOSLivePreviewArchive.extract(zip, in: directory)
        let decodedStill = try Data(contentsOf: live.stillURL)
        precondition(decodedStill == still)
        let decodedMotion = try Data(contentsOf: live.motionURL)
        precondition(decodedMotion == motion)
        precondition(manager.fileExists(atPath: live.folderURL.path))
        live.discard()
        precondition(!manager.fileExists(atPath: live.folderURL.path))
        let original = try Data(contentsOf: zip)
        func mustReject(_ bytes: Data, name: String) throws {
            let file = directory.appendingPathComponent("mutated-" + name + ".zip")
            try bytes.write(to: file)
            let before = Set(try manager.contentsOfDirectory(atPath: directory.path))
            do {
                let result = try XDriveIOSLivePreviewArchive.extract(file, in: directory)
                result.discard()
                preconditionFailure("Accepted invalid ZIP: \(name)")
            } catch { }
            let after = Set(try manager.contentsOfDirectory(atPath: directory.path))
            precondition(before == after, "Left staging on invalid ZIP: \(name)")
        }
        var crcTampered = original
        crcTampered[48] ^= 0x80
        try mustReject(crcTampered, name: "data-crc")
        try mustReject(Data(original.dropLast(22)), name: "missing-eocd")
        var zipBomb = original
        // Uncompressed size header advertises 0x7FFFFFFF, impossible for source.
        for i in 22..<26 { zipBomb[i] = 0x7f }
        try mustReject(zipBomb, name: "oversized")
        var escaped = original
        // The first entry name at offset 30 may not escape the private stage.
        escaped.replaceSubrange(30..<35, with: Data("../..".utf8))
        try mustReject(escaped, name: "zip-slip")
        var wrongManifest = original
        if let range = wrongManifest.range(of: Data("xdrive-live-originals".utf8)) {
            wrongManifest[range.lowerBound] = UInt8(ascii: "y")
            try mustReject(wrongManifest, name: "manifest")
        } else { preconditionFailure("Missing ZIP manifest") }
        print("Live preview bounded STORE ZIP, CRC, manifest and clean failure: PASS")
    }
}

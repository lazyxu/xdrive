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
        // ZIP64 local extras sit between the filename and actual data.
        // Mutate the data byte, not the ZIP64 metadata, to exercise CRC.
        let firstNameCount = Int(original[26]) | (Int(original[27]) << 8)
        let firstExtraCount = Int(original[28]) | (Int(original[29]) << 8)
        precondition(firstExtraCount == 20, "writer must use local ZIP64 size extras")
        let firstExtra = 30 + firstNameCount
        let firstPayload = firstExtra + firstExtraCount
        precondition(firstPayload < original.count)
        var crcTampered = original
        crcTampered[firstPayload] ^= 0x80
        try mustReject(crcTampered, name: "data-crc")
        try mustReject(Data(original.dropLast(22)), name: "missing-eocd")
        var zipBomb = original
        // Inflate authoritative ZIP64 size beyond the actual file.
        zipBomb[firstExtra + 4 + 7] = 0x7f
        try mustReject(zipBomb, name: "oversized")
        let locatorSignature = Data([0x50, 0x4b, 0x06, 0x07])
        guard let locator = original.range(of: locatorSignature) else {
            preconditionFailure("Missing ZIP64 locator")
        }
        var wrongLocator = original
        wrongLocator[locator.lowerBound + 8] ^= 0x80
        try mustReject(wrongLocator, name: "zip64-locator-offset")
        var escaped = original
        // The first entry name at offset 30 may not escape the private stage.
        escaped.replaceSubrange(30..<35, with: Data("../..".utf8))
        try mustReject(escaped, name: "zip-slip")
        var wrongManifest = original
        if let range = wrongManifest.range(of: Data("xdrive-live-originals".utf8)) {
            wrongManifest[range.lowerBound] = UInt8(ascii: "y")
            try mustReject(wrongManifest, name: "manifest")
        } else { preconditionFailure("Missing ZIP manifest") }
        // Previously uploaded Live archives used the product's strict
        // three-entry ZIP32 STORE format. ZIP64 support must not break them.
        let legacyFixture = """
        UEsDBBQAAAgAAAAAIQBNbcpxAwAAAAMAAAAQAAAAbWVkaWEvc3RpbGwuaGVpYwIEBlBLAwQUAAAIAAAAACEAXHkHLgQAAAAEAAAAEAAAAG1lZGlhL21vdGlvbi5tb3YHCQsNUEsDBBQAAAgAAAAAIQDsw9DaDgEAAA4BAAANAAAAbWFuaWZlc3QuanNvbnsiZm9ybWF0IjoieGRyaXZlLWxpdmUtb3JpZ2luYWxzIiwidmVyc2lvbiI6MSwicmVzb3VyY2VzIjpbeyJyb2xlIjoic3RpbGwiLCJwYXRoIjoibWVkaWEvc3RpbGwuaGVpYyIsIm9yaWdpbmFsRmlsZW5hbWUiOiJMRUdBQ1kuSEVJQyIsImJ5dGVzIjozLCJjcmMzMiI6IjcxY2E2ZDRkIn0seyJyb2xlIjoibW90aW9uIiwicGF0aCI6Im1lZGlhL21vdGlvbi5tb3YiLCJvcmlnaW5hbEZpbGVuYW1lIjoiTEVHQUNZLk1PViIsImJ5dGVzIjo0LCJjcmMzMiI6IjJlMDc3OTVjIn1dfVBLAQIUABQAAAgAAAAAIQBNbcpxAwAAAAMAAAAQAAAAAAAAAAAAAAAAAAAAAABtZWRpYS9zdGlsbC5oZWljUEsBAhQAFAAACAAAAAAhAFx5By4EAAAABAAAABAAAAAAAAAAAAAAAAAAMQAAAG1lZGlhL21vdGlvbi5tb3ZQSwECFAAUAAAIAAAAACEA7MPQ2g4BAAAOAQAADQAAAAAAAAAAAAAAAABjAAAAbWFuaWZlc3QuanNvblBLBQYAAAAAAwADALcAAACcAQAAAAA=
        """
        guard let legacyBytes = Data(base64Encoded: legacyFixture) else {
            preconditionFailure("Broken legacy ZIP32 fixture")
        }
        let legacyURL = directory.appendingPathComponent("legacy.zip")
        try legacyBytes.write(to: legacyURL)
        let legacy = try XDriveIOSLivePreviewArchive.extract(legacyURL, in: directory)
        let restoredLegacyStill = try Data(contentsOf: legacy.stillURL)
        let restoredLegacyMotion = try Data(contentsOf: legacy.motionURL)
        precondition(restoredLegacyStill == Data([2, 4, 6]))
        precondition(restoredLegacyMotion == Data([7, 9, 11, 13]))
        legacy.discard()
        var legacyCRC = legacyBytes
        legacyCRC[30 + "media/still.heic".utf8.count] ^= 1
        try mustReject(legacyCRC, name: "legacy-data-crc")
        print("Live preview strict ZIP32/ZIP64 STORE, CRC, manifest and clean failure: PASS")
    }
}

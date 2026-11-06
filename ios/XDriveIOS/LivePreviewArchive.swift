import Foundation

/// An ephemeral, read-only Live original pair. Never persisted as a media cache.
struct XDriveIOSLivePreviewFiles: Sendable {
    let folderURL: URL
    let stillURL: URL
    let motionURL: URL

    func discard() { try? FileManager.default.removeItem(at: folderURL) }
}

enum XDriveIOSLivePreviewError: Error {
    case invalidArchive
    case tooLarge
    case unsupportedResource
}

/// Strict reader for the exact three-entry, STORE-only archive written by
/// XDriveIOSLiveOriginalArchive. Not a generic ZIP extractor: refuse every
/// unsupported feature, path, CRC mismatch, or manifest inconsistency.
enum XDriveIOSLivePreviewArchive {
    // The reader streams 1 MiB chunks; no iOS-specific Live archive size cap.
    // File metadata and UploadSession still use the signed Int64 range.
    static let maximumArchiveBytes: UInt64 = UInt64(Int64.max)
    private static let bufferSize = 1_048_576

    private struct Entry {
        let path: String
        let size: UInt64
        let checksum: UInt32
        let offset: UInt64
        let zip64: Bool
    }
    private struct Manifest: Decodable {
        let format: String
        let version: Int
        let resources: [Part]
        struct Part: Decodable {
            let role: String
            let path: String
            let originalFilename: String
            let bytes: Int64
            let crc32: String
        }
    }
    private static let crcTable: [UInt32] = (0..<256).map { index in
        var value = UInt32(index)
        for _ in 0..<8 {
            value = (value & 1) == 1 ? 0xedb88320 ^ (value >> 1) : value >> 1
        }
        return value
    }
    private static func updateCRC(_ previous: UInt32, _ data: Data) -> UInt32 {
        var state = previous
        for byte in data {
            state = crcTable[Int((state ^ UInt32(byte)) & 0xff)] ^ (state >> 8)
        }
        return state
    }
    private static func short(_ bytes: Data, _ offset: Int) throws -> UInt16 {
        guard offset >= 0 && offset + 2 <= bytes.count else {
            throw XDriveIOSLivePreviewError.invalidArchive
        }
        return UInt16(bytes[offset]) | (UInt16(bytes[offset + 1]) << 8)
    }
    private static func word(_ bytes: Data, _ offset: Int) throws -> UInt32 {
        guard offset >= 0 && offset + 4 <= bytes.count else {
            throw XDriveIOSLivePreviewError.invalidArchive
        }
        return UInt32(bytes[offset]) | (UInt32(bytes[offset + 1]) << 8) |
            (UInt32(bytes[offset + 2]) << 16) | (UInt32(bytes[offset + 3]) << 24)
    }
    private static func qword(_ bytes: Data, _ offset: Int) throws -> UInt64 {
        guard offset >= 0 && offset + 8 <= bytes.count else {
            throw XDriveIOSLivePreviewError.invalidArchive
        }
        var result: UInt64 = 0
        for index in 0..<8 {
            result |= UInt64(bytes[offset + index]) << (index * 8)
        }
        return result
    }
    private static func invalid() -> XDriveIOSLivePreviewError { .invalidArchive }
    private static func exact(_ handle: FileHandle, _ count: Int) throws -> Data {
        guard count >= 0 && count <= bufferSize else {
            throw XDriveIOSLivePreviewError.invalidArchive
        }
        var result = Data()
        while result.count < count {
            try Task.checkCancellation()
            guard let part = try handle.read(upToCount: count - result.count),
                  !part.isEmpty else { throw XDriveIOSLivePreviewError.invalidArchive }
            result.append(part)
        }
        return result
    }
    private static func allowed(_ path: String, role: String) -> Bool {
        if role == "manifest" { return path == "manifest.json" }
        let prefix = "media/" + role + "."
        guard path.hasPrefix(prefix) else { return false }
        let suffix = String(path.dropFirst(prefix.count))
        let allowed = role == "still"
            ? ["jpg", "jpeg", "png", "heic", "heif", "tif", "tiff", "dng"]
            : ["mov", "mp4", "m4v"]
        return allowed.contains(suffix)
    }
    private static func attributes(permissions: Int) -> [FileAttributeKey: Any] {
        var attrs: [FileAttributeKey: Any] = [
            .posixPermissions: NSNumber(value: permissions)
        ]
        #if os(iOS)
        attrs[.protectionKey] = FileProtectionType.complete
        #endif
        return attrs
    }

    static func extract(_ archiveURL: URL,
                        in directory: URL = FileManager.default.temporaryDirectory)
        throws -> XDriveIOSLivePreviewFiles {
        let manager = FileManager.default
        guard archiveURL.isFileURL, directory.isFileURL,
              let attr = try? manager.attributesOfItem(atPath: archiveURL.path),
              attr[.type] as? FileAttributeType == .typeRegular,
              let size = (attr[.size] as? NSNumber)?.uint64Value,
              size >= 200, size <= maximumArchiveBytes else {
            throw XDriveIOSLivePreviewError.tooLarge
        }
        let staging = directory.appendingPathComponent(
            "xdrive-live-preview-" + UUID().uuidString, isDirectory: true)
        try manager.createDirectory(at: staging, withIntermediateDirectories: false,
                                    attributes: attributes(permissions: 0o700))
        var finished = false
        defer { if !finished { try? manager.removeItem(at: staging) } }
        let input = try FileHandle(forReadingFrom: archiveURL)
        defer { try? input.close() }

        // Accept only this product's exact three-entry legacy ZIP32 or ZIP64
        // STORE layout. Never parse arbitrary compressed ZIPs or use a ZIP
        // library that could expand untrusted entries without bounded reads.
        var entries: [Entry] = []
        var manifestBytes = Data()
        var stillURL: URL?
        var motionURL: URL?
        var archiveIsZIP64: Bool?
        for role in ["still", "motion", "manifest"] {
            try Task.checkCancellation()
            let position = input.offsetInFile
            guard position <= size, size - position >= 30 else {
                throw XDriveIOSLivePreviewError.invalidArchive
            }
            let header = try exact(input, 30)
            guard try word(header, 0) == 0x04034b50,
                  try short(header, 6) == 0x0800, // UTF-8, no descriptor
                  try short(header, 8) == 0 else { // STORE only
                throw XDriveIOSLivePreviewError.invalidArchive
            }
            let nameCount = Int(try short(header, 26))
            let extraCount = Int(try short(header, 28))
            let compressed32 = try word(header, 18)
            let uncompressed32 = try word(header, 22)
            let usesZIP64 = compressed32 == UInt32.max || uncompressed32 == UInt32.max
            guard nameCount > 0, nameCount <= 64,
                  extraCount == (usesZIP64 ? 20 : 0),
                  try short(header, 4) == (usesZIP64 ? 45 : 20),
                  compressed32 == uncompressed32,
                  archiveIsZIP64 == nil || archiveIsZIP64 == usesZIP64 else {
                throw XDriveIOSLivePreviewError.invalidArchive
            }
            archiveIsZIP64 = usesZIP64
            guard input.offsetInFile <= size,
                  UInt64(nameCount + extraCount) <= size - input.offsetInFile else {
                throw XDriveIOSLivePreviewError.invalidArchive
            }
            let filenameBytes = try exact(input, nameCount)
            guard let filename = String(data: filenameBytes, encoding: .utf8),
                  allowed(filename, role: role) else {
                throw XDriveIOSLivePreviewError.unsupportedResource
            }
            let extra = try exact(input, extraCount)
            let amount: UInt64
            if usesZIP64 {
                guard try short(extra, 0) == 0x0001,
                      try short(extra, 2) == 16 else {
                    throw XDriveIOSLivePreviewError.invalidArchive
                }
                let uncompressed = try qword(extra, 4)
                let compressed = try qword(extra, 12)
                guard uncompressed == compressed else {
                    throw XDriveIOSLivePreviewError.invalidArchive
                }
                amount = compressed
            } else {
                amount = UInt64(compressed32)
            }
            guard (role == "manifest"
                    ? amount > 0 && amount <= 65_535
                    : amount > 0),
                  input.offsetInFile <= size,
                  amount <= size - input.offsetInFile else {
                throw XDriveIOSLivePreviewError.invalidArchive
            }

            let output: URL?
            if role == "manifest" {
                output = nil
            } else {
                let name = String(filename.dropFirst("media/".count))
                output = staging.appendingPathComponent(name, isDirectory: false)
                guard let output,
                      manager.createFile(atPath: output.path, contents: nil,
                                         attributes: attributes(permissions: 0o600)) else {
                    throw XDriveIOSLivePreviewError.invalidArchive
                }
            }
            let writer = try output.map { try FileHandle(forWritingTo: $0) }
            defer { try? writer?.close() }
            var remaining = amount
            var computed = UInt32.max
            while remaining > 0 {
                try Task.checkCancellation()
                let chunk = try exact(input, Int(min(remaining, UInt64(bufferSize))))
                computed = updateCRC(computed, chunk)
                if role == "manifest" { manifestBytes.append(chunk) }
                else { try writer?.write(contentsOf: chunk) }
                remaining -= UInt64(chunk.count)
            }
            guard ~computed == (try word(header, 14)) else {
                throw XDriveIOSLivePreviewError.invalidArchive
            }
            try writer?.synchronize()
            entries.append(Entry(path: filename, size: amount,
                                 checksum: try word(header, 14),
                                 offset: position, zip64: usesZIP64))
            if role == "still" { stillURL = output }
            if role == "motion" { motionURL = output }
        }

        let centralOffset = input.offsetInFile
        for expected in entries {
            try Task.checkCancellation()
            let header = try exact(input, 46)
            let usesZIP64 = expected.zip64
            let compressed32 = try word(header, 20)
            let uncompressed32 = try word(header, 24)
            let offset32 = try word(header, 42)
            guard try word(header, 0) == 0x02014b50,
                  try short(header, 6) == (usesZIP64 ? 45 : 20),
                  try short(header, 8) == 0x0800,
                  try short(header, 10) == 0,
                  try word(header, 16) == expected.checksum,
                  try short(header, 30) == (usesZIP64 ? 28 : 0),
                  try short(header, 32) == 0, // no file comment
                  try short(header, 34) == 0, // single disk
                  try word(header, 38) == 0,
                  (usesZIP64
                    ? compressed32 == UInt32.max &&
                      uncompressed32 == UInt32.max &&
                      offset32 == UInt32.max
                    : UInt64(compressed32) == expected.size &&
                      uncompressed32 == compressed32 &&
                      UInt64(offset32) == expected.offset) else {
                throw XDriveIOSLivePreviewError.invalidArchive
            }
            let nameLen = Int(try short(header, 28))
            guard nameLen == expected.path.utf8.count,
                  (try String(data: exact(input, nameLen), encoding: .utf8)) == expected.path else {
                throw XDriveIOSLivePreviewError.invalidArchive
            }
            if usesZIP64 {
                let extra = try exact(input, 28)
                guard try short(extra, 0) == 0x0001,
                      try short(extra, 2) == 24,
                      try qword(extra, 4) == expected.size,
                      try qword(extra, 12) == expected.size,
                      try qword(extra, 20) == expected.offset else {
                    throw XDriveIOSLivePreviewError.invalidArchive
                }
            }
        }

        let directorySize = input.offsetInFile - centralOffset
        if archiveIsZIP64 == true {
            let zip64EndOffset = input.offsetInFile
            let end = try exact(input, 56)
            guard try word(end, 0) == 0x06064b50,
                  try qword(end, 4) == 44,
                  try short(end, 12) == 45, try short(end, 14) == 45,
                  try word(end, 16) == 0, try word(end, 20) == 0,
                  try qword(end, 24) == 3, try qword(end, 32) == 3,
                  try qword(end, 40) == directorySize,
                  try qword(end, 48) == centralOffset else {
                throw XDriveIOSLivePreviewError.invalidArchive
            }
            let locator = try exact(input, 20)
            guard try word(locator, 0) == 0x07064b50,
                  try word(locator, 4) == 0,
                  try qword(locator, 8) == zip64EndOffset,
                  try word(locator, 16) == 1 else {
                throw XDriveIOSLivePreviewError.invalidArchive
            }
            let classic = try exact(input, 22)
            guard try word(classic, 0) == 0x06054b50,
                  try short(classic, 4) == 0, try short(classic, 6) == 0,
                  try short(classic, 8) == UInt16.max,
                  try short(classic, 10) == UInt16.max,
                  try word(classic, 12) == UInt32.max,
                  try word(classic, 16) == UInt32.max,
                  try short(classic, 20) == 0,
                  input.offsetInFile == size else {
                throw XDriveIOSLivePreviewError.invalidArchive
            }
        } else {
            let footer = try exact(input, 22)
            guard try word(footer, 0) == 0x06054b50,
                  try short(footer, 4) == 0, try short(footer, 6) == 0,
                  try short(footer, 8) == 3, try short(footer, 10) == 3,
                  UInt64(try word(footer, 12)) == directorySize,
                  UInt64(try word(footer, 16)) == centralOffset,
                  try short(footer, 20) == 0,
                  input.offsetInFile == size else {
                throw XDriveIOSLivePreviewError.invalidArchive
            }
        }

        let manifest = try JSONDecoder().decode(Manifest.self, from: manifestBytes)
        guard manifest.format == "xdrive-live-originals", manifest.version == 1,
              manifest.resources.count == 2,
              zip(manifest.resources, entries.prefix(2)).allSatisfy({ pair in
                  let (resource, entry) = pair
                  return resource.role == (entry.path.hasPrefix("media/still.") ? "still" : "motion") &&
                      resource.path == entry.path &&
                      entry.size <= UInt64(Int64.max) &&
                      resource.bytes == Int64(entry.size) &&
                      resource.crc32 == String(format: "%08x", entry.checksum) &&
                      !resource.originalFilename.isEmpty &&
                      resource.originalFilename.utf8.count <= 255
              }), let stillURL, let motionURL else {
            throw XDriveIOSLivePreviewError.invalidArchive
        }
        try Task.checkCancellation()
        finished = true
        return XDriveIOSLivePreviewFiles(folderURL: staging, stillURL: stillURL,
                                        motionURL: motionURL)
    }
}

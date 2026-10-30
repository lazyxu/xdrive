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
    static let maximumArchiveBytes: UInt64 = 1_073_741_824 + 131_072
    private static let bufferSize = 1_048_576

    private struct Entry {
        let path: String
        let size: UInt32
        let checksum: UInt32
        let offset: UInt32
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
        var entries: [Entry] = []
        var manifestBytes = Data()
        var stillURL: URL?
        var motionURL: URL?
        for role in ["still", "motion", "manifest"] {
            try Task.checkCancellation()
            let position = input.offsetInFile
            guard position < UInt64(UInt32.max),
                  position + 30 <= size else {
                throw XDriveIOSLivePreviewError.invalidArchive
            }
            let header = try exact(input, 30)
            guard try word(header, 0) == 0x04034b50,
                  try short(header, 6) == 0x0800, // UTF-8, no data descriptors
                  try short(header, 8) == 0 else { // STORE, never decompress
                throw XDriveIOSLivePreviewError.invalidArchive
            }
            let nameCount = Int(try short(header, 26))
            let extraCount = Int(try short(header, 28))
            guard nameCount > 0, nameCount <= 64, extraCount == 0 else {
                throw XDriveIOSLivePreviewError.invalidArchive
            }
            let amount = try word(header, 18)
            let uncompressed = try word(header, 22)
            let crc = try word(header, 14)
            guard amount == uncompressed,
                  (role == "manifest" ? amount <= 65_535 : amount > 0 && amount <= 512 * 1_048_576),
                  input.offsetInFile + UInt64(nameCount) + UInt64(amount) <= size else {
                throw XDriveIOSLivePreviewError.invalidArchive
            }
            let filenameBytes = try exact(input, nameCount)
            guard let filename = String(data: filenameBytes, encoding: .utf8),
                  allowed(filename, role: role) else {
                throw XDriveIOSLivePreviewError.unsupportedResource
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
            var copied = 0
            var computed = UInt32.max
            while copied < Int(amount) {
                let chunk = try exact(input, min(bufferSize, Int(amount) - copied))
                computed = updateCRC(computed, chunk)
                if role == "manifest" { manifestBytes.append(chunk) }
                else { try writer?.write(contentsOf: chunk) }
                copied += chunk.count
            }
            guard ~computed == crc else {
                throw XDriveIOSLivePreviewError.invalidArchive
            }
            try writer?.synchronize()
            entries.append(Entry(path: filename, size: amount, checksum: crc,
                                 offset: UInt32(position)))
            if role == "still" { stillURL = output }
            if role == "motion" { motionURL = output }
        }
        let centralOffset = input.offsetInFile
        for expected in entries {
            let header = try exact(input, 46)
            guard try word(header, 0) == 0x02014b50,
                  try short(header, 8) == 0x0800, try short(header, 10) == 0,
                  try word(header, 16) == expected.checksum,
                  try word(header, 20) == expected.size,
                  try word(header, 24) == expected.size,
                  try short(header, 30) == 0, try short(header, 32) == 0,
                  try short(header, 34) == 0,
                  try word(header, 42) == expected.offset else {
                throw XDriveIOSLivePreviewError.invalidArchive
            }
            let nameLen = Int(try short(header, 28))
            guard nameLen == expected.path.utf8.count,
                  (try String(data: exact(input, nameLen), encoding: .utf8)) == expected.path else {
                throw XDriveIOSLivePreviewError.invalidArchive
            }
        }
        let directorySize = input.offsetInFile - centralOffset
        let footer = try exact(input, 22)
        guard try word(footer, 0) == 0x06054b50,
              try short(footer, 4) == 0, try short(footer, 6) == 0,
              try short(footer, 8) == 3, try short(footer, 10) == 3,
              try word(footer, 12) == directorySize,
              try word(footer, 16) == centralOffset,
              try short(footer, 20) == 0,
              input.offsetInFile == size else {
            throw XDriveIOSLivePreviewError.invalidArchive
        }
        let manifest = try JSONDecoder().decode(Manifest.self, from: manifestBytes)
        guard manifest.format == "xdrive-live-originals", manifest.version == 1,
              manifest.resources.count == 2,
              zip(manifest.resources, entries.prefix(2)).allSatisfy({ pair in
                  let (resource, entry) = pair
                  return resource.role == (entry.path.hasPrefix("media/still.") ? "still" : "motion") &&
                      resource.path == entry.path &&
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

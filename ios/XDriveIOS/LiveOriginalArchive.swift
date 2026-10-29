import Foundation

/// A single recoverable ZIP (store, no recompression) is the atomic Owner
/// UploadSession unit for the TWO original PhotoKit resources of a Live Photo.
/// No temporary still-only Node is ever considered a backed-up Live asset.
struct XDriveIOSLiveArchiveInput {
    let role: String
    let fileURL: URL
    let originalFilename: String
    let byteCount: Int64
}

enum XDriveIOSLiveArchiveFailure: Error {
    case invalidPair
    case invalidSource
    case tooLarge
    case resourceChanged
    case archiveFailed
}

enum XDriveIOSLiveOriginalArchive {
    static let maximumPartBytes: Int64 = 512 * 1_048_576
    static let maximumBundleBytes: Int64 = 1_073_741_824
    private static let bufferSize = 1 * 1_048_576

    private struct Entry {
        let path: String
        let size: UInt32
        let checksum: UInt32
        let source: URL?
        let memory: Data?
    }
    private struct Manifest: Encodable {
        let format: String
        let version: Int
        let resources: [Part]
        struct Part: Encodable {
            let role: String
            let path: String
            let originalFilename: String
            let bytes: Int64
            let crc32: String
        }
    }
    private struct Central {
        let entry: Entry
        let offset: UInt32
    }

    /// The caller creates a unique, private, protected staging directory and
    /// must remove the whole folder in defer on every result or cancellation.
    /// Only the ZIP Node is uploaded. The central directory is written only
    /// after both originals + manifest pass size/CRC checks.
    static func create(still: XDriveIOSLiveArchiveInput,
                       motion: XDriveIOSLiveArchiveInput,
                       outputURL: URL) throws -> Int64 {
        guard still.role == "still", motion.role == "motion",
              outputURL.isFileURL, still.fileURL.isFileURL, motion.fileURL.isFileURL,
              still.fileURL != motion.fileURL,
              still.fileURL != outputURL, motion.fileURL != outputURL,
              still.fileURL.deletingLastPathComponent().standardizedFileURL ==
                outputURL.deletingLastPathComponent().standardizedFileURL,
              motion.fileURL.deletingLastPathComponent().standardizedFileURL ==
                outputURL.deletingLastPathComponent().standardizedFileURL,
              !FileManager.default.fileExists(atPath: outputURL.path) else {
            throw XDriveIOSLiveArchiveFailure.invalidPair
        }
        for resource in [still, motion] {
            guard resource.byteCount > 0, resource.byteCount <= maximumPartBytes,
                  !resource.originalFilename.isEmpty,
                  resource.originalFilename.utf8.count <= 255 else {
                throw XDriveIOSLiveArchiveFailure.tooLarge
            }
        }
        guard still.byteCount <= maximumBundleBytes - motion.byteCount else {
            throw XDriveIOSLiveArchiveFailure.tooLarge
        }
        try Task.checkCancellation()
        let pair: [(role: String, input: XDriveIOSLiveArchiveInput)] = [
            ("still", still), ("motion", motion)
        ]
        var content: [Entry] = []
        var parts: [Manifest.Part] = []
        for part in pair {
            let path = "media/" + part.role + extensionFor(part.input.originalFilename)
            let crc = try checksum(part.input.fileURL, expected: part.input.byteCount)
            content.append(Entry(path: path, size: UInt32(part.input.byteCount),
                                 checksum: crc, source: part.input.fileURL, memory: nil))
            parts.append(Manifest.Part(
                role: part.role, path: path,
                originalFilename: part.input.originalFilename,
                bytes: part.input.byteCount,
                crc32: String(format: "%08x", crc)
            ))
        }
        var encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let manifest = try encoder.encode(
            Manifest(format: "xdrive-live-originals", version: 1, resources: parts)
        )
        guard manifest.count <= 65_535 else {
            throw XDriveIOSLiveArchiveFailure.archiveFailed
        }
        content.append(Entry(path: "manifest.json", size: UInt32(manifest.count),
                             checksum: crc32(manifest), source: nil, memory: manifest))
        var attributes: [FileAttributeKey: Any] = [
            .posixPermissions: NSNumber(value: 0o600)
        ]
        #if os(iOS)
        attributes[.protectionKey] = FileProtectionType.complete
        #endif
        guard FileManager.default.createFile(
            atPath: outputURL.path, contents: nil, attributes: attributes
        ) else { throw XDriveIOSLiveArchiveFailure.archiveFailed }
        var committed = false
        defer {
            if !committed { try? FileManager.default.removeItem(at: outputURL) }
        }
        let handle = try FileHandle(forWritingTo: outputURL)
        defer { try? handle.close() }
        var cursor: UInt64 = 0
        func write(_ data: Data) throws {
            try Task.checkCancellation()
            try handle.write(contentsOf: data)
            cursor += UInt64(data.count)
            guard cursor < UInt64(UInt32.max) else {
                throw XDriveIOSLiveArchiveFailure.tooLarge
            }
        }
        var central: [Central] = []
        for entry in content {
            let localOffset = UInt32(cursor)
            let name = Data(entry.path.utf8)
            guard name.count < 65_535 else {
                throw XDriveIOSLiveArchiveFailure.archiveFailed
            }
            var header = Data()
            append(UInt32(0x04034b50), to: &header)
            append(UInt16(20), to: &header)
            append(UInt16(0x0800), to: &header) // UTF-8 ZIP filename
            append(UInt16(0), to: &header) // STORE, no lossy transcoding
            append(UInt16(0), to: &header) // DOS time
            append(UInt16(0x0021), to: &header) // 1980-01-01
            append(entry.checksum, to: &header)
            append(entry.size, to: &header)
            append(entry.size, to: &header)
            append(UInt16(name.count), to: &header)
            append(UInt16(0), to: &header)
            try write(header)
            try write(name)
            if let original = entry.source {
                let input = try FileHandle(forReadingFrom: original)
                defer { try? input.close() }
                var copied: UInt64 = 0
                var checksum = UInt32.max
                while let bytes = try input.read(upToCount: bufferSize), !bytes.isEmpty {
                    try Task.checkCancellation()
                    copied += UInt64(bytes.count)
                    guard copied <= UInt64(entry.size) else {
                        throw XDriveIOSLiveArchiveFailure.resourceChanged
                    }
                    checksum = rollingCRC32(bytes, previous: checksum)
                    try write(bytes)
                }
                guard copied == UInt64(entry.size), ~checksum == entry.checksum else {
                    throw XDriveIOSLiveArchiveFailure.resourceChanged
                }
            } else if let data = entry.memory {
                try write(data)
            }
            central.append(Central(entry: entry, offset: localOffset))
        }
        let directoryOffset = UInt32(cursor)
        for record in central {
            let entry = record.entry
            let name = Data(entry.path.utf8)
            var header = Data()
            append(UInt32(0x02014b50), to: &header)
            append(UInt16(20), to: &header)
            append(UInt16(20), to: &header)
            append(UInt16(0x0800), to: &header)
            append(UInt16(0), to: &header)
            append(UInt16(0), to: &header)
            append(UInt16(0x0021), to: &header)
            append(entry.checksum, to: &header)
            append(entry.size, to: &header)
            append(entry.size, to: &header)
            append(UInt16(name.count), to: &header)
            append(UInt16(0), to: &header)
            append(UInt16(0), to: &header)
            append(UInt16(0), to: &header)
            append(UInt16(0), to: &header)
            append(UInt32(0), to: &header)
            append(record.offset, to: &header)
            try write(header)
            try write(name)
        }
        let centralBytes = UInt32(cursor) - directoryOffset
        var footer = Data()
        append(UInt32(0x06054b50), to: &footer)
        append(UInt16(0), to: &footer)
        append(UInt16(0), to: &footer)
        append(UInt16(central.count), to: &footer)
        append(UInt16(central.count), to: &footer)
        append(centralBytes, to: &footer)
        append(directoryOffset, to: &footer)
        append(UInt16(0), to: &footer)
        try write(footer)
        try handle.synchronize()
        committed = true
        return Int64(cursor)
    }

    private static func extensionFor(_ name: String) -> String {
        let ext = (name as NSString).pathExtension.lowercased()
        guard !ext.isEmpty, ext.utf8.count <= 12,
              ext.utf8.allSatisfy({ ($0 >= 97 && $0 <= 122) ||
                                    ($0 >= 48 && $0 <= 57) }) else { return ".bin" }
        return "." + ext
    }
    private static let crcTable: [UInt32] = (0..<256).map { index in
        var value = UInt32(index)
        for _ in 0..<8 {
            value = (value & 1) == 1 ? 0xedb88320 ^ (value >> 1) : value >> 1
        }
        return value
    }
    private static func rollingCRC32(_ bytes: Data, previous: UInt32) -> UInt32 {
        var value = previous
        for byte in bytes {
            value = crcTable[Int((value ^ UInt32(byte)) & 0xff)] ^ (value >> 8)
        }
        return value
    }
    private static func crc32(_ data: Data) -> UInt32 {
        ~rollingCRC32(data, previous: UInt32.max)
    }
    private static func checksum(_ source: URL, expected: Int64) throws -> UInt32 {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: source.path),
              (attributes[.type] as? FileAttributeType) == .typeRegular,
              (attributes[.size] as? NSNumber)?.int64Value == expected else {
            throw XDriveIOSLiveArchiveFailure.invalidSource
        }
        let file = try FileHandle(forReadingFrom: source)
        defer { try? file.close() }
        var count: Int64 = 0
        var crc = UInt32.max
        while let data = try file.read(upToCount: bufferSize), !data.isEmpty {
            try Task.checkCancellation()
            count += Int64(data.count)
            guard count <= expected else {
                throw XDriveIOSLiveArchiveFailure.resourceChanged
            }
            crc = rollingCRC32(data, previous: crc)
        }
        guard count == expected else { throw XDriveIOSLiveArchiveFailure.resourceChanged }
        return ~crc
    }
    private static func append<T: FixedWidthInteger>(_ number: T, to bytes: inout Data) {
        for index in 0..<MemoryLayout<T>.size {
            bytes.append(UInt8(truncatingIfNeeded: number >> (index * 8)))
        }
    }
}

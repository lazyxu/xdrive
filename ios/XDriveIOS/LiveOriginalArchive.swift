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
    // A local ZIP destination I/O failure invalidates the full scan window.
    case storageUnavailable
}

enum XDriveIOSLiveOriginalArchive {
    // Legacy compatibility constants describe the Int64 byte-count range,
    // not an iOS-specific photo/video size policy. ZIP64 stores 64-bit sizes.
    static let maximumPartBytes: Int64 = .max
    static let maximumBundleBytes: Int64 = .max
    private static let bufferSize = 1 * 1_048_576

    private struct Entry {
        let path: String
        let size: UInt64
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
        let offset: UInt64
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
            guard resource.byteCount > 0,
                  !resource.originalFilename.isEmpty,
                  resource.originalFilename.utf8.count <= 255 else {
                throw XDriveIOSLiveArchiveFailure.tooLarge
            }
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
            content.append(Entry(path: path, size: UInt64(part.input.byteCount),
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
        content.append(Entry(path: "manifest.json", size: UInt64(manifest.count),
                             checksum: crc32(manifest), source: nil, memory: manifest))
        var attributes: [FileAttributeKey: Any] = [
            .posixPermissions: NSNumber(value: 0o600)
        ]
        #if os(iOS)
        attributes[.protectionKey] = FileProtectionType.complete
        #endif
        guard FileManager.default.createFile(
            atPath: outputURL.path, contents: nil, attributes: attributes
        ) else { throw XDriveIOSLiveArchiveFailure.storageUnavailable }
        var committed = false
        defer {
            if !committed { try? FileManager.default.removeItem(at: outputURL) }
        }
        let handle: FileHandle
        do {
            handle = try FileHandle(forWritingTo: outputURL)
        } catch {
            throw XDriveIOSLiveArchiveFailure.storageUnavailable
        }
        defer { try? handle.close() }
        var cursor: UInt64 = 0
        func write(_ data: Data) throws {
            try Task.checkCancellation()
            let (next, overflow) = cursor.addingReportingOverflow(UInt64(data.count))
            guard !overflow && next <= UInt64(Int64.max) else {
                // Int64 is the on-disk file metadata / UploadSession range,
                // not a product-imposed media limit.
                throw XDriveIOSLiveArchiveFailure.tooLarge
            }
            do {
                try handle.write(contentsOf: data)
            } catch {
                throw XDriveIOSLiveArchiveFailure.storageUnavailable
            }
            cursor = next
        }
        var central: [Central] = []
        for entry in content {
            let localOffset = cursor
            let name = Data(entry.path.utf8)
            guard name.count < 65_535 else {
                throw XDriveIOSLiveArchiveFailure.archiveFailed
            }
            let extra = zip64Extra(size: entry.size, offset: nil)
            var header = Data()
            append(UInt32(0x04034b50), to: &header)
            append(UInt16(45), to: &header) // ZIP64 version needed
            append(UInt16(0x0800), to: &header) // UTF-8 ZIP filename
            append(UInt16(0), to: &header) // STORE, no lossy transcoding
            append(UInt16(0), to: &header)
            append(UInt16(0x0021), to: &header)
            append(entry.checksum, to: &header)
            append(UInt32.max, to: &header) // true sizes in ZIP64 extra
            append(UInt32.max, to: &header)
            append(UInt16(name.count), to: &header)
            append(UInt16(extra.count), to: &header)
            try write(header)
            try write(name)
            try write(extra)
            if let original = entry.source {
                let input = try openOriginal(original)
                defer { try? input.close() }
                var copied: UInt64 = 0
                var checksum = UInt32.max
                while let bytes = try nextOriginalChunk(input), !bytes.isEmpty {
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
        let directoryOffset = cursor
        for record in central {
            let entry = record.entry
            let name = Data(entry.path.utf8)
            let extra = zip64Extra(size: entry.size, offset: record.offset)
            var header = Data()
            append(UInt32(0x02014b50), to: &header)
            append(UInt16(45), to: &header) // ZIP64 version made by
            append(UInt16(45), to: &header) // ZIP64 version needed
            append(UInt16(0x0800), to: &header)
            append(UInt16(0), to: &header)
            append(UInt16(0), to: &header)
            append(UInt16(0x0021), to: &header)
            append(entry.checksum, to: &header)
            append(UInt32.max, to: &header)
            append(UInt32.max, to: &header)
            append(UInt16(name.count), to: &header)
            append(UInt16(extra.count), to: &header)
            append(UInt16(0), to: &header) // comment
            append(UInt16(0), to: &header) // disk
            append(UInt16(0), to: &header) // internal attributes
            append(UInt32(0), to: &header) // external attributes
            append(UInt32.max, to: &header) // true offset in ZIP64 extra
            try write(header)
            try write(name)
            try write(extra)
        }
        let directoryBytes = cursor - directoryOffset
        let zip64EndOffset = cursor
        var zip64End = Data()
        append(UInt32(0x06064b50), to: &zip64End)
        append(UInt64(44), to: &zip64End) // bytes after this size field
        append(UInt16(45), to: &zip64End)
        append(UInt16(45), to: &zip64End)
        append(UInt32(0), to: &zip64End)
        append(UInt32(0), to: &zip64End)
        append(UInt64(central.count), to: &zip64End)
        append(UInt64(central.count), to: &zip64End)
        append(directoryBytes, to: &zip64End)
        append(directoryOffset, to: &zip64End)
        try write(zip64End)
        var locator = Data()
        append(UInt32(0x07064b50), to: &locator)
        append(UInt32(0), to: &locator)
        append(zip64EndOffset, to: &locator)
        append(UInt32(1), to: &locator)
        try write(locator)
        // Classic EOCD fields are sentinels; ZIP64 stores authoritative
        // sizes, counts and offsets even for small archives.
        var footer = Data()
        append(UInt32(0x06054b50), to: &footer)
        append(UInt16(0), to: &footer)
        append(UInt16(0), to: &footer)
        append(UInt16.max, to: &footer)
        append(UInt16.max, to: &footer)
        append(UInt32.max, to: &footer)
        append(UInt32.max, to: &footer)
        append(UInt16(0), to: &footer)
        try write(footer)
        do {
            try handle.synchronize()
        } catch {
            throw XDriveIOSLiveArchiveFailure.storageUnavailable
        }
        committed = true
        return Int64(cursor)
    }

    /// Per-file ZIP64 extra: sizes in local/central entries, and the
    /// local-header offset in the central directory record.
    private static func zip64Extra(size: UInt64, offset: UInt64?) -> Data {
        var extra = Data()
        append(UInt16(0x0001), to: &extra)
        append(UInt16(offset == nil ? 16 : 24), to: &extra)
        append(size, to: &extra)
        append(size, to: &extra)
        if let offset { append(offset, to: &extra) }
        return extra
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
    // A transient read/open failure of protected PhotoKit staging is a
    // shared local I/O fault, not evidence that one media asset is missing.
    // Normalize both Live ZIP passes to the existing whole-run abort error:
    // otherwise a raw Cocoa/FileHandle error would be recorded as an
    // item-local "unavailable", letting a 256-slot backup cursor advance.
    private static func openOriginal(_ source: URL) throws -> FileHandle {
        do {
            return try FileHandle(forReadingFrom: source)
        } catch {
            throw XDriveIOSLiveArchiveFailure.storageUnavailable
        }
    }

    private static func nextOriginalChunk(_ file: FileHandle) throws -> Data? {
        do {
            return try file.read(upToCount: bufferSize)
        } catch {
            throw XDriveIOSLiveArchiveFailure.storageUnavailable
        }
    }

    private static func checksum(_ source: URL, expected: Int64) throws -> UInt32 {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: source.path),
              (attributes[.type] as? FileAttributeType) == .typeRegular,
              (attributes[.size] as? NSNumber)?.int64Value == expected else {
            throw XDriveIOSLiveArchiveFailure.invalidSource
        }
        let file = try openOriginal(source)
        defer { try? file.close() }
        var count: Int64 = 0
        var crc = UInt32.max
        while let data = try nextOriginalChunk(file), !data.isEmpty {
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

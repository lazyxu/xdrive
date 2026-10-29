import CryptoKit
import Foundation

/// The result of a Server-confirmed, Owner-authenticated original file commit.
/// No local PhotoKit identity or private token is ever included in the receipt.
struct XDriveNativeUploadReceipt {
    let nodeID: UInt64
    let nodeName: String
    let revision: UInt64
    let sha256: String
    let bytes: Int64
    let sessionID: String
}

enum XDriveNativeUploadError: Error {
    case invalidLocalFile
    case invalidServerResponse
    case unauthorizedOrRejected(Int)
    case uncertainCommit
}

private struct NativeUploadSessionDTO: Decodable {
    let id: String
    let parent_id: UInt64?
    let name: String?
    let size: Int64
    let chunk_size: Int64
    let chunk_count: Int
    let sha256: String?
    let status: String
    let received_chunks: [NativeUploadPartDTO]
    let result: NativeUploadNodeDTO?
}

private struct NativeUploadPartDTO: Decodable {
    let index: Int
    let size: Int64
    let sha256: String
}

private struct NativeUploadNodeDTO: Decodable {
    let id: UInt64
    let name: String
    let type: String
    let revision: UInt64
}

private struct NativeUploadStartDTO: Encodable {
    let parent_id: UInt64
    let name: String
    let size: Int64
    let chunk_size: Int64
    let sha256: String
    let resume_key: String
    let conflict_policy = "fail"
}

/// Acknowledged session transitions must be durable BEFORE any upload write.
/// The native encrypted journal supplies all three callbacks. Failure stops
/// the transport; no retry or later checkpoint is silently attempted.
struct XDriveNativeUploadCheckpointHooks {
    let beforeCreate: () async throws -> Void
    let sessionAccepted: (String) async throws -> Void
    let beforeFinalize: () async throws -> Void
}

private final class NativePhotoDenyRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// One explicit local file -> existing xDrive Go UploadSession protocol.
/// No second uploader, PhotoAsset writer, mirrored deletion, silent retry, or
/// background claims. Files must already be exported into an app-owned local
/// staging URL; PhotoKit and Owner/Device authorization are separate layers.
final class XDriveNativeUploadSessionTransport {
    private static let chunkBytes = 8 * 1_048_576
    private let origin: URL
    private let accessToken: String
    private let session: URLSession

    init(origin: URL, accessToken: String) throws {
        let verifiedOrigin = try ServerAddress.parse(origin.absoluteString)
        guard !accessToken.isEmpty else { throw XDriveNativeUploadError.unauthorizedOrRejected(401) }
        self.origin = verifiedOrigin
        self.accessToken = accessToken
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 600
        session = URLSession(configuration: config, delegate: NativePhotoDenyRedirects(), delegateQueue: nil)
    }

    deinit { session.invalidateAndCancel() }

    /// "fail" means no overwrite and no rename. A lost create/finalize ACK is
    /// never interpreted as a failure-safe permission to create a new session.
    /// A production sync runner must first durably persist resume_key/Owner/
    /// resource identity before calling this method.
    func uploadOnce(from stagedFileURL: URL, name: String, parentID: UInt64) async throws
        -> XDriveNativeUploadReceipt {
        try await uploadInternally(from: stagedFileURL, name: name, parentID: parentID,
                                   resumeKey: "iosmanual_" + UUID().uuidString.lowercased(),
                                   expectedSize: nil, expectedSHA256: nil, hooks: nil)
    }

    /// This is the ledger-backed path, not a public retry API. Only accept an
    /// existing 256-bit HMAC resume key; the calling Owner runner MUST persist
    /// each journal transition using the supplied durable callbacks.
    func uploadPreparedOriginal(from stagedFileURL: URL, name: String, parentID: UInt64,
                                resumeKey: String, expectedSize: Int64,
                                expectedSHA256: String, hooks: XDriveNativeUploadCheckpointHooks)
        async throws -> XDriveNativeUploadReceipt {
        guard resumeKey.hasPrefix("ios_"), resumeKey.utf8.count == 68,
              resumeKey.dropFirst(4).utf8.allSatisfy({
                  ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102)
              }),
              expectedSize >= 0, expectedSHA256.utf8.count == 64,
              expectedSHA256.utf8.allSatisfy({
                  ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102)
              }) else {
            throw XDriveNativeUploadError.invalidLocalFile
        }
        return try await uploadInternally(from: stagedFileURL, name: name, parentID: parentID,
                                          resumeKey: resumeKey, expectedSize: expectedSize,
                                          expectedSHA256: expectedSHA256, hooks: hooks)
    }

    private func uploadInternally(from stagedFileURL: URL, name: String, parentID: UInt64,
                                  resumeKey: String, expectedSize: Int64?,
                                  expectedSHA256: String?, hooks: XDriveNativeUploadCheckpointHooks?)
        async throws -> XDriveNativeUploadReceipt {
        guard stagedFileURL.isFileURL, parentID > 0, validName(name) else {
            throw XDriveNativeUploadError.invalidLocalFile
        }
        let fileSize = try localSize(stagedFileURL)
        let hashes = try fileHashes(stagedFileURL, expectedSize: fileSize)
        // All bytes are checked BEFORE the journal is advanced to creating.
        // An outdated Photos export can never be submitted against a saved
        // resource identity, even if its filename is unchanged.
        if let expectedSize, expectedSize != fileSize {
            throw XDriveNativeUploadError.invalidLocalFile
        }
        if let expectedSHA256, expectedSHA256 != hashes.full {
            throw XDriveNativeUploadError.invalidLocalFile
        }
        let initData = try JSONEncoder().encode(NativeUploadStartDTO(
            parent_id: parentID, name: name, size: fileSize,
            chunk_size: Int64(Self.chunkBytes), sha256: hashes.full,
            resume_key: resumeKey
        ))

        try Task.checkCancellation()
        if let hooks { try await hooks.beforeCreate() }
        try Task.checkCancellation()
        // Never retry a POST that may have created an UploadSession. A durable
        // ledger is required before supporting cross-process replay by key.
        let created: NativeUploadSessionDTO
        do {
            created = try await send(
                NativeUploadSessionDTO.self, method: "POST", path: "/api/v1/uploads",
                body: initData, contentType: "application/json"
            )
        } catch {
            if Task.isCancelled { throw CancellationError() }
            throw XDriveNativeUploadError.uncertainCommit
        }

        try validate(created, parentID: parentID, name: name,
                     size: fileSize, fullHash: hashes.full, chunkHashes: hashes.parts)
        // The Server-issued UUID is recorded BEFORE any PUT or finalize.
        if let hooks { try await hooks.sessionAccepted(created.id) }
        try Task.checkCancellation()
        if created.status == "finalized" {
            // Instant CAS dedup may physically commit during POST /uploads.
            // Still record finalizing before accepting the trusted receipt.
            if let hooks { try await hooks.beforeFinalize() }
            return try verifiedReceipt(created, size: fileSize, hash: hashes.full, name: name)
        }
        guard created.status == "active" else {
            throw XDriveNativeUploadError.invalidServerResponse
        }

        let file = try FileHandle(forReadingFrom: stagedFileURL)
        defer { try? file.close() }
        let received = try receivedParts(created, hashes: hashes.parts, size: fileSize)

        for index in hashes.parts.indices {
            try Task.checkCancellation()
            if received.contains(index) { continue }
            let start = Int64(index) * Int64(Self.chunkBytes)
            let bytes = Int(min(Int64(Self.chunkBytes), fileSize - start))
            try file.seek(toOffset: UInt64(start))
            guard let part = try file.read(upToCount: bytes), part.count == bytes,
                  sha(part) == hashes.parts[index] else {
                throw XDriveNativeUploadError.invalidLocalFile
            }
            let path = "/api/v1/uploads/\(created.id)/chunks/\(index)"
            do {
                let acknowledged: NativeUploadPartDTO = try await send(
                    NativeUploadPartDTO.self, method: "PUT", path: path,
                    body: part, contentType: "application/octet-stream",
                    chunkSHA: hashes.parts[index]
                )
                guard acknowledged.index == index,
                      acknowledged.size == Int64(bytes),
                      acknowledged.sha256.lowercased() == hashes.parts[index]
                else { throw XDriveNativeUploadError.invalidServerResponse }
            } catch {
                if Task.isCancelled { throw CancellationError() }
                // Network failure may occur AFTER the Server persisted a
                // chunk. A read-only Owner status can confirm the exact part;
                // absent/unverifiable evidence is uncertain, not a retry cue.
                guard let status = try? await statusFor(created.id),
                      status.id == created.id, status.status == "active",
                      (try? receivedParts(status, hashes: hashes.parts, size: fileSize))?.contains(index) == true
                else { throw XDriveNativeUploadError.uncertainCommit }
            }
        }

        try Task.checkCancellation()
        guard (try? localSize(stagedFileURL)) == fileSize else {
            throw XDriveNativeUploadError.invalidLocalFile
        }
        // Persist the possibility of CAS physical commit before finalize POST.
        if let hooks { try await hooks.beforeFinalize() }
        try Task.checkCancellation()
        // Finalize's ACK might be lost after the CAS physical commit. A
        // failed/malformed response requires GET; no blind finalize replay.
        do {
            let finalized: NativeUploadSessionDTO = try await send(
                NativeUploadSessionDTO.self, method: "POST",
                path: "/api/v1/uploads/\(created.id)/finalize",
                body: Data("{}".utf8), contentType: "application/json"
            )
            guard finalized.id == created.id else {
                throw XDriveNativeUploadError.invalidServerResponse
            }
            return try verifiedReceipt(finalized, size: fileSize, hash: hashes.full, name: name)
        } catch {
            if Task.isCancelled { throw CancellationError() }
            guard let observed = try? await statusFor(created.id),
                  observed.id == created.id, observed.status == "finalized",
                  let receipt = try? verifiedReceipt(observed, size: fileSize,
                                                     hash: hashes.full, name: name)
            else { throw XDriveNativeUploadError.uncertainCommit }
            return receipt
        }
    }

    private func statusFor(_ id: String) async throws -> NativeUploadSessionDTO {
        try await send(NativeUploadSessionDTO.self, method: "GET", path: "/api/v1/uploads/\(id)")
    }

    private func validate(_ snapshot: NativeUploadSessionDTO, parentID: UInt64,
                          name: String, size: Int64, fullHash: String,
                          chunkHashes: [String]) throws {
        guard UUID(uuidString: snapshot.id) != nil,
              snapshot.parent_id == parentID, snapshot.name == name,
              snapshot.size == size, snapshot.chunk_size == Int64(Self.chunkBytes),
              snapshot.chunk_count == chunkHashes.count,
              snapshot.sha256?.lowercased() == fullHash,
              snapshot.status == "active" || snapshot.status == "finalized" else {
            throw XDriveNativeUploadError.invalidServerResponse
        }
        _ = try receivedParts(snapshot, hashes: chunkHashes, size: size)
    }

    private func receivedParts(_ snapshot: NativeUploadSessionDTO, hashes: [String],
                               size: Int64) throws -> Set<Int> {
        var seen = Set<Int>()
        for part in snapshot.received_chunks {
            guard hashes.indices.contains(part.index),
                  seen.insert(part.index).inserted,
                  part.sha256.lowercased() == hashes[part.index],
                  part.size == min(Int64(Self.chunkBytes),
                                   size - Int64(part.index) * Int64(Self.chunkBytes)) else {
                throw XDriveNativeUploadError.invalidServerResponse
            }
        }
        return seen
    }

    private func verifiedReceipt(_ snapshot: NativeUploadSessionDTO,
                                 size: Int64, hash: String, name: String) throws
        -> XDriveNativeUploadReceipt {
        guard UUID(uuidString: snapshot.id) != nil,
              snapshot.status == "finalized",
              snapshot.size == size, snapshot.sha256?.lowercased() == hash,
              let result = snapshot.result, result.id > 0,
              result.type == "file", result.name == name, result.revision > 0 else {
            throw XDriveNativeUploadError.invalidServerResponse
        }
        return XDriveNativeUploadReceipt(nodeID: result.id, nodeName: result.name,
                                         revision: result.revision, sha256: hash,
                                         bytes: size, sessionID: snapshot.id)
    }

    private func send<T: Decodable>(_ type: T.Type, method: String, path: String,
                                    body: Data? = nil, contentType: String? = nil,
                                    chunkSHA: String? = nil) async throws -> T {
        guard path.hasPrefix("/api/v1/uploads"),
              var components = URLComponents(url: origin, resolvingAgainstBaseURL: false) else {
            throw XDriveNativeUploadError.invalidServerResponse
        }
        components.path = path
        guard let url = components.url else { throw XDriveNativeUploadError.invalidServerResponse }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.timeoutInterval = method == "POST" && path.hasSuffix("/finalize") ? 600 : 60
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let contentType { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        if let chunkSHA { request.setValue(chunkSHA, forHTTPHeaderField: "X-Chunk-SHA256") }
        request.httpBody = body
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw XDriveNativeUploadError.invalidServerResponse
        }
        guard (200..<300).contains(http.statusCode), data.count <= 2_097_152 else {
            throw XDriveNativeUploadError.unauthorizedOrRejected(http.statusCode)
        }
        guard let decoded = try? JSONDecoder().decode(T.self, from: data) else {
            throw XDriveNativeUploadError.invalidServerResponse
        }
        return decoded
    }

    private func localSize(_ url: URL) throws -> Int64 {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard (attributes[.type] as? FileAttributeType) == .typeRegular,
              let size = attributes[.size] as? NSNumber,
              size.int64Value >= 0 else { throw XDriveNativeUploadError.invalidLocalFile }
        return size.int64Value
    }

    private func fileHashes(_ url: URL, expectedSize: Int64) throws
        -> (full: String, parts: [String]) {
        let file = try FileHandle(forReadingFrom: url)
        defer { try? file.close() }
        var hasher = SHA256()
        var count: Int64 = 0
        var parts: [String] = []
        while true {
            if Task.isCancelled { throw CancellationError() }
            guard let data = try file.read(upToCount: Self.chunkBytes), !data.isEmpty else { break }
            count += Int64(data.count)
            guard count <= expectedSize else { throw XDriveNativeUploadError.invalidLocalFile }
            hasher.update(data: data)
            parts.append(sha(data))
        }
        guard count == expectedSize else { throw XDriveNativeUploadError.invalidLocalFile }
        return (hex(hasher.finalize()), parts)
    }

    private func sha(_ data: Data) -> String { hex(SHA256.hash(data: data)) }

    private func hex<D: Sequence>(_ digest: D) -> String where D.Element == UInt8 {
        digest.map { String(format: "%02x", $0) }.joined()
    }

    private func validName(_ name: String) -> Bool {
        guard !name.isEmpty, name != ".", name != "..",
              !name.hasSuffix(" "), !name.hasSuffix("."),
              name.utf8.count <= 255,
              !name.unicodeScalars.contains(where: {
                  $0.value < 32 || "<>:\\\"/|?*".unicodeScalars.contains($0)
              }) else { return false }
        let stem = name.components(separatedBy: ".").first?.uppercased() ?? ""
        return !["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3",
                 "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
                 "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6",
                 "LPT7", "LPT8", "LPT9"].contains(stem)
    }
}

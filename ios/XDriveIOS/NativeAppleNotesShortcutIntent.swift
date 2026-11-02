import AppIntents
import CryptoKit
import Foundation

/// Shortcuts owns selection and authorization to each Apple Note. This action
/// receives only the two strings explicitly passed by that Shortcut; there is
/// deliberately no Apple Notes database access or invented Notes entitlement.
struct XDriveBackupAppleNoteIntent: AppIntent {
    static var title: LocalizedStringResource = "备份 Apple 备忘录到 xDrive"
    static var description = IntentDescription(
        "将快捷指令提供的一条备忘录纯文本备份到当前保存登录的 xDrive 云端根目录。"
    )
    static var openAppWhenRun = false

    @Parameter(title: "备忘录标题") var noteTitle: String
    @Parameter(title: "备忘录纯文本") var noteText: String

    static var parameterSummary: some ParameterSummary {
        Summary("备份 \(\.$noteTitle) 到 xDrive")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let uploaded = try await XDriveIOSAppleNotesShortcutRunner.backup(
            title: noteTitle, text: noteText
        )
        if uploaded { return .result(dialog: "xDrive 已验证并保存备忘录文本快照。") }
        return .result(dialog: "xDrive 已核对存在相同内容，无需重复上传。")
    }
}

enum XDriveIOSAppleNotesShortcutRunError: LocalizedError {
    case noSavedLogin
    case ownerChanged
    case anotherUploadActive
    case tooManySearchResults
    case existingNameMismatch
    case uncertainReceipt

    var errorDescription: String? {
        switch self {
        case .noSavedLogin:
            return "请先在 xDrive 原生 App 登录，并开启保持登录；解锁设备后重试。"
        case .ownerChanged:
            return "xDrive 当前服务器或账号与保存的身份不一致，未上传。"
        case .anotherUploadActive:
            return "xDrive 正在进行其他原件上传，请稍后重试。"
        case .tooManySearchResults:
            return "无法在限定范围内验证相同备份文件，未提交上传。"
        case .existingNameMismatch:
            return "已存在同名但无法验证完整内容的文件，未覆盖。"
        case .uncertainReceipt:
            return "上传结果未确认，请先在云端根目录核对；不要盲目重复提交。"
        }
    }
}

/// Foreground/unlocked-device best effort. Every Shortcuts invocation uses the
/// normal Owner-scoped native Keychain refresh, shared upload gate and existing
/// Server UploadSession/CAS writer; never a background Photo grant.
@MainActor
enum XDriveIOSAppleNotesShortcutRunner {
    static func backup(title: String, text: String) async throws -> Bool {
        guard !text.isEmpty else { throw XDriveIOSAppleNotesShortcutError.emptyText }
        guard text.utf8.count <= XDriveIOSAppleNotesShortcutPolicy.maximumTextBytes else {
            throw XDriveIOSAppleNotesShortcutError.textTooLarge
        }
        let data = Data(text.utf8)
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        let snapshot = try XDriveIOSAppleNotesShortcutPolicy.prepare(
            title: title, text: text, sha256: digest
        )
        guard let gate = XDriveIOSOriginalRunGate.shared.acquire() else {
            throw XDriveIOSAppleNotesShortcutRunError.anotherUploadActive
        }
        defer { XDriveIOSOriginalRunGate.shared.release(gate) }

        guard let saved = try XDriveIOSNativeOwnerSessionStore.load() else {
            throw XDriveIOSAppleNotesShortcutRunError.noSavedLogin
        }
        let origin = try ServerAddress.parse(saved.origin)
        let response = try await AuthService(origin: origin).refresh(token: saved.refreshToken)
        try Task.checkCancellation()
        guard response.must_change_password != true,
              response.username == saved.username,
              let accessToken = [response.access_token, response.token]
                .compactMap({ $0 }).first(where: { !$0.isEmpty }),
              !response.refresh_token.isEmpty else {
            throw XDriveIOSAppleNotesShortcutRunError.ownerChanged
        }
        let owner = try await XDriveNativeOwnerRootVerifier(
            origin: origin, accessToken: accessToken,
            expectedUsername: saved.username
        ).verify()
        try Task.checkCancellation()
        guard owner.origin.absoluteString == saved.origin,
              owner.instanceID == saved.serverInstanceID,
              owner.ownerID == saved.ownerID,
              owner.username == saved.username,
              owner.rootNodeID == saved.rootNodeID,
              try XDriveIOSNativeOwnerSessionStore.load() == saved else {
            throw XDriveIOSAppleNotesShortcutRunError.ownerChanged
        }
        // Persist the rotated refresh only after current Owner/root proof,
        // so the next scheduled Shortcut can authenticate without a password.
        try XDriveIOSNativeOwnerSessionStore.save(XDriveIOSNativeOwnerCredential(
            origin: saved.origin, username: saved.username,
            serverInstanceID: saved.serverInstanceID,
            ownerID: saved.ownerID, rootNodeID: saved.rootNodeID,
            refreshToken: response.refresh_token
        ))
        let reader = XDriveIOSNativeFilesReader(owner: owner, accessToken: accessToken)
        let readback = XDriveIOSNativeFilesUploadReadback(
            owner: owner, accessToken: accessToken
        )
        if try await exists(snapshot, reader: reader, readback: readback,
                            parentID: owner.rootNodeID) { return false }
        try Task.checkCancellation()

        // The staged text is at most 1 MiB and has a private, short-lived URL.
        // A dropped response is NOT safe to retry with another new filename.
        let temporaryDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(
            "xdrive-ios-apple-notes-" + UUID().uuidString, isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: temporaryDirectory, withIntermediateDirectories: false,
            attributes: [.posixPermissions: NSNumber(value: 0o700),
                         .protectionKey: FileProtectionType.complete]
        )
        defer { try? FileManager.default.removeItem(at: temporaryDirectory) }
        let localFile = temporaryDirectory.appendingPathComponent("note.txt")
        try snapshot.data.write(to: localFile, options: .atomic)
        try FileManager.default.setAttributes(
            [.posixPermissions: NSNumber(value: 0o600),
             .protectionKey: FileProtectionType.complete], ofItemAtPath: localFile.path
        )
        try Task.checkCancellation()
        // Do not start the session if the saved account was switched mid-Shortcuts.
        guard let newest = try XDriveIOSNativeOwnerSessionStore.load(),
              newest.origin == saved.origin,
              newest.serverInstanceID == saved.serverInstanceID,
              newest.ownerID == saved.ownerID,
              newest.username == saved.username,
              newest.rootNodeID == saved.rootNodeID,
              newest.refreshToken == response.refresh_token else {
            throw XDriveIOSAppleNotesShortcutRunError.ownerChanged
        }
        let verified = try await XDriveNativeOwnerRootVerifier(
            origin: origin, accessToken: accessToken,
            expectedUsername: saved.username
        ).verify()
        guard verified.origin == owner.origin,
              verified.instanceID == owner.instanceID,
              verified.ownerID == owner.ownerID,
              verified.rootNodeID == owner.rootNodeID else {
            throw XDriveIOSAppleNotesShortcutRunError.ownerChanged
        }
        try Task.checkCancellation()
        let writer = try XDriveNativeUploadSessionTransport(
            origin: origin, accessToken: accessToken
        )
        let receipt: XDriveNativeUploadReceipt
        do {
            receipt = try await writer.uploadOnce(
                from: localFile, name: snapshot.filename, parentID: owner.rootNodeID
            )
        } catch XDriveNativeUploadError.uncertainCommit {
            // POST create may have committed despite an ACK being lost.
            // Read-only full-SHA reconciliation is safe; never issue a second POST.
            if (try? await exists(snapshot, reader: reader, readback: readback,
                                  parentID: owner.rootNodeID)) == true { return false }
            throw XDriveIOSAppleNotesShortcutRunError.uncertainReceipt
        }
        try await XDriveIOSNodeReceiptReadbackVerifier(
            owner: owner, accessToken: accessToken
        ).verify(receipt, parentID: owner.rootNodeID,
                 expectedName: snapshot.filename)
        guard receipt.sha256 == snapshot.sha256,
              receipt.bytes == Int64(snapshot.data.count) else {
            throw XDriveIOSAppleNotesShortcutRunError.uncertainReceipt
        }
        return true
    }

    /// Search only bounded current Owner results, then GET the exact Node and
    /// verify its full SHA-256. A name-only or incomplete result never counts.
    private static func exists(
        _ expected: XDriveIOSAppleNoteSnapshot,
        reader: XDriveIOSNativeFilesReader,
        readback: XDriveIOSNativeFilesUploadReadback,
        parentID: UInt64
    ) async throws -> Bool {
        let maxResults = 256
        for offset in stride(from: 0, to: maxResults, by: XDriveIOSNativeFilesPagePolicy.pageSize) {
            let page = try await reader.search(
                expected.filename, offset: offset, sort: "name", order: "asc"
            )
            for hit in page.items where hit.node.name == expected.filename &&
                hit.node.parent_id == parentID {
                let detail = try await readback.getNode(hit.node.id)
                guard detail.id == hit.node.id,
                      XDriveIOSAppleNotesShortcutPolicy.matchesExisting(
                        filename: detail.name, expected: expected,
                        parentID: detail.parent_id, expectedParentID: parentID,
                        type: detail.type, bytes: detail.size,
                        sha256: detail.sha256
                      ) else { throw XDriveIOSAppleNotesShortcutRunError.existingNameMismatch }
                return true
            }
            if offset + page.items.count >= page.total_count { return false }
        }
        throw XDriveIOSAppleNotesShortcutRunError.tooManySearchResults
    }
}

extension XDriveIOSAppleNotesShortcutError: LocalizedError {
    var errorDescription: String? {
        switch self {
        case .emptyText: return "备忘录文本为空；请在快捷指令中传入正文。"
        case .textTooLarge: return "单条备忘录纯文本超过 1 MiB；本次未上传。"
        case .invalidSHA256: return "备忘录内容指纹格式无效；本次未上传。"
        }
    }
}

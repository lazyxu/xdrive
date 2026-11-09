import CryptoKit
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// The Clipboard tool is a fully native SwiftUI L2 dynamic page. It never
/// polls the iOS system pasteboard, persists its E2EE key or launches WebKit.
struct XDriveIOSNativeClipboardScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    // Ownership of Viewer navigation stays in the app's verified root, not
    // in the Clipboard child, so Lock/Owner changes invalidate its effects.
    let onOpenReferencedFile: (XDriveNativeOwnerRoot, XDriveIOSNativeFilesNode) -> Void
    @Environment(\.scenePhase) private var scenePhase
    @State private var passphrase = ""
    @State private var key: SymmetricKey?
    @State private var aadScope = ""
    @State private var ownerAtUnlock: XDriveNativeOwnerRoot?
    @State private var recipientPrivateKey: Curve25519.KeyAgreement.PrivateKey?
    @State private var recipientProof: XDriveIOSBackgroundDeviceProof?
    @State private var targetDevices: [XDriveIOSClipboardTargetDevice] = []
    @State private var targetID = ""
    @State private var referenceKind = "text"
    @State private var referenceNodeID = ""
    @State private var localFilePicker = false
    @State private var uploadTask: Task<Void, Never>?
    @State private var pickerGeneration: UInt64?
    @State private var pickerTargetID = ""
    @State private var pickerKind = ""
    @State private var pendingDirected: PendingDirected?
    @State private var draft = ""
    @State private var items: [Decrypted] = []
    @State private var loading = false
    @State private var busy = false
    @State private var message: String?
    @State private var confirmClear = false
    @State private var pending: Pending?
    @State private var retryNeedsAbandon = false
    // A manual Lock, Owner change or screen exit invalidates every async task,
    // including an in-flight unlock for the same Owner.
    @State private var sessionGeneration: UInt64 = 0

    private struct Decrypted: Identifiable {
        let source: XDriveIOSClipboardItem
        let text: String?
        var id: UInt64 { source.id }
    }
    private struct Pending {
        let sourceText: String
        let createdAt: Date
        let wire: XDriveIOSClipboardCrypto.Encrypted
    }
    private struct PendingDirected {
        let sourceText: String
        let targetID: String
        let kind: String
        let nodeID: UInt64
        let createdAt: Date
        let wire: XDriveIOSClipboardDirectedWrite
    }
    private var unlocked: Bool { key != nil }
    private var currentScope: String { aadScope }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("当前账号的端到端加密收件箱；图片与文件以 CAS Node 引用传递。仅在你点击后读取或写入本机剪贴板。")
                    .font(.footnote).foregroundStyle(.secondary)
                if let message {
                    Text(message).font(.footnote).foregroundStyle(.orange)
                        .accessibilityIdentifier("ios-clipboard-status")
                }
                if !unlocked {
                    SecureField("独立剪贴板口令（至少 12 个字符）", text: $passphrase)
                        .textContentType(.newPassword)
                        .textFieldStyle(.roundedBorder)
                    Button("解锁") { Task { await unlock() } }
                        .buttonStyle(.borderedProminent)
                        .disabled(busy || passphrase.count < 12)
                } else {
                    HStack {
                        Text("加密发送").font(.headline)
                        Spacer()
                        Button("锁定") { lock() }
                    }
                    TextEditor(text: $draft)
                        .frame(minHeight: 95, maxHeight: 150)
                        .overlay(RoundedRectangle(cornerRadius: 8)
                            .stroke(.gray.opacity(0.25)))
                        .accessibilityIdentifier("ios-clipboard-draft")
                        .onChange(of: draft) { _ in retryNeedsAbandon = false }
                    HStack {
                        Button("发送") { Task { await send() } }
                            .buttonStyle(.borderedProminent)
                            .disabled(busy || draft.isEmpty || !targetID.isEmpty)
                        Button("从本机粘贴") {
                            // Explicit user gesture. No background UIPasteboard reads.
                            if let text = UIPasteboard.general.string { draft = text }
                            else { message = "本机剪贴板没有可读取的文本。" }
                        }.disabled(busy)
                        Spacer()
                    }
                    Picker("发送范围", selection: $targetID) {
                        Text("当前 Owner 广播（v1 文本）").tag("")
                        ForEach(targetDevices) { device in
                            Text(device.name + " · " + device.platform).tag(device.device_id)
                        }
                    }
                    .pickerStyle(.menu)
                    .disabled(busy)
                    if !targetID.isEmpty {
                        Picker("定向消息内容", selection: $referenceKind) {
                            Text("文本或链接").tag("text")
                            Text("现有云端图片引用").tag("image")
                            Text("现有云端文件引用").tag("file")
                        }
                        .pickerStyle(.segmented)
                        .disabled(busy)
                        if referenceKind != "text" {
                            TextField("已经完成上传的 CAS Node ID", text: $referenceNodeID)
                                .keyboardType(.numberPad)
                                .textFieldStyle(.roundedBorder)
                                .disabled(busy)
                            Button("选择本机文件并上传 CAS") {
                                guard !busy, pending == nil, pendingDirected == nil else { return }
                                pickerGeneration = sessionGeneration
                                pickerTargetID = targetID
                                pickerKind = referenceKind
                                localFilePicker = true
                            }
                            .disabled(busy || pending != nil || pendingDirected != nil)
                            Text("上传只创建当前 Owner 文件，不会自动发送。确认 Node ID 后再次点击定向加密发送。")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Button("定向加密发送") { Task { await sendDirected() } }
                            .buttonStyle(.borderedProminent)
                            .disabled(busy || !targetDevices.contains(where: { $0.device_id == targetID }))
                    }
                    if recipientProof == nil {
                        Button("启用本机设备定向加密接收") {
                            Task { await enableDeviceReceipt() }
                        }.disabled(busy)
                        Text("需先在此账号注册本机设备。单独授权 Clipboard，不启用相册备份。")
                            .font(.caption).foregroundStyle(.secondary)
                    } else {
                        Label("设备定向接收已启用", systemImage: "checkmark.shield")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    if retryNeedsAbandon && (pending != nil || pendingDirected != nil) {
                        Button("放弃待确认回执") {
                            pending = nil
                            pendingDirected = nil
                            retryNeedsAbandon = false
                            message = "已放弃旧回执。请先核对历史，再发送新内容。"
                        }.foregroundStyle(.orange)
                    }
                    HStack {
                        Text("最近内容").font(.headline)
                        Spacer()
                        Button("刷新") { Task { await refresh() } }.disabled(busy || loading)
                        Button("清空") { confirmClear = true }
                            .disabled(busy || items.isEmpty).foregroundStyle(.red)
                    }
                    if loading { ProgressView() }
                    if items.isEmpty && !loading {
                        Text("暂无有效消息。").font(.footnote).foregroundStyle(.secondary)
                    }
                    ForEach(items) { entry in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text(entry.source.kind == "text/uri-list" ? "链接" :
                                    entry.source.node_id != nil ? "云端文件引用" : "文本")
                                    .font(.caption).foregroundStyle(.secondary)
                                Spacer()
                                Button("删除") { Task { await delete(entry.source.id) } }
                                    .disabled(busy).font(.caption).foregroundStyle(.red)
                            }
                            if let text = entry.text {
                                if let nodeID = entry.source.node_id, nodeID > 0,
                                   entry.source.kind == "image/x-xdrive-node-ref" ||
                                   entry.source.kind == "application/x-xdrive-node-ref" {
                                    Text("已收到加密的云端文件引用 #\(nodeID)。原件仍保存在 Files/CAS。")
                                        .font(.footnote)
                                    Button("在文件查看器中打开") {
                                        Task { await openReferencedFile(entry) }
                                    }
                                    .disabled(busy || loading || text != "asset:\(nodeID)")
                                } else {
                                    Text(text).textSelection(.enabled)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .lineLimit(8)
                                    Button("复制到本机") {
                                        // Explicit tap only; OS clipboard cannot be revoked.
                                        UIPasteboard.general.string = text
                                        message = "已复制到本机剪贴板。"
                                    }
                                }
                            } else {
                                Text("该条消息无法解密。")
                                    .foregroundStyle(.red)
                            }
                        }
                        .padding(12)
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
                    }
                    Text("最多保存 50 条有效消息，24 小时后不可见。不会自动监听系统剪贴板。")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(16)
        }
        .navigationTitle("剪贴板")
        .fileImporter(isPresented: $localFilePicker,
                      allowedContentTypes: [.item], allowsMultipleSelection: false) { outcome in
            let generation = pickerGeneration
            pickerGeneration = nil
            guard let generation, generation == sessionGeneration,
                  targetID == pickerTargetID, referenceKind == pickerKind,
                  !targetID.isEmpty else { return }
            switch outcome {
            case .success(let urls):
                guard let chosen = urls.first else { return }
                uploadTask = Task { await importLocalFile(chosen, generation: generation) }
            case .failure:
                message = "本机文件选择没有完成，尚未上传。"
            }
        }
        .alert("确认清空剪贴板历史？", isPresented: $confirmClear) {
            Button("取消", role: .cancel) {}
            Button("清空", role: .destructive) { Task { await clear() } }
        } message: {
            Text("只删除当前 Owner 的 Server 密文历史，不能撤销。")
        }
        // The polling task and SSE stream are both strictly foreground.
        // Returning to an active scene triggers an immediate current-Owner GET.
        .task(id: unlocked && scenePhase == .active) {
            guard unlocked, scenePhase == .active else { return }
            await refresh()
            while !Task.isCancelled && scenePhase == .active {
                do { try await Task.sleep(nanoseconds: 15_000_000_000) }
                catch { break }
                guard !Task.isCancelled, scenePhase == .active else { break }
                await refresh()
            }
        }
        // Include device enrollment in the subscription identity. Before
        // enrollment this stream has broadcast-only scope; after opt-in it
        // must close and reopen with a freshly verified device proof.
        .task(id: "\(unlocked && scenePhase == .active):\(recipientProof?.deviceID ?? "")") {
            guard unlocked, scenePhase == .active else { return }
            let generation = sessionGeneration
            var after: UInt64 = 0 // Never persist or reuse across Owners.
            while !Task.isCancelled && scenePhase == .active &&
                  sessionGeneration == generation && key != nil {
                do {
                    let client = try await authorizedClient(for: generation)
                    after = try await client.watchChanges(after: after) {
                        guard !Task.isCancelled, scenePhase == .active,
                              sessionGeneration == generation,
                              ownerAtUnlock == client.owner, key != nil else { return }
                        await refresh() // Stream contains only invalidations.
                    }
                } catch {
                    if Task.isCancelled || scenePhase != .active ||
                        sessionGeneration != generation { break }
                    // Older Server/no SSE: 15-second foreground GET remains.
                }
                guard !Task.isCancelled, scenePhase == .active,
                      sessionGeneration == generation, key != nil else { break }
                await refresh() // Full GET after disconnect/cursor eviction.
                do { try await Task.sleep(nanoseconds: 3_000_000_000) }
                catch { break }
            }
        }
        .onChange(of: targetID) { _ in
            // A previous CAS Node must never follow a new recipient intent.
            referenceKind = "text"
            referenceNodeID = ""
        }
        .onChange(of: recipientProof?.deviceID) { _ in
            // The 15-second GET fallback never waits for the next tick after
            // a new Owner-scoped device capability is enrolled or revoked.
            Task { await refresh() }
        }
        .onChange(of: login.owner) { _ in lock() }
        .onDisappear { lock() }
    }

    @MainActor
    private func authorizedClient(for generation: UInt64) async throws -> XDriveIOSNativeClipboardClient {
        let proof = try await login.verifiedAuthorization()
        guard sessionGeneration == generation, login.owner == proof.owner else {
            throw XDriveIOSClipboardCrypto.Failure.invalidOwner
        }
        if let lockedOwner = ownerAtUnlock, proof.owner != lockedOwner {
            lock()
            throw XDriveIOSClipboardCrypto.Failure.invalidOwner
        }
        return try XDriveIOSNativeClipboardClient(owner: proof.owner,
            accessToken: proof.accessToken, deviceProof: recipientProof)
    }

    @MainActor
    private func unlock() async {
        if busy || key != nil { return }
        let generation = sessionGeneration
        busy = true
        message = nil
        defer { if sessionGeneration == generation { busy = false } }
        do {
            let client = try await authorizedClient(for: generation)
            let vault = try await client.vault()
            guard sessionGeneration == generation else { return }
            let derived = try XDriveIOSClipboardCrypto.key(passphrase, salt: vault.salt)
            var scope = vault.aad_scope
            if vault.check_ciphertext.isEmpty {
                scope = client.newVaultScope
                let canary = try XDriveIOSClipboardCrypto.check(key: derived, scope: scope)
                let pinned = try await client.check(canary, scope: scope)
                guard sessionGeneration == generation else { return }
                scope = pinned.aad_scope
                try XDriveIOSClipboardCrypto.verify(key: derived, scope: scope,
                    nonce: pinned.check_nonce, ciphertext: pinned.check_ciphertext)
            } else {
                guard !scope.isEmpty else {
                    message = "旧版加密历史须先在首次浏览器的原地址解锁，完成密钥范围绑定。"
                    return
                }
                try XDriveIOSClipboardCrypto.verify(key: derived, scope: scope,
                    nonce: vault.check_nonce, ciphertext: vault.check_ciphertext)
            }
            guard sessionGeneration == generation, login.owner == client.owner else {
                throw XDriveIOSClipboardCrypto.Failure.invalidOwner
            }
            ownerAtUnlock = client.owner
            aadScope = scope
            key = derived
            passphrase = ""
            await refresh()
            await refreshTargets(generation: generation)
        } catch {
            if sessionGeneration == generation { message = error.localizedDescription }
        }
    }

    @MainActor
    private func enableDeviceReceipt() async {
        guard !busy, key != nil else { return }
        let generation = sessionGeneration
        busy = true
        defer { if sessionGeneration == generation { busy = false } }
        do {
            let current = try await authorizedClient(for: generation)
            guard let proof = try await XDriveIOSDeviceEnrollment.shared.clipboardDeviceProof(
                owner: current.owner, accessToken: current.token) else {
                message = "请先在当前账号注册并核验此 iPhone 的设备身份。"
                return
            }
            let privateKey = try XDriveIOSClipboardDeviceCrypto.privateKey(owner: current.owner)
            let deviceClient = try XDriveIOSNativeClipboardClient(
                owner: current.owner, accessToken: current.token, deviceProof: proof)
            try await deviceClient.enrollClipboardDevice(
                publicKey: privateKey.publicKey.rawRepresentation.base64EncodedString())
            guard sessionGeneration == generation, ownerAtUnlock == current.owner,
                  key != nil else { return }
            recipientPrivateKey = privateKey
            recipientProof = proof
            message = "此 iPhone 已获 Clipboard 设备定向接收授权。"
            await refresh()
        } catch {
            if sessionGeneration == generation { message = error.localizedDescription }
        }
    }

    @MainActor
    private func refresh() async {
        guard let localKey = key, !currentScope.isEmpty, !loading else { return }
        let generation = sessionGeneration
        let scope = currentScope
        loading = true
        defer { if sessionGeneration == generation { loading = false } }
        do {
            let client = try await authorizedClient(for: generation)
            let result = try await client.list()
            let deviceKey = recipientPrivateKey
            let deviceID = recipientProof?.deviceID
            let decoded = result.items.map { item in
                if let target = item.target_device_id, !target.isEmpty {
                    let clear: String?
                    if let deviceKey, let deviceID, target == deviceID {
                        clear = try? XDriveIOSClipboardDeviceCrypto.decrypt(
                            item, ownerScope: scope, deviceID: deviceID, privateKey: deviceKey)
                    } else {
                        clear = nil
                    }
                    return Decrypted(source: item, text: clear)
                }
                return Decrypted(source: item, text: try? XDriveIOSClipboardCrypto.decrypt(
                    item.encrypted, key: localKey, scope: scope))
            }
            try Task.checkCancellation()
            guard sessionGeneration == generation, ownerAtUnlock == client.owner,
                  key != nil else { return }
            items = decoded
        } catch {
            if sessionGeneration == generation { message = error.localizedDescription }
        }
    }

    /// Only the explicit, unlocked current Owner may open a reference.
    /// The Files reader performs a new bearer-authenticated Node lookup and
    /// the app root presents the original read-only Files Viewer.
    @MainActor
    private func openReferencedFile(_ entry: Decrypted) async {
        guard !busy, key != nil,
              let nodeID = entry.source.node_id, nodeID > 0,
              (entry.source.kind == "image/x-xdrive-node-ref" ||
               entry.source.kind == "application/x-xdrive-node-ref"),
              entry.text == "asset:\(nodeID)" else {
            message = "加密文件引用与消息身份不一致。"
            return
        }
        let generation = sessionGeneration
        busy = true
        defer { if sessionGeneration == generation { busy = false } }
        do {
            let client = try await authorizedClient(for: generation)
            let reader = XDriveIOSNativeFilesReader(owner: client.owner,
                                                    accessToken: client.token)
            let node = try await reader.referencedFile(nodeID: nodeID)
            try Task.checkCancellation()
            guard sessionGeneration == generation, key != nil,
                  ownerAtUnlock == client.owner,
                  XDriveIOSNativePhotoOwnerScope.matches(login.owner, client.owner)
            else { return }
            onOpenReferencedFile(client.owner, node)
        } catch {
            if sessionGeneration == generation {
                message = "无法打开云端文件：\(error.localizedDescription)"
            }
        }
    }

    @MainActor
    private func refreshTargets(generation: UInt64) async {
        guard key != nil, generation == sessionGeneration else { return }
        do {
            let client = try await authorizedClient(for: generation)
            let directory = try await client.devices()
            guard sessionGeneration == generation, key != nil,
                  ownerAtUnlock == client.owner else { return }
            targetDevices = directory
            if !targetID.isEmpty && !directory.contains(where: { $0.device_id == targetID }) {
                targetID = ""
                referenceNodeID = ""
            }
        } catch {
            if sessionGeneration == generation {
                targetDevices = [] // A stale recipient cannot remain selectable.
            }
        }
    }

    @MainActor
    private func importLocalFile(_ selectedURL: URL, generation: UInt64) async {
        guard generation == sessionGeneration, !busy, key != nil,
              !targetID.isEmpty, referenceKind != "text",
              pending == nil, pendingDirected == nil else { return }
        let expectedTarget = targetID
        let expectedKind = referenceKind
        referenceNodeID = ""
        busy = true
        defer {
            if sessionGeneration == generation {
                busy = false
                uploadTask = nil
            }
        }
        do {
            guard let gate = XDriveIOSOriginalRunGate.shared.acquire() else {
                throw XDriveIOSClipboardCrypto.Failure.invalidOwner
            }
            defer { XDriveIOSOriginalRunGate.shared.release(gate) }
            let client = try await authorizedClient(for: generation)
            let staged = try await XDriveManualDocumentStager.stage(selectedURL)
            defer { staged.delete() }
            guard staged.byteCount > 0 && staged.byteCount <= 64 * 1_048_576,
                  generation == sessionGeneration, ownerAtUnlock == client.owner,
                  referenceKind == expectedKind, targetID == expectedTarget else {
                throw XDriveIOSClipboardCrypto.Failure.invalidOwner
            }
            try Task.checkCancellation()
            // This is exactly the existing Owner Files UploadSession writer.
            // A lost finalize ACK is unknown; never retry automatically or
            // turn it into a confirmed clipboard reference.
            let writer = try XDriveNativeUploadSessionTransport(
                origin: client.owner.origin, accessToken: client.token)
            let receipt = try await writer.uploadOnce(
                from: staged.fileURL, name: staged.originalName,
                parentID: client.owner.rootNodeID)
            let after = try await authorizedClient(for: generation)
            let verifier = XDriveIOSNativeFilesUploadReadback(
                owner: after.owner, accessToken: after.token)
            try await verifier.requireCommitted(
                receipt, parentID: after.owner.rootNodeID,
                name: staged.originalName, byteCount: staged.byteCount)
            try Task.checkCancellation()
            guard generation == sessionGeneration, key != nil,
                  ownerAtUnlock == after.owner, targetID == expectedTarget,
                  referenceKind == expectedKind else { return }
            referenceNodeID = String(receipt.nodeID)
            message = "原件已上传到当前 Owner 的 CAS。请检查 Node 后，再明确点击“定向加密发送”。"
        } catch {
            if generation == sessionGeneration {
                referenceNodeID = ""
                message = "本机文件上传未确认：请先检查 Files 目录，勿自动重传。"
            }
        }
    }

    @MainActor
    private func sendDirected() async {
        guard !busy, key != nil, !aadScope.isEmpty,
              let device = targetDevices.first(where: { $0.device_id == targetID })
        else { return }
        let generation = sessionGeneration
        let selected = targetID
        let nodeID = referenceKind == "text" ? 0 : (UInt64(referenceNodeID) ?? 0)
        let kind: String
        switch referenceKind {
        case "image": kind = "image/x-xdrive-node-ref"
        case "file": kind = "application/x-xdrive-node-ref"
        default: kind = XDriveIOSClipboardCrypto.kind(draft)
        }
        guard (referenceKind == "text" && !draft.isEmpty) ||
              (referenceKind != "text" && nodeID > 0) else {
            message = "请选择有效文本或已确认的 CAS 文件 Node。"
            return
        }
        guard pending == nil else {
            retryNeedsAbandon = true
            message = "旧广播消息的回执未确认，请先核对历史并处理。"
            return
        }
        let payload = nodeID > 0 ? "asset:\(nodeID)" : draft
        let scope = aadScope
        busy = true
        defer { if sessionGeneration == generation { busy = false } }
        do {
            let wire: XDriveIOSClipboardDirectedWrite
            if let prior = pendingDirected {
                let elapsed = Date().timeIntervalSince(prior.createdAt)
                guard elapsed >= 0, elapsed < 300,
                      prior.sourceText == payload, prior.targetID == selected,
                      prior.kind == kind, prior.nodeID == nodeID else {
                    retryNeedsAbandon = true
                    message = "待确认的定向回执不能更换设备、MIME 或 Node；请先核对历史或明确放弃。"
                    return
                }
                wire = prior.wire
            } else {
                wire = try XDriveIOSClipboardDeviceCrypto.encryptForDevice(
                    payload, ownerScope: scope, deviceID: selected,
                    publicKey: device.public_key, kind: kind, nodeID: nodeID)
                pendingDirected = PendingDirected(sourceText: payload, targetID: selected,
                    kind: kind, nodeID: nodeID, createdAt: Date(), wire: wire)
            }
            let client = try await authorizedClient(for: generation)
            guard generation == sessionGeneration, ownerAtUnlock == client.owner,
                  key != nil else { return }
            _ = try await client.sendDirected(wire)
            guard generation == sessionGeneration, ownerAtUnlock == client.owner,
                  key != nil else { return }
            pendingDirected = nil
            if nodeID == 0 && draft == payload { draft = "" }
            message = "已加密发送至指定设备。"
            await refresh()
        } catch {
            if generation == sessionGeneration {
                message = "定向发送回执未知：请检查历史，不要自动重新加密投递。"
            }
        }
    }

    @MainActor
    private func send() async {
        guard !busy, let localKey = key, !aadScope.isEmpty, targetID.isEmpty,
              pendingDirected == nil else { return }
        let generation = sessionGeneration
        let textAtStart = draft
        busy = true
        defer { if sessionGeneration == generation { busy = false } }
        do {
            let candidate: XDriveIOSClipboardCrypto.Encrypted
            if let previous = pending {
                guard previous.sourceText == textAtStart else {
                    retryNeedsAbandon = true
                    message = "上一条消息的 Server 回执未知。请先核对历史或明确放弃回执。"
                    return
                }
                let age = Date().timeIntervalSince(previous.createdAt)
                guard age >= 0 && age < 300 else {
                    retryNeedsAbandon = true
                    message = "旧回执超过 5 分钟安全重试期，请先核对历史。"
                    return
                }
                candidate = previous.wire
            } else {
                candidate = try XDriveIOSClipboardCrypto.encrypt(
                    textAtStart, key: localKey, scope: aadScope)
                pending = Pending(sourceText: textAtStart, createdAt: Date(), wire: candidate)
            }
            let client = try await authorizedClient(for: generation)
            guard sessionGeneration == generation else { return }
            _ = try await client.send(candidate)
            guard sessionGeneration == generation, ownerAtUnlock == client.owner,
                  key != nil else { return }
            pending = nil
            if draft == textAtStart { draft = "" } // Do not erase a newer edit.
            message = "已加密发送到当前账号。"
            await refresh()
        } catch {
            if sessionGeneration == generation {
                message = "发送回执未知；保留相同事件 ID。\(error.localizedDescription)"
            }
        }
    }

    @MainActor
    private func delete(_ id: UInt64) async {
        guard !busy, key != nil else { return }
        let generation = sessionGeneration
        busy = true
        defer { if sessionGeneration == generation { busy = false } }
        do {
            let client = try await authorizedClient(for: generation)
            guard sessionGeneration == generation else { return }
            try await client.delete(id)
            guard sessionGeneration == generation, ownerAtUnlock == client.owner,
                  key != nil else { return }
            message = "已删除消息。"
            items.removeAll { $0.id == id }
        } catch {
            if sessionGeneration == generation { message = error.localizedDescription }
        }
    }

    @MainActor
    private func clear() async {
        guard !busy, key != nil else { return }
        let generation = sessionGeneration
        busy = true
        defer { if sessionGeneration == generation { busy = false } }
        do {
            let client = try await authorizedClient(for: generation)
            guard sessionGeneration == generation else { return }
            try await client.clear()
            guard sessionGeneration == generation, ownerAtUnlock == client.owner,
                  key != nil else { return }
            items = []
            message = "已清空本账号历史。"
        } catch {
            if sessionGeneration == generation { message = error.localizedDescription }
        }
    }

    @MainActor
    private func lock() {
        sessionGeneration &+= 1
        key = nil
        aadScope = ""
        passphrase = ""
        draft = ""
        items = []
        pending = nil
        retryNeedsAbandon = false
        ownerAtUnlock = nil
        recipientPrivateKey = nil
        recipientProof = nil
        targetDevices = []
        targetID = ""
        referenceKind = "text"
        referenceNodeID = ""
        localFilePicker = false
        uploadTask?.cancel()
        uploadTask = nil
        pickerGeneration = nil
        pickerTargetID = ""
        pickerKind = ""
        pendingDirected = nil
        loading = false
        busy = false
        confirmClear = false
        message = nil
    }
}

import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Native, authenticated Owner Clipboard. Content is plaintext on the Server.
/// No independent password, cryptographic key or background pasteboard access.
struct XDriveIOSNativeClipboardScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let onOpenReferencedFile: (XDriveNativeOwnerRoot, XDriveIOSNativeFilesNode) -> Void
    @Environment(\.scenePhase) private var scenePhase

    @State private var ownerAtOpen: XDriveNativeOwnerRoot?
    @State private var recipientProof: XDriveIOSBackgroundDeviceProof?
    @State private var targetDevices: [XDriveIOSClipboardTargetDevice] = []
    @State private var targetID = ""
    @State private var referenceKind = "text"
    @State private var referenceNodeID = ""
    @State private var draft = ""
    @State private var items: [XDriveIOSClipboardItem] = []
    @State private var loading = false
    @State private var busy = false
    @State private var message: String?
    @State private var confirmClear = false
    @State private var sessionGeneration: UInt64 = 0
    @State private var pending: Pending?
    @State private var retryNeedsAbandon = false
    @State private var filePickerOpen = false
    @State private var uploadTask: Task<Void, Never>?
    @State private var pickerGeneration: UInt64?
    @State private var pickerTargetID = ""
    @State private var pickerKind = ""
    @State private var cloudPickerOpen = false
    @State private var cloudPickerTargetID = ""
    @State private var cloudPickerKind = ""
    @State private var cloudPickerGeneration: UInt64?
    @State private var revokeCandidate: String?
    @State private var confirmRevoke = false


    private struct Pending {
        let sourceText: String
        let targetID: String
        let kind: String
        let nodeID: UInt64
        let createdAt: Date
        let wire: XDriveIOSClipboardWrite
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("此剪贴板不加密；Server 将明文保存最多 24 小时。请勿发送密码或验证码。只有明确点击后才会读取或写入本机剪贴板。")
                    .font(.footnote).foregroundStyle(.secondary)
                if let message {
                    Text(message).font(.footnote).foregroundStyle(.orange)
                        .accessibilityIdentifier("ios-clipboard-status")
                }
                Text("发送文字或链接").font(.headline)
                TextEditor(text: $draft)
                    .frame(minHeight: 95, maxHeight: 150)
                    .overlay(RoundedRectangle(cornerRadius: 8)
                        .stroke(.gray.opacity(0.25)))
                    .accessibilityIdentifier("ios-clipboard-draft")
                HStack {
                    Button("发送") { Task { await send(directed: false) } }
                        .buttonStyle(.borderedProminent)
                        .disabled(busy || draft.isEmpty || !targetID.isEmpty)
                    Button("从本机粘贴") {
                        if let text = UIPasteboard.general.string { draft = text }
                        else { message = "本机剪贴板没有可读取的文本。" }
                    }.disabled(busy)
                }
                Picker("发送范围", selection: $targetID) {
                    Text("当前 Owner 广播").tag("")
                    ForEach(targetDevices) { device in
                        Text(device.name + " · " + device.platform).tag(device.device_id)
                    }
                }
                .pickerStyle(.menu)
                .disabled(busy)
                .onChange(of: targetID) { _ in
                    referenceKind = "text"
                    referenceNodeID = ""
                    cloudPickerOpen = false
                }
                if !targetID.isEmpty {
                    Picker("定向消息内容", selection: $referenceKind) {
                        Text("文本或链接").tag("text")
                        Text("现有云端图片引用").tag("image")
                        Text("现有云端文件引用").tag("file")
                    }
                    .pickerStyle(.segmented)
                    .disabled(busy)
                    .onChange(of: referenceKind) { _ in
                        referenceNodeID = ""
                        cloudPickerOpen = false
                    }
                    if referenceKind != "text" {
                        TextField("已核验的云端文件 Node", text: $referenceNodeID)
                            .textFieldStyle(.roundedBorder)
                            .disabled(true)
                        Button("从云端 Files 选择现有文件") {
                            guard !busy, pending == nil, ownerAtOpen != nil,
                                  !targetID.isEmpty else {
                                message = "请先验证当前 Owner 和目标设备。"
                                return
                            }
                            cloudPickerTargetID = targetID
                            cloudPickerKind = referenceKind
                            cloudPickerGeneration = sessionGeneration
                            cloudPickerOpen = true
                        }.disabled(busy || pending != nil)
                        Button("选择本机文件并上传 CAS") {
                            guard !busy, pending == nil else { return }
                            pickerGeneration = sessionGeneration
                            pickerTargetID = targetID
                            pickerKind = referenceKind
                            filePickerOpen = true
                        }.disabled(busy || pending != nil)
                        Button("从分享内容导入") {
                            guard !busy, pending == nil else { return }
                            Task { await importSharedPasteboard() }
                        }.disabled(busy || pending != nil)
                        if referenceKind == "image" {
                            Button("读取本机剪贴板图片并上传") {
                                importSystemClipboardImage()
                            }.disabled(busy || pending != nil)
                        }
                        Text("分享扩展复制的图片/文件仅保留 2 分钟；先选择目标及图片/文件类型，再手动导入。导入不会自动发送。")
                            .font(.caption).foregroundStyle(.secondary)
                        Text("上传只创建当前 Owner 文件。确认 Node ID 后再次点击定向发送。")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Button("撤销所选设备的 Clipboard 接收授权") {
                        revokeCandidate = targetID
                        confirmRevoke = true
                    }.foregroundStyle(.red).disabled(busy || pending != nil)
                    Button("定向发送") { Task { await send(directed: true) } }
                        .buttonStyle(.borderedProminent)
                        .disabled(busy || !targetDevices.contains(where: { $0.device_id == targetID }))
                }
                if recipientProof == nil {
                    Button("启用本机设备定向接收") { Task { await enableRecipient() } }
                        .disabled(busy)
                    Text("需先为此账号注册本机设备。接收授权独立于相册备份。")
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    Label("设备定向接收已启用", systemImage: "checkmark.shield")
                        .font(.footnote).foregroundStyle(.secondary)
                    Button("撤销本机 Clipboard 接收授权") {
                        revokeCandidate = recipientProof?.deviceID
                        confirmRevoke = true
                    }.foregroundStyle(.red).disabled(busy || pending != nil)
                }
                if retryNeedsAbandon && pending != nil {
                    Button("放弃待确认回执") {
                        pending = nil
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
                ForEach(items) { item in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(item.kind == "text/uri-list" ? "链接" :
                                 item.node_id != nil ? "云端文件引用" : "文本")
                                .font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            Button("删除") { Task { await delete(item.id) } }
                                .disabled(busy).font(.caption).foregroundStyle(.red)
                        }
                        if let nodeID = item.node_id, nodeID > 0,
                           (item.kind == "image/x-xdrive-node-ref" ||
                            item.kind == "application/x-xdrive-node-ref") {
                            Text("云端文件引用 #\(nodeID)。原件仍保存在 Files/CAS。")
                                .font(.footnote)
                            Button("在文件查看器中打开") {
                                Task { await openReferencedFile(item) }
                            }
                            .disabled(busy || loading || item.content != "asset:\(nodeID)")
                        } else {
                            Text(item.content).textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .lineLimit(8)
                            Button("复制到本机") {
                                UIPasteboard.general.string = item.content
                                message = "已复制到本机剪贴板。"
                            }
                        }
                    }
                    .padding(12)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
                }
                Text("最多保存 50 条有效消息，24 小时后不可见；不会自动监听系统剪贴板。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .padding(16)
        }
        .navigationTitle("剪贴板")
        .sheet(isPresented: $cloudPickerOpen) {
            if let owner = ownerAtOpen {
                XDriveIOSNativeClipboardCloudPicker(
                    login: login, openedOwner: owner, kind: cloudPickerKind,
                    onChoose: { node in
                        let generation = cloudPickerGeneration ?? sessionGeneration
                        let target = cloudPickerTargetID
                        let kind = cloudPickerKind
                        cloudPickerOpen = false
                        Task { await chooseExistingCloudFile(
                            node, generation: generation, target: target, kind: kind
                        ) }
                    },
                    onDismiss: { cloudPickerOpen = false }
                )
            }
        }
        .fileImporter(isPresented: $filePickerOpen,
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
            Text("只删除当前账号的 Server 剪贴板历史，无法撤销。")
        }
        .confirmationDialog("撤销设备的 Clipboard 定向接收授权？",
                            isPresented: $confirmRevoke, titleVisibility: .visible) {
            Button("确认撤销", role: .destructive) {
                Task { await revokeSelectedDevice() }
            }
            Button("取消", role: .cancel) { revokeCandidate = nil }
        } message: {
            Text("撤销后设备不能再接收新定向消息；已复制到设备的内容无法追回。")
        }
        .task(id: scenePhase == .active) {
            guard scenePhase == .active else { return }
            await refresh()
            await refreshTargets(generation: sessionGeneration)
            while !Task.isCancelled && scenePhase == .active {
                do { try await Task.sleep(nanoseconds: 15_000_000_000) }
                catch { break }
                guard !Task.isCancelled, scenePhase == .active else { break }
                await refresh()
            }
        }
        // A new device grant reopens SSE with new verified installation proof.
        .task(id: "\(scenePhase == .active):\(recipientProof?.deviceID ?? "")") {
            guard scenePhase == .active else { return }
            let generation = sessionGeneration
            var after: UInt64 = 0
            while !Task.isCancelled && scenePhase == .active &&
                  sessionGeneration == generation {
                do {
                    let client = try await authorizedClient(for: generation)
                    after = try await client.watchChanges(after: after) {
                        guard !Task.isCancelled, scenePhase == .active,
                              sessionGeneration == generation,
                              ownerAtOpen == client.owner else { return }
                        await refresh()
                    }
                } catch {
                    if Task.isCancelled || scenePhase != .active ||
                        sessionGeneration != generation { break }
                }
                guard !Task.isCancelled, scenePhase == .active,
                      sessionGeneration == generation else { break }
                await refresh()
                do { try await Task.sleep(nanoseconds: 3_000_000_000) }
                catch { break }
            }
        }
        .onChange(of: recipientProof?.deviceID) { _ in Task { await refresh() } }
        .onChange(of: login.owner) { _ in reset() }
        .onDisappear { reset() }
    }

    @MainActor
    private func authorizedClient(for generation: UInt64) async throws -> XDriveIOSNativeClipboardClient {
        let proof = try await login.verifiedAuthorization()
        guard generation == sessionGeneration, login.owner == proof.owner else {
            throw XDriveIOSClipboardPolicy.Failure.invalidOwner
        }
        if let previous = ownerAtOpen, proof.owner != previous {
            reset()
            throw XDriveIOSClipboardPolicy.Failure.invalidOwner
        }
        if ownerAtOpen == nil { ownerAtOpen = proof.owner }
        return try XDriveIOSNativeClipboardClient(owner: proof.owner,
            accessToken: proof.accessToken, deviceProof: recipientProof)
    }

    @MainActor
    private func enableRecipient() async {
        guard !busy else { return }
        let generation = sessionGeneration
        busy = true
        defer { if sessionGeneration == generation { busy = false } }
        do {
            let client = try await authorizedClient(for: generation)
            guard let proof = try await XDriveIOSDeviceEnrollment.shared.clipboardDeviceProof(
                owner: client.owner, accessToken: client.token) else {
                message = "请先在当前账号注册并核验此 iPhone 的设备身份。"
                return
            }
            let deviceClient = try XDriveIOSNativeClipboardClient(
                owner: client.owner, accessToken: client.token, deviceProof: proof)
            try await deviceClient.enrollClipboardDevice()
            guard generation == sessionGeneration, ownerAtOpen == client.owner else { return }
            recipientProof = proof
            message = "此 iPhone 已获 Clipboard 设备定向接收授权。"
            await refresh()
        } catch {
            if generation == sessionGeneration { message = error.localizedDescription }
        }
    }

    @MainActor
    private func refresh() async {
        guard !loading else { return }
        let generation = sessionGeneration
        loading = true
        defer { if generation == sessionGeneration { loading = false } }
        do {
            let client = try await authorizedClient(for: generation)
            let result = try await client.list()
            try Task.checkCancellation()
            guard generation == sessionGeneration, ownerAtOpen == client.owner else { return }
            items = result.items.filter { item in
                if let nodeID = item.node_id { return item.content == "asset:\(nodeID)" }
                return (1...65_536).contains(Data(item.content.utf8).count)
            }
        } catch {
            if generation == sessionGeneration { message = error.localizedDescription }
        }
    }

    @MainActor
    private func refreshTargets(generation: UInt64) async {
        guard generation == sessionGeneration else { return }
        do {
            let client = try await authorizedClient(for: generation)
            let directory = try await client.devices()
            guard generation == sessionGeneration, ownerAtOpen == client.owner else { return }
            targetDevices = directory
            if !targetID.isEmpty && !directory.contains(where: { $0.device_id == targetID }) {
                targetID = ""
                referenceKind = "text"
                referenceNodeID = ""
                cloudPickerOpen = false
            }
        } catch {
            if generation == sessionGeneration { targetDevices = [] }
        }
    }

    /// The chosen Files row is a hint, not an authorization. Re-read the
    /// exact Node under the current Owner before offering an explicit send.
    @MainActor
    private func chooseExistingCloudFile(
        _ selected: XDriveIOSNativeFilesNode, generation: UInt64,
        target: String, kind: String
    ) async {
        guard generation == sessionGeneration, !busy, pending == nil,
              targetID == target, referenceKind == kind, !target.isEmpty,
              XDriveIOSClipboardCloudFilePolicy.accepts(selected, kind: kind)
        else { return }
        busy = true
        referenceNodeID = ""
        defer { if generation == sessionGeneration { busy = false } }
        do {
            let client = try await authorizedClient(for: generation)
            let reader = XDriveIOSNativeFilesReader(
                owner: client.owner, accessToken: client.token
            )
            let current = try await reader.referencedFile(nodeID: selected.id)
            try Task.checkCancellation()
            guard generation == sessionGeneration, ownerAtOpen == client.owner,
                  targetID == target, referenceKind == kind,
                  XDriveIOSClipboardCloudFilePolicy.accepts(current, kind: kind),
                  current.id == selected.id,
                  current.parent_id == selected.parent_id,
                  current.revision == selected.revision,
                  current.name == selected.name, current.size == selected.size
            else { throw XDriveIOSClipboardPolicy.Failure.invalidPayload }
            referenceNodeID = String(current.id)
            message = "已从当前 Owner 的 Files 核验文件；请确认目标后点击“定向发送”。"
        } catch {
            if generation == sessionGeneration {
                referenceNodeID = ""
                message = "所选云端文件已变化或权限失效，请重新选择。"
            }
        }
    }

    /// Device grant revocation never deletes the installation or Files data.
    @MainActor
    private func revokeSelectedDevice() async {
        guard !busy, let selected = revokeCandidate,
              targetDevices.contains(where: { $0.device_id == selected }) ||
              recipientProof?.deviceID == selected else { return }
        let generation = sessionGeneration
        busy = true
        defer { if sessionGeneration == generation { busy = false } }
        do {
            let client = try await authorizedClient(for: generation)
            try await client.revokeDevice(selected)
            try Task.checkCancellation()
            guard sessionGeneration == generation, ownerAtOpen == client.owner else { return }
            revokeCandidate = nil
            targetDevices.removeAll(where: { $0.device_id == selected })
            if recipientProof?.deviceID == selected { recipientProof = nil }
            if targetID == selected {
                targetID = ""
                referenceKind = "text"
                referenceNodeID = ""
                cloudPickerOpen = false
            }
            if pending?.targetID == selected {
                pending = nil // Never retry an unknown ACK to a revoked device.
                retryNeedsAbandon = false
            }
            message = "该设备的 Clipboard 接收授权已撤销。"
            await refresh()
        } catch {
            if generation == sessionGeneration {
                message = "撤销未确认，请刷新授权状态再核对；不会自动重复提交。"
            }
        }
    }

    /// Clipboard images enter through a user gesture and the SAME CAS writer.
    @MainActor
    private func importSystemClipboardImage() {
        guard scenePhase == .active, !busy, pending == nil,
              !targetID.isEmpty, referenceKind == "image" else { return }
        let clipboard = UIPasteboard.general
        let supported: [(String, String)] = [
            ("public.heic", "heic"), ("public.heif", "heif"),
            ("public.png", "png"), ("public.jpeg", "jpg")
        ]
        var imageData: Data?
        var suffix = "png"
        for (type, ext) in supported {
            if let data = clipboard.data(forPasteboardType: type) {
                imageData = data
                suffix = ext
                break
            }
        }
        if imageData == nil { imageData = clipboard.image?.pngData() }
        guard let bytes = imageData, !bytes.isEmpty,
              bytes.count <= 64 * 1_048_576 else {
            message = "剪贴板没有有效且不超过 64 MiB 的图片；请从本机文件选择。"
            return
        }
        let generation = sessionGeneration
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("xdrive-clipboard-" + UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: directory,
                withIntermediateDirectories: true)
            let source = directory.appendingPathComponent("Clipboard." + suffix)
            try bytes.write(to: source, options: .atomic)
            uploadTask = Task { @MainActor in
                defer { try? FileManager.default.removeItem(at: directory) }
                await importLocalFile(source, generation: generation)
            }
        } catch {
            try? FileManager.default.removeItem(at: directory)
            message = "剪贴板图片暂存失败，未进行任何上传。"
        }
    }

    /// Clipboard item is only a locator; Files independently rechecks the
    /// current Owner, Node location, revision and normal read permission.
    @MainActor
    private func openReferencedFile(_ item: XDriveIOSClipboardItem) async {
        guard !busy, let nodeID = item.node_id, nodeID > 0,
              (item.kind == "image/x-xdrive-node-ref" ||
               item.kind == "application/x-xdrive-node-ref"),
              item.content == "asset:\(nodeID)",
              items.contains(where: { $0.id == item.id && $0.content == item.content })
        else { message = "文件引用与消息身份不一致。"; return }
        let generation = sessionGeneration
        busy = true
        defer { if generation == sessionGeneration { busy = false } }
        do {
            let client = try await authorizedClient(for: generation)
            let reader = XDriveIOSNativeFilesReader(owner: client.owner,
                                                    accessToken: client.token)
            let node = try await reader.referencedFile(nodeID: nodeID)
            try Task.checkCancellation()
            guard generation == sessionGeneration, ownerAtOpen == client.owner,
                  XDriveIOSNativePhotoOwnerScope.matches(login.owner, client.owner)
            else { return }
            onOpenReferencedFile(client.owner, node)
        } catch {
            if generation == sessionGeneration {
                message = "无法打开云端文件：\(error.localizedDescription)"
            }
        }
    }

    /// A temporary local-only Share Extension handoff. Never reads the
    /// pasteboard in the background or sends without an explicit second tap.
    @MainActor
    private func importSharedPasteboard() async {
        guard !busy, pending == nil, !targetID.isEmpty, referenceKind != "text" else { return }
        let generation = sessionGeneration
        let pasteboard = UIPasteboard.general
        let bytesType = "com.lazyxu.xdrive.clipboard.file.bytes"
        let nameType = "com.lazyxu.xdrive.clipboard.file.name"
        let kindType = "com.lazyxu.xdrive.clipboard.file.kind"
        guard let data = pasteboard.data(forPasteboardType: bytesType),
              data.count > 0 && data.count <= 64 * 1_048_576,
              let name = pasteboard.value(forPasteboardType: nameType) as? String,
              let kind = pasteboard.value(forPasteboardType: kindType) as? String,
              kind == referenceKind,
              !name.isEmpty && name == name.trimmingCharacters(in: .whitespacesAndNewlines),
              name != "." && name != ".." && name.utf8.count <= 255,
              !name.contains("/") && !name.contains("\\") &&
              !name.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 })
        else {
            message = "未找到有效的 2 分钟分享文件，或图片/文件类型不匹配；请重新分享。"
            return
        }
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("xdrive-share-" + UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: directory,
                withIntermediateDirectories: true)
            let url = directory.appendingPathComponent(name, isDirectory: false)
            try data.write(to: url, options: .atomic)
            defer { try? FileManager.default.removeItem(at: directory) }
            guard generation == sessionGeneration else { return }
            // Existing verified File stager and single UploadSession/CAS writer.
            await importLocalFile(url, generation: generation)
        } catch {
            if generation == sessionGeneration {
                message = "分享文件暂存失败，请改用“选择本机文件并上传 CAS”。"
            }
        }
    }

    @MainActor
    private func importLocalFile(_ selectedURL: URL, generation: UInt64) async {
        guard generation == sessionGeneration, !busy, !targetID.isEmpty,
              referenceKind != "text", pending == nil else { return }
        let expectedTarget = targetID
        let expectedKind = referenceKind
        referenceNodeID = ""
        busy = true
        defer {
            if generation == sessionGeneration {
                busy = false
                uploadTask = nil
            }
        }
        do {
            guard let gate = XDriveIOSOriginalRunGate.shared.acquire() else {
                throw XDriveIOSClipboardPolicy.Failure.invalidOwner
            }
            defer { XDriveIOSOriginalRunGate.shared.release(gate) }
            let client = try await authorizedClient(for: generation)
            let staged = try await XDriveManualDocumentStager.stage(selectedURL)
            defer { staged.delete() }
            guard staged.byteCount > 0 && staged.byteCount <= 64 * 1_048_576,
                  generation == sessionGeneration, ownerAtOpen == client.owner,
                  referenceKind == expectedKind, targetID == expectedTarget else {
                throw XDriveIOSClipboardPolicy.Failure.invalidOwner
            }
            try Task.checkCancellation()
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
            guard generation == sessionGeneration, ownerAtOpen == after.owner,
                  targetID == expectedTarget, referenceKind == expectedKind else { return }
            referenceNodeID = String(receipt.nodeID)
            message = "原件已上传到当前 Owner 的 CAS。请检查 Node 后，再明确点击“定向发送”。"
        } catch {
            if generation == sessionGeneration {
                referenceNodeID = ""
                message = "本机文件上传未确认：请检查 Files 目录，勿自动重传。"
            }
        }
    }

    @MainActor
    private func send(directed: Bool) async {
        guard !busy else { return }
        let selected = directed ? targetID : ""
        if directed && !targetDevices.contains(where: { $0.device_id == selected }) {
            message = "目标设备已失效，请刷新后重新选择。"
            return
        }
        let nodeID = directed && referenceKind != "text" ?
            (UInt64(referenceNodeID) ?? 0) : 0
        // Never turn an explicitly chosen file/image into an unrelated text
        // message just because a stale or malformed Node ID was supplied.
        if directed && referenceKind != "text" && nodeID == 0 {
            message = "请先选择并核验已完成上传的云端文件。"
            return
        }
        if !directed && !targetID.isEmpty {
            message = "请先明确选择当前账号广播或目标设备。"
            return
        }
        let kind: String
        if nodeID > 0 {
            kind = referenceKind == "image" ?
                "image/x-xdrive-node-ref" : "application/x-xdrive-node-ref"
        } else {
            kind = XDriveIOSClipboardPolicy.kind(draft)
        }
        let payload = nodeID > 0 ? "asset:\(nodeID)" : draft
        guard (nodeID > 0 && directed) || !payload.isEmpty else {
            message = "请选择有效文本或已确认的 CAS 文件 Node。"
            return
        }
        let generation = sessionGeneration
        busy = true
        defer { if generation == sessionGeneration { busy = false } }
        do {
            let wire: XDriveIOSClipboardWrite
            if let previous = pending {
                let elapsed = Date().timeIntervalSince(previous.createdAt)
                guard elapsed >= 0 && elapsed < 300,
                      previous.sourceText == payload, previous.targetID == selected,
                      previous.kind == kind, previous.nodeID == nodeID else {
                    retryNeedsAbandon = true
                    message = "待确认回执不能改变文本、目标设备或 Node。请先核对历史并明确放弃。"
                    return
                }
                wire = previous.wire
            } else {
                wire = try XDriveIOSClipboardWrite(payload, kind: kind,
                    targetID: directed ? selected : nil, nodeID: nodeID)
                pending = Pending(sourceText: payload, targetID: selected,
                    kind: kind, nodeID: nodeID, createdAt: Date(), wire: wire)
            }
            let client = try await authorizedClient(for: generation)
            guard generation == sessionGeneration, ownerAtOpen == client.owner else { return }
            _ = try await client.send(wire)
            guard generation == sessionGeneration, ownerAtOpen == client.owner else { return }
            pending = nil
            retryNeedsAbandon = false
            if nodeID == 0 && draft == payload { draft = "" }
            message = directed ? "已发送到指定设备。" : "已发送到当前账号。"
            await refresh()
        } catch {
            if generation == sessionGeneration {
                message = "发送回执未知，保留相同事件 ID：\(error.localizedDescription)"
            }
        }
    }

    @MainActor
    private func delete(_ id: UInt64) async {
        guard !busy else { return }
        let generation = sessionGeneration
        busy = true
        defer { if generation == sessionGeneration { busy = false } }
        do {
            let client = try await authorizedClient(for: generation)
            try await client.delete(id)
            guard generation == sessionGeneration, ownerAtOpen == client.owner else { return }
            items.removeAll { $0.id == id }
            message = "已删除消息。"
        } catch {
            if generation == sessionGeneration { message = error.localizedDescription }
        }
    }

    @MainActor
    private func clear() async {
        guard !busy else { return }
        let generation = sessionGeneration
        busy = true
        defer { if generation == sessionGeneration { busy = false } }
        do {
            let client = try await authorizedClient(for: generation)
            try await client.clear()
            guard generation == sessionGeneration, ownerAtOpen == client.owner else { return }
            items = []
            message = "已清空本账号历史。"
        } catch {
            if generation == sessionGeneration { message = error.localizedDescription }
        }
    }

    @MainActor
    private func reset() {
        sessionGeneration &+= 1
        draft = ""
        items = []
        pending = nil
        retryNeedsAbandon = false
        ownerAtOpen = nil
        recipientProof = nil
        targetDevices = []
        targetID = ""
        referenceKind = "text"
        referenceNodeID = ""
        filePickerOpen = false
        uploadTask?.cancel()
        uploadTask = nil
        pickerGeneration = nil
        pickerTargetID = ""
        pickerKind = ""
        cloudPickerOpen = false
        cloudPickerTargetID = ""
        cloudPickerKind = ""
        cloudPickerGeneration = nil
        revokeCandidate = nil
        confirmRevoke = false
        loading = false
        busy = false
        confirmClear = false
        message = nil
    }
}


/// Files/Owner authorization is shared with Native Files. Clipboard adds
/// no second file reader, binary store or local cache of remote metadata.
private enum XDriveIOSClipboardCloudFilePolicy {
    static let imageExtensions: Set<String> = [
        "png", "jpg", "jpeg", "gif", "webp", "avif", "heic", "heif",
        "tif", "tiff", "bmp"
    ]

    static func accepts(_ node: XDriveIOSNativeFilesNode, kind: String) -> Bool {
        guard node.id > 0, node.parent_id != nil,
              node.revision > 0, node.size >= 0,
              !node.name.isEmpty, node.type == "file" else { return false }
        if kind == "image" {
            guard let suffix = node.name.split(separator: ".").last else { return false }
            return imageExtensions.contains(String(suffix).lowercased())
        }
        return kind == "file"
    }
}

/// Read-only Cloud Files selection: a single, real 64-item Server page at
/// any time; no fabricated directory/Node data or unbounded 100k lists.
private struct XDriveIOSNativeClipboardCloudPicker: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let openedOwner: XDriveNativeOwnerRoot
    let kind: String
    let onChoose: (XDriveIOSNativeFilesNode) -> Void
    let onDismiss: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var folders: [XDriveIOSNativeFilesDestination] = []
    @State private var rows: [XDriveIOSNativeFilesNode] = []
    @State private var offset = 0
    @State private var totalCount = 0
    @State private var loading = false
    @State private var failure: String?
    @State private var requestID = UUID()

    private var folderID: UInt64 { folders.last?.id ?? openedOwner.rootNodeID }
    private var folderName: String { folders.last?.name ?? "云端根目录" }

    var body: some View {
        NavigationStack {
            List {
                Section("当前目录") {
                    Label(folderName, systemImage: "folder")
                    if !folders.isEmpty {
                        Button("返回上一级") {
                            folders.removeLast()
                            offset = 0
                            rows = []
                        }
                    }
                }
                Section("当前 Owner 的云端文件") {
                    if loading { ProgressView("正在核验 Files 分页…") }
                    if let failure {
                        Text(failure).foregroundStyle(.secondary)
                        Button("重试") { Task { await readPage() } }
                    } else if !loading {
                        ForEach(rows) { node in
                            if node.isDirectory {
                                Button {
                                    guard node.parent_id == folderID, node.id > 0 else { return }
                                    folders.append(.init(id: node.id, name: node.name))
                                    offset = 0
                                    rows = []
                                } label: {
                                    Label(node.name, systemImage: "folder.fill")
                                }
                            } else if XDriveIOSClipboardCloudFilePolicy.accepts(node, kind: kind) {
                                Button {
                                    guard XDriveIOSNativePhotoOwnerScope.matches(
                                        login.owner, openedOwner
                                    ), rows.contains(where: { $0.id == node.id }) else { return }
                                    onChoose(node)
                                    dismiss()
                                } label: {
                                    Label(node.name, systemImage: "doc")
                                }
                            }
                        }
                        if offset > 0 {
                            Button("上一页") { offset = max(0, offset - 64) }
                        }
                        if offset + rows.count < totalCount && !rows.isEmpty {
                            Button("下一页") { offset += rows.count }
                        }
                        if rows.isEmpty && totalCount == 0 {
                            Text("当前目录没有文件").foregroundStyle(.secondary)
                        }
                        Text("已读取 \(offset + rows.count) / \(totalCount) 项")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("从云端 Files 选择")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("取消") { onDismiss(); dismiss() }
                }
            }
            .task(id: "\(folderID):\(offset)") { await readPage() }
            .onChange(of: login.owner) { _ in
                requestID = UUID()
                onDismiss()
                dismiss()
            }
            .onDisappear { requestID = UUID() }
        }
    }

    @MainActor private func readPage() async {
        let id = UUID()
        requestID = id
        loading = true
        failure = nil
        rows = []
        let requestedFolder = folderID
        let requestedOffset = offset
        defer { if requestID == id { loading = false } }
        do {
            let auth = try await login.verifiedAuthorization()
            try Task.checkCancellation()
            guard requestID == id,
                  XDriveIOSNativePhotoOwnerScope.matches(auth.owner, openedOwner),
                  XDriveIOSNativePhotoOwnerScope.matches(login.owner, openedOwner)
            else { return }
            let result = try await XDriveIOSNativeFilesReader(
                owner: auth.owner, accessToken: auth.accessToken
            ).children(parentID: requestedFolder, offset: requestedOffset,
                       sort: "name", order: "asc")
            try Task.checkCancellation()
            guard requestID == id, folderID == requestedFolder,
                  offset == requestedOffset,
                  XDriveIOSNativePhotoOwnerScope.matches(login.owner, openedOwner)
            else { return }
            guard result.offset == requestedOffset, result.items.count <= 64,
                  result.total_count >= requestedOffset + result.items.count,
                  (result.items.count > 0 || result.total_count == requestedOffset),
                  Set(result.items.map(\.id)).count == result.items.count,
                  result.items.allSatisfy({ $0.id > 0 && $0.parent_id == requestedFolder })
            else { throw XDriveIOSClipboardPolicy.Failure.invalidPayload }
            rows = result.items
            totalCount = result.total_count
        } catch is CancellationError {
        } catch {
            if requestID == id {
                rows = []
                failure = "目录已变化、无权访问或分页无效；请返回或重试。"
            }
        }
    }
}

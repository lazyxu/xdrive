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
                }
                if !targetID.isEmpty {
                    Picker("定向消息内容", selection: $referenceKind) {
                        Text("文本或链接").tag("text")
                        Text("现有云端图片引用").tag("image")
                        Text("现有云端文件引用").tag("file")
                    }
                    .pickerStyle(.segmented)
                    .disabled(busy)
                    .onChange(of: referenceKind) { _ in referenceNodeID = "" }
                    if referenceKind != "text" {
                        TextField("已经完成上传的 CAS Node ID", text: $referenceNodeID)
                            .keyboardType(.numberPad)
                            .textFieldStyle(.roundedBorder)
                            .disabled(busy)
                        Button("选择本机文件并上传 CAS") {
                            guard !busy, pending == nil else { return }
                            pickerGeneration = sessionGeneration
                            pickerTargetID = targetID
                            pickerKind = referenceKind
                            filePickerOpen = true
                        }.disabled(busy || pending != nil)
                        Text("上传只创建当前 Owner 文件。确认 Node ID 后再次点击定向发送。")
                            .font(.caption).foregroundStyle(.secondary)
                    }
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
                referenceNodeID = ""
            }
        } catch {
            if generation == sessionGeneration { targetDevices = [] }
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
        loading = false
        busy = false
        confirmClear = false
        message = nil
    }
}

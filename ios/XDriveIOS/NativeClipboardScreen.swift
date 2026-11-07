import CryptoKit
import SwiftUI
import UIKit

/// The Clipboard tool is a fully native SwiftUI L2 dynamic page. It never
/// polls the iOS system pasteboard, persists its E2EE key or launches WebKit.
struct XDriveIOSNativeClipboardScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @State private var passphrase = ""
    @State private var key: SymmetricKey?
    @State private var aadScope = ""
    @State private var ownerAtUnlock: XDriveNativeOwnerRoot?
    @State private var draft = ""
    @State private var items: [Decrypted] = []
    @State private var loading = false
    @State private var busy = false
    @State private var message: String?
    @State private var confirmClear = false
    @State private var pending: Pending?
    @State private var retryNeedsAbandon = false

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
    private var unlocked: Bool { key != nil }
    private var currentScope: String { aadScope }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("端到端加密的当前账号文本收件箱。仅在你点击后读取或写入本机剪贴板。")
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
                            .disabled(busy || draft.isEmpty)
                        Button("从本机粘贴") {
                            // Explicit user gesture. No background UIPasteboard reads.
                            if let text = UIPasteboard.general.string { draft = text }
                            else { message = "本机剪贴板没有可读取的文本。" }
                        }.disabled(busy)
                        Spacer()
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
                    ForEach(items) { entry in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text(entry.source.kind == "text/uri-list" ? "链接" : "文本")
                                    .font(.caption).foregroundStyle(.secondary)
                                Spacer()
                                Button("删除") { Task { await delete(entry.source.id) } }
                                    .disabled(busy).font(.caption).foregroundStyle(.red)
                            }
                            if let text = entry.text {
                                Text(text).textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .lineLimit(8)
                                Button("复制到本机") {
                                    // Explicit tap only; OS clipboard cannot be revoked.
                                    UIPasteboard.general.string = text
                                    message = "已复制到本机剪贴板。"
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
        .alert("确认清空剪贴板历史？", isPresented: $confirmClear) {
            Button("取消", role: .cancel) {}
            Button("清空", role: .destructive) { Task { await clear() } }
        } message: {
            Text("只删除当前 Owner 的 Server 密文历史，不能撤销。")
        }
        .task(id: unlocked) {
            guard unlocked else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                if Task.isCancelled { break }
                await refresh()
            }
        }
        .onChange(of: login.owner) { newOwner in
            if newOwner != ownerAtUnlock && ownerAtUnlock != nil { lock() }
        }
        .onDisappear { lock() }
    }

    @MainActor
    private func authorizedClient() async throws -> XDriveIOSNativeClipboardClient {
        let proof = try await login.verifiedAuthorization()
        if let lockedOwner = ownerAtUnlock, proof.owner != lockedOwner {
            lock()
            throw XDriveIOSClipboardCrypto.Failure.invalidOwner
        }
        return try XDriveIOSNativeClipboardClient(owner: proof.owner, accessToken: proof.accessToken)
    }

    @MainActor
    private func unlock() async {
        if busy || key != nil { return }
        busy = true
        message = nil
        defer { busy = false }
        do {
            let client = try await authorizedClient()
            let vault = try await client.vault()
            let derived = try XDriveIOSClipboardCrypto.key(passphrase, salt: vault.salt)
            var scope = vault.aad_scope
            if vault.check_ciphertext.isEmpty {
                scope = client.newVaultScope
                let canary = try XDriveIOSClipboardCrypto.check(key: derived, scope: scope)
                let pinned = try await client.check(canary, scope: scope)
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
            guard login.owner == client.owner else { throw XDriveIOSClipboardCrypto.Failure.invalidOwner }
            ownerAtUnlock = client.owner
            aadScope = scope
            key = derived
            passphrase = ""
            await refresh()
        } catch {
            message = error.localizedDescription
        }
    }

    @MainActor
    private func refresh() async {
        guard let localKey = key, !currentScope.isEmpty, !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let client = try await authorizedClient()
            let result = try await client.list()
            let decoded = result.items.map { item in
                Decrypted(source: item, text: try? XDriveIOSClipboardCrypto.decrypt(
                    item.encrypted, key: localKey, scope: currentScope))
            }
            try Task.checkCancellation()
            guard ownerAtUnlock == client.owner, key != nil else { return }
            items = decoded
        } catch {
            message = error.localizedDescription
        }
    }

    @MainActor
    private func send() async {
        guard !busy, let localKey = key, !aadScope.isEmpty else { return }
        busy = true
        defer { busy = false }
        do {
            let candidate: XDriveIOSClipboardCrypto.Encrypted
            if let previous = pending {
                guard previous.sourceText == draft else {
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
                    draft, key: localKey, scope: aadScope)
                pending = Pending(sourceText: draft, createdAt: Date(), wire: candidate)
            }
            let client = try await authorizedClient()
            _ = try await client.send(candidate)
            guard ownerAtUnlock == client.owner else { return }
            pending = nil
            draft = ""
            message = "已加密发送到当前账号。"
            await refresh()
        } catch {
            message = "发送回执未知；保留相同事件 ID。\(error.localizedDescription)"
        }
    }
    @MainActor
    private func delete(_ id: UInt64) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            try await authorizedClient().delete(id)
            message = "已删除消息。"
            items.removeAll { $0.id == id }
        } catch { message = error.localizedDescription }
    }
    @MainActor
    private func clear() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            try await authorizedClient().clear()
            items = []
            message = "已清空本账号历史。"
        } catch { message = error.localizedDescription }
    }
    @MainActor
    private func lock() {
        key = nil
        aadScope = ""
        passphrase = ""
        draft = ""
        items = []
        pending = nil
        retryNeedsAbandon = false
        ownerAtUnlock = nil
    }
}

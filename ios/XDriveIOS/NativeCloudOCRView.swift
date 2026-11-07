import SwiftUI
import UIKit

/// Private text stays in this one foreground information sheet. Owner/scene
/// changes revoke it, and neither detail GET nor queue POST is polled/retried.
struct XDriveIOSNativeCloudOCRView: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let owner: XDriveNativeOwnerRoot?
    let target: XDriveIOSNativeOCRTarget
    @Environment(\.scenePhase) private var phase
    @State private var result: XDriveIOSNativeOCRResult?
    @State private var message = "正在读取识别结果…"
    @State private var reload = UUID()
    @State private var busy = false
    @State private var revoked = false
    @State private var confirm = false
    @State private var attempted = false
    @State private var notice = ""
    @State private var write: Task<Void, Never>?

    private var authorized: Bool {
        !revoked && phase == .active && owner.map {
            XDriveIOSNativePhotoOwnerScope.matches(login.owner, $0)
        } == true
    }
    var body: some View {
        Group {
            if authorized {
                Text(message).font(.subheadline)
                if let result, result.state == "ready", !result.text.isEmpty {
                    Text(result.text).textSelection(.enabled)
                    Button("复制文字") {
                        guard authorized else { return }
                        UIPasteboard.general.string = result.text
                        notice = "已复制"
                    }
                }
                Button("刷新识别结果") { reload = UUID() }.disabled(busy)
                Button("重新识别云端图库") { confirm = true }.disabled(busy || attempted)
                if !notice.isEmpty { Text(notice).font(.caption) }
            }
        }
        .accessibilityIdentifier("native-ios-cloud-ocr")
        .task(id: revoked ? nil : reload) { await load() }
        .alert("重新识别云端图库？", isPresented: $confirm) {
            Button("取消", role: .cancel) {}
            Button("重新识别") { reanalyze() }
        } message: {
            Text("对当前账号的全部云端照片重新进行 OCR 和物体识别，任务在服务器后台执行。不会修改照片原件。")
        }
        .onReceive(login.$owner) { current in
            if let owner, !XDriveIOSNativePhotoOwnerScope.matches(current, owner) { revoke() }
        }
        .onChange(of: phase) { if $0 != .active { revoke() } }
        .onDisappear { revoke() }
    }
    private func revoke() {
        revoked = true
        result = nil
        notice = ""
        confirm = false
        write?.cancel()
        write = nil
    }
    @MainActor private func load() async {
        guard authorized, let owner else { return }
        busy = true
        result = nil
        message = "正在读取识别结果…"
        defer { busy = false }
        do {
            let auth = try await login.verifiedAuthorization()
            try Task.checkCancellation()
            guard authorized, XDriveIOSNativePhotoOwnerScope.matches(auth.owner, owner) else { return }
            let read = try await XDriveIOSNativeMediaGalleryReader(owner: auth.owner,
                accessToken: auth.accessToken).ocr(target)
            try Task.checkCancellation()
            guard authorized else { return }
            result = read
            message = read?.message ?? "暂无 OCR 结果，请检查服务器模型配置"
        } catch is CancellationError { }
        catch { if authorized { message = "读取失败，请刷新重试" } }
    }
    private func reanalyze() {
        guard authorized, !attempted, let owner else { return }
        attempted = true
        notice = "正在提交…"
        write = Task { @MainActor in
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard authorized, XDriveIOSNativePhotoOwnerScope.matches(auth.owner, owner) else { return }
                try await XDriveIOSNativeMediaGalleryReader(owner: auth.owner,
                    accessToken: auth.accessToken).reanalyzeOCR()
                try Task.checkCancellation()
                guard authorized else { return }
                notice = "已加入后台队列；稍后刷新查看实际识别结果"
                reload = UUID()
            } catch is CancellationError { }
            catch { if authorized { notice = "提交未确认，请先刷新状态；不会自动重复提交" } }
        }
    }
}

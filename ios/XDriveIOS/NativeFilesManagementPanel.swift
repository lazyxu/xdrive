import Combine
import Foundation
import SwiftUI
import UniformTypeIdentifiers

private struct XDriveIOSNativeFilesManageDestinationIntent: Identifiable {
    let id = UUID()
    let node: XDriveIOSNativeFilesNode
    let kind: XDriveIOSNativeFilesDestinationKind
}

/// Native Server Files operations live beside, never inside, the independent
/// read-only L3 Files Viewer. One modal owns one selected file or folder.
struct XDriveIOSNativeFilesManagementPanel: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let expectedOwner: XDriveNativeOwnerRoot
    let folderID: UInt64
    let folderName: String?
    let file: XDriveIOSNativeFilesNode?
    let onConfirmed: @MainActor () -> Void

    @Environment(\.dismiss) private var dismiss
    @StateObject private var exporter = XDriveIOSNativeFilesExportModel()
    @StateObject private var uploader = XDriveIOSNativeFilesManualUploadModel()
    @StateObject private var mutator = XDriveIOSNativeFilesMutationModel()
    @StateObject private var destinationWriter =
        XDriveIOSNativeFilesDestinationMutationModel()
    @State private var showingImporter = false
    @State private var showingCreate = false
    @State private var showingRename = false
    @State private var showingTrash = false
    @State private var folderDraft = ""
    @State private var renameDraft = ""
    @State private var createBusy = false
    @State private var createNotice: String?
    @State private var createEpoch = UUID()
    @State private var createTask: Task<Void, Never>?
    @State private var destinationIntent: XDriveIOSNativeFilesManageDestinationIntent?

    private var verified: Bool {
        XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner)
    }
    private var anyBusy: Bool {
        createBusy || exporter.busy || uploader.busy ||
            mutator.busy || destinationWriter.busy
    }

    var body: some View {
        NavigationStack {
            Form {
                if !verified {
                    Section {
                        Label("当前服务器或账户已变化，文件操作不可用。",
                              systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.secondary)
                    }
                } else if let file {
                    Section("文件信息") {
                        LabeledContent("名称", value: file.name)
                        LabeledContent("大小", value: ByteCountFormatter.string(
                            fromByteCount: file.size, countStyle: .file
                        ))
                        LabeledContent("版本", value: String(file.revision))
                    }
                    Section("下载与系统导出") {
                        if let staged = exporter.prepared,
                           staged.nodeID == file.id, staged.revision == file.revision {
                            ShareLink(item: staged.fileURL) {
                                Label("存储到“文件”或分享", systemImage: "square.and.arrow.up")
                            }
                            Text("需在系统界面选择保存位置；当前只表示已暂存原件。")
                                .font(.footnote).foregroundStyle(.secondary)
                        } else {
                            Button(exporter.busy ? "正在下载…" : "下载并准备导出") {
                                exporter.prepare(file, login: login)
                            }
                            .disabled(anyBusy)
                            .accessibilityIdentifier("native-ios-files-export")
                            Text("首版上限 512 MiB，使用实际下载结果；无后台任务或虚构进度。")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        if let status = exporter.status {
                            Text(status).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    Section("单文件管理") {
                        Button("复制到…") {
                            destinationIntent = .init(node: file, kind: .copy)
                        }
                        .disabled(anyBusy)
                        .accessibilityIdentifier("native-ios-files-copy-to")
                        Button("移动到…") {
                            destinationIntent = .init(node: file, kind: .move)
                        }
                        .disabled(anyBusy)
                        .accessibilityIdentifier("native-ios-files-move-to")
                        Button("重命名文件") {
                            renameDraft = file.name
                            showingRename = true
                        }
                        .disabled(anyBusy)
                        .alert("重命名文件", isPresented: $showingRename) {
                            TextField("新文件名", text: $renameDraft)
                            Button("保存") {
                                mutator.perform(node: file, kind: .rename(renameDraft),
                                                login: login, onConfirmed: finishConfirmed)
                            }
                            Button("取消", role: .cancel) {}
                        } message: {
                            Text("使用服务器的准确版本进行更名；冲突或结果不确定时先刷新。")
                        }
                        .accessibilityIdentifier("native-ios-files-rename")
                        Button("移入回收站", role: .destructive) {
                            showingTrash = true
                        }
                        .disabled(anyBusy)
                        .confirmationDialog(
                            "将“\(file.name)”移入回收站？",
                            isPresented: $showingTrash, titleVisibility: .visible
                        ) {
                            Button("确认移入回收站", role: .destructive) {
                                mutator.perform(node: file, kind: .trash,
                                                login: login, onConfirmed: finishConfirmed)
                            }
                        } message: {
                            Text("请求已发出但响应丢失时，必须核对目录，不能自动重试。")
                        }
                        .accessibilityIdentifier("native-ios-files-trash")
                        if let status = mutator.status {
                            Text(status).font(.footnote).foregroundStyle(.secondary)
                        }
                        if let status = destinationWriter.status {
                            Text(status).font(.footnote).foregroundStyle(.secondary)
                        }
                        Text("多选、目录级复制/移动和后台传输仍待实现。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                } else {
                    Section("当前目录") {
                        LabeledContent("位置", value: folderName ?? "云端根目录")
                        Button("新建文件夹") {
                            folderDraft = ""
                            showingCreate = true
                        }
                        .disabled(anyBusy)
                        .alert("新建文件夹", isPresented: $showingCreate) {
                            TextField("文件夹名称", text: $folderDraft)
                            Button("创建") { createDirectory() }
                            Button("取消", role: .cancel) {}
                        } message: {
                            Text("若服务器可能已创建但响应丢失，请先刷新目录，不要盲目重试。")
                        }
                        .accessibilityIdentifier("native-ios-files-create-folder")
                        Button("从 iOS“文件”上传") {
                            showingImporter = true
                        }
                        .disabled(anyBusy)
                        .fileImporter(
                            isPresented: $showingImporter, allowedContentTypes: [.item]
                        ) { result in
                            switch result {
                            case .success(let pickedURL):
                                guard verified else {
                                    uploader.pickerFailed()
                                    return
                                }
                                uploader.start(
                                    fileURL: pickedURL, login: login,
                                    parentID: folderID, expectedFolderName: folderName,
                                    onConfirmed: finishConfirmed
                                )
                            case .failure:
                                uploader.pickerFailed()
                            }
                        }
                        .accessibilityIdentifier("native-ios-files-manual-upload")
                        Text("一次仅选一个不超过 128 MiB 的原文件；不自动重新提交未知结果。")
                            .font(.footnote).foregroundStyle(.secondary)
                        if let status = uploader.status {
                            Text(status).font(.footnote).foregroundStyle(.secondary)
                        }
                        if let createNotice {
                            Text(createNotice).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .navigationTitle(file?.name ?? "文件夹操作")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                        .disabled(anyBusy)
                }
            }
            .sheet(item: $destinationIntent) { intent in
                XDriveIOSNativeFilesDestinationPicker(
                    login: login, originalOwner: expectedOwner,
                    selected: intent.node, kind: intent.kind
                ) { target in
                    destinationIntent = nil
                    guard verified else { return }
                    destinationWriter.perform(
                        intent.kind, original: intent.node,
                        destination: target, login: login,
                        onConfirmed: finishConfirmed
                    )
                }
            }
        }
        .onDisappear { invalidate() }
        .onChange(of: login.owner) { _ in
            if !verified {
                invalidate()
                dismiss()
            }
        }
    }

    @MainActor
    private func finishConfirmed() {
        dismiss()
        onConfirmed()
    }

    private func invalidate() {
        createEpoch = UUID()
        createTask?.cancel()
        createTask = nil
        createBusy = false
        createNotice = nil
        showingCreate = false
        showingRename = false
        showingTrash = false
        showingImporter = false
        destinationIntent = nil
        exporter.invalidate()
        uploader.invalidate()
        mutator.invalidate()
        destinationWriter.invalidate()
    }

    private func createDirectory() {
        guard verified, !anyBusy else {
            createNotice = "当前账号或目录操作状态不可用。"
            return
        }
        guard let name = XDriveIOSNativeFilesFolderNamePolicy.normalized(folderDraft) else {
            createNotice = "文件夹名称不符合服务器规范，未创建。"
            return
        }
        let ticket = UUID()
        createEpoch = ticket
        createBusy = true
        createNotice = "正在验证服务器和目标目录…"
        createTask = Task { @MainActor in
            defer {
                if createEpoch == ticket {
                    createBusy = false
                    createTask = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard createEpoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(
                        auth.owner, expectedOwner
                      ), verified else { return }
                // A nested folder must remain an authorized current directory.
                if folderID != expectedOwner.rootNodeID {
                    let reader = XDriveIOSNativeFilesReader(
                        owner: auth.owner, accessToken: auth.accessToken
                    )
                    // Exact GET semantics are checked by the Go Server on POST;
                    // this read makes the target current before any write.
                    _ = reader
                    guard folderName != nil else { return }
                }
                _ = try await XDriveIOSNativeFilesDirectoryCreator(
                    owner: auth.owner, accessToken: auth.accessToken
                ).create(parentID: folderID, name: name)
                try Task.checkCancellation()
                let afterward = try await login.verifiedAuthorization()
                guard createEpoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(
                        afterward.owner, expectedOwner
                      ), verified else { return }
                createNotice = "服务器已确认创建文件夹。"
                finishConfirmed()
            } catch is CancellationError {
                if createEpoch == ticket {
                    createNotice = "已取消；如果请求已经发出，请刷新核对。"
                }
            } catch {
                guard createEpoch == ticket else { return }
                if let failure = error as? XDriveIOSNativeFilesCreateError {
                    switch failure {
                    case .server(409):
                        createNotice = "同名文件夹已经存在，请更换名称。"
                    case .server(401), .server(403), .server(404), .invalidOwner:
                        createNotice = "当前目录或账户已变化，未确认创建。"
                    default:
                        createNotice = "创建结果未确认，请先刷新目录核对。"
                    }
                } else {
                    createNotice = "创建结果未确认，请先刷新目录核对。"
                }
            }
        }
    }
}

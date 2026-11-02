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
    let directory: XDriveIOSNativeFilesNode?
    let onConfirmed: @MainActor () -> Void

    @Environment(\.dismiss) private var dismiss
    @StateObject private var exporter = XDriveIOSNativeFilesExportModel()
    @StateObject private var folderArchive = XDriveIOSNativeFilesFolderArchiveModel()
    @StateObject private var uploader = XDriveIOSNativeFilesManualUploadModel()
    @StateObject private var mutator = XDriveIOSNativeFilesMutationModel()
    @StateObject private var favoriteMutation = XDriveIOSNativeFilesFavoriteMutationModel()
    @StateObject private var destinationWriter =
        XDriveIOSNativeFilesDestinationMutationModel()
    @State private var showingImporter = false
    @State private var showingMultiImporter = false
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
    @State private var shareNode: XDriveIOSNativeFilesNode?

    private var verified: Bool {
        XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner)
    }
    private var anyBusy: Bool {
        createBusy || exporter.busy || folderArchive.busy || uploader.busy ||
            mutator.busy || destinationWriter.busy || favoriteMutation.busy
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
                    Section("收藏夹") {
                        Button("收藏此文件") {
                            favoriteMutation.add(file, login: login)
                        }
                        .disabled(anyBusy)
                        .accessibilityIdentifier("native-ios-files-add-favorite")
                        if let status = favoriteMutation.status {
                            Text(status).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    Section("云端分享链接") {
                        Button("管理分享链接") { shareNode = file }
                            .disabled(anyBusy)
                            .accessibilityIdentifier("native-ios-files-share-file")
                        Text("创建或撤销浏览器可访问的云端链接；不同于下载原件后进行系统分享。")
                            .font(.footnote).foregroundStyle(.secondary)
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
                            Text("单文件导出最大 1 GiB，需足够暂存空间；不支持后台下载。")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        if exporter.busy {
                            Button("取消当前下载", role: .cancel) {
                                exporter.cancelCurrentTransfer()
                            }
                            .accessibilityIdentifier("native-ios-files-download-cancel")
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
                        Text("多选批量管理请返回文件列表使用“多选”；后台传输尚未提供。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                } else if let directory {
                    Section("文件夹信息") {
                        LabeledContent("名称", value: directory.name)
                        LabeledContent("版本", value: String(directory.revision))
                    }
                    Section("云端分享链接") {
                        Button("管理分享链接") { shareNode = directory }
                            .disabled(anyBusy)
                            .accessibilityIdentifier("native-ios-files-share-folder")
                        Text("可创建只读或查看并上传的云端文件夹分享链接。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    Section("下载文件夹 ZIP") {
                        if let archive = folderArchive.prepared {
                            ShareLink(item: archive.fileURL) {
                                Label("存储 ZIP 到“文件”或分享",
                                      systemImage: "square.and.arrow.up")
                            }
                            .accessibilityIdentifier("native-ios-files-folder-zip-share")
                            Text("服务器已生成 ZIP，仍须在系统界面选择保存位置。")
                                .font(.footnote).foregroundStyle(.secondary)
                        } else {
                            Button(folderArchive.busy ? "正在准备 ZIP…" : "下载并导出文件夹 ZIP") {
                                folderArchive.prepare(directory, login: login,
                                                      expectedOwner: expectedOwner)
                            }
                            .disabled(anyBusy)
                            .accessibilityIdentifier("native-ios-files-folder-zip-download")
                        }
                        Text("前台限源文件合计 512 MiB 和最多 2048 个文件；需至少 768 MiB 本机暂存空间。")
                            .font(.footnote).foregroundStyle(.secondary)
                        if folderArchive.busy {
                            Button("取消 ZIP 下载", role: .cancel) {
                                folderArchive.cancelCurrentTransfer()
                            }
                            .accessibilityIdentifier("native-ios-files-folder-zip-cancel")
                        }
                        if let status = folderArchive.status {
                            Text(status).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    Section("文件夹管理") {
                        Button("复制文件夹到…") {
                            destinationIntent = .init(node: directory, kind: .copy)
                        }
                        .disabled(anyBusy)
                        .accessibilityIdentifier("native-ios-files-copy-folder-to")
                        Button("移动文件夹到…") {
                            destinationIntent = .init(node: directory, kind: .move)
                        }
                        .disabled(anyBusy)
                        .accessibilityIdentifier("native-ios-files-move-folder-to")
                        Button("重命名文件夹") {
                            renameDraft = directory.name
                            showingRename = true
                        }
                        .disabled(anyBusy)
                        .alert("重命名文件夹", isPresented: $showingRename) {
                            TextField("新文件夹名称", text: $renameDraft)
                            Button("保存") {
                                mutator.perform(node: directory,
                                                kind: .rename(renameDraft),
                                                login: login,
                                                onConfirmed: finishConfirmed)
                            }
                            Button("取消", role: .cancel) {}
                        } message: {
                            Text("只更改当前文件夹的名称；服务器将核对版本和同名冲突。")
                        }
                        .accessibilityIdentifier("native-ios-files-rename-folder")
                        Button("将文件夹移入回收站", role: .destructive) {
                            showingTrash = true
                        }
                        .disabled(anyBusy)
                        .confirmationDialog(
                            "将“\(directory.name)”及其子文件移入回收站？",
                            isPresented: $showingTrash, titleVisibility: .visible
                        ) {
                            Button("确认移入回收站", role: .destructive) {
                                mutator.perform(node: directory, kind: .trash,
                                                login: login,
                                                onConfirmed: finishConfirmed)
                            }
                        } message: {
                            Text("会影响这个文件夹中的全部内容及其共享链接；结果未确认时先刷新核对。")
                        }
                        .accessibilityIdentifier("native-ios-files-trash-folder")
                        if let status = mutator.status {
                            Text(status).font(.footnote).foregroundStyle(.secondary)
                        }
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
                        Button("从 iOS“文件”批量上传（最多 8 项）") {
                            showingMultiImporter = true
                        }
                        .disabled(anyBusy)
                        .fileImporter(
                            isPresented: $showingMultiImporter,
                            allowedContentTypes: [.item],
                            allowsMultipleSelection: true
                        ) { result in
                            switch result {
                            case .success(let pickedURLs):
                                guard verified else {
                                    uploader.pickerFailed()
                                    return
                                }
                                uploader.start(
                                    files: pickedURLs, login: login,
                                    parentID: folderID, expectedFolderName: folderName,
                                    onConfirmed: finishConfirmed
                                )
                            case .failure:
                                uploader.pickerFailed()
                            }
                        }
                        .accessibilityIdentifier("native-ios-files-manual-batch-upload")
                        Text("单文件最大 1 GiB（需足够本机暂存空间）；批量最多 8 个文件，逐项核对收据。失败或结果未知时停止后续上传。")
                            .font(.footnote).foregroundStyle(.secondary)
                        if uploader.busy {
                            Button("取消当前上传", role: .cancel) {
                                uploader.cancelCurrentTransfer()
                            }
                            .accessibilityIdentifier("native-ios-files-upload-cancel")
                        }
                        if let status = uploader.status {
                            Text(status).font(.footnote).foregroundStyle(.secondary)
                        }
                        if let createNotice {
                            Text(createNotice).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .navigationTitle(file?.name ?? directory?.name ?? "文件夹操作")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                        .disabled(anyBusy)
                }
            }
            .sheet(item: $shareNode) { selected in
                if verified {
                    XDriveIOSNativeFilesShareScreen(
                        login: login, expectedOwner: expectedOwner, node: selected
                    )
                } else {
                    Text("当前账户已变化，请关闭后重新选择文件。")
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
        showingMultiImporter = false
        destinationIntent = nil
        shareNode = nil
        exporter.invalidate()
        folderArchive.invalidate()
        uploader.invalidate()
        mutator.invalidate()
        destinationWriter.invalidate()
        favoriteMutation.invalidate()
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
                // The Server revalidates the current Owner's directory ACL
                // and its actual existence inside createDirectory. A path
                // hint from earlier navigation is never independent authority.
                guard folderID == expectedOwner.rootNodeID || folderName != nil
                else { return }
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

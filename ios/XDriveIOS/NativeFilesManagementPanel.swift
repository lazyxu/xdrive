import Combine
import Foundation
import SwiftUI
import UIKit
import UniformTypeIdentifiers

private struct XDriveIOSNativeFilesManageDestinationIntent: Identifiable {
    let id = UUID()
    let node: XDriveIOSNativeFilesNode
    let kind: XDriveIOSNativeFilesDestinationKind
}

/// No context-menu action bypasses the existing verified Owner-scoped
/// operation or its destination / rename / destructive confirmation UI.
enum XDriveIOSNativeFilesQuickAction {
    case createFolder, uploadFile, uploadMultiple, copy, move, rename, favorite, shareLink, download, trash
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
    let initialQuickAction: XDriveIOSNativeFilesQuickAction?
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
    @State private var showingFolderImporter = false
    @State private var showingCreate = false
    @State private var showingRename = false
    @State private var showingTrash = false
    @State private var initialActionApplied = false
    @State private var folderDraft = ""
    @State private var renameDraft = ""
    @State private var createBusy = false
    @State private var createNotice: String?
    @State private var createEpoch = UUID()
    @State private var createTask: Task<Void, Never>?
    @State private var destinationIntent: XDriveIOSNativeFilesManageDestinationIntent?
    @State private var shareNode: XDriveIOSNativeFilesNode?
    @State private var copyPathEpoch = UUID()
    @State private var copyPathTask: Task<Void, Never>?
    @State private var copyPathBusy = false
    @State private var copyPathStatus: String?

    private var verified: Bool {
        XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner)
    }
    private var anyBusy: Bool {
        createBusy || exporter.busy || folderArchive.busy || uploader.busy ||
            mutator.busy || destinationWriter.busy || favoriteMutation.busy ||
            copyPathBusy
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
                        if let date = file.createdDate {
                            LabeledContent("创建时间",
                                           value: XDriveIOSNativeFilesDatePolicy.display(date))
                        }
                        if let date = file.modifiedDate {
                            LabeledContent("修改时间",
                                           value: XDriveIOSNativeFilesDatePolicy.display(date))
                        }
                    }
                    Section("标签") {
                        NavigationLink {
                            XDriveIOSNativeFilesTagPanel(
                                login: login, expectedOwner: expectedOwner,
                                nodeIDs: [file.id], selectionLabel: file.name
                            )
                        } label: {
                            Label("设置标签", systemImage: "tag")
                        }
                        .disabled(anyBusy)
                        .accessibilityIdentifier("native-ios-files-manage-tags")
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
                        if let date = directory.createdDate {
                            LabeledContent("创建时间",
                                           value: XDriveIOSNativeFilesDatePolicy.display(date))
                        }
                        if let date = directory.modifiedDate {
                            LabeledContent("修改时间",
                                           value: XDriveIOSNativeFilesDatePolicy.display(date))
                        }
                    }
                    Section("标签") {
                        NavigationLink {
                            XDriveIOSNativeFilesTagPanel(
                                login: login, expectedOwner: expectedOwner,
                                nodeIDs: [directory.id], selectionLabel: directory.name
                            )
                        } label: {
                            Label("设置标签", systemImage: "tag")
                        }
                        .disabled(anyBusy)
                        .accessibilityIdentifier("native-ios-files-manage-folder-tags")
                    }
                    Section("收藏夹") {
                        Button("收藏此文件夹") {
                            favoriteMutation.add(directory, login: login)
                        }
                        .disabled(anyBusy)
                        .accessibilityIdentifier("native-ios-files-add-folder-favorite")
                        if let status = favoriteMutation.status {
                            Text(status).font(.footnote).foregroundStyle(.secondary)
                        }
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

                        Button("从 iOS“文件”上传整个文件夹") {
                            showingFolderImporter = true
                        }
                        .disabled(anyBusy)
                        .fileImporter(
                            isPresented: $showingFolderImporter,
                            allowedContentTypes: [.folder]
                        ) { result in
                            switch result {
                            case .success(let pickedFolder):
                                guard verified else {
                                    uploader.pickerFailed()
                                    return
                                }
                                uploader.start(
                                    folderURL: pickedFolder, login: login,
                                    parentID: folderID, expectedFolderName: folderName,
                                    onConfirmed: finishConfirmed
                                )
                            case .failure:
                                uploader.pickerFailed()
                            }
                        }
                        .accessibilityIdentifier("native-ios-files-folder-upload")
                        Text("完整保留选中文件夹及子目录。前台最多 64 个文件、32 个目录、总计 256 MiB、8 层；先完成整棵目录检查，失败不自动重传。")
                            .font(.footnote).foregroundStyle(.secondary)
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
                if verified, let selected = file ?? directory {
                    Section("云端路径") {
                        Button {
                            copyCurrentPath(selected)
                        } label: {
                            Label(copyPathBusy ? "正在核对路径…" : "复制路径",
                                  systemImage: "doc.on.doc")
                        }
                        .disabled(anyBusy)
                        .accessibilityIdentifier("native-ios-files-copy-path")
                        if let copyPathStatus {
                            Text(copyPathStatus)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .accessibilityIdentifier("native-ios-files-copy-path-status")
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
        .onAppear { applyInitialQuickAction() }
        .onDisappear { invalidate() }
        .onChange(of: login.owner) { _ in
            if !verified {
                invalidate()
                dismiss()
            }
        }
    }

    /// The current-directory shortcuts open the same native alert/importers
    /// already used by the management screen. No new upload or create writer,
    /// and never use a guessed root or a stale Owner identity.
    /// File and folder quick actions keep their existing version checks and
    /// explicit confirmation where appropriate.
    @MainActor
    private func applyInitialQuickAction() {
        guard !initialActionApplied else { return }
        initialActionApplied = true
        guard verified, !anyBusy, let initialQuickAction else { return }
        switch initialQuickAction {
        case .createFolder:
            guard file == nil, directory == nil else { return }
            folderDraft = ""
            showingCreate = true
        case .uploadFile:
            guard file == nil, directory == nil else { return }
            showingImporter = true
        case .uploadMultiple:
            guard file == nil, directory == nil else { return }
            showingMultiImporter = true
        case .copy, .move, .rename, .favorite, .shareLink, .download, .trash:
            guard let selected = file ?? directory else { return }
            switch initialQuickAction {
            case .copy:
                destinationIntent = .init(node: selected, kind: .copy)
            case .move:
                destinationIntent = .init(node: selected, kind: .move)
            case .rename:
                renameDraft = selected.name
                showingRename = true
            case .favorite:
                // Reuse the existing Owner/Node revision checked writer.
                favoriteMutation.add(selected, login: login)
            case .shareLink:
                shareNode = selected
            case .download:
                if let file {
                    exporter.prepare(file, login: login)
                } else if let directory {
                    folderArchive.prepare(
                        directory, login: login, expectedOwner: expectedOwner
                    )
                }
            case .trash:
                showingTrash = true
            case .createFolder, .uploadFile, .uploadMultiple:
                return
            }
        }
    }

    @MainActor
    private func finishConfirmed() {
        dismiss()
        onConfirmed()
    }

    private func invalidate() {
        copyPathEpoch = UUID()
        copyPathTask?.cancel()
        copyPathTask = nil
        copyPathBusy = false
        copyPathStatus = nil
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
        showingFolderImporter = false
        destinationIntent = nil
        shareNode = nil
        exporter.invalidate()
        folderArchive.invalidate()
        uploader.invalidate()
        mutator.invalidate()
        destinationWriter.invalidate()
        favoriteMutation.invalidate()
    }

    /// Copy only the current Server-confirmed path, not a cached display hint.
    @MainActor
    private func copyCurrentPath(_ node: XDriveIOSNativeFilesNode) {
        guard verified, !anyBusy, file == node || directory == node else {
            copyPathStatus = "当前文件或账户不可用，请刷新。"
            return
        }
        let ticket = UUID()
        copyPathEpoch = ticket
        copyPathBusy = true
        copyPathStatus = "正在验证云端文件位置…"
        copyPathTask = Task { @MainActor in
            defer {
                if copyPathEpoch == ticket {
                    copyPathBusy = false
                    copyPathTask = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard copyPathEpoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(
                        auth.owner, expectedOwner
                      ), verified else { return }
                let currentPath = try await XDriveIOSNativeFilesLocateReader(
                    owner: auth.owner, accessToken: auth.accessToken
                ).copyPath(node)
                try Task.checkCancellation()
                let after = try await login.verifiedAuthorization()
                guard copyPathEpoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(
                        after.owner, expectedOwner
                      ), verified else { return }
                UIPasteboard.general.string = currentPath
                copyPathStatus = "已复制当前云端路径。"
            } catch is CancellationError {
                if copyPathEpoch == ticket { copyPathStatus = "已取消读取路径。" }
            } catch {
                if copyPathEpoch == ticket {
                    copyPathStatus = "未能确认当前云端路径，请刷新后重试。"
                }
            }
        }
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


// Native tag management mirrors the Web tag dialog's owner-scoped CRUD and
// assignment endpoints. The model supports up to 500 selected nodes so the
// same screen can be reused by the native batch-selection toolbar later.
private struct XDriveIOSNativeFilesTag: Decodable, Identifiable, Equatable {
    let id: UInt64
    let name: String
    let color: String?
    let itemCount: Int?
}

private struct XDriveIOSNativeFilesNodeTags: Decodable {
    let nodeID: UInt64
    let tags: [XDriveIOSNativeFilesTag]?
}

private struct XDriveIOSNativeFilesTagNodeIDs: Encodable {
    let nodeIDs: [UInt64]
}

private struct XDriveIOSNativeFilesTagPayload: Encodable {
    let name: String
    let color: String
}

private enum XDriveIOSNativeFilesTagFailure: Error {
    case invalidScope
    case invalidSelection
    case malformedReply
    case server(Int)
}

private struct XDriveIOSNativeFilesTagClient {
    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    private final class DenyRedirects: XDriveIOSServerTLSDelegate, URLSessionTaskDelegate, @unchecked Sendable {
        func urlSession(_ session: URLSession, task: URLSessionTask,
                        willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest,
                        completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(nil)
        }
    }

    private func endpoint(_ path: String) throws -> URL {
        guard owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty, !accessToken.isEmpty,
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin, path.hasPrefix("/api/v1/"),
              !path.contains("?"), !path.contains("#"),
              var components = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              components.scheme == "https" else {
            throw XDriveIOSNativeFilesTagFailure.invalidScope
        }
        components.path = path
        components.query = nil
        guard let url = components.url else {
            throw XDriveIOSNativeFilesTagFailure.invalidScope
        }
        return url
    }

    private func perform(_ path: String, method: String = "GET",
                         body: Data? = nil, accepted: Set<Int>) async throws -> Data {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 25
        let session = URLSession(configuration: config,
                                 delegate: DenyRedirects(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }

        var request = URLRequest(url: try endpoint(path))
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNativeFilesTagFailure.malformedReply
        }
        guard accepted.contains(http.statusCode) else {
            throw XDriveIOSNativeFilesTagFailure.server(http.statusCode)
        }
        guard data.count <= 2_097_152 else {
            throw XDriveIOSNativeFilesTagFailure.malformedReply
        }
        return data
    }

    private func decoder() -> JSONDecoder {
        let value = JSONDecoder()
        value.keyDecodingStrategy = .convertFromSnakeCase
        return value
    }

    private func encoder() -> JSONEncoder {
        let value = JSONEncoder()
        value.keyEncodingStrategy = .convertToSnakeCase
        return value
    }

    private func valid(_ tag: XDriveIOSNativeFilesTag) -> Bool {
        let name = tag.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let validColor = tag.color == nil || tag.color == "" ||
            (tag.color?.count == 7 && tag.color?.first == "#" &&
             Int(tag.color?.dropFirst() ?? "", radix: 16) != nil)
        return tag.id > 0 && !name.isEmpty && name.utf8.count <= 64 &&
            !name.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) &&
            validColor && (tag.itemCount == nil || tag.itemCount! >= 0)
    }

    func list() async throws -> [XDriveIOSNativeFilesTag] {
        let data = try await perform("/api/v1/file-tags", accepted: [200])
        let tags = try decoder().decode([XDriveIOSNativeFilesTag].self, from: data)
        guard tags.count <= 4096,
              tags.allSatisfy(valid),
              Set(tags.map(\.id)).count == tags.count else {
            throw XDriveIOSNativeFilesTagFailure.malformedReply
        }
        return tags
    }

    func query(nodeIDs: [UInt64]) async throws -> [XDriveIOSNativeFilesNodeTags] {
        guard !nodeIDs.isEmpty, nodeIDs.count <= 500,
              nodeIDs.allSatisfy({ $0 > 0 }),
              Set(nodeIDs).count == nodeIDs.count else {
            throw XDriveIOSNativeFilesTagFailure.invalidSelection
        }
        let body = try encoder().encode(XDriveIOSNativeFilesTagNodeIDs(nodeIDs: nodeIDs))
        let data = try await perform("/api/v1/nodes/tags/query",
                                     method: "POST", body: body, accepted: [200])
        let rows = try decoder().decode([XDriveIOSNativeFilesNodeTags].self, from: data)
        let rowIDs = rows.map(\.nodeID)
        guard rows.count == nodeIDs.count, Set(rowIDs) == Set(nodeIDs),
              rows.allSatisfy({ row in
                  (row.tags ?? []).allSatisfy(valid)
              }) else {
            throw XDriveIOSNativeFilesTagFailure.malformedReply
        }
        return rows
    }

    func create(name: String, color: String) async throws -> XDriveIOSNativeFilesTag {
        let body = try encoder().encode(XDriveIOSNativeFilesTagPayload(name: name, color: color))
        let data = try await perform("/api/v1/file-tags", method: "POST",
                                     body: body, accepted: [200, 201])
        let tag = try decoder().decode(XDriveIOSNativeFilesTag.self, from: data)
        guard valid(tag), tag.name == name, tag.color == color else {
            throw XDriveIOSNativeFilesTagFailure.malformedReply
        }
        return tag
    }

    func update(id: UInt64, name: String, color: String) async throws {
        guard id > 0 else { throw XDriveIOSNativeFilesTagFailure.invalidSelection }
        let body = try encoder().encode(XDriveIOSNativeFilesTagPayload(name: name, color: color))
        let data = try await perform("/api/v1/file-tags/\(id)", method: "PATCH",
                                     body: body, accepted: [200])
        let tag = try decoder().decode(XDriveIOSNativeFilesTag.self, from: data)
        guard valid(tag), tag.id == id, tag.name == name, tag.color == color else {
            throw XDriveIOSNativeFilesTagFailure.malformedReply
        }
    }

    func delete(id: UInt64) async throws {
        guard id > 0 else { throw XDriveIOSNativeFilesTagFailure.invalidSelection }
        _ = try await perform("/api/v1/file-tags/\(id)", method: "DELETE",
                              accepted: [200, 204])
    }

    func setNodes(tagID: UInt64, nodeIDs: [UInt64], assigned: Bool) async throws {
        guard tagID > 0, !nodeIDs.isEmpty, nodeIDs.count <= 500,
              nodeIDs.allSatisfy({ $0 > 0 }), Set(nodeIDs).count == nodeIDs.count else {
            throw XDriveIOSNativeFilesTagFailure.invalidSelection
        }
        let body = try encoder().encode(XDriveIOSNativeFilesTagNodeIDs(nodeIDs: nodeIDs))
        let method = assigned ? "PUT" : "DELETE"
        _ = try await perform("/api/v1/file-tags/\(tagID)/nodes", method: method,
                              body: body, accepted: [200, 204])
    }
}

@MainActor
private final class XDriveIOSNativeFilesTagModel: ObservableObject {
    @Published private(set) var tags: [XDriveIOSNativeFilesTag] = []
    @Published private(set) var assignedCounts: [UInt64: Int] = [:]
    @Published private(set) var loading = false
    @Published private(set) var busy = false
    @Published private(set) var status: String?

    private let login: XDriveIOSNativeOwnerLoginModel
    private let expectedOwner: XDriveNativeOwnerRoot
    private let nodeIDs: [UInt64]
    private var epoch = UUID()
    private var task: Task<Void, Never>?

    init(login: XDriveIOSNativeOwnerLoginModel,
         expectedOwner: XDriveNativeOwnerRoot, nodeIDs: [UInt64]) {
        self.login = login
        self.expectedOwner = expectedOwner
        self.nodeIDs = nodeIDs
    }

    func invalidate() {
        epoch = UUID()
        task?.cancel()
        task = nil
        loading = false
        busy = false
    }

    private func client(ticket: UUID) async throws -> XDriveIOSNativeFilesTagClient {
        let credentials = try await login.verifiedAuthorization()
        try Task.checkCancellation()
        guard epoch == ticket,
              XDriveIOSNativePhotoOwnerScope.matches(credentials.owner, expectedOwner),
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner) else {
            throw XDriveIOSNativeFilesTagFailure.invalidScope
        }
        return XDriveIOSNativeFilesTagClient(
            owner: credentials.owner, accessToken: credentials.accessToken
        )
    }

    private func verify(ticket: UUID) async throws {
        let credentials = try await login.verifiedAuthorization()
        try Task.checkCancellation()
        guard epoch == ticket,
              XDriveIOSNativePhotoOwnerScope.matches(credentials.owner, expectedOwner),
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner) else {
            throw XDriveIOSNativeFilesTagFailure.invalidScope
        }
    }

    private func reload(ticket: UUID, client: XDriveIOSNativeFilesTagClient) async throws {
        async let nextTags = client.list()
        async let nextRows = client.query(nodeIDs: nodeIDs)
        let (loadedTags, rows) = try await (nextTags, nextRows)
        try await verify(ticket: ticket)
        var counts: [UInt64: Int] = [:]
        for row in rows {
            for tag in row.tags ?? [] {
                counts[tag.id, default: 0] += 1
            }
        }
        tags = loadedTags
        assignedCounts = counts
    }

    private func run(loading shouldLoad: Bool, message: String,
                     operation: @escaping @MainActor (UUID) async throws -> Void) {
        guard !loading, !busy else { return }
        let ticket = UUID()
        epoch = ticket
        if shouldLoad { loading = true } else { busy = true }
        status = message
        task = Task { @MainActor in
            defer {
                if epoch == ticket {
                    loading = false
                    busy = false
                    task = nil
                }
            }
            do {
                try await operation(ticket)
            } catch is CancellationError {
                if epoch == ticket {
                    status = shouldLoad
                        ? "加载已取消。"
                        : "操作结果未确认；请刷新核对，不要直接重复操作。"
                }
            } catch {
                guard epoch == ticket else { return }
                if shouldLoad {
                    status = "标签加载失败，请检查网络后刷新。"
                } else {
                    status = "标签操作结果未确认，请刷新核对后再继续。"
                }
            }
        }
    }

    func load() {
        guard !nodeIDs.isEmpty, nodeIDs.count <= 500,
              nodeIDs.allSatisfy({ $0 > 0 }), Set(nodeIDs).count == nodeIDs.count else {
            status = "所选文件无效，或一次选择超过 500 项。"
            return
        }
        run(loading: true, message: "正在加载标签…") { ticket in
            let client = try await self.client(ticket: ticket)
            try await self.reload(ticket: ticket, client: client)
            self.status = "已加载 \(self.tags.count) 个标签。"
        }
    }

    func assignedCount(for tagID: UInt64) -> Int {
        min(max(0, assignedCounts[tagID, default: 0]), nodeIDs.count)
    }

    func toggle(_ tagID: UInt64) {
        let shouldAssign = assignedCount(for: tagID) < nodeIDs.count
        run(loading: false, message: shouldAssign ? "正在应用标签…" : "正在移除标签…") { ticket in
            let client = try await self.client(ticket: ticket)
            try await client.setNodes(tagID: tagID, nodeIDs: self.nodeIDs,
                                      assigned: shouldAssign)
            try await self.reload(ticket: ticket, client: client)
            self.status = shouldAssign ? "标签已应用。" : "标签已从所选项目移除。"
        }
    }

    func create(name: String, color: String) {
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, clean.utf8.count <= 64,
              !clean.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
              color.count == 7, color.first == "#",
              Int(color.dropFirst(), radix: 16) != nil else {
            status = "标签名称不能为空且最多 64 个 UTF-8 字节；颜色必须为 #RRGGBB。"
            return
        }
        run(loading: false, message: "正在创建并应用标签…") { ticket in
            let client = try await self.client(ticket: ticket)
            let created = try await client.create(name: clean, color: color)
            try await client.setNodes(tagID: created.id, nodeIDs: self.nodeIDs,
                                      assigned: true)
            try await self.reload(ticket: ticket, client: client)
            self.status = "标签已创建并应用。"
        }
    }

    func update(id: UInt64, name: String, color: String) {
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, clean.utf8.count <= 64,
              !clean.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
              color.count == 7, color.first == "#",
              Int(color.dropFirst(), radix: 16) != nil else {
            status = "标签名称不能为空且最多 64 个 UTF-8 字节；颜色必须为 #RRGGBB。"
            return
        }
        run(loading: false, message: "正在保存标签…") { ticket in
            let client = try await self.client(ticket: ticket)
            try await client.update(id: id, name: clean, color: color)
            try await self.reload(ticket: ticket, client: client)
            self.status = "标签已更新。"
        }
    }

    func delete(_ tagID: UInt64) {
        run(loading: false, message: "正在删除标签…") { ticket in
            let client = try await self.client(ticket: ticket)
            try await client.delete(id: tagID)
            try await self.reload(ticket: ticket, client: client)
            self.status = "标签已删除。"
        }
    }
}

/// Reused by single-node management and the native Files batch selection.
struct XDriveIOSNativeFilesTagPanel: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let expectedOwner: XDriveNativeOwnerRoot
    let nodeIDs: [UInt64]
    let selectionLabel: String

    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: XDriveIOSNativeFilesTagModel
    @State private var nameDraft = ""
    @State private var colorDraft = "#2563EB"
    @State private var editingTagID: UInt64?
    @State private var deleteTarget: XDriveIOSNativeFilesTag?
    @State private var showingDeleteConfirmation = false

    private let palette: [(String, String)] = [
        ("灰色", "#6B7280"), ("蓝色", "#2563EB"), ("绿色", "#059669"),
        ("橙色", "#D97706"), ("红色", "#DC2626"), ("紫色", "#7C3AED"),
        ("粉色", "#DB2777")
    ]

    init(login: XDriveIOSNativeOwnerLoginModel,
         expectedOwner: XDriveNativeOwnerRoot,
         nodeIDs: [UInt64], selectionLabel: String) {
        self.login = login
        self.expectedOwner = expectedOwner
        self.nodeIDs = nodeIDs
        self.selectionLabel = selectionLabel
        _model = StateObject(wrappedValue: XDriveIOSNativeFilesTagModel(
            login: login, expectedOwner: expectedOwner, nodeIDs: nodeIDs
        ))
    }

    private func swatch(_ hex: String) -> Color {
        guard hex.count == 7, let value = UInt32(hex.dropFirst(), radix: 16) else {
            return .gray
        }
        return Color(
            red: Double((value >> 16) & 0xff) / 255,
            green: Double((value >> 8) & 0xff) / 255,
            blue: Double(value & 0xff) / 255
        )
    }

    var body: some View {
        Form {
            Section("选择范围") {
                Text(selectionLabel)
                Text("\(nodeIDs.count) 个文件或文件夹")
                    .font(.footnote).foregroundStyle(.secondary)
                Text("支持一次为最多 500 个项目分配标签。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section("已有标签") {
                if model.loading {
                    ProgressView("正在加载标签…")
                } else if model.tags.isEmpty {
                    Text("还没有标签，可以在下方创建。")
                        .foregroundStyle(.secondary)
                }
                ForEach(model.tags) { tag in
                    HStack(spacing: 10) {
                        Button {
                            model.toggle(tag.id)
                        } label: {
                            HStack(spacing: 10) {
                                Circle().fill(swatch(tag.color ?? "#6B7280"))
                                    .frame(width: 10, height: 10)
                                Text(tag.name)
                                Spacer()
                                let count = model.assignedCount(for: tag.id)
                                if count == nodeIDs.count {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(.tint)
                                } else if count > 0 {
                                    Image(systemName: "minus.circle")
                                        .foregroundStyle(.secondary)
                                }
                                Text("\(count)/\(nodeIDs.count)")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .buttonStyle(.plain)
                        .disabled(model.loading || model.busy)
                        Menu {
                            Button("编辑") {
                                editingTagID = tag.id
                                nameDraft = tag.name
                                colorDraft = tag.color ?? "#6B7280"
                            }
                            Button("删除", role: .destructive) {
                                deleteTarget = tag
                                showingDeleteConfirmation = true
                            }
                        } label: {
                            Image(systemName: "ellipsis")
                                .frame(width: 32, height: 32)
                        }
                        .disabled(model.loading || model.busy)
                    }
                    .accessibilityIdentifier("native-ios-files-tag-row-\(tag.id)")
                }
            }
            Section(editingTagID == nil ? "新建标签" : "编辑标签") {
                TextField("标签名称", text: $nameDraft)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Picker("颜色", selection: $colorDraft) {
                    ForEach(palette, id: \.1) { item in
                        HStack {
                            Circle().fill(swatch(item.1)).frame(width: 10, height: 10)
                            Text(item.0)
                        }.tag(item.1)
                    }
                }
                Button(editingTagID == nil ? "创建并应用" : "保存修改") {
                    if let id = editingTagID {
                        model.update(id: id, name: nameDraft, color: colorDraft)
                    } else {
                        model.create(name: nameDraft, color: colorDraft)
                    }
                    nameDraft = ""
                    editingTagID = nil
                }
                .disabled(model.loading || model.busy || nameDraft.trimmingCharacters(
                    in: .whitespacesAndNewlines
                ).isEmpty)
                .accessibilityIdentifier("native-ios-files-tag-save")
                if editingTagID != nil {
                    Button("取消编辑", role: .cancel) {
                        editingTagID = nil
                        nameDraft = ""
                        colorDraft = "#2563EB"
                    }
                    .disabled(model.busy)
                }
            }
            if let status = model.status {
                Section("状态") {
                    Text(status).font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("标签")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("刷新") { model.load() }
                    .disabled(model.loading || model.busy)
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("完成") { dismiss() }
            }
        }
        .task { model.load() }
        .onDisappear { model.invalidate() }
        .alert("删除标签", isPresented: $showingDeleteConfirmation) {
            Button("删除", role: .destructive) {
                if let tag = deleteTarget { model.delete(tag.id) }
                deleteTarget = nil
            }
            Button("取消", role: .cancel) { deleteTarget = nil }
        } message: {
            Text("删除标签不会删除文件；该标签将从所有已关联项目中移除。")
        }
        .accessibilityIdentifier("native-ios-files-tag-management")
    }
}

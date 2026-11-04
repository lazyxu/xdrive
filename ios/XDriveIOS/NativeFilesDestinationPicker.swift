import Foundation
import SwiftUI

/// A destination is only a navigation hint until its own current Owner page
/// has been verified. No destination from a previous Owner is reusable.
struct XDriveIOSNativeFilesDestination: Hashable, Identifiable {
    let id: UInt64
    let name: String
}


struct XDriveIOSNativeFilesDestinationPicker: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let originalOwner: XDriveNativeOwnerRoot
    let selected: XDriveIOSNativeFilesNode
    // Default keeps existing single-node callers source-compatible.
    var selectedItems: [XDriveIOSNativeFilesNode] = []
    let kind: XDriveIOSNativeFilesDestinationKind
    let onChoose: (XDriveIOSNativeFilesDestination) -> Void

    @State private var path: [XDriveIOSNativeFilesDestination] = []

    var body: some View {
        NavigationStack(path: $path) {
            XDriveIOSNativeFilesDestinationPage(
                login: login, originalOwner: originalOwner,
                folder: .init(id: originalOwner.rootNodeID, name: "云端根目录"),
                selected: selected, selectedItems: selectedItems,
                kind: kind, onChoose: onChoose,
                onCreated: { destination in path.append(destination) }
            )
        }
    }
}

/// A real 64-item counted directory Range is the ONLY source of target folders.
/// Every pushed page owns a separate native navigation state and cancels on exit.
private struct XDriveIOSNativeFilesDestinationPage: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let originalOwner: XDriveNativeOwnerRoot
    let folder: XDriveIOSNativeFilesDestination
    let selected: XDriveIOSNativeFilesNode
    // Default keeps existing single-node callers source-compatible.
    var selectedItems: [XDriveIOSNativeFilesNode] = []
    let kind: XDriveIOSNativeFilesDestinationKind
    let onChoose: (XDriveIOSNativeFilesDestination) -> Void
    let onCreated: (XDriveIOSNativeFilesDestination) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var page: XDriveIOSNativeFilesRange?
    @State private var offset = 0
    @State private var busy = false
    @State private var failure: String?
    @State private var epoch = UUID()
    @State private var work: Task<Void, Never>?
    @State private var showingCreate = false
    @State private var folderDraft = ""
    @State private var creating = false
    @State private var createStatus: String?
    @State private var creationEpoch = UUID()
    @State private var creationTask: Task<Void, Never>?

    private var allSelected: [XDriveIOSNativeFilesNode] {
        selectedItems.isEmpty ? [selected] : selectedItems
    }

    private var canUseTarget: Bool {
        page != nil && !busy && failure == nil && !creating &&
            XDriveIOSNativePhotoOwnerScope.matches(login.owner, originalOwner) &&
            !allSelected.contains(where: { $0.isDirectory && $0.id == folder.id }) &&
            !(kind == .move && allSelected.contains(where: { $0.parent_id == folder.id }))
    }

    private var canCreateFolder: Bool {
        page != nil && !busy && failure == nil && !creating &&
            XDriveIOSNativePhotoOwnerScope.matches(login.owner, originalOwner)
    }

    var body: some View {
        List {
            Section("当前目标目录") {
                Label(folder.name, systemImage: "folder")
                    .font(.headline)
                Button(kind.confirmLabel) {
                    guard canUseTarget else { return }
                    onChoose(folder)
                }
                .disabled(!canUseTarget)
                .frame(minHeight: 44)
                .accessibilityIdentifier("native-ios-files-destination-confirm")
                if kind == .move && allSelected.contains(where: { $0.parent_id == folder.id }) {
                    Text("文件已在这个目录，不能重复移动。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if creating {
                    ProgressView("正在创建文件夹…")
                }
                if let createStatus {
                    Text(createStatus).font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("native-ios-files-destination-create-status")
                }
            }
            Section("子文件夹") {
                if busy {
                    ProgressView("正在验证目录…")
                } else if let failure {
                    Text(failure).foregroundStyle(.secondary)
                    Button("重试") { load() }
                } else if let page {
                    ForEach(page.items.filter(\.isDirectory)) { entry in
                        NavigationLink(value: XDriveIOSNativeFilesDestination(
                            id: entry.id, name: entry.name
                        )) {
                            Label(entry.name, systemImage: "folder.fill")
                                .frame(minHeight: 44, alignment: .leading)
                        }
                        // Prevent entering this folder or any of its
                        // descendants as a copy/move destination. The Server
                        // also rejects cycles if the tree changes after GET.
                        .disabled(creating ||
                            allSelected.contains(where: { $0.isDirectory && $0.id == entry.id }))
                    }
                    if !page.items.contains(where: \.isDirectory) {
                        Text("本页没有子文件夹")
                            .foregroundStyle(.secondary)
                    }
                    HStack {
                        Button("上一页") {
                            offset = max(0, offset - XDriveIOSNativeFilesPagePolicy.pageSize)
                            load()
                        }
                        .disabled(busy || creating || offset == 0)
                        Spacer()
                        Text("\(offset + page.items.count) / \(page.total_count)")
                            .font(.footnote.monospacedDigit())
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button("下一页") {
                            offset += XDriveIOSNativeFilesPagePolicy.pageSize
                            load()
                        }
                        .disabled(busy || creating ||
                            offset + page.items.count >= page.total_count)
                    }
                } else {
                    Text("尚未验证当前目录").foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle(kind.title)
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: XDriveIOSNativeFilesDestination.self) { target in
            XDriveIOSNativeFilesDestinationPage(
                login: login, originalOwner: originalOwner,
                folder: target, selected: selected, selectedItems: selectedItems,
                kind: kind, onChoose: onChoose, onCreated: onCreated
            )
        }
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button {
                        folderDraft = ""
                        createStatus = nil
                        showingCreate = true
                    } label: {
                        Label("新建文件夹", systemImage: "folder.badge.plus")
                    }
                    .disabled(!canCreateFolder)
                    .accessibilityIdentifier("native-ios-files-destination-create")
                    Button { load() } label: {
                        Label("刷新", systemImage: "arrow.clockwise")
                    }
                    .disabled(busy || creating)
                } label: {
                    Label("更多", systemImage: "ellipsis.circle")
                }
            }
        }
        .alert("新建文件夹", isPresented: $showingCreate) {
            TextField("文件夹名称", text: $folderDraft)
            Button("创建") { createFolder() }
            Button("取消", role: .cancel) {}
        } message: {
            Text("在当前目标目录新建文件夹；创建后进入新目录，再选择复制或移动。")
        }
        .onAppear { load() }
        .onDisappear { invalidate() }
        .onChange(of: login.owner) { _ in invalidate() }
    }

    /// Do not reuse an unverified folder or issue a copy/move automatically:
    /// navigate to the created ID only after the actual Server 201 receipt,
    /// and let the next page verify its children before enabling confirmation.
    private func createFolder() {
        guard canCreateFolder else { return }
        guard let name = XDriveIOSNativeFilesFolderNamePolicy.normalized(folderDraft) else {
            createStatus = "文件夹名称不符合规范，请修改后重试。"
            return
        }

        let ticket = UUID()
        creationEpoch = ticket
        creating = true
        createStatus = nil
        creationTask = Task { @MainActor in
            defer {
                if creationEpoch == ticket {
                    creating = false
                    creationTask = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard creationEpoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, originalOwner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, originalOwner)
                else { return }

                let createdID = try await XDriveIOSNativeFilesDirectoryCreator(
                    owner: auth.owner, accessToken: auth.accessToken
                ).create(parentID: folder.id, name: name)
                try Task.checkCancellation()
                let after = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard creationEpoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(after.owner, originalOwner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, originalOwner)
                else { return }
                onCreated(XDriveIOSNativeFilesDestination(id: createdID, name: name))
            } catch is CancellationError {
                if creationEpoch == ticket {
                    createStatus = "创建可能已提交，请先刷新目录核对，不要重复提交。"
                }
            } catch {
                guard creationEpoch == ticket else { return }
                if let failure = error as? XDriveIOSNativeFilesCreateError {
                    switch failure {
                    case .server(409):
                        createStatus = "同名文件夹已存在，请更换名称。"
                    case .server(401), .server(403), .server(404), .invalidOwner:
                        createStatus = "账户或目录已变化，无法确认创建。"
                    default:
                        createStatus = "创建结果未确认，请先刷新目录核对，勿盲目重试。"
                    }
                } else {
                    createStatus = "创建结果未确认，请先刷新目录核对，勿盲目重试。"
                }
            }
        }
    }

    private func invalidate() {
        epoch = UUID()
        work?.cancel()
        work = nil
        creationEpoch = UUID()
        creationTask?.cancel()
        creationTask = nil
        showingCreate = false
        creating = false
        createStatus = nil
        page = nil
        busy = false
        failure = nil
    }

    private func load() {
        invalidate()
        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, originalOwner) else {
            failure = "当前账户已变化，请关闭后重新选择目标目录。"
            return
        }
        let ticket = epoch
        busy = true
        work = Task { @MainActor in
            defer { if epoch == ticket { busy = false; work = nil } }
            do {
                let credentials = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(
                        credentials.owner, originalOwner
                      ), XDriveIOSNativePhotoOwnerScope.matches(
                        login.owner, originalOwner
                      ) else { return }
                let reader = XDriveIOSNativeFilesReader(
                    owner: credentials.owner, accessToken: credentials.accessToken
                )
                let response = try await reader.children(
                    parentID: folder.id, offset: offset, sort: "name", order: "asc"
                )
                try Task.checkCancellation()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, originalOwner)
                else { return }
                page = response
            } catch is CancellationError {
            } catch {
                guard epoch == ticket else { return }
                page = nil
                failure = "无法验证目标目录或其权限，请返回上一层或重试。"
            }
        }
    }
}

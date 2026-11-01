import Foundation
import SwiftUI

/// A destination is only a navigation hint until its own current Owner page
/// has been verified. No destination from a previous Owner is reusable.
struct XDriveIOSNativeFilesDestination: Hashable, Identifiable {
    let id: UInt64
    let name: String
}

enum XDriveIOSNativeFilesDestinationKind: String, Equatable {
    case copy, move

    var title: String { self == .copy ? "复制到…" : "移动到…" }
    var confirmLabel: String { self == .copy ? "复制到此文件夹" : "移动到此文件夹" }
}

struct XDriveIOSNativeFilesDestinationPicker: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let originalOwner: XDriveNativeOwnerRoot
    let selected: XDriveIOSNativeFilesNode
    let kind: XDriveIOSNativeFilesDestinationKind
    let onChoose: (XDriveIOSNativeFilesDestination) -> Void

    var body: some View {
        NavigationStack {
            XDriveIOSNativeFilesDestinationPage(
                login: login, originalOwner: originalOwner,
                folder: .init(id: originalOwner.rootNodeID, name: "云端根目录"),
                selected: selected, kind: kind, onChoose: onChoose
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
    let kind: XDriveIOSNativeFilesDestinationKind
    let onChoose: (XDriveIOSNativeFilesDestination) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var page: XDriveIOSNativeFilesRange?
    @State private var offset = 0
    @State private var busy = false
    @State private var failure: String?
    @State private var epoch = UUID()
    @State private var work: Task<Void, Never>?

    private var canUseTarget: Bool {
        page != nil && !busy && failure == nil &&
            XDriveIOSNativePhotoOwnerScope.matches(login.owner, originalOwner) &&
            !(kind == .move && selected.parent_id == folder.id)
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
                if kind == .move && selected.parent_id == folder.id {
                    Text("文件已在这个目录，不能重复移动。")
                        .font(.caption).foregroundStyle(.secondary)
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
                        .disabled(busy || offset == 0)
                        Spacer()
                        Text("\(offset + page.items.count) / \(page.total_count)")
                            .font(.footnote.monospacedDigit())
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button("下一页") {
                            offset += XDriveIOSNativeFilesPagePolicy.pageSize
                            load()
                        }
                        .disabled(busy || offset + page.items.count >= page.total_count)
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
                folder: target, selected: selected, kind: kind, onChoose: onChoose
            )
        }
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("刷新") { load() }
            }
        }
        .onAppear { load() }
        .onDisappear { invalidate() }
        .onChange(of: login.owner) { _ in invalidate() }
    }

    private func invalidate() {
        epoch = UUID()
        work?.cancel()
        work = nil
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

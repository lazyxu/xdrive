import SwiftUI
import UIKit

@MainActor
struct XDriveIOSNativePhotoThumbnailCacheScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @State private var entries: [XDriveIOSNativePhotoThumbnailCache.Entry] = []
    @State private var loadedScope: String?
    @State private var selected: Set<String> = []
    @State private var confirmingClear = false
    @State private var clearOwner: XDriveNativeOwnerRoot?
    @State private var errorMessage: String?
    @State private var refreshID = UUID()

    var body: some View {
        let owner = login.owner
        let scope = owner.map(XDriveIOSNativePhotoThumbnailCache.scope(for:))
        let visibleEntries = loadedScope == scope ? entries : []
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                LabeledContent("本账户缓存", value: size(visibleEntries.reduce(0) { $0 + $1.bytes }))
                Text("\(visibleEntries.count) 个缩略图 · 上限 512 MiB")
                    .font(.subheadline).foregroundStyle(.secondary)
                if let errorMessage { Text(errorMessage).foregroundStyle(.secondary) }
                if let owner, let scope, !visibleEntries.isEmpty {
                    buttons(owner: owner, scope: scope)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 94), spacing: 10)], spacing: 10) {
                        ForEach(visibleEntries) { entry in
                            Button {
                                if selected.contains(entry.id) { selected.remove(entry.id) }
                                else { selected.insert(entry.id) }
                            } label: {
                                XDriveIOSCachedPhotoPreview(
                                    scope: scope, entry: entry, selected: selected.contains(entry.id)
                                )
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("缓存缩略图，\(size(entry.bytes))")
                            .accessibilityAddTraits(selected.contains(entry.id) ? .isSelected : [])
                        }
                    }
                } else {
                    Text("浏览云端图库时，已验证的缩略图会按需缓存在这里。")
                        .foregroundStyle(.secondary)
                }
                Text("清理只会移除 App 缩略图。重新浏览时可以再次获取。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .padding()
        }
        .navigationTitle("缩略图缓存")
        .accessibilityIdentifier("native-ios-gallery-thumbnail-cache")
        .task(id: refreshID) {
            guard let owner, let scope else { return }
            do {
                let snapshot = try await XDriveIOSNativePhotoThumbnailCache.shared.entries(scope: scope)
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { return }
                entries = snapshot
                loadedScope = scope
                selected.formIntersection(Set(snapshot.map(\.id)))
            } catch is CancellationError {
            } catch {
                errorMessage = "暂时无法读取缩略图缓存。"
            }
        }
        .onChange(of: scope) { _ in
            entries = []
            loadedScope = nil
            selected = []
            errorMessage = nil
            confirmingClear = false
            clearOwner = nil
            refreshID = UUID()
        }
        .confirmationDialog("清空当前账户的缩略图缓存？", isPresented: $confirmingClear) {
            Button("清空缩略图", role: .destructive) {
                if let expected = clearOwner {
                    remove(owner: expected, scope: XDriveIOSNativePhotoThumbnailCache.scope(for: expected), keys: nil)
                }
                clearOwner = nil
            }
        }
    }

    private func buttons(owner: XDriveNativeOwnerRoot, scope: String) -> some View {
        HStack {
            Button("删除选中的 \(selected.count) 项", role: .destructive) {
                remove(owner: owner, scope: scope, keys: selected)
            }
            .disabled(selected.isEmpty)
            Spacer()
            Button("清空缓存", role: .destructive) {
                clearOwner = owner
                confirmingClear = true
            }
        }
    }

    private func remove(owner: XDriveNativeOwnerRoot, scope: String, keys: Set<String>?) {
        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { return }
        Task {
            do {
                try await XDriveIOSNativePhotoThumbnailCache.shared.remove(scope: scope, keys: keys)
                if XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) {
                    errorMessage = nil
                    refreshID = UUID()
                }
            } catch {
                if XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) {
                    errorMessage = "部分缩略图未能删除，请重新查看缓存。"
                    refreshID = UUID()
                }
            }
        }
    }

    private func size(_ bytes: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}

private struct XDriveIOSCachedPhotoPreview: View {
    let scope: String
    let entry: XDriveIOSNativePhotoThumbnailCache.Entry
    let selected: Bool
    @State private var image: UIImage?

    var body: some View {
        Rectangle()
            .fill(.quaternary)
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Image(systemName: "photo").foregroundStyle(.secondary)
                }
            }
            .clipped()
            .overlay(alignment: .bottomTrailing) {
                if selected {
                    Image(systemName: "checkmark.circle.fill").padding(6)
                        .foregroundStyle(.white).shadow(radius: 2)
                }
            }
            .task(id: scope + ":" + entry.id) {
                image = nil
                if let data = try? await XDriveIOSNativePhotoThumbnailCache.shared.load(scope: scope, key: entry.id),
                   !Task.isCancelled {
                    image = UIImage(data: data)
                }
            }
            .onDisappear { image = nil }
    }
}

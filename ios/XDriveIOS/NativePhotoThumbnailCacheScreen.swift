import SwiftUI
import UIKit

@MainActor
struct XDriveIOSNativePhotoThumbnailCacheScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @Environment(\.scenePhase) private var phase
    @State private var isVisible = false
    @State private var reading = false
    @State private var deleting = false
    @State private var deletionEpoch = UUID()
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
        let verifiedScope = scope != nil && loadedScope == scope
        let visibleEntries = verifiedScope ? entries : []
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                LabeledContent("本账户缓存", value: size(visibleEntries.reduce(0) { $0 + $1.bytes }))
                Text("\(visibleEntries.count) 个缩略图 · 上限 512 MiB")
                    .font(.subheadline).foregroundStyle(.secondary)
                if reading {
                    ProgressView("正在读取缩略图缓存…")
                        .accessibilityIdentifier("native-ios-gallery-cache-loading")
                }
                if deleting { ProgressView("正在更新缩略图缓存…") }
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.secondary)
                    Button("重试读取缓存") {
                        self.errorMessage = nil
                        refreshID = UUID()
                    }
                    .disabled(reading || deleting || phase != .active)
                    .accessibilityIdentifier("native-ios-gallery-cache-retry")
                }
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
                            .disabled(reading || deleting || phase != .active)
                            .accessibilityIdentifier("native-ios-gallery-cache-entry-\(entry.id)")
                            .accessibilityLabel("缓存缩略图，\(size(entry.bytes))")
                            .accessibilityAddTraits(selected.contains(entry.id) ? .isSelected : [])
                        }
                    }
                } else if owner == nil {
                    Text("请先验证服务器账户以查看缩略图缓存。")
                        .foregroundStyle(.secondary)
                } else if verifiedScope {
                    Text("当前账户暂无缓存缩略图。浏览云端图库后会按需缓存。")
                        .foregroundStyle(.secondary)
                } else if errorMessage == nil {
                    Text("正在核验当前账户的缩略图缓存…")
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
            guard let owner, let scope, phase == .active else { return }
            reading = true
            defer {
                if !Task.isCancelled, phase == .active,
                   XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) {
                    reading = false
                }
            }
            do {
                let snapshot = try await XDriveIOSNativePhotoThumbnailCache.shared.entries(scope: scope)
                try Task.checkCancellation()
                guard phase == .active,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { return }
                entries = snapshot
                loadedScope = scope
                selected.formIntersection(Set(snapshot.map(\.id)))
                errorMessage = nil
            } catch is CancellationError {
            } catch {
                guard !Task.isCancelled, phase == .active,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { return }
                errorMessage = "暂时无法读取缩略图缓存。"
            }
        }
        .onAppear { isVisible = true }
        .onDisappear {
            isVisible = false
            reading = false
            confirmingClear = false
            clearOwner = nil
        }
        .onChange(of: phase) { state in
            if state == .active && isVisible {
                refreshID = UUID()
            } else if state != .active {
                reading = false
                confirmingClear = false
                clearOwner = nil
            }
        }
        .onChange(of: scope) { _ in
            deletionEpoch = UUID()
            deleting = false
            reading = false
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
                if let expected = clearOwner, phase == .active,
                   XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected) {
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
            .disabled(selected.isEmpty || reading || deleting || phase != .active)
            Spacer()
            Button("清空缓存", role: .destructive) {
                clearOwner = owner
                confirmingClear = true
            }
            .disabled(reading || deleting || phase != .active)
        }
    }

    private func remove(owner: XDriveNativeOwnerRoot, scope: String, keys: Set<String>?) {
        guard !deleting, phase == .active, isVisible,
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { return }
        let ticket = UUID()
        deletionEpoch = ticket
        deleting = true
        Task {
            do {
                try await XDriveIOSNativePhotoThumbnailCache.shared.remove(scope: scope, keys: keys)
                guard deletionEpoch == ticket else { return }
                deleting = false
                if phase == .active, isVisible,
                   XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) {
                    errorMessage = nil
                    refreshID = UUID()
                }
            } catch {
                guard deletionEpoch == ticket else { return }
                deleting = false
                if phase == .active, isVisible,
                   XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) {
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

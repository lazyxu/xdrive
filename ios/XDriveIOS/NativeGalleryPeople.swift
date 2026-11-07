import SwiftUI
import UIKit

/// Person groups use the verified Owner transport and the existing native Viewer.
/// Only one 24-group / 48-photo page lives in memory at a time.
@MainActor
struct XDriveIOSNativeGalleryPeople: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @Environment(\.scenePhase) private var phase
    @State private var suggested = true
    @State private var groupOffset = 0
    @State private var groups: [XDriveIOSNativeMediaPerson] = []
    @State private var person: XDriveIOSNativeMediaPerson?
    @State private var photoOffset = 0
    @State private var page: XDriveIOSNativeMediaRange?
    @State private var pageOwner: XDriveNativeOwnerRoot?
    @State private var selected: XDriveIOSNativeMediaItem?
    @State private var error: String?
    @State private var busy = false
    @State private var epoch = UUID()
    @State private var job: Task<Void, Never>?
    @State private var confirmAnalysis = false
    @State private var analysisAttempted = false
    @State private var analysisAccepted = false

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if let person {
                    Button("返回人物") {
                        self.person = nil; photoOffset = 0; reload()
                    }
                    Text(person.title).font(.headline)
                    if let page, let owner = pageOwner {
                        Text("\(page.total_count) 张照片").foregroundStyle(.secondary)
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 96))], spacing: 4) {
                            ForEach(page.items, id: \.contentIdentity) { item in
                                Button {
                                    guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { return }
                                    selected = item
                                } label: {
                                    XDriveIOSNativePeopleTile(item: item, owner: owner,
                                        login: login, active: selected == nil && phase == .active)
                                        .id("\(item.contentIdentity)-\(item.id)-\(item.node.revision)-\(epoch)")
                                }.buttonStyle(.plain)
                            }
                        }
                    }
                } else {
                    Picker("人物类型", selection: $suggested) {
                        Text("人物建议").tag(true)
                        Text("已确认人物").tag(false)
                    }.pickerStyle(.segmented).disabled(busy)
                    Text("自动分组仅供参考。相同原件的文件副本只计为一张照片。")
                        .font(.footnote).foregroundStyle(.secondary)
                    HStack {
                        Button("刷新人物") { reload() }.disabled(busy)
                        Button("重新检测人脸") { confirmAnalysis = true }
                            .disabled(busy || analysisAttempted)
                    }
                    if analysisAttempted {
                        Text(analysisAccepted ? "已提交后台检测，完成后刷新人物。" :
                            "检测请求尚未确认，请查看后台任务，避免重复提交。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    ForEach(groups) { group in
                        Button {
                            person = group; photoOffset = 0; reload()
                        } label: {
                            HStack {
                                Label(group.title, systemImage: "person.2")
                                Spacer()
                                Text("\(group.item_count) 张照片")
                                Image(systemName: "chevron.right")
                            }.frame(minHeight: 44)
                        }.disabled(busy)
                    }
                    if !busy && error == nil && groups.isEmpty { Text("当前没有可显示的人物") }
                }
                if busy { ProgressView("正在读取…") }
                if let error {
                    Text(error).foregroundStyle(.red)
                    Button("重试") { reload() }.disabled(busy)
                }
                HStack {
                    Button("上一页") { movePage(-1) }.disabled(busy || currentOffset == 0)
                    Spacer()
                    Button("下一页") { movePage(1) }.disabled(busy || !hasNext)
                }
            }.padding(12)
        }
        .navigationTitle("人物")
        .accessibilityIdentifier("native-ios-gallery-people-page")
        .onAppear { reload() }
        .onChange(of: suggested) { _ in groupOffset = 0; reload() }
        .onChange(of: login.owner) { _ in
            cancel(); selected = nil; person = nil; groups = []; page = nil; pageOwner = nil
            analysisAttempted = false; analysisAccepted = false; confirmAnalysis = false
            groupOffset = 0; photoOffset = 0
            if phase == .active { reload() }
        }
        .onChange(of: phase) { value in
            if value == .active { reload() }
            else { cancel(); selected = nil; groups = []; page = nil; pageOwner = nil }
        }
        .onDisappear { cancel() }
        .confirmationDialog("重新检测当前账户全部云端照片的人脸？", isPresented: $confirmAnalysis) {
            Button("开始检测") { reanalyze() }
            Button("取消", role: .cancel) { }
        } message: {
            Text("将更新自动人物建议；已确认人物保留。")
        }
        .fullScreenCover(item: $selected) { item in
            XDriveIOSNativeServerMediaPreview(item: item, login: login,
                loadedItems: page?.items ?? [], loadedRange: page, openedOwner: pageOwner,
                onNavigate: { next in
                    guard let pageOwner, XDriveIOSNativePhotoOwnerScope.matches(login.owner, pageOwner),
                          page?.items.contains(where: { $0.sameVisibleRevision(as: next) }) == true else { return false }
                    selected = next
                    return true
                })
        }
    }

    private var currentOffset: Int { person == nil ? groupOffset : photoOffset }
    private var hasNext: Bool {
        if person == nil { return groups.count == 24 }
        guard let page else { return false }
        return page.offset + page.items.count < page.total_count
    }
    private func movePage(_ direction: Int) {
        if person == nil { groupOffset = max(0, groupOffset + direction * 24) }
        else { photoOffset = max(0, photoOffset + direction * XDriveIOSNativeMediaGalleryReader.pageSize) }
        reload()
    }
    private func cancel() {
        epoch = UUID(); job?.cancel(); job = nil; busy = false
    }
    private func reanalyze() {
        guard !analysisAttempted, !busy, phase == .active, let expected = login.owner else { return }
        cancel(); analysisAttempted = true; analysisAccepted = false; busy = true
        let ticket = epoch
        job = Task { @MainActor in
            defer { if epoch == ticket { busy = false; job = nil } }
            do {
                let auth = try await login.verifiedAuthorization()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected) else {
                    throw XDriveIOSNativeMediaReadFailure.invalidScope
                }
                try await XDriveIOSNativeMediaGalleryReader(owner: auth.owner,
                    accessToken: auth.accessToken).reanalyzeFaces()
                try Task.checkCancellation()
                guard epoch == ticket, XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected) else { return }
                analysisAccepted = true
            } catch {
                // A lost/cancelled POST ACK must never cause an automatic replay.
            }
        }
    }
    private func reload() {
        guard selected == nil else { return }
        cancel(); error = nil; page = nil; pageOwner = nil
        if person == nil { groups = [] }
        guard phase == .active, let expected = login.owner, selected == nil else { return }
        let ticket = epoch, selectedPerson = person
        let requestedOffset = currentOffset, requestedSuggested = suggested
        busy = true
        job = Task { @MainActor in
            defer { if epoch == ticket { busy = false; job = nil } }
            do {
                let auth = try await login.verifiedAuthorization()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected) else {
                    throw XDriveIOSNativeMediaReadFailure.invalidScope
                }
                let reader = XDriveIOSNativeMediaGalleryReader(owner: auth.owner, accessToken: auth.accessToken)
                if let selectedPerson {
                    let result = try await reader.page(offset: requestedOffset, person: selectedPerson)
                    try Task.checkCancellation()
                    guard epoch == ticket, XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected) else { return }
                    page = result; pageOwner = expected
                } else {
                    let result = try await reader.people(suggested: requestedSuggested, offset: requestedOffset)
                    try Task.checkCancellation()
                    guard epoch == ticket, XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected) else { return }
                    groups = result
                }
            } catch is CancellationError {
            } catch {
                guard epoch == ticket else { return }
                self.error = "无法读取人物，请检查连接、账户权限或模型配置。"
            }
        }
    }
}

@MainActor
private struct XDriveIOSNativePeopleTile: View {
    let item: XDriveIOSNativeMediaItem
    let owner: XDriveNativeOwnerRoot
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let active: Bool
    @State private var image: UIImage?

    var body: some View {
        GeometryReader { bounds in
            Group {
                if let image { Image(uiImage: image).resizable().scaledToFill() }
                else { Rectangle().fill(Color(uiColor: .secondarySystemGroupedBackground))
                    .overlay { Image(systemName: "photo") } }
            }.frame(width: bounds.size.width, height: bounds.size.height).clipped()
        }.aspectRatio(1, contentMode: .fit).accessibilityLabel(item.node.name)
        .task(id: active) {
            guard active, image == nil else { return }
            do {
                let auth = try await login.verifiedAuthorization()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, owner) else { return }
                let result = try await XDriveIOSNativeMediaGalleryReader(
                    owner: auth.owner, accessToken: auth.accessToken).thumbnail(item)
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { return }
                image = result
            } catch { }
        }
        .onDisappear { image = nil }
    }
}

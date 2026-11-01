import Foundation

/// Exact current xDrive tree provenance returned by GET /nodes/:id/location.
/// An old search-hit path is a display hint, never authority to enter a folder.
struct XDriveIOSNativeFilesLocationCrumb: Decodable, Hashable {
    let id: UInt64
    let name: String
}

struct XDriveIOSNativeFilesLocationDTO: Decodable {
    let node_id: UInt64
    let revision: UInt64
    let node_type: String
    let parent_id: UInt64?
    let breadcrumbs: [XDriveIOSNativeFilesLocationCrumb]
}

struct XDriveIOSNativeFilesLocatedParent: Equatable {
    let id: UInt64
    let name: String
}

struct XDriveIOSNativeFilesPositionDTO: Decodable {
    let node_id: UInt64
    let revision: UInt64
    let index: Int64
    let sort: String
    let order: String
    let group: String
    let folders_first: Bool
}

struct XDriveIOSNativeFilesLocatedPage {
    let folder: XDriveIOSNativeFilesLocatedParent
    let offset: Int
}

enum XDriveIOSNativeFilesLocationPolicy {
    static let maximumBreadcrumbs = 10_000

    /// Reuse the exact current Owner 64-item Range sort/grouping.
    static func pageOffset(
        of selected: XDriveIOSNativeFilesNode,
        position: XDriveIOSNativeFilesPositionDTO
    ) -> Int? {
        guard position.node_id == selected.id,
              position.revision == selected.revision,
              position.index >= 0,
              position.index < Int64(XDriveIOSNativeFilesPagePolicy.maximumCount),
              position.sort == "name", position.order == "asc",
              position.group == "none", position.folders_first else { return nil }
        return (Int(position.index) / XDriveIOSNativeFilesPagePolicy.pageSize) *
            XDriveIOSNativeFilesPagePolicy.pageSize
    }

    /// A file's last breadcrumb is its containing folder; a directory's
    /// last breadcrumb is itself, so use its penultimate breadcrumb.
    static func parent(
        of selected: XDriveIOSNativeFilesNode,
        at location: XDriveIOSNativeFilesLocationDTO,
        ownerRootID: UInt64
    ) -> XDriveIOSNativeFilesLocatedParent? {
        guard ownerRootID > 0, selected.id > 0, selected.revision > 0,
              selected.parent_id != nil,
              selected.type == "file" || selected.type == "dir",
              location.node_id == selected.id,
              location.revision == selected.revision,
              location.node_type == selected.type,
              location.parent_id == selected.parent_id,
              !location.breadcrumbs.isEmpty,
              location.breadcrumbs.count <= maximumBreadcrumbs,
              location.breadcrumbs.first?.id == ownerRootID,
              Set(location.breadcrumbs.map(\.id)).count == location.breadcrumbs.count,
              location.breadcrumbs.allSatisfy({
                $0.id > 0 && $0.name.utf8.count <= 255 &&
                    ($0.id == ownerRootID || !$0.name.isEmpty)
              }) else { return nil }
        let chain = location.breadcrumbs
        let parent: XDriveIOSNativeFilesLocationCrumb
        if selected.isDirectory {
            guard chain.count >= 2, chain.last?.id == selected.id else { return nil }
            parent = chain[chain.count - 2]
        } else {
            guard let last = chain.last else { return nil }
            parent = last
        }
        guard parent.id == selected.parent_id,
              parent.id == ownerRootID || !parent.name.isEmpty else { return nil }
        return XDriveIOSNativeFilesLocatedParent(
            id: parent.id,
            name: parent.id == ownerRootID ? "云端根目录" : parent.name
        )
    }
}

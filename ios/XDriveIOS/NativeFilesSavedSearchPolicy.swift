import Foundation

/// Exact native projection of the existing Owner-scoped
/// /api/v1/file-saved-searches JSON; never persist PWA's availability UI flag.
struct XDriveIOSNativeFilesSavedSearchFilters: Codable, Equatable {
    var kind: String?
    var modifiedFrom: String?
    var modifiedTo: String?
    var minSize: Int64?
    var maxSize: Int64?
    var sourceID: UInt64?
    var tagID: UInt64?

    init(from native: XDriveIOSNativeFilesSearchFilterState) {
        kind = native.kind == "all" ? nil : native.kind
        modifiedFrom = native.modifiedFrom
        modifiedTo = native.modifiedTo
        minSize = native.minSize
        maxSize = native.maxSize
        sourceID = native.sourceID
        tagID = native.tagID
    }

    var native: XDriveIOSNativeFilesSearchFilterState {
        var native = XDriveIOSNativeFilesSearchFilterState()
        native.kind = kind ?? "all"
        native.modifiedFrom = modifiedFrom
        native.modifiedTo = modifiedTo
        native.minSize = minSize
        native.maxSize = maxSize
        native.sourceID = sourceID
        native.tagID = tagID
        return native
    }
}

struct XDriveIOSNativeFilesSavedSearch: Decodable, Identifiable, Equatable {
    let id: UInt64
    let name: String
    let query: String
    let filters: XDriveIOSNativeFilesSavedSearchFilters
    let position: Int
}

struct XDriveIOSNativeFilesSavedSearchInput: Encodable {
    let name: String
    let query: String
    let filters: XDriveIOSNativeFilesSavedSearchFilters
}

enum XDriveIOSNativeFilesSavedSearchPolicy {
    static let maximumItems = 64
    static let maximumNameUTF8Bytes = 128

    static func normalizedName(_ value: String) -> String? {
        let name = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.utf8.count <= maximumNameUTF8Bytes else {
            return nil
        }
        return name
    }

    static func validInput(name: String, query: String,
                           filters: XDriveIOSNativeFilesSavedSearchFilters) -> Bool {
        guard normalizedName(name) == name, filters.kind != "all",
              XDriveIOSNativeFilesPagePolicy.validSearchFilters(filters.native),
              XDriveIOSNativeFilesPagePolicy.validSearchRequest(
                query: query, filters: filters.native
              ) else { return false }
        return query == query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func valid(_ item: XDriveIOSNativeFilesSavedSearch) -> Bool {
        item.id > 0 && item.position >= 0 &&
            validInput(name: item.name, query: item.query, filters: item.filters)
    }

    static func validList(_ items: [XDriveIOSNativeFilesSavedSearch]) -> Bool {
        guard items.count <= maximumItems,
              Set(items.map(\.id)).count == items.count,
              items.allSatisfy(valid) else { return false }
        let names = items.map { $0.name.lowercased() }
        return Set(names).count == names.count
    }

    static func validReorder(_ ids: [UInt64],
                             items: [XDriveIOSNativeFilesSavedSearch]) -> Bool {
        validList(items) && ids.count == items.count &&
            Set(ids).count == ids.count && Set(ids) == Set(items.map(\.id))
    }
}

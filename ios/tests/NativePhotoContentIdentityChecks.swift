import Foundation

@main
struct NativePhotoContentIdentityChecks {
    static func main() throws {
        let hash = String(repeating: "a", count: 64)
        precondition(XDriveIOSNativePhotoContentPolicy.valid("sha256:" + hash))
        precondition(XDriveIOSNativePhotoContentPolicy.valid("photo-bundle:v1:sha256:" + hash))
        for invalid in [hash, "sha256:" + hash.uppercased(), "sha256:" + hash + "/x", "sha256:1", ""] {
            precondition(!XDriveIOSNativePhotoContentPolicy.valid(invalid))
        }
        let suggestion = try JSONDecoder().decode(XDriveIOSNativeMediaPerson.self,
            from: Data("{\"id\":\"auto:v1:\(hash)\",\"item_count\":2}".utf8))
        precondition(suggestion.suggested && suggestion.isValid)
        let person = XDriveIOSNativeMediaPerson(id: "person:v1:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            name: "Family", item_count: 1)
        precondition(person.isValid && !person.suggested)
        precondition(!XDriveIOSNativeMediaPerson(id: "../../items", name: "x", item_count: 1).isValid)
        precondition(!XDriveIOSNativeMediaPerson(id: suggestion.id, name: nil, item_count: -1).isValid)
        print("Native content identity and person selector validation passed")
    }
}

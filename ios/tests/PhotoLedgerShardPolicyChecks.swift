import Foundation

@main enum XDrivePhotoLedgerShardPolicyChecks {
    static func main() {
        let p = XDrivePhotoLedgerShardPolicy.self
        precondition(p.prefix(forFingerprint: String(repeating: "a", count: 64)) == "aaa")
        precondition(p.prefix(forFingerprint: "09f" + String(repeating: "0", count: 61)) == "09f")
        precondition(p.prefix(forFingerprint: String(repeating: "A", count: 64)) == nil)
        precondition(p.prefix(forFingerprint: String(repeating: "0", count: 63)) == nil)
        precondition(!p.isValidPrefix("ZZZ") && !p.isValidPrefix("a/b"))
        let uuid = UUID(uuidString: "12345678-1234-4234-8123-123456789abc")!
        let id = p.makeOperationID(prefix: "09f", uuid: uuid)!
        precondition(id == "09f45678-1234-4234-8123-123456789abc")
        precondition(UUID(uuidString: id) != nil)
        precondition(p.prefix(forOperationID: id) == "09f")
        precondition(p.prefix(forOperationID: "09f45678-1234-4234-8123-123456789abZ") == nil)
        precondition(p.makeOperationID(prefix: "abcdef", uuid: uuid) == nil)
        precondition(4096 * p.maximumShardOperations > 100_000)
        print("iOS Photo ledger V2 pure shard routing: PASS")
    }
}

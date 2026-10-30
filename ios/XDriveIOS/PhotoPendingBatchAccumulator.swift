import Foundation

/// Retain only a bounded sample of unverified receipts while counting every
/// record. The owner-scoped encrypted journal remains responsible for
/// authentication, duplicate rejection and disk traversal.
struct XDrivePhotoPendingBatchAccumulator<Entry> {
    let limit: Int
    private(set) var pending = 0
    private(set) var batch: [Entry] = []

    init(limit: Int) {
        precondition(limit >= 0 && limit <= 20)
        self.limit = limit
        batch.reserveCapacity(limit)
    }

    mutating func consider(_ entry: Entry, isPending: Bool) {
        guard isPending else { return }
        pending += 1
        if batch.count < limit { batch.append(entry) }
    }
}

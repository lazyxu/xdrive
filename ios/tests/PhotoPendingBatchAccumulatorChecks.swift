import Foundation

@main enum XDrivePhotoPendingBatchAccumulatorChecks {
    static func main() {
        var sample = XDrivePhotoPendingBatchAccumulator<Int>(limit: 20)
        for index in 0..<100_000 {
            sample.consider(index, isPending: index % 4 == 0)
        }
        precondition(sample.pending == 25_000)
        precondition(sample.batch.count == 20)
        precondition(sample.batch == (0..<20).map { $0 * 4 })

        var countOnly = XDrivePhotoPendingBatchAccumulator<Int>(limit: 0)
        for index in 0..<100_000 {
            countOnly.consider(index, isPending: index % 10 == 0)
        }
        precondition(countOnly.pending == 10_000)
        precondition(countOnly.batch.isEmpty)

        var none = XDrivePhotoPendingBatchAccumulator<String>(limit: 20)
        none.consider("confirmed", isPending: false)
        none.consider("prepared", isPending: false)
        precondition(none.pending == 0 && none.batch.isEmpty)
        print("iOS photo pending receipt bounded-memory Swift fixture: PASS")
    }
}

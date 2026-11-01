import Foundation

private actor XDriveIOSNativeFilesThumbnailTestProbe {
    private var active = 0
    private var peak = 0

    func enter() {
        active += 1
        peak = max(peak, active)
    }
    func leave() { active -= 1 }
    func status() -> (active: Int, peak: Int) { (active, peak) }
}

@main
struct XDriveIOSNativeFilesThumbnailSlotsChecks {
    private static func check(_ condition: Bool, _ label: String) {
        if !condition {
            fputs("native Files thumbnail admission: \(label)\n", stderr)
            exit(1)
        }
    }

    static func main() async {
        let slots = XDriveIOSNativeFilesThumbnailSlots()
        let probe = XDriveIOSNativeFilesThumbnailTestProbe()
        let tasks: [Task<Int, Error>] = (0..<24).map { index in
            Task {
                try await slots.perform {
                    await probe.enter()
                    do {
                        try await Task.sleep(nanoseconds: 8_000_000)
                        await probe.leave()
                        return index
                    } catch {
                        await probe.leave()
                        throw error
                    }
                }
            }
        }
        for task in tasks {
            do { _ = try await task.value }
            catch { check(false, "admitted request unexpectedly failed") }
        }
        let firstStatus = await probe.status()
        check(firstStatus.active == 0 && firstStatus.peak == 2,
              "bounded 24-request workload must admit exactly two concurrent")

        let pendingProbe = XDriveIOSNativeFilesThumbnailTestProbe()
        let first: Task<Void, Error> = Task {
            try await slots.perform {
                await pendingProbe.enter()
                try await Task.sleep(nanoseconds: 80_000_000)
                await pendingProbe.leave()
            }
        }
        let second: Task<Void, Error> = Task {
            try await slots.perform {
                await pendingProbe.enter()
                try await Task.sleep(nanoseconds: 80_000_000)
                await pendingProbe.leave()
            }
        }
        for _ in 0..<200 {
            if (await pendingProbe.status()).active == 2 { break }
            try? await Task.sleep(nanoseconds: 1_000_000)
        }
        check((await pendingProbe.status()).active == 2,
              "two long requests must occupy slots before cancellation")
        let waiting: Task<Int, Error> = Task {
            try await slots.perform { 99 }
        }
        try? await Task.sleep(nanoseconds: 2_000_000)
        waiting.cancel()
        do {
            _ = try await waiting.value
            check(false, "cancelled waiting request may not execute")
        } catch is CancellationError {
            // The queued continuation was woken with cancellation.
        } catch {
            check(false, "cancelled waiting request returned unexpected error")
        }
        do {
            try await first.value
            try await second.value
            let afterCancellation = try await slots.perform { 7 }
            check(afterCancellation == 7,
                  "cancelled waiters must not consume a future permit")
        } catch {
            check(false, "slots were leaked after cancelling a queued tile")
        }
        print("native Files thumbnail concurrency/cancellation: PASS")
    }
}

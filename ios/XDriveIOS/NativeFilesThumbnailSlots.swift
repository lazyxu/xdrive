import Foundation

actor XDriveIOSNativeFilesThumbnailSlots {
    static let shared = XDriveIOSNativeFilesThumbnailSlots()
    private var inFlight = 0
    private var waiters: [(UUID, CheckedContinuation<Void, Error>)] = []

    private func acquire() async throws {
        try Task.checkCancellation()
        if inFlight < XDriveIOSNativeFilesThumbnailPolicy.maximumConcurrent {
            inFlight += 1
            return
        }
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (resume: CheckedContinuation<Void, Error>) in
                if Task.isCancelled {
                    resume.resume(throwing: CancellationError())
                } else {
                    waiters.append((id, resume))
                }
            }
        } onCancel: {
            Task { await self.cancelWaiting(id) }
        }
    }

    private func cancelWaiting(_ id: UUID) {
        guard let index = waiters.firstIndex(where: { $0.0 == id }) else { return }
        let cancelled = waiters.remove(at: index)
        cancelled.1.resume(throwing: CancellationError())
    }

    private func release() {
        if waiters.isEmpty {
            inFlight = max(0, inFlight - 1)
        } else {
            let next = waiters.removeFirst()
            next.1.resume()
        }
    }

    func perform<T>(_ operation: () async throws -> T) async throws -> T {
        try await acquire()
        defer { release() }
        try Task.checkCancellation()
        return try await operation()
    }
}


import Foundation

/// A safe observation, NOT a request to resume PUT/finalize or create a
/// replacement upload session. Every result other than .confirmed retains
/// uncertainty in the protected Owner/Device photo journal.
enum XDriveIOSPhotoBackupRecoveryResult {
    case confirmed(sessionID: String, nodeID: UInt64, revision: UInt64)
    case activeButUnverified(sessionID: String, reportedChunkCount: Int)
    case noSessionEvidence
    case expiredSession
    case ambiguousSession
}

enum XDriveIOSPhotoBackupRecoveryError: Error {
    case invalidScope
    case notAnUncertainOperation
    case changedOperation
}

/// Read-only recovery for a possibly committed iOS PhotoKit original.
/// It composes the existing server HMAC resume-key observation with the
/// existing Owner Node SHA/revision readback and sealed journal. All network
/// methods are GET or logically read-only POST /uploads/resume-lookup.
struct XDriveIOSPhotoBackupUncertainReceiptRecovery {
    let owner: XDriveNativeOwnerRoot
    let scope: XDrivePhotoSyncScope
    let accessToken: String
    let ledger: XDrivePhotoSyncLedger

    func reconcile(operationID: String) async throws
        -> XDriveIOSPhotoBackupRecoveryResult {
        let origin = try ServerAddress.parse(owner.origin.absoluteString)
        guard origin == owner.origin, !accessToken.isEmpty,
              owner.ownerID > 0, owner.rootNodeID > 0,
              scope.origin == origin.absoluteString,
              scope.serverInstanceID == owner.instanceID,
              scope.ownerID == owner.ownerID,
              scope.rootNodeID == owner.rootNodeID,
              UUID(uuidString: scope.deviceID) != nil else {
            throw XDriveIOSPhotoBackupRecoveryError.invalidScope
        }
        try Task.checkCancellation()
        guard let pending = try await ledger.operation(
                  scope: scope, id: operationID
              ),
              pending.destinationParentID == owner.rootNodeID,
              pending.verifiedNodeID == nil,
              pending.verifiedNodeRevision == nil else {
            throw XDriveIOSPhotoBackupRecoveryError.notAnUncertainOperation
        }
        switch pending.state {
        case .prepared, .confirmed:
            // Prepared has never entered a possible network mutation.
            // Confirmed must be verified through ordinary Owner Node reads.
            throw XDriveIOSPhotoBackupRecoveryError.notAnUncertainOperation
        case .creating, .uploading, .finalizing:
            // Crash at any write boundary requires persistent uncertainty
            // even if this recovery request is itself cancelled.
            _ = try await ledger.markUnknown(scope: scope, id: operationID)
        case .needsReconciliation:
            break
        }

        try Task.checkCancellation()
        let observed = try await XDriveIOSUploadResumeProofReader(
            owner: owner, scope: scope, accessToken: accessToken
        ).observe(pending)
        try Task.checkCancellation()

        // A 404 is not evidence the original create POST did not commit.
        // Never silently discard the encrypted intent or generate a new key.
        switch observed {
        case .noMatchingSession:
            return .noSessionEvidence
        case .expired:
            return .expiredSession
        case .ambiguous:
            return .ambiguousSession
        case .active(let sessionID, let chunkCount):
            _ = try await ledger.recordObservedSession(
                scope: scope, id: operationID, observedSessionID: sessionID,
                parentID: pending.destinationParentID,
                name: pending.destinationName,
                byteSize: pending.byteSize,
                fullSHA256: pending.sha256,
                observedStatus: "active"
            )
            // Server part list does not establish the staged original's
            // expected per-part hashes. No resume PUT is attempted.
            return .activeButUnverified(
                sessionID: sessionID, reportedChunkCount: chunkCount
            )
        case .finalized(let sessionID, let nodeID, let revision):
            // Save the authoritative Server UUID, but keep the status
            // needsReconciliation until a second current-Owner Node read.
            _ = try await ledger.recordObservedSession(
                scope: scope, id: operationID, observedSessionID: sessionID,
                parentID: pending.destinationParentID,
                name: pending.destinationName,
                byteSize: pending.byteSize,
                fullSHA256: pending.sha256,
                observedStatus: "finalized"
            )
            try Task.checkCancellation()
            let receipt = XDriveNativeUploadReceipt(
                nodeID: nodeID,
                nodeName: pending.destinationName,
                revision: revision,
                sha256: pending.sha256,
                bytes: pending.byteSize,
                sessionID: sessionID
            )
            try await XDriveIOSNodeReceiptReadbackVerifier(
                owner: owner, accessToken: accessToken
            ).verify(
                receipt,
                parentID: pending.destinationParentID,
                expectedName: pending.destinationName
            )
            try Task.checkCancellation()
            // No "confirmed" bit until both the exact UploadSession and
            // Owner file digest/revision checks succeeded.
            let updated = try await ledger.confirmReceipt(
                scope: scope, id: operationID,
                sessionID: sessionID,
                parentID: pending.destinationParentID,
                name: pending.destinationName,
                size: pending.byteSize,
                fullSHA256: pending.sha256,
                nodeID: nodeID,
                revision: revision
            )
            guard updated.state == .confirmed,
                  updated.verifiedNodeID == nodeID,
                  updated.verifiedNodeRevision == revision else {
                throw XDriveIOSPhotoBackupRecoveryError.changedOperation
            }
            return .confirmed(
                sessionID: sessionID, nodeID: nodeID, revision: revision
            )
        }
    }
}

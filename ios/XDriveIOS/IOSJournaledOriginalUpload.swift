import Foundation

/// This coordinates one already-staged, explicitly authorized original
/// against the existing encrypted Owner/Device intent. It is intentionally
/// NOT wired to login, WKWebView, automatic Photos scanning or a background
/// scheduler until the Server's iOS Device/Root rights have been verified.
struct XDriveIOSJournaledOriginalUpload {
    let owner: XDriveNativeOwnerRoot
    let scope: XDrivePhotoSyncScope
    let authorization: XDriveIOSOriginalOwnerAuthorization
    let ledger: XDrivePhotoSyncLedger

    init(owner: XDriveNativeOwnerRoot, scope: XDrivePhotoSyncScope,
         accessToken: String, ledger: XDrivePhotoSyncLedger) {
        self.owner = owner
        self.scope = scope
        self.authorization = .webBearer(accessToken)
        self.ledger = ledger
    }

    init(owner: XDriveNativeOwnerRoot, scope: XDrivePhotoSyncScope,
         approvedBackgroundGrant: XDriveIOSApprovedPhotoBGCredential,
         ledger: XDrivePhotoSyncLedger) {
        self.owner = owner
        self.scope = scope
        self.authorization = .background(approvedBackgroundGrant)
        self.ledger = ledger
    }

    func uploadPrepared(_ requested: XDrivePhotoSyncOperation, from stagedURL: URL)
        async throws -> XDriveNativeUploadReceipt {
        let canonicalOrigin = try ServerAddress.parse(owner.origin.absoluteString)
        guard owner.origin == canonicalOrigin,
              scope.origin == canonicalOrigin.absoluteString,
              scope.serverInstanceID == owner.instanceID,
              scope.ownerID == owner.ownerID,
              scope.rootNodeID == owner.rootNodeID,
              !scope.deviceID.isEmpty,
              requested.destinationParentID == owner.rootNodeID,
              requested.state == .prepared,
              requested.sessionID == nil else {
            throw XDrivePhotoSyncLedgerError.identityMismatch
        }

        // A recently changed auth user, root or installation must never
        // inherit a previously prepared device photo resource.
        try await authorization.verify(owner: owner)
        try Task.checkCancellation()

        // Always reload the sealed ledger, not a stale caller-supplied object.
        // A crashed/uncertain creating or finalizing record is never replayed.
        let stored = try await ledger.operations(scope: scope)
        guard let current = stored.first(where: { $0.id == requested.id }),
              current.id == requested.id,
              current.assetFingerprint == requested.assetFingerprint,
              current.role == requested.role,
              current.resumeKey == requested.resumeKey,
              current.destinationParentID == requested.destinationParentID,
              current.destinationName == requested.destinationName,
              current.byteSize == requested.byteSize,
              current.sha256 == requested.sha256,
              current.state == .prepared,
              current.sessionID == nil,
              current.verifiedNodeID == nil else {
            throw XDrivePhotoSyncLedgerError.invalidTransition
        }

        let transport = try authorization.transport(origin: canonicalOrigin)
        let operationID = current.id
        let hooks = XDriveNativeUploadCheckpointHooks(
            beforeCreate: {
                // Committed to encrypted local storage before any new POST.
                _ = try await ledger.beginCreate(scope: scope, id: operationID)
            },
            sessionAccepted: { serverID in
                // No chunk PUT is issued until this UUID is durable.
                _ = try await ledger.recordSession(
                    scope: scope, id: operationID, sessionID: serverID
                )
            },
            beforeFinalize: {
                // CAS physical finalize may commit despite a lost HTTP ACK.
                _ = try await ledger.beginFinalize(scope: scope, id: operationID)
            }
        )
        do {
            let receipt = try await transport.uploadPreparedOriginal(
                from: stagedURL, name: current.destinationName,
                parentID: current.destinationParentID,
                resumeKey: current.resumeKey, expectedSize: current.byteSize,
                expectedSHA256: current.sha256, hooks: hooks
            )
            try Task.checkCancellation()
            // A finalized Session and a visible current-Owner Node must
            // agree on parent, name, byte size, full SHA and exact revision.
            // Any GET/auth mismatch remains uncertain in the encrypted
            // ledger, never a fabricated "backed up" checkpoint.
            try await authorization.verifyNodeReceipt(
                receipt, owner: owner, parentID: current.destinationParentID,
                expectedName: current.destinationName
            )
            try Task.checkCancellation()
            // Only this verified single-resource file receipt can be marked
            // confirmed. It is not proof of Live still/motion pairing or a
            // durable PhotoAsset/SourceRun commit.
            _ = try await ledger.confirmReceipt(
                scope: scope, id: operationID,
                sessionID: receipt.sessionID,
                parentID: current.destinationParentID,
                name: current.destinationName,
                size: receipt.bytes,
                fullSHA256: receipt.sha256,
                nodeID: receipt.nodeID,
                revision: receipt.revision
            )
            return receipt
        } catch {
            // A failed original size/hash check before creating is read-only,
            // so preserve the prepared intent. If any mutation might have
            // begun, retain uncertainty and require Owner read-only recovery.
            if let snapshot = try? await ledger.operations(scope: scope),
               let last = snapshot.first(where: { $0.id == operationID }),
               last.state != .prepared, last.state != .confirmed {
                _ = try? await ledger.markUnknown(scope: scope, id: operationID)
            }
            throw error
        }
    }
}

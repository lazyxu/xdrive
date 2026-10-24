package api

import (
	"context"
	"strconv"
	"time"

	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"gorm.io/gorm"
)

// This is a PRIVATE primitive for a future explicit Owner batch endpoint.
// Do not call it from periodic reconciliation, Gallery mounts or map opening.
// Each bounded candidate is revalidated by the established grant transaction
// against freshly locked Owner/Asset/Node/Media/Consent before any mutation.
//
// The outer transaction commits the renewed grant, derived-coordinate purge,
// grant audit, current-source durable index Intent, and enqueue audit together.
// An audit failure, source edit, revoked/leased old Intent or cancelled ctx
// rolls ALL of them back; no GPS or AK is sent to the provider here.
func grantAndQueueBaiduPhotoMapBatchCandidate(
	ctx context.Context, db *gorm.DB, ownerID uint64,
	candidate baiduPhotoMapGrantBatchCandidate, expiresAt time.Time,
	verifyDecision baiduPhotoMapGrantDecision,
) (uint64, error) {
	denied := errBaiduPhotoMapGrantBatchUnavailable
	if ctx == nil || ctx.Err() != nil || db == nil || ownerID == 0 ||
		!validBaiduPhotoMapGrantBatchCandidate(candidate) ||
		verifyDecision == nil || expiresAt.IsZero() {
		return 0, denied
	}
	var committed uint64
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Every decision is verified independently against the current Owner
		// session *inside* the locked grant transaction, not a client-provided
		// confirm/identity/asset list or a stale preview.
		var actor auditpkg.Event
		checkedDecision := func(inner context.Context, locked *gorm.DB,
			actualOwner, assetID uint64) (auditpkg.Event, error) {
			event, err := verifyDecision(inner, locked, actualOwner, assetID)
			if err == nil && event.ActorUserID != nil &&
				*event.ActorUserID == ownerID && actualOwner == ownerID &&
				assetID == candidate.AssetID {
				actor = event
			}
			return event, err
		}
		grant, err := grantBaiduPhotoMapConsent(ctx, tx, baiduPhotoMapGrantCandidate{
			OwnerID: ownerID, AssetID: candidate.AssetID,
			PrimaryNodeID:           candidate.PrimaryNodeID,
			NodeRevision:            candidate.NodeRevision,
			MediaUpdatedAt:          candidate.MediaUpdatedAt,
			SourceLatitude:          candidate.SourceLatitude,
			SourceLongitude:         candidate.SourceLongitude,
			ExpectedConsentRevision: candidate.ConsentRevision,
			ExpiresAt:               expiresAt,
		}, checkedDecision)
		if err != nil || ctx.Err() != nil || grant.OwnerID != ownerID ||
			grant.AssetID != candidate.AssetID || grant.Revision == 0 ||
			actor.ActorUserID == nil || *actor.ActorUserID != ownerID {
			return denied
		}
		// Same transaction and lock order: Owner -> Asset -> Node ->
		// Metadata -> Consent -> durable Intent. This helper itself never
		// claims or dispatches a worker, sends GPS or reads a provider AK.
		if err := enqueueBaiduPhotoMapIndexIntent(ctx, tx,
			ownerID, candidate.AssetID, grant.Revision); err != nil {
			return denied
		}
		if err := auditpkg.Record(tx, auditpkg.Event{
			ActorUserID:   actor.ActorUserID,
			ActorUsername: actor.ActorUsername,
			ActorRole:     actor.ActorRole,
			RequestID:     actor.RequestID,
			IPAddress:     actor.IPAddress,
			Action:        "media.photo_map.index.enqueue",
			TargetType:    "photo_asset",
			TargetID:      strconv.FormatUint(candidate.AssetID, 10),
			Result:        auditpkg.ResultSuccess,
			Metadata: map[string]any{
				"consent_revision": grant.Revision,
				"purpose":          "baidu-forward-map-index",
				"source":           "explicit-batch-consent",
			},
		}); err != nil || ctx.Err() != nil {
			return denied
		}
		committed = grant.Revision
		return nil
	})
	if err != nil || ctx.Err() != nil || committed == 0 {
		return 0, denied
	}
	return committed, nil
}

// A batch is ALWAYS assembled and bounded server-side by the candidate
// scanner (maximum 32). No HTTP route, browser GPS cursor or automatic
// provider dispatch is installed by this private transaction primitive.

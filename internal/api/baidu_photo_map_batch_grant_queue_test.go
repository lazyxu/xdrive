package api

import (
	"context"
	"testing"
	"time"
)

func TestBaiduPhotoMapBatchGrantAndIntentRequireIndependentConsent(t *testing.T) {
	candidate := baiduPhotoMapGrantBatchCandidate{
		AssetID: 8, PrimaryNodeID: 9, NodeRevision: 4,
		MediaUpdatedAt: time.Now().UTC(), SourceLatitude: 0,
		SourceLongitude: 0, ConsentRevision: 0,
	}
	now := time.Now().UTC().Add(time.Hour)
	// No HTTP route or transport callback can grant permission on a
	// missing DB, missing source, nil Owner, expired context or nil decision.
	for _, tc := range []struct {
		name      string
		ctx       context.Context
		owner     uint64
		candidate baiduPhotoMapGrantBatchCandidate
		expiry    time.Time
	}{
		{name: "no context", ctx: nil, owner: 1, candidate: candidate, expiry: now},
		{name: "missing owner", ctx: context.Background(), owner: 0, candidate: candidate, expiry: now},
		{name: "missing source", ctx: context.Background(), owner: 1, expiry: now},
		{name: "missing expiry", ctx: context.Background(), owner: 1, candidate: candidate},
		{name: "valid input but missing database/decision", ctx: context.Background(), owner: 1, candidate: candidate, expiry: now},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if rev, err := grantAndQueueBaiduPhotoMapBatchCandidate(tc.ctx, nil,
				tc.owner, tc.candidate, tc.expiry, nil); err == nil || rev != 0 {
				t.Fatalf("unsafe batch grant accepted: rev=%d err=%v", rev, err)
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if rev, err := grantAndQueueBaiduPhotoMapBatchCandidate(ctx, nil, 1, candidate, now, nil); err == nil || rev != 0 {
		t.Fatal("cancelled Owner batch grant accepted")
	}
}

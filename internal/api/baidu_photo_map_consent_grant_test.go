package api

import (
	"context"
	"math"
	"testing"
	"time"

	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"gorm.io/gorm"
)

func TestBaiduPhotoMapGrantCandidateNeverDefaultsToConsent(t *testing.T) {
	valid := baiduPhotoMapGrantCandidate{
		OwnerID: 1, AssetID: 2, PrimaryNodeID: 3,
		NodeRevision: 1, MediaUpdatedAt: time.Now().UTC(),
		SourceLatitude: 0, SourceLongitude: 0,
		ExpiresAt: time.Now().UTC().Add(time.Hour),
	}
	if !validBaiduPhotoMapGrantCandidate(valid) {
		t.Fatal("valid original GPS (0,0) rejected")
	}
	for _, mutate := range []func(*baiduPhotoMapGrantCandidate){
		func(c *baiduPhotoMapGrantCandidate) { c.OwnerID = 0 },
		func(c *baiduPhotoMapGrantCandidate) { c.AssetID = 0 },
		func(c *baiduPhotoMapGrantCandidate) { c.PrimaryNodeID = 0 },
		func(c *baiduPhotoMapGrantCandidate) { c.NodeRevision = 0 },
		func(c *baiduPhotoMapGrantCandidate) { c.MediaUpdatedAt = time.Time{} },
		func(c *baiduPhotoMapGrantCandidate) { c.ExpiresAt = time.Time{} },
		func(c *baiduPhotoMapGrantCandidate) { c.SourceLatitude = math.NaN() },
		func(c *baiduPhotoMapGrantCandidate) { c.SourceLongitude = math.Inf(1) },
		func(c *baiduPhotoMapGrantCandidate) { c.SourceLatitude = 91 },
		func(c *baiduPhotoMapGrantCandidate) { c.SourceLongitude = -181 },
		func(c *baiduPhotoMapGrantCandidate) { c.ExpectedConsentRevision = ^uint64(0) },
	} {
		candidate := valid
		mutate(&candidate)
		if validBaiduPhotoMapGrantCandidate(candidate) {
			t.Fatal("invalid grant candidate passed preflight")
		}
	}
	var db *gorm.DB
	actor := func(context.Context, *gorm.DB, uint64, uint64) (auditpkg.Event, error) {
		return auditpkg.Event{}, nil
	}
	if _, err := grantBaiduPhotoMapConsent(context.Background(), db, valid, actor); err == nil {
		t.Fatal("nil DB allowed private grant")
	}
	if _, err := grantBaiduPhotoMapConsent(context.Background(), db, valid, nil); err == nil {
		t.Fatal("missing independent owner decision allowed grant")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := grantBaiduPhotoMapConsent(ctx, db, valid, actor); err == nil {
		t.Fatal("cancelled context allowed grant")
	}
}

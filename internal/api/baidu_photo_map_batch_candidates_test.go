package api

import (
	"context"
	"encoding/json"
	"math"
	"strings"
	"testing"
	"time"
)

func TestBaiduPhotoMapBatchGrantLimitsAndPrivateCandidate(t *testing.T) {
	for _, n := range []int{-1, 0, 33, 64, 100000} {
		if validBaiduPhotoMapGrantBatchLimit(n) {
			t.Fatalf("unsafe limit accepted: %d", n)
		}
	}
	for _, n := range []int{1, 16, 32} {
		if !validBaiduPhotoMapGrantBatchLimit(n) {
			t.Fatalf("valid bounded limit denied: %d", n)
		}
	}
	c := baiduPhotoMapGrantBatchCandidate{
		AssetID: 8, PrimaryNodeID: 9, NodeRevision: 4,
		MediaUpdatedAt: time.Now().UTC(), ConsentRevision: 0,
		SourceLatitude: 0, SourceLongitude: 0,
	}
	if !validBaiduPhotoMapGrantBatchCandidate(c) {
		t.Fatal("legitimate (0,0) source wrongly dropped")
	}
	if encoded, err := json.Marshal(c); err == nil ||
		strings.Contains(string(encoded), "SourceLatitude") ||
		strings.Contains(string(encoded), "source_latitude") ||
		strings.Contains(string(encoded), "asset_id") {
		t.Fatalf("private candidate could be serialized: %s %v", encoded, err)
	}
	for _, bad := range []baiduPhotoMapGrantBatchCandidate{
		func() baiduPhotoMapGrantBatchCandidate { v := c; v.AssetID = 0; return v }(),
		func() baiduPhotoMapGrantBatchCandidate { v := c; v.NodeRevision = 0; return v }(),
		func() baiduPhotoMapGrantBatchCandidate { v := c; v.MediaUpdatedAt = time.Time{}; return v }(),
		func() baiduPhotoMapGrantBatchCandidate { v := c; v.ConsentRevision = ^uint64(0); return v }(),
		func() baiduPhotoMapGrantBatchCandidate { v := c; v.SourceLatitude = math.NaN(); return v }(),
		func() baiduPhotoMapGrantBatchCandidate { v := c; v.SourceLatitude = 91; return v }(),
		func() baiduPhotoMapGrantBatchCandidate { v := c; v.SourceLongitude = math.Inf(1); return v }(),
		func() baiduPhotoMapGrantBatchCandidate { v := c; v.SourceLongitude = -181; return v }(),
	} {
		if validBaiduPhotoMapGrantBatchCandidate(bad) {
			t.Fatal("invalid GPS/source candidate accepted")
		}
	}
}

func TestBaiduPhotoMapBatchRequiresRealOwnerContextAndDB(t *testing.T) {
	if _, err := queryBaiduPhotoMapGrantBatchCandidates(nil, nil, 1, 32); err == nil {
		t.Fatal("nil context and db accepted")
	}
	if _, err := queryBaiduPhotoMapGrantBatchCandidates(context.Background(), nil, 1, 32); err == nil {
		t.Fatal("nil db accepted")
	}
	if _, err := queryBaiduPhotoMapGrantBatchCandidates(context.Background(), nil, 0, 32); err == nil {
		t.Fatal("no Owner accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := queryBaiduPhotoMapGrantBatchCandidates(ctx, nil, 1, 32); err == nil {
		t.Fatal("cancelled request accepted")
	}
}

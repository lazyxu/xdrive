package client

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestLocalPushStagingClientRejectsMalformedOrUnfencedReply(t *testing.T) {
	sourceID, revision, size := uint64(21), uint64(7), uint64(5)
	stageID := uuid.NewString()
	now := time.Now().UTC().Add(20 * time.Minute)
	valid := LocalPushStagingResult{
		StageID: stageID, SourceID: sourceID, Revision: revision,
		Size: int64(size), Status: "staged", ExpiresAt: now,
	}
	check := func(out LocalPushStagingResult, cache, etag string) error {
		raw, err := json.Marshal(out)
		if err != nil {
			t.Fatal(err)
		}
		response := &http.Response{
			StatusCode: http.StatusOK,
			Header: http.Header{
				"Cache-Control": []string{cache},
				"Etag":          []string{etag},
			},
			Body: io.NopCloser(strings.NewReader(string(raw))),
		}
		_, err = validateLocalPushStagingOutput(response, sourceID, revision, size, stageID)
		return err
	}
	if err := check(valid, "private, no-store", "\"7\""); err != nil {
		t.Fatalf("valid private staging response refused: %v", err)
	}
	for name, mutate := range map[string]func(*LocalPushStagingResult){
		"wrong stage":    func(v *LocalPushStagingResult) { v.StageID = uuid.NewString() },
		"wrong source":   func(v *LocalPushStagingResult) { v.SourceID++ },
		"wrong revision": func(v *LocalPushStagingResult) { v.Revision++ },
		"wrong size":     func(v *LocalPushStagingResult) { v.Size++ },
		"unknown status": func(v *LocalPushStagingResult) { v.Status = "committed" },
		"no expiry":      func(v *LocalPushStagingResult) { v.ExpiresAt = time.Time{} },
	} {
		t.Run(name, func(t *testing.T) {
			bad := valid
			mutate(&bad)
			if err := check(bad, "private, no-store", "\"7\""); err == nil {
				t.Fatal("unsafe private staging response accepted")
			}
		})
	}
	if err := check(valid, "public, max-age=300", "\"7\""); err == nil {
		t.Fatal("cacheable private staging response accepted")
	}
	if err := check(valid, "private, no-store", "\"8\""); err == nil {
		t.Fatal("stale private staging revision accepted")
	}
}

func TestLocalPushStagingClientInputRejectsUnboundedOrMissingNativeClaim(t *testing.T) {
	valid := LocalPushStagingInput{
		CurrentSnapshotSHA256: strings.Repeat("a", 64),
		CurrentPathKey:        strings.Repeat("b", 64),
		SHA256:                strings.Repeat("c", 64), Size: 2048,
	}
	if !validLocalPushStagingInput(valid) {
		t.Fatal("valid staging metadata refused")
	}
	if validLocalPushStageProof(context.Background(), 9, 1, LocalBoundSourceProof{}) {
		t.Fatal("missing device credential accepted")
	}
	bad := valid
	bad.Size = localPushStageLimitBytes + 1
	if validLocalPushStagingInput(bad) {
		t.Fatal("oversize native staging claim accepted")
	}
	bad = valid
	bad.CurrentPathKey = strings.Repeat("B", 64)
	if validLocalPushStagingInput(bad) {
		t.Fatal("uppercase native path key accepted")
	}
}

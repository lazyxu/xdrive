package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestLocalCommonBatchHistoryProjectionNeverIncludesNativeIdentity(t *testing.T) {
	now := time.Now().UTC()
	page := localBackupCommonBatchHistoryPage{
		SourceID: 42,
		Items: []localBackupCommonBatchHistoryItem{{
			RunID:    "d878809a-cd7d-489a-b181-8f5e91e57c96",
			SourceID: 42, Revision: 9, State: "uncertain",
			InspectedFiles: 3, ConfirmedFiles: 1, SkippedFiles: 1,
			UncertainFiles: 1, ConfirmedBytes: 20,
			StartedAt: now.Add(-time.Minute), FinishedAt: now,
		}},
	}
	raw, err := json.Marshal(page)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{
		"root_id", "root_fingerprint", "session_digest", "operation_id",
		"device_token", "absolute_path", "target_node_id", "content_sha256",
		"backup_complete", "retirement_safe", "current_cas_verified",
	} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("owner-private history leaked internal identity %q", forbidden)
		}
	}
	var recovered localBackupCommonBatchHistoryPage
	if err := json.Unmarshal(raw, &recovered); err != nil ||
		recovered.SourceID != 42 || len(recovered.Items) != 1 ||
		recovered.Items[0].State != "uncertain" ||
		recovered.Items[0].ConfirmedBytes != 20 {
		t.Fatalf("owner-only redacted run DTO failed round-trip: %+v %v", recovered, err)
	}
}

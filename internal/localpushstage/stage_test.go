package localpushstage

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
)

func TestPrivateRenameBatchStagesOnlyExistingCanonicalSourceItem(t *testing.T) {
	grant := localpush.RootGrant{
		SourceID: 42, RootID: uuid.NewString(),
		DeviceID: uuid.NewString(), Fingerprint: strings.Repeat("a", 64),
	}
	proof := client.LocalBoundSourceProof{
		DeviceID: grant.DeviceID, DeviceToken: "os-only-token",
		RootID: grant.RootID, RootFingerprint: grant.Fingerprint,
	}
	hints := []localpush.InventoryRenameHint{{
		PreviousPath: "old.txt", CurrentPath: "new.txt",
		NativeIdentityKey: strings.Repeat("b", 64),
	}}
	manifest := localpush.LocalReconcileEvidence{
		PreviousSHA256: strings.Repeat("1", 64),
		CurrentSHA256:  strings.Repeat("2", 64),
	}
	oldKey, err := localpush.LocalInventoryPathKey(grant, "file", "old.txt")
	if err != nil {
		t.Fatal(err)
	}
	newKey, err := localpush.LocalInventoryPathKey(grant, "file", "new.txt")
	if err != nil {
		t.Fatal(err)
	}
	mode := "stage"
	lookups, writes := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("X-XDrive-Device-ID") != proof.DeviceID ||
			r.Header.Get("X-XDrive-Device-Token") != proof.DeviceToken ||
			r.Header.Get("X-XDrive-Local-Root-ID") != grant.RootID ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != grant.Fingerprint ||
			r.Header.Get("If-Match") != "\"7\"" {
			t.Error("private call lost device, Root or source revision proof")
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/sources/42/local-identity/lookup":
			lookups++
			var input struct {
				Identities []string `json:"identities"`
			}
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil ||
				r.Method != http.MethodPost || len(input.Identities) != 2 ||
				input.Identities[0] != oldKey || input.Identities[1] != newKey {
				t.Errorf("unexpected bounded path lookup: %+v err=%v", input, err)
			}
			switch mode {
			case "missing":
				_, _ = fmt.Fprint(w, `{"source_id":42,"revision":7,"input_count":2,"matches":[],"authoritative":false,"missing_inference_safe":false}`)
			case "collision":
				_, _ = fmt.Fprint(w, `{"source_id":42,"revision":7,"input_count":2,"matches":[{"index":0,"source_item_id":91},{"index":1,"source_item_id":92}],"authoritative":false,"missing_inference_safe":false}`)
			default:
				_, _ = fmt.Fprint(w, `{"source_id":42,"revision":7,"input_count":2,"matches":[{"index":0,"source_item_id":91}],"authoritative":false,"missing_inference_safe":false}`)
			}
		case "/api/v1/sources/42/local-identity/evidence":
			writes++
			var input client.LocalSourceItemEvidenceInput
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil ||
				r.Method != http.MethodPost || input.SourceItemID != 91 ||
				input.PreviousPathKey != oldKey || input.CurrentPathKey != newKey ||
				input.PreviousSnapshotSHA256 != manifest.PreviousSHA256 ||
				input.CurrentSnapshotSHA256 != manifest.CurrentSHA256 ||
				input.PreviousNativeKey != hints[0].NativeIdentityKey ||
				!input.PreviousStrong || input.PreviousLinkCount != 1 {
				t.Errorf("unverified or wrong evidence: %+v err=%v", input, err)
			}
			_, _ = fmt.Fprint(w, `{"source_id":42,"revision":7,"source_item_id":91,"evidence_id":5,"stored":true,"replayed":false,"authoritative":false,"missing_inference_safe":false}`)
		default:
			t.Errorf("unexpected endpoint: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	cli := client.New(server.URL, "owner")
	matched, missing, stored, replayed, err := stageLocalRenameBatch(cli,
		context.Background(), grant, 7, proof, manifest, hints)
	if err != nil || matched != 1 || missing != 0 || stored != 1 || replayed != 0 ||
		lookups != 1 || writes != 1 {
		t.Fatalf("stage existing canonical failed: matched=%d missing=%d stored=%d replayed=%d err=%v",
			matched, missing, stored, replayed, err)
	}
	mode = "missing"
	matched, missing, stored, replayed, err = stageLocalRenameBatch(cli,
		context.Background(), grant, 7, proof, manifest, hints)
	if err != nil || matched != 0 || missing != 1 || stored != 0 || replayed != 0 || writes != 1 {
		t.Fatalf("unmatched local hint must not create SourceItem: %v", err)
	}
	mode = "collision"
	if _, _, _, _, err := stageLocalRenameBatch(cli,
		context.Background(), grant, 7, proof, manifest, hints); err == nil || writes != 1 {
		t.Fatalf("destination identity collision produced evidence: err=%v writes=%d", err, writes)
	}
	before := lookups
	invalid := []localpush.InventoryRenameHint{{
		PreviousPath: "../escape", CurrentPath: "new.txt",
		NativeIdentityKey: strings.Repeat("b", 64),
	}}
	if _, _, _, _, err := stageLocalRenameBatch(cli,
		context.Background(), grant, 7, proof, manifest, invalid); err == nil ||
		lookups != before {
		t.Fatalf("unsafe path made remote call: err=%v lookups=%d", err, lookups)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, _, _, err := stageLocalRenameBatch(cli,
		ctx, grant, 7, proof, manifest, hints); err == nil || writes != 1 {
		t.Fatalf("cancelled private call staged evidence: err=%v writes=%d", err, writes)
	}
}

func TestVerifiedRenameGenerationRequiresExactSealedJournals(t *testing.T) {
	m := localpush.LocalReconcileEvidence{
		PreviousSnapshot: "previous", PreviousSHA256: "old", PreviousItems: 3,
		CurrentSnapshot: "current", CurrentSHA256: "new", CurrentItems: 3,
		Added: 1, Changed: 1, MetadataStable: 1, AbsentCandidates: 1,
	}
	s := localpush.InventoryRenameHintSummary{
		Delta: localpush.InventoryDeltaSummary{
			Previous: localpush.InventoryJournalSnapshot{SnapshotName: "previous", SnapshotSHA256: "old", Items: 3},
			Current:  localpush.InventoryJournalSnapshot{SnapshotName: "current", SnapshotSHA256: "new", Items: 3},
			Added:    1, Changed: 1, MetadataStable: 1, AbsentCandidates: 1,
		},
		Hints: 1,
	}
	if !verifiedRenameGeneration(m, s) {
		t.Fatal("matching advisory generation rejected")
	}
	s.Hints = 2
	if verifiedRenameGeneration(m, s) {
		t.Fatal("hint count exceeded verified additions/absence")
	}
	s.Hints = 1
	m.Authoritative = true
	if verifiedRenameGeneration(m, s) {
		t.Fatal("authoritative flag accepted for untrusted hints")
	}
	m.Authoritative = false
	m.CurrentSHA256 = "changed"
	if verifiedRenameGeneration(m, s) {
		t.Fatal("changed local generation was accepted")
	}
}

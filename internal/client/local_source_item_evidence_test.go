package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestStoreLocalSourceItemEvidenceUsesOwningRootProofAndRejectsUnsafeReplies(t *testing.T) {
	var calls atomic.Int32
	var reply atomic.Value
	reply.Store(`{"source_id":42,"revision":7,"source_item_id":91,"evidence_id":12,"stored":true,"replayed":false,"authoritative":false,"missing_inference_safe":false}`)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/sources/42/local-identity/evidence" ||
			r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("X-XDrive-Device-ID") != "device-A" ||
			r.Header.Get("X-XDrive-Device-Token") != "OS-secret-credential" ||
			r.Header.Get("X-XDrive-Local-Root-ID") != "root-A" ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != "fingerprint-A" ||
			r.Header.Get("If-Match") != "\"7\"" {
			t.Error("private SourceItem evidence omitted own-device credential, Root or revision")
		}
		var body LocalSourceItemEvidenceInput
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
			body.SourceItemID != 91 || body.PreviousLinkCount != 1 ||
			body.CurrentLinkCount != 1 || !body.PreviousStrong || !body.CurrentStrong {
			t.Errorf("invalid request DTO: %+v err=%v", body, err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(reply.Load().(string)))
	}))
	defer server.Close()
	cli := New(server.URL, "owner")
	proof := LocalBoundSourceProof{
		DeviceID: "device-A", DeviceToken: "OS-secret-credential",
		RootID: "root-A", RootFingerprint: "fingerprint-A",
	}
	input := LocalSourceItemEvidenceInput{
		SourceItemID:           91,
		PreviousSnapshotSHA256: strings.Repeat("1", 64),
		CurrentSnapshotSHA256:  strings.Repeat("2", 64),
		PreviousPathKey:        strings.Repeat("3", 64),
		CurrentPathKey:         strings.Repeat("4", 64),
		PreviousNativeKey:      strings.Repeat("5", 64),
		CurrentNativeKey:       strings.Repeat("5", 64),
		PreviousStrong:         true, CurrentStrong: true,
		PreviousLinkCount: 1, CurrentLinkCount: 1,
	}
	if _, err := cli.StoreLocalSourceItemEvidence(context.Background(), 0, 7, proof, input); err == nil {
		t.Fatal("zero Source ID accepted")
	}
	if _, err := cli.StoreLocalSourceItemEvidence(context.Background(), 42, 0, proof, input); err == nil {
		t.Fatal("zero revision accepted")
	}
	for _, change := range []func(*LocalSourceItemEvidenceInput){
		func(v *LocalSourceItemEvidenceInput) { v.SourceItemID = 0 },
		func(v *LocalSourceItemEvidenceInput) { v.CurrentPathKey = v.PreviousPathKey },
		func(v *LocalSourceItemEvidenceInput) { v.CurrentNativeKey = strings.Repeat("6", 64) },
		func(v *LocalSourceItemEvidenceInput) { v.PreviousStrong = false },
		func(v *LocalSourceItemEvidenceInput) { v.CurrentLinkCount = 2 },
		func(v *LocalSourceItemEvidenceInput) { v.CurrentSnapshotSHA256 = strings.Repeat("0", 64) },
	} {
		copy := input
		change(&copy)
		if _, err := cli.StoreLocalSourceItemEvidence(context.Background(), 42, 7, proof, copy); err == nil {
			t.Fatalf("unsafe evidence was sent: %+v", copy)
		}
	}
	if calls.Load() != 0 {
		t.Fatalf("invalid private evidence contacted Server: %d", calls.Load())
	}
	saved, err := cli.StoreLocalSourceItemEvidence(context.Background(), 42, 7, proof, input)
	if err != nil || saved.SourceItemID != 91 || saved.EvidenceID != 12 ||
		saved.Replayed || !saved.Stored || saved.Authoritative || saved.MissingInferenceSafe {
		t.Fatalf("private evidence failed or unsafe: %+v err=%v", saved, err)
	}
	for _, invalid := range []string{
		`{"source_id":42,"revision":8,"source_item_id":91,"evidence_id":12,"stored":true}`,
		`{"source_id":42,"revision":7,"source_item_id":92,"evidence_id":12,"stored":true}`,
		`{"source_id":42,"revision":7,"source_item_id":91,"evidence_id":0,"stored":true}`,
		`{"source_id":42,"revision":7,"source_item_id":91,"evidence_id":12,"stored":false}`,
		`{"source_id":42,"revision":7,"source_item_id":91,"evidence_id":12,"stored":true,"authoritative":true}`,
		`{"source_id":42,"revision":7,"source_item_id":91,"evidence_id":12,"stored":true,"missing_inference_safe":true}`,
	} {
		reply.Store(invalid)
		if _, err := cli.StoreLocalSourceItemEvidence(context.Background(), 42, 7, proof, input); err == nil {
			t.Fatalf("invalid Server evidence was accepted: %s", invalid)
		}
	}
}
